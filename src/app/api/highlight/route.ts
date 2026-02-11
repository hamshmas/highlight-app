import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { logAction } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

// .xls 파일을 .xlsx 형식으로 변환
async function convertXlsToXlsx(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const xlsWorkbook = XLSX.read(arrayBuffer, { type: "array" });
  const xlsxBuffer = XLSX.write(xlsWorkbook, { type: "array", bookType: "xlsx" });
  return xlsxBuffer;
}

export async function POST(request: NextRequest) {
  // 인증 확인
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
  const { allowed } = rateLimit(`highlight:${userId}`, 20, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const threshold = parseInt(formData.get("threshold") as string) || 0;
    const color = (formData.get("color") as string) || "FFFF00";

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // 파일 읽기
    let arrayBuffer = await file.arrayBuffer();

    // 파일 확장자 확인 및 변환
    const fileName = file.name.toLowerCase();
    const isXls = fileName.endsWith(".xls") && !fileName.endsWith(".xlsx");

    if (isXls) {
      // .xls 파일을 .xlsx로 변환
      arrayBuffer = await convertXlsToXlsx(arrayBuffer);
    }

    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(arrayBuffer);
    } catch {
      // xlsx 로드 실패 시 xls로 시도
      const convertedBuffer = await convertXlsToXlsx(arrayBuffer);
      await workbook.xlsx.load(convertedBuffer);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json({ error: "워크시트를 찾을 수 없습니다" }, { status: 400 });
    }

    // 헤더 행 찾기
    let headerRow = 1;
    const headerKeywords = ["거래일", "날짜", "일자", "입금", "출금", "잔액"];

    for (let r = 1; r <= Math.min(10, worksheet.rowCount); r++) {
      const row = worksheet.getRow(r);
      let rowText = "";
      row.eachCell((cell) => {
        rowText += " " + String(cell.value || "");
      });
      if (headerKeywords.some((kw) => rowText.includes(kw))) {
        headerRow = r;
        break;
      }
    }

    // 금액 컬럼 찾기
    const amountKeywords = [
      "입금", "출금", "금액", "입금액", "출금액",
      "지급", "수입", "찾으신", "맡기신", "받으신", "보내신"
    ];
    const amountCols: number[] = [];
    const headerRowData = worksheet.getRow(headerRow);

    headerRowData.eachCell((cell, colNumber) => {
      const cellValue = String(cell.value || "");
      if (amountKeywords.some((kw) => cellValue.includes(kw))) {
        amountCols.push(colNumber);
      }
    });

    // 금액 컬럼을 못 찾으면 모든 컬럼 사용
    if (amountCols.length === 0) {
      for (let c = 1; c <= worksheet.columnCount; c++) {
        amountCols.push(c);
      }
    }

    // 금액 파싱 함수
    function parseAmount(value: ExcelJS.CellValue): number {
      if (value === null || value === undefined) return 0;
      if (typeof value === "number") return Math.abs(value);
      if (typeof value === "object" && "result" in value) {
        return parseAmount(value.result);
      }
      const str = String(value)
        .replace(/,/g, "")
        .replace(/\s/g, "")
        .replace(/원/g, "")
        .trim();
      if (!str || str === "-") return 0;
      const num = parseFloat(str);
      return isNaN(num) ? 0 : Math.abs(num);
    }

    // 하이라이트 처리
    let highlightedRows = 0;
    for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      let shouldHighlight = false;

      for (const c of amountCols) {
        const cell = row.getCell(c);
        const amount = parseAmount(cell.value);
        if (amount >= threshold) {
          shouldHighlight = true;
          break;
        }
      }

      if (shouldHighlight) {
        // 행 전체에 배경색 적용 (기존 서식 유지)
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + color },
          };
        });
        highlightedRows++;
      }
    }

    // 작업 로그 기록 (Supabase)
    await logAction(userEmail, "highlight_transactions", {
      fileName: file.name,
      fileSize: file.size,
      threshold: threshold,
      color: color,
      totalRows: worksheet.rowCount,
      highlightedRows: highlightedRows,
    }, userId, provider);

    // 결과 파일 생성
    const outputBuffer = await workbook.xlsx.writeBuffer();

    // 응답 반환
    const originalName = file.name.replace(/\.[^/.]+$/, "");
    const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // 에러도 로그 기록
    await logAction(userEmail, "highlight_error", {
      error: errorMessage,
    }, userId, provider);

    // 암호 보호된 Excel 감지 (더 구체적인 조건)
    const lowerMessage = errorMessage.toLowerCase();
    if (
      lowerMessage.includes("password") ||
      lowerMessage.includes("encrypted") ||
      (lowerMessage.includes("ecma-376") && lowerMessage.includes("encrypt"))
    ) {
      return NextResponse.json(
        {
          error: "암호로 보호된 Excel 파일입니다. 암호를 해제한 후 다시 시도해주세요.",
          isPasswordProtected: true,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: errorMessage || "처리 중 오류 발생" },
      { status: 500 }
    );
  }
}
