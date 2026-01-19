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

// 금액 파싱 (음수 포함)
function parseAmount(str: string): { value: number; isNegative: boolean } {
  if (!str) return { value: 0, isNegative: false };
  const isNegative = str.includes("-");
  const cleaned = str.replace(/[,\s원₩\-]/g, "").trim();
  if (!cleaned || cleaned === "") return { value: 0, isNegative: false };
  const num = parseFloat(cleaned);
  return isNaN(num) ? { value: 0, isNegative: false } : { value: Math.abs(num), isNegative };
}

// PDF 텍스트에서 거래내역 추출 (카카오뱅크/케이뱅크 형식)
function parseTransactions(text: string): TransactionRow[] {
  const transactions: TransactionRow[] = [];

  // 카카오뱅크 형식: 2024.10.30 10:15:15 출금 -1,300 503,426 ...
  // 날짜 + 시간 + 구분 + 금액 + 잔액 + 내용 패턴
  const kakaoPattern = /(\d{4}\.\d{2}\.\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(입금|출금)\s+([\-\d,]+)\s+([\d,]+)\s+(.+?)(?=\d{4}\.\d{2}\.\d{2}|$)/g;

  let match;
  while ((match = kakaoPattern.exec(text)) !== null) {
    const date = match[1];
    const type = match[3];
    const amountStr = match[4];
    const balanceStr = match[5];
    const description = match[6].trim();

    const amount = parseAmount(amountStr);
    const balance = parseAmount(balanceStr);

    const transaction: TransactionRow = {
      date: date,
      description: description.split(/\s{2,}/)[0] || description, // 첫 번째 부분만
      deposit: type === "입금" ? amount.value : 0,
      withdrawal: type === "출금" ? amount.value : 0,
      balance: balance.value,
    };

    if (transaction.deposit > 0 || transaction.withdrawal > 0) {
      transactions.push(transaction);
    }
  }

  // 카카오뱅크 패턴으로 찾지 못한 경우, 더 유연한 패턴 시도
  if (transactions.length === 0) {
    // 케이뱅크 및 기타 형식
    // 날짜 패턴: 2024. 10.26 또는 2024.10.26
    const datePattern = /(\d{4})\.\s*(\d{1,2})\.(\d{1,2})/g;
    const dates: { date: string; index: number }[] = [];

    let dateMatch;
    while ((dateMatch = datePattern.exec(text)) !== null) {
      const year = dateMatch[1];
      const month = dateMatch[2].padStart(2, "0");
      const day = dateMatch[3].padStart(2, "0");
      dates.push({
        date: `${year}.${month}.${day}`,
        index: dateMatch.index,
      });
    }

    // 각 날짜 주변에서 금액 찾기
    for (let i = 0; i < dates.length; i++) {
      const startIdx = dates[i].index;
      const endIdx = i < dates.length - 1 ? dates[i + 1].index : text.length;
      const segment = text.substring(startIdx, endIdx);

      // 금액 패턴 (음수 포함)
      const amounts: { value: number; isNegative: boolean }[] = [];
      const amountMatches = segment.match(/-?[\d,]+/g) || [];

      for (const am of amountMatches) {
        const parsed = parseAmount(am);
        if (parsed.value > 0) {
          amounts.push(parsed);
        }
      }

      if (amounts.length >= 2) {
        // 입금/출금 구분
        const isDeposit = segment.includes("입금") || segment.includes("이자");
        const isWithdrawal = segment.includes("출금") || segment.includes("대출원리금") || segment.includes("전자금융");

        // 첫 번째 큰 금액이 거래금액, 두 번째가 잔액인 경우가 많음
        let transactionAmount = amounts[0];
        let balanceAmount = amounts.length > 1 ? amounts[1] : { value: 0, isNegative: false };

        // 음수면 출금
        const transaction: TransactionRow = {
          date: dates[i].date,
          description: segment.replace(/\d{4}\.\s*\d{1,2}\.\d{1,2}/, "").trim().substring(0, 50),
          deposit: (isDeposit || (!isWithdrawal && !transactionAmount.isNegative)) && !transactionAmount.isNegative ? transactionAmount.value : 0,
          withdrawal: (isWithdrawal || transactionAmount.isNegative) ? transactionAmount.value : 0,
          balance: balanceAmount.value,
        };

        // 이자 0원 같은 건 제외
        if (transaction.deposit > 0 || transaction.withdrawal > 0) {
          transactions.push(transaction);
        }
      }
    }
  }

  // 여전히 없으면 원본 라인 기반 파싱
  if (transactions.length === 0) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const simpleDatePattern = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/;

    for (const line of lines) {
      const dateMatch = line.match(simpleDatePattern);
      if (!dateMatch) continue;

      const amountMatches = line.match(/-?[\d,]+/g) || [];
      const amounts = amountMatches.map(a => parseAmount(a)).filter(a => a.value > 0);

      if (amounts.length === 0) continue;

      const isDeposit = line.includes("입금");
      const transaction: TransactionRow = {
        date: dateMatch[0],
        description: line.replace(dateMatch[0], "").trim().substring(0, 50),
        deposit: isDeposit ? amounts[0].value : 0,
        withdrawal: !isDeposit ? amounts[0].value : 0,
        balance: amounts.length > 1 ? amounts[amounts.length - 1].value : 0,
      };

      if (transaction.deposit > 0 || transaction.withdrawal > 0) {
        transactions.push(transaction);
      }
    }
  }

  return transactions;
}

// PDF에서 텍스트 추출
async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  // Uint8Array로 변환하여 전달
  const uint8Array = new Uint8Array(buffer);
  const { text } = await extractText(uint8Array, { mergePages: true });
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
