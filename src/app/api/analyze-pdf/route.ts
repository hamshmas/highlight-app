import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as mupdf from "mupdf";

interface PdfAnalysisResult {
  type: "text-based" | "image-based" | "mixed";
  confidence: number;
  textLength: number;
  pageCount: number;
  recommendation: "normal" | "ocr";
  message: string;
}

// PDF 타입 분석 (텍스트 기반 vs 이미지 기반)
function analyzePdfType(buffer: ArrayBuffer): PdfAnalysisResult {
  const pdfBuffer = Buffer.from(buffer);
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageCount = doc.countPages();
  let totalTextLength = 0;
  let pagesWithText = 0;

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText();
    const cleanedText = text?.replace(/\s+/g, " ").trim() || "";
    const textLength = cleanedText.length;

    totalTextLength += textLength;
    if (textLength > 0) pagesWithText++;
  }

  const textRatio = pageCount > 0 ? pagesWithText / pageCount : 0;

  // 단순화된 로직: 규칙 기반 임계값 제거
  // - 텍스트가 전혀 없으면 OCR 권장
  // - 텍스트가 존재하면 일반 처리 권장
  const recommendation: "normal" | "ocr" = totalTextLength > 0 ? "normal" : "ocr";
  const type: "text-based" | "image-based" | "mixed" = totalTextLength > 0 ? "text-based" : "image-based";
  const confidence = Math.round(textRatio * 100);

  return {
    type,
    confidence,
    textLength: totalTextLength,
    pageCount,
    recommendation,
    message: "Raw text metrics provided. Use OCR if no text is present.",
  };
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "PDF 파일만 분석할 수 있습니다" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const analysis = analyzePdfType(arrayBuffer);

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("PDF analysis error:", error);

    const errorMessage = error instanceof Error ? error.message : "PDF 분석 중 오류 발생";

    // 암호 보호된 PDF 감지
    if (errorMessage.toLowerCase().includes("password") || errorMessage.includes("encrypted")) {
      return NextResponse.json(
        {
          error: "암호로 보호된 PDF입니다. 암호를 해제한 후 다시 시도해주세요.",
          isPasswordProtected: true
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
