import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { logAction } from "@/lib/supabase";

// 동적 컬럼 지원
type TransactionRow = Record<string, string | number>;

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email || "unknown";

  try {
    const body = await request.json();
    const {
      transactions,
      threshold,
      color,
      fileName,
      columns,
    }: {
      transactions: TransactionRow[];
      threshold: number;
      color: string;
      fileName: string;
      columns: string[];
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

    // 동적 헤더 설정
    worksheet.columns = effectiveColumns.map((col) => ({
      header: col,
      key: col,
      width: col.includes("금액") || col.includes("잔액") || col.includes("입금") || col.includes("출금") ? 15 :
             col.includes("일") || col.includes("date") ? 15 : 25,
    }));

    // 헤더 스타일
    const headerRow = worksheet.getRow(1);
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
      const rowData: Record<string, unknown> = {};
      for (const col of effectiveColumns) {
        rowData[col] = tx[col] ?? "";
      }
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

      // 금액 컬럼 포맷
      for (const col of effectiveColumns) {
        if (isAmountColumn(col) && typeof tx[col] === "number" && tx[col] > 0) {
          row.getCell(col).numFmt = "#,##0";
        }
      }
    }

    // 작업 로그 기록
    await logAction(userEmail, "ocr_highlight_transactions", {
      fileName: fileName,
      threshold: threshold,
      color: color,
      totalRows: transactions.length,
      highlightedRows: highlightedRows,
    });

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
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel 생성 중 오류 발생" },
      { status: 500 }
    );
  }
}
