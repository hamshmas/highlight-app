import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { logAction } from "@/lib/supabase";

interface TransactionRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
}

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
    }: {
      transactions: TransactionRow[];
      threshold: number;
      color: string;
      fileName: string;
    } = body;

    if (!transactions || transactions.length === 0) {
      return NextResponse.json({ error: "거래내역이 없습니다" }, { status: 400 });
    }

    if (!threshold || threshold <= 0) {
      return NextResponse.json({ error: "기준 금액을 확인해주세요" }, { status: 400 });
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
      const maxAmount = Math.max(tx.deposit || 0, tx.withdrawal || 0);
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
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="highlighted_${originalName}.xlsx"`,
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
