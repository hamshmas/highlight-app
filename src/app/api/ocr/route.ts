import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { logAction } from "@/lib/supabase";

interface TransactionRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
}

// Google Cloud Vision 클라이언트 초기화
function getVisionClient(): ImageAnnotatorClient | null {
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentialsJson) {
    console.warn("Google Cloud credentials not configured");
    return null;
  }

  try {
    const credentials = JSON.parse(credentialsJson);
    return new ImageAnnotatorClient({ credentials });
  } catch (error) {
    console.error("Failed to parse Google Cloud credentials:", error);
    return null;
  }
}

// 금액 파싱
function parseAmount(str: string): { value: number; isNegative: boolean } {
  if (!str) return { value: 0, isNegative: false };
  const isNegative = str.includes("-") || str.includes("△");
  const cleaned = str.replace(/[,\s원₩\-△]/g, "").trim();
  if (!cleaned || cleaned === "") return { value: 0, isNegative: false };
  const num = parseFloat(cleaned);
  return isNaN(num) ? { value: 0, isNegative: false } : { value: Math.abs(num), isNegative };
}

// OCR 텍스트에서 거래내역 추출
function parseTransactionsFromOCR(text: string): TransactionRow[] {
  const transactions: TransactionRow[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // 날짜 패턴들
  const datePatterns = [
    /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/,  // 2024.10.30, 2024-10-30
    /(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/,  // 24.10.30
  ];

  for (const line of lines) {
    let dateMatch = null;
    let dateStr = "";

    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        dateMatch = match;
        const year = match[1].length === 2 ? "20" + match[1] : match[1];
        const month = match[2].padStart(2, "0");
        const day = match[3].padStart(2, "0");
        dateStr = `${year}.${month}.${day}`;
        break;
      }
    }

    if (!dateMatch) continue;

    // 금액 추출 (쉼표 포함된 숫자들)
    const amountMatches = line.match(/-?[\d,]+/g) || [];
    const amounts = amountMatches
      .map(a => parseAmount(a))
      .filter(a => a.value >= 100); // 100원 이상만

    if (amounts.length === 0) continue;

    // 입금/출금 판단
    const isDeposit = line.includes("입금") || line.includes("이자") || line.includes("급여");
    const isWithdrawal = line.includes("출금") || line.includes("이체") ||
                         line.includes("결제") || line.includes("인출") ||
                         amounts[0]?.isNegative;

    // 설명 추출 (날짜와 금액 제외)
    let description = line
      .replace(dateMatch[0], "")
      .replace(/-?[\d,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 50);

    const transaction: TransactionRow = {
      date: dateStr,
      description: description || "거래",
      deposit: (!isWithdrawal && isDeposit) || (!isWithdrawal && !amounts[0]?.isNegative && line.includes("입"))
        ? amounts[0]?.value || 0 : 0,
      withdrawal: isWithdrawal || amounts[0]?.isNegative
        ? amounts[0]?.value || 0 : 0,
      balance: amounts.length > 1 ? amounts[amounts.length - 1].value : 0,
    };

    // 입금도 출금도 아닌 경우 금액 기준으로 판단
    if (transaction.deposit === 0 && transaction.withdrawal === 0 && amounts[0]?.value > 0) {
      if (amounts[0].isNegative) {
        transaction.withdrawal = amounts[0].value;
      } else {
        // 기본적으로 출금으로 처리 (대부분의 거래가 출금)
        transaction.withdrawal = amounts[0].value;
      }
    }

    if (transaction.deposit > 0 || transaction.withdrawal > 0) {
      transactions.push(transaction);
    }
  }

  return transactions;
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

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    const visionClient = getVisionClient();
    if (!visionClient) {
      return NextResponse.json(
        { error: "OCR 서비스가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 500 }
      );
    }

    // PDF/이미지를 base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Content = buffer.toString("base64");

    // Google Cloud Vision OCR 호출
    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    let fullText = "";

    if (isPdf) {
      // PDF의 경우 각 페이지를 처리
      const [result] = await visionClient.documentTextDetection({
        image: {
          content: base64Content,
        },
        imageContext: {
          languageHints: ["ko", "en"],
        },
      });

      fullText = result.fullTextAnnotation?.text || "";
    } else {
      // 이미지의 경우
      const [result] = await visionClient.textDetection({
        image: {
          content: base64Content,
        },
        imageContext: {
          languageHints: ["ko", "en"],
        },
      });

      fullText = result.fullTextAnnotation?.text || "";
    }

    if (!fullText) {
      return NextResponse.json(
        { error: "OCR로 텍스트를 추출할 수 없습니다. 파일을 확인해주세요." },
        { status: 400 }
      );
    }

    // 거래내역 파싱
    const transactions = parseTransactionsFromOCR(fullText);

    // 작업 로그 기록
    await logAction(userEmail, "ocr_extract", {
      fileName: file.name,
      fileSize: file.size,
      extractedTextLength: fullText.length,
      transactionCount: transactions.length,
    });

    return NextResponse.json({
      success: true,
      rawText: fullText,
      transactions: transactions,
      message: `${transactions.length}개의 거래내역이 추출되었습니다.`,
    });
  } catch (error) {
    console.error("OCR error:", error);

    await logAction(userEmail, "ocr_error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OCR 처리 중 오류 발생" },
      { status: 500 }
    );
  }
}
