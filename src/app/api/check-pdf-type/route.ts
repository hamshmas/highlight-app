import { NextRequest, NextResponse } from "next/server";
import * as mupdf from "mupdf";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();

    // 엑셀 파일인 경우
    if (fileName.match(/\.(xlsx|xls)$/i)) {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetNames = workbook.SheetNames;
      const firstSheet = workbook.Sheets[sheetNames[0]];
      const range = XLSX.utils.decode_range(firstSheet["!ref"] || "A1");
      const rowCount = range.e.r - range.s.r + 1;

      return NextResponse.json({
        fileType: "excel",
        documentType: "excel",
        sheetCount: sheetNames.length,
        rowCount,
        message: "엑셀 파일입니다.",
        estimatedTime: "약 1-5초",
        warning: null,
      });
    }

    // 이미지 파일인 경우
    if (fileName.match(/\.(png|jpg|jpeg|gif|bmp|webp|tiff?)$/i)) {
      return NextResponse.json({
        fileType: "image",
        documentType: "image",
        message: "이미지 파일입니다.",
        estimatedTime: "약 10-30초",
        warning: null,
      });
    }

    // PDF가 아닌 경우
    if (!fileName.endsWith(".pdf")) {
      return NextResponse.json({
        fileType: "unknown",
        documentType: null,
        message: "지원하지 않는 파일 형식입니다.",
        estimatedTime: null,
        warning: "PDF, 이미지, 엑셀 파일만 지원합니다.",
      });
    }

    // PDF 분석
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const doc = mupdf.Document.openDocument(buffer, "application/pdf");
    const pageCount = doc.countPages();

    // 처음 3페이지에서 텍스트 추출 시도
    let totalTextLength = 0;
    let pagesWithText = 0;

    for (let i = 0; i < Math.min(pageCount, 3); i++) {
      const page = doc.loadPage(i);
      const text = page.toStructuredText("preserve-whitespace").asText();
      const cleanedText = text?.replace(/\s+/g, " ").trim() || "";
      totalTextLength += cleanedText.length;
      if (cleanedText.length >= 50) {
        pagesWithText++;
      }
    }

    const avgTextPerPage = totalTextLength / Math.min(pageCount, 3);
    const textRatio = pagesWithText / Math.min(pageCount, 3);

    // 텍스트 기반 PDF 판정
    const isTextBased = avgTextPerPage >= 100 && textRatio >= 0.7;

    if (isTextBased) {
      return NextResponse.json({
        fileType: "pdf",
        documentType: "text-based",
        pageCount,
        message: "텍스트 기반 PDF입니다. 빠르게 처리됩니다.",
        estimatedTime: "약 10-30초",
        warning: null,
      });
    } else {
      // 이미지 기반 PDF
      const estimatedMinutes = Math.ceil(pageCount / 10) * 0.5; // 10페이지당 약 30초
      const estimatedTime = pageCount <= 10
        ? "약 30초-1분"
        : pageCount <= 30
          ? "약 1-2분"
          : `약 ${Math.ceil(estimatedMinutes)}-${Math.ceil(estimatedMinutes * 1.5)}분`;

      return NextResponse.json({
        fileType: "pdf",
        documentType: "image-based",
        pageCount,
        message: "스캔/이미지 기반 PDF입니다.",
        estimatedTime,
        warning: pageCount > 20
          ? `${pageCount}페이지 문서입니다. 처리에 시간이 걸릴 수 있습니다.`
          : null,
      });
    }
  } catch (error) {
    console.error("PDF type check error:", error);
    return NextResponse.json(
      { error: "파일 분석 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
