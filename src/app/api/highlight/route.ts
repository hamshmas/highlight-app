import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";

export async function POST(request: NextRequest) {
  // 인증 확인
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
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
    const arrayBuffer = await file.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

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
      }
    }

    // 결과 파일 생성
    const outputBuffer = await workbook.xlsx.writeBuffer();

    // 응답 반환
    const originalName = file.name.replace(/\.[^/.]+$/, "");
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="highlighted_${originalName}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "처리 중 오류 발생" },
      { status: 500 }
    );
  }
}
