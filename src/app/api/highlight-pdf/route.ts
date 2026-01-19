import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { logAction } from "@/lib/supabase";
import { extractText } from "unpdf";

interface TransactionRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
}

// 날짜 패턴 (다양한 형식 지원)
const DATE_PATTERNS = [
  /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/,  // 2024.01.15, 2024-01-15
  /(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/,  // 24.01.15
  /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,    // 2024년 1월 15일
];

// 금액 파싱
function parseAmount(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/[,\s원₩]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}

// 날짜 추출
function extractDate(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

// PDF 텍스트에서 거래내역 추출
function parseTransactions(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactions: TransactionRow[] = [];

  // 금액 패턴 (콤마 포함 숫자)
  const amountPattern = /[\d,]+(?:\.\d+)?/g;

  for (const line of lines) {
    const date = extractDate(line);
    if (!date) continue;

    // 금액들 추출
    const amounts = line.match(amountPattern) || [];
    const parsedAmounts = amounts.map(a => parseAmount(a)).filter(a => a > 0);

    if (parsedAmounts.length === 0) continue;

    // 거래 내역으로 판단되는 행
    const transaction: TransactionRow = {
      date: date,
      description: line.replace(date, "").trim(),
      deposit: 0,
      withdrawal: 0,
      balance: 0,
    };

    // 금액 할당 (휴리스틱: 마지막이 잔액, 그 전이 입출금)
    if (parsedAmounts.length >= 3) {
      transaction.balance = parsedAmounts[parsedAmounts.length - 1];
      // 입금/출금 구분은 텍스트 키워드로
      if (line.includes("입금") || line.includes("받으신") || line.includes("맡기신")) {
        transaction.deposit = parsedAmounts[parsedAmounts.length - 2];
      } else if (line.includes("출금") || line.includes("찾으신") || line.includes("보내신") || line.includes("이체")) {
        transaction.withdrawal = parsedAmounts[parsedAmounts.length - 2];
      } else {
        // 기본적으로 두 번째를 출금으로 처리
        transaction.withdrawal = parsedAmounts[parsedAmounts.length - 2];
      }
    } else if (parsedAmounts.length === 2) {
      transaction.balance = parsedAmounts[1];
      transaction.withdrawal = parsedAmounts[0];
    } else if (parsedAmounts.length === 1) {
      transaction.withdrawal = parsedAmounts[0];
    }

    // 유효한 거래만 추가
    if (transaction.deposit > 0 || transaction.withdrawal > 0) {
      transactions.push(transaction);
    }
  }

  return transactions;
}

// PDF에서 텍스트 추출
async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(buffer, { mergePages: true });
  return text;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email || "unknown";

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const threshold = parseInt(formData.get("threshold") as string) || 0;
    const color = (formData.get("color") as string) || "FFFF00";

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // PDF 읽기
    const arrayBuffer = await file.arrayBuffer();
    const text = await extractTextFromPdf(arrayBuffer);
    const transactions = parseTransactions(text);

    if (transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 찾을 수 없습니다. PDF 형식을 확인해주세요." },
        { status: 400 }
      );
    }

    // Excel 파일 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("거래내역");

    // 헤더
    worksheet.columns = [
      { header: "날짜", key: "date", width: 15 },
      { header: "내용", key: "description", width: 40 },
      { header: "입금", key: "deposit", width: 15 },
      { header: "출금", key: "withdrawal", width: 15 },
      { header: "잔액", key: "balance", width: 15 },
    ];

    // 헤더 스타일
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // 데이터 추가 및 하이라이트
    let highlightedRows = 0;
    for (const tx of transactions) {
      const row = worksheet.addRow({
        date: tx.date,
        description: tx.description,
        deposit: tx.deposit || "",
        withdrawal: tx.withdrawal || "",
        balance: tx.balance || "",
      });

      // 기준 금액 이상이면 하이라이트
      const maxAmount = Math.max(tx.deposit, tx.withdrawal);
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

      // 금액 포맷
      if (tx.deposit > 0) {
        row.getCell("deposit").numFmt = "#,##0";
      }
      if (tx.withdrawal > 0) {
        row.getCell("withdrawal").numFmt = "#,##0";
      }
      if (tx.balance > 0) {
        row.getCell("balance").numFmt = "#,##0";
      }
    }

    // 작업 로그 기록
    await logAction(userEmail, "highlight_pdf_transactions", {
      fileName: file.name,
      fileSize: file.size,
      threshold: threshold,
      color: color,
      totalRows: transactions.length,
      highlightedRows: highlightedRows,
    });

    // 결과 파일 생성
    const outputBuffer = await workbook.xlsx.writeBuffer();

    const originalName = file.name.replace(/\.[^/.]+$/, "");
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="highlighted_${originalName}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("PDF Highlight error:", error);

    await logAction(userEmail, "highlight_pdf_error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF 처리 중 오류 발생" },
      { status: 500 }
    );
  }
}
