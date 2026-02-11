import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";
import { logAction } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

// 동적 컬럼 지원
type TransactionRow = Record<string, string | number>;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  const provider = (session as any).provider;
  const userId = (session as any).providerAccountId || userEmail;
  if (!userEmail) {
    return NextResponse.json(
      { error: "세션 정보가 유효하지 않습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  // Rate limit: 분당 20회
  const { allowed } = rateLimit(`ocr-highlight:${userId}`, 20, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const body = await request.json();
    const {
      transactions,
      threshold,
      color,
      fileName,
      columns,
      accountInfo,
    }: {
      transactions: TransactionRow[];
      threshold: number;
      color: string;
      fileName: string;
      columns: string[];
      accountInfo?: {
        bankName: string;
        accountHolder: string;
        accountNumber: string;
        queryPeriod: string;
      };
    } = body;

    if (!transactions || transactions.length === 0) {
      return NextResponse.json({ error: "거래내역이 없습니다" }, { status: 400 });
    }

    if (!threshold || threshold <= 0) {
      return NextResponse.json({ error: "기준 금액을 확인해주세요" }, { status: 400 });
    }

    // 동적 컬럼 사용 (서버에서 전달받거나 첫 번째 거래에서 추출)
    const effectiveColumns = columns && columns.length > 0
      ? columns
      : Object.keys(transactions[0] || {});

    // Excel 파일 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("거래내역");

    // 계좌 정보가 있으면 상단에 표시
    const hasAccountInfo = accountInfo && (
      accountInfo.bankName ||
      accountInfo.accountHolder ||
      accountInfo.accountNumber ||
      accountInfo.queryPeriod
    );

    if (hasAccountInfo) {
      // 계좌 정보 행 추가
      if (accountInfo.bankName) {
        const row = worksheet.addRow(["금융기관", accountInfo.bankName]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E8FF" } };
      }
      if (accountInfo.accountHolder) {
        const row = worksheet.addRow(["계좌주명", accountInfo.accountHolder]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E8FF" } };
      }
      if (accountInfo.accountNumber) {
        const row = worksheet.addRow(["계좌번호", accountInfo.accountNumber]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E8FF" } };
      }
      if (accountInfo.queryPeriod) {
        const row = worksheet.addRow(["조회기간", accountInfo.queryPeriod]);
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E8FF" } };
      }
      // 빈 줄 추가
      worksheet.addRow([]);
    }

    // 동적 헤더 설정 (컬럼 너비만 설정, 헤더는 수동 추가)
    const colWidths = effectiveColumns.map((col) => ({
      width: col.includes("금액") || col.includes("잔액") || col.includes("입금") || col.includes("출금") ? 15 :
             col.includes("일") || col.includes("date") ? 15 : 25,
    }));

    // 컬럼 너비 설정
    effectiveColumns.forEach((col, idx) => {
      worksheet.getColumn(idx + 1).width = colWidths[idx].width;
    });

    // 헤더 행 추가
    const headerRow = worksheet.addRow(effectiveColumns);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // 동적 금액 컬럼 판별 함수
    const findAmountValue = (tx: TransactionRow, keywords: string[]): number => {
      for (const key of Object.keys(tx)) {
        if (keywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
          const val = tx[key];
          if (typeof val === "number") return val;
          if (typeof val === "string") return parseFloat(val.replace(/[,원₩]/g, "")) || 0;
        }
      }
      return 0;
    };

    const depositKeywords = ["입금", "입금액", "입금금액", "맡기신", "받으신", "deposit"];
    const withdrawalKeywords = ["출금", "출금액", "출금금액", "찾으신", "보내신", "withdrawal"];
    const generalAmountKeywords = ["거래금액", "금액", "amount"];

    // 금액 컬럼 판별 함수
    const isAmountColumn = (key: string): boolean => {
      const amountKeywords = ["금액", "잔액", "입금", "출금", "deposit", "withdrawal", "balance", "amount"];
      return amountKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
    };

    // 데이터 추가 및 하이라이트
    let highlightedRows = 0;
    for (const tx of transactions) {
      // 배열 형식으로 데이터 생성 (컬럼 순서대로)
      const rowData = effectiveColumns.map(col => tx[col] ?? "");
      const row = worksheet.addRow(rowData);

      // 동적 금액 판별로 하이라이트
      const depositVal = findAmountValue(tx, depositKeywords);
      const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
      const generalAmount = findAmountValue(tx, generalAmountKeywords);
      const maxAmount = Math.max(depositVal, withdrawalVal, generalAmount);

      if (maxAmount >= threshold) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + color },
          };
        });
        highlightedRows++;
      }

      // 금액 컬럼 포맷 (인덱스 기반)
      effectiveColumns.forEach((col, idx) => {
        if (isAmountColumn(col) && typeof tx[col] === "number" && tx[col] > 0) {
          row.getCell(idx + 1).numFmt = "#,##0";
        }
      });
    }

    // 작업 로그 기록
    await logAction(userEmail, "ocr_highlight_transactions", {
      fileName: fileName,
      threshold: threshold,
      color: color,
      totalRows: transactions.length,
      highlightedRows: highlightedRows,
    }, userId, provider);

    // 결과 파일 생성
    const outputBuffer = await workbook.xlsx.writeBuffer();

    const originalName = fileName.replace(/\.[^/.]+$/, "");
    const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error("OCR Highlight error:", error);

    await logAction(userEmail, "ocr_highlight_error", {
      error: error instanceof Error ? error.message : "Unknown error",
    }, userId, provider);

    return NextResponse.json(
      { error: "Excel 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
