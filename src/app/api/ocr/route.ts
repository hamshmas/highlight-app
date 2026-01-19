import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { logAction } from "@/lib/supabase";
import { generateFileHash, getCachedParsing, saveParsing, isCacheEnabled } from "@/lib/cache";
import * as mupdf from "mupdf";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface TransactionRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
  // 동적 컬럼 지원
  [key: string]: string | number;
}

// Google Cloud Vision 클라이언트 초기화
function getVisionClient(): ImageAnnotatorClient | null {
  let credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentialsJson) {
    console.warn("Google Cloud credentials not configured");
    return null;
  }

  try {
    // .env 파일에서 실제 줄바꿈이 들어간 경우 이를 \n 문자열로 변환
    credentialsJson = credentialsJson.replace(/\n/g, '\\n');

    // Vercel에서 가져온 JSON이 이스케이프된 형태일 수 있음
    if (credentialsJson.startsWith('"') && credentialsJson.endsWith('"')) {
      credentialsJson = credentialsJson.slice(1, -1);
    }

    const credentials = JSON.parse(credentialsJson);
    return new ImageAnnotatorClient({ credentials });
  } catch (error) {
    console.error("Failed to parse Google Cloud credentials:", error);
    return null;
  }
}

// Gemini API 클라이언트 초기화
function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your-gemini-api-key") {
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
}

// AI로 샘플 거래 파싱 (처음 5개)
async function parseSampleTransactions(sampleText: string): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.log("Gemini API not configured");
    return null;
  }

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `당신은 한국 은행 거래내역을 정확하게 파싱하는 전문가입니다.

## 작업
아래 텍스트에서 처음 5개의 거래내역만 추출하여 JSON 배열로 반환하세요.

## 입력 텍스트
${sampleText}

## 출력 형식
반드시 유효한 JSON 배열만 반환하세요. 처음 5개 거래만 추출하세요.

## 중요: 컬럼명 규칙
- 원본 문서에 있는 컬럼명(헤더)을 그대로 JSON 키로 사용하세요
- 예: "거래일", "거래일자", "일자" → 원본 그대로 사용
- 예: "적요", "내용", "거래내용" → 원본 그대로 사용
- 예: "찾으신금액", "출금", "출금액" → 원본 그대로 사용
- 예: "맡기신금액", "입금", "입금액" → 원본 그대로 사용
- 예: "잔액", "거래후잔액" → 원본 그대로 사용
- 공백이 있는 컬럼명은 공백을 제거하세요 (예: "거래 일자" → "거래일자")

## 파싱 규칙
- 날짜 값은 "YYYY.MM.DD" 형식으로 통일
- 금액 값은 숫자만 (쉼표, 원, ₩ 제거)
- 텍스트에서 발견되는 모든 컬럼을 추출하세요
- 빈 값은 문자열 컬럼은 "", 숫자 컬럼은 0으로 설정

JSON 배열만 반환하세요:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // 토큰 사용량 추적
    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      addTokenUsage(usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0);
    }

    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("Failed to parse sample transactions");
      return null;
    }

    const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];

    // 동적 컬럼명 지원을 위한 헬퍼 함수
    const findDateColumn = (tx: TransactionRow): string | null => {
      const dateKeywords = ["거래일", "일자", "날짜", "date"];
      for (const key of Object.keys(tx)) {
        if (dateKeywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
          return tx[key] as string;
        }
      }
      return null;
    };

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

    const depositKeywords = ["입금", "맡기신", "받으신", "deposit"];
    const withdrawalKeywords = ["출금", "찾으신", "보내신", "withdrawal"];
    const generalAmountKeywords = ["거래금액", "금액", "amount"];

    // 정제
    const validTransactions = transactions
      .filter(tx => {
        const dateVal = findDateColumn(tx);
        const depositVal = findAmountValue(tx, depositKeywords);
        const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
        const generalAmount = findAmountValue(tx, generalAmountKeywords);
        // 입금/출금 컬럼이 있거나, 거래금액 컬럼이 있으면 유효한 거래
        return dateVal && (depositVal > 0 || withdrawalVal > 0 || generalAmount > 0);
      })
      .map(tx => {
        const normalized = { ...tx };
        for (const key of Object.keys(normalized)) {
          const val = normalized[key];
          if (typeof val === "string" && /^[\d,]+$/.test(val.replace(/[원₩\s]/g, ""))) {
            normalized[key] = parseFloat(val.replace(/[,원₩\s]/g, "")) || 0;
          }
        }
        return normalized;
      });

    console.log(`AI parsed ${validTransactions.length} sample transactions`);
    return validTransactions;
  } catch (error) {
    console.error("Error parsing sample:", error);
    return null;
  }
}

// 텍스트를 청크로 분할 (날짜 경계 기준)
function splitTextIntoChunks(text: string, chunkSize: number = 4000): string[] {
  const chunks: string[] = [];

  if (text.length <= chunkSize) {
    return [text];
  }

  // 날짜 패턴으로 자연스러운 분할점 찾기
  const datePattern = /\n(?=\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}|\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2})/g;

  let startIndex = 0;
  let lastValidBreak = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + chunkSize, text.length);

    if (endIndex < text.length) {
      // chunkSize 근처에서 날짜 경계 찾기
      const searchText = text.substring(startIndex, endIndex + 500);
      const matches = [...searchText.matchAll(datePattern)];

      // 청크 끝 근처의 날짜 경계 찾기
      let bestBreak = endIndex;
      for (const match of matches) {
        const breakPoint = startIndex + (match.index || 0);
        if (breakPoint > startIndex + chunkSize * 0.7 && breakPoint <= endIndex) {
          bestBreak = breakPoint;
        }
      }
      endIndex = bestBreak;
    }

    const chunk = text.substring(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    startIndex = endIndex;
    if (startIndex === lastValidBreak) {
      // 무한 루프 방지
      startIndex += chunkSize;
    }
    lastValidBreak = startIndex;
  }

  return chunks;
}

// 단일 청크 AI 파싱 (규칙 적용)
async function parseChunkWithAI(
  chunkText: string,
  chunkIndex: number,
  detectedColumns: string[],
  sampleExample: string
): Promise<TransactionRow[]> {
  const gemini = getGeminiClient();
  if (!gemini) return [];

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });

    const columnsDescription = detectedColumns.length > 0
      ? `사용할 컬럼명: ${detectedColumns.join(", ")}`
      : "";

    const prompt = `당신은 한국 은행 거래내역을 정확하게 파싱하는 전문가입니다.

## 작업
아래 텍스트에서 모든 거래내역을 추출하여 JSON 배열로 반환하세요.

## 참고: 이 문서의 형식 예시 (동일한 컬럼명 사용)
${sampleExample}

${columnsDescription ? `## ${columnsDescription}` : ""}

## 입력 텍스트 (청크 ${chunkIndex + 1})
${chunkText}

## 출력 형식
반드시 유효한 JSON 배열만 반환하세요.

## 중요: 컬럼명 규칙
- 위 예시에서 사용된 컬럼명을 정확히 동일하게 사용하세요
- 원본 문서의 컬럼명을 그대로 JSON 키로 사용해야 합니다
- 공백이 있는 컬럼명은 공백을 제거하세요

## 파싱 규칙
- 날짜 값은 "YYYY.MM.DD" 형식으로 통일
- 금액 값은 숫자만 (쉼표, 원, ₩ 제거)
- 빈 값은 문자열 컬럼은 "", 숫자 컬럼은 0으로 설정
- 위 예시와 정확히 동일한 형식으로 파싱하세요

JSON 배열만 반환하세요:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // 토큰 사용량 추적
    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      addTokenUsage(usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0);
    }

    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`Chunk ${chunkIndex + 1}: No JSON array found in response`);
      console.log(`Chunk ${chunkIndex + 1} response preview:`, response.substring(0, 500));
      return [];
    }

    const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
    console.log(`Chunk ${chunkIndex + 1}: parsed ${transactions.length} raw transactions`);

    // 동적 컬럼명 지원
    const findDateColumn = (tx: TransactionRow): string | null => {
      const dateKeywords = ["거래일", "일자", "날짜", "date"];
      for (const key of Object.keys(tx)) {
        if (dateKeywords.some(kw => key.toLowerCase().includes(kw.toLowerCase()))) {
          return tx[key] as string;
        }
      }
      return null;
    };

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

    const depositKeywords = ["입금", "맡기신", "받으신", "deposit"];
    const withdrawalKeywords = ["출금", "찾으신", "보내신", "withdrawal"];
    const generalAmountKeywords = ["거래금액", "금액", "amount"];

    const filtered = transactions
      .filter(tx => {
        const dateVal = findDateColumn(tx);
        const depositVal = findAmountValue(tx, depositKeywords);
        const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
        const generalAmount = findAmountValue(tx, generalAmountKeywords);
        // 입금/출금 컬럼이 있거나, 거래금액 컬럼이 있으면 유효한 거래
        return dateVal && (depositVal > 0 || withdrawalVal > 0 || generalAmount > 0);
      })
      .map(tx => {
        const normalized = { ...tx };
        for (const key of Object.keys(normalized)) {
          const val = normalized[key];
          if (typeof val === "string" && /^[\d,]+$/.test(val.replace(/[원₩\s]/g, ""))) {
            normalized[key] = parseFloat(val.replace(/[,원₩\s]/g, "")) || 0;
          }
        }
        return normalized;
      });

    console.log(`Chunk ${chunkIndex + 1}: ${filtered.length} transactions after filtering`);
    return filtered;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Chunk ${chunkIndex + 1} parsing error:`, errorMessage);
    // API 에러인 경우 상세 정보 출력
    if (error && typeof error === 'object' && 'status' in error) {
      console.error(`Chunk ${chunkIndex + 1} API error status:`, (error as { status: number }).status);
    }
    return [];
  }
}

// 토큰 사용량 추적
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// 전역 토큰 카운터
let totalTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

function resetTokenUsage() {
  totalTokenUsage = { inputTokens: 0, outputTokens: 0 };
}

function addTokenUsage(input: number, output: number) {
  totalTokenUsage.inputTokens += input;
  totalTokenUsage.outputTokens += output;
}

// Gemini 2.5 Flash Lite 가격 (2025년 1월 기준, USD per 1M tokens)
// Input: $0.075 / 1M tokens, Output: $0.30 / 1M tokens
const GEMINI_PRICING = {
  inputPricePerMillion: 0.075,
  outputPricePerMillion: 0.30,
};

function calculateCost(usage: TokenUsage): { usd: number; krw: number } {
  const inputCost = (usage.inputTokens / 1_000_000) * GEMINI_PRICING.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * GEMINI_PRICING.outputPricePerMillion;
  const totalUsd = inputCost + outputCost;
  // 환율 약 1,450원/USD 기준
  const totalKrw = totalUsd * 1450;
  return { usd: totalUsd, krw: totalKrw };
}

// 병렬 AI 파싱
async function parseFullTextWithAIParallel(
  text: string,
  detectedColumns: string[],
  sampleTransactions: TransactionRow[]
): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    // 샘플 거래를 예시 문자열로 변환
    const sampleExample = sampleTransactions.length > 0
      ? JSON.stringify(sampleTransactions.slice(0, 3), null, 2)
      : "[]";

    // 텍스트를 청크로 분할 (약 15,000자씩 - 청크 수 줄이기)
    const chunks = splitTextIntoChunks(text, 15000);
    console.log(`Splitting text into ${chunks.length} chunks for parallel AI processing`);

    // 병렬로 모든 청크 처리
    const startTime = Date.now();
    const chunkPromises = chunks.map((chunk, index) =>
      parseChunkWithAI(chunk, index, detectedColumns, sampleExample)
    );

    const results = await Promise.all(chunkPromises);
    const elapsed = Date.now() - startTime;
    console.log(`Parallel AI processing completed in ${elapsed}ms`);

    // 모든 결과 합치기
    const allTransactions: TransactionRow[] = [];
    for (const chunkTransactions of results) {
      allTransactions.push(...chunkTransactions);
    }

    // 중복 제거 (동적 컬럼명 지원)
    const seen = new Set<string>();
    const uniqueTransactions = allTransactions.filter(tx => {
      // 모든 값을 정렬된 키 순서로 연결하여 고유 키 생성
      const key = Object.keys(tx)
        .sort()
        .map(k => `${k}:${tx[k]}`)
        .join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total: ${allTransactions.length} transactions, after dedup: ${uniqueTransactions.length}`);
    return uniqueTransactions;
  } catch (error) {
    console.error("Parallel AI parsing error:", error);
    return null;
  }
}

// AI 기반 파싱 (샘플 파싱 → 병렬 전체 파싱)
interface ParseResult {
  transactions: TransactionRow[];
  tokenUsage: TokenUsage;
  cost: { usd: number; krw: number };
}

async function parseWithAI(text: string): Promise<ParseResult | null> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.log("Gemini API not configured");
    return null;
  }

  // 토큰 사용량 초기화
  resetTokenUsage();

  try {
    const startTime = Date.now();

    // ===== 1단계: 샘플 AI 파싱 =====
    const sampleText = text.substring(0, 3000);
    console.log(`[1단계] 샘플 AI 파싱 시작 (${sampleText.length}자)`);

    const sampleStartTime = Date.now();
    const sampleTransactions = await parseSampleTransactions(sampleText);
    const sampleElapsed = Date.now() - sampleStartTime;
    console.log(`[1단계] 샘플 AI 파싱 완료: ${sampleElapsed}ms`);

    if (!sampleTransactions || sampleTransactions.length === 0) {
      console.log("샘플 파싱 실패, AI 병렬 파싱으로 폴백");
      const result = await parseFullTextWithAIParallel(text, [], []);
      const cost = calculateCost(totalTokenUsage);
      return result ? { transactions: result, tokenUsage: { ...totalTokenUsage }, cost } : null;
    }

    console.log(`[1단계] 샘플에서 ${sampleTransactions.length}개 거래 파싱됨`);

    // 샘플에서 발견된 컬럼 추출
    const detectedColumns = new Set<string>();
    for (const tx of sampleTransactions) {
      for (const key of Object.keys(tx)) {
        if (tx[key] !== undefined && tx[key] !== null && tx[key] !== "" && tx[key] !== 0) {
          detectedColumns.add(key);
        }
      }
    }

    // ===== 2단계: AI 병렬 전체 파싱 =====
    console.log(`[2단계] AI 병렬 파싱 시작 (${text.length}자)`);
    const aiParseStart = Date.now();
    const allTransactions = await parseFullTextWithAIParallel(text, [...detectedColumns], sampleTransactions);
    const aiParseElapsed = Date.now() - aiParseStart;
    console.log(`[2단계] AI 병렬 파싱 완료: ${aiParseElapsed}ms`);

    if (!allTransactions || allTransactions.length === 0) {
      console.log("전체 파싱 실패, 샘플 결과 반환");
      const cost = calculateCost(totalTokenUsage);
      return { transactions: sampleTransactions, tokenUsage: { ...totalTokenUsage }, cost };
    }

    const totalElapsed = Date.now() - startTime;
    const cost = calculateCost(totalTokenUsage);

    console.log(`=== 파싱 완료 ===`);
    console.log(`총 시간: ${totalElapsed}ms (샘플AI: ${sampleElapsed}ms, 전체AI: ${aiParseElapsed}ms)`);
    console.log(`총 거래: ${allTransactions.length}개`);
    console.log(`토큰 사용량: 입력 ${totalTokenUsage.inputTokens}, 출력 ${totalTokenUsage.outputTokens}`);
    console.log(`예상 비용: $${cost.usd.toFixed(6)} (약 ${cost.krw.toFixed(2)}원)`);

    return { transactions: allTransactions, tokenUsage: { ...totalTokenUsage }, cost };
  } catch (error) {
    console.error("AI parsing error:", error);
    return null;
  }
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

    // Gemini API 확인
    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return NextResponse.json(
        { error: "AI 파싱 서비스가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 500 }
      );
    }

    // PDF/이미지를 base64로 변환
    const arrayBuffer = await file.arrayBuffer();

    // 캐시 확인 (활성화된 경우)
    if (isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      console.log(`Checking cache for file: ${file.name} (hash: ${fileHash})`);

      const cached = await getCachedParsing(fileHash);
      if (cached) {
        console.log(`Cache HIT for ${file.name}`);

        await logAction(userEmail, "ocr_extract_cached", {
          fileName: file.name,
          fileSize: file.size,
          transactionCount: cached.parsing_result.length,
          columns: cached.columns,
          cacheHitCount: cached.hit_count + 1,
        });

        return NextResponse.json({
          success: true,
          transactions: cached.parsing_result,
          columns: cached.columns,
          cached: true,
          message: `캐시에서 ${cached.parsing_result.length}개의 거래내역을 로드했습니다.`,
          aiCost: cached.ai_cost || { inputTokens: 0, outputTokens: 0, usd: 0, krw: 0 },
        });
      }
      console.log(`Cache MISS for ${file.name}`);
    }

    // 버퍼 복사 (여러 라이브러리에서 사용하기 위해)
    const bufferCopy = Buffer.from(arrayBuffer).buffer.slice(0);
    const buffer = Buffer.from(bufferCopy);
    const base64Content = buffer.toString("base64");

    // Google Cloud Vision OCR 호출
    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    let fullText = "";

    console.log("OCR: Processing file:", file.name, "isPdf:", isPdf, "size:", file.size);

    if (isPdf) {
      // 먼저 텍스트 기반 PDF인지 확인
      const pdfBuffer = Buffer.from(bufferCopy);
      const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
      const pageCount = doc.countPages();

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

      // 텍스트 기반 PDF인 경우 OCR 모드 차단
      if (avgTextPerPage >= 100 && textRatio >= 0.7) {
        console.log(`Text-based PDF detected: avgTextPerPage=${avgTextPerPage}, textRatio=${textRatio}`);
        return NextResponse.json(
          {
            error: "텍스트 기반 PDF입니다. OCR 모드 대신 일반 모드를 사용해주세요.",
            isTextBasedPdf: true
          },
          { status: 400 }
        );
      }

      // mupdf를 사용하여 PDF를 이미지로 변환 후 Vision OCR 사용
      console.log("Converting PDF to images for OCR using mupdf...");

      const maxPages = 50; // 최대 50페이지만 처리
      const actualPageCount = Math.min(pageCount, maxPages);

      // 위에서 이미 열린 doc, pageCount 재사용
      console.log(`PDF has ${pageCount} pages, processing ${actualPageCount} pages`);

      // 1단계: 모든 페이지를 이미지로 변환 (순차 - mupdf는 동기 API)
      const pageImages: { pageNum: number; base64: string }[] = [];
      const conversionStart = Date.now();

      for (let pageNum = 0; pageNum < actualPageCount; pageNum++) {
        try {
          const page = doc.loadPage(pageNum);

          // 150 DPI로 이미지 생성 (72 DPI가 기본, 2배 스케일 = 144 DPI)
          const scale = 2.0;
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true
          );

          // PNG로 변환
          const pngData = pixmap.asPNG();
          const pageBase64 = Buffer.from(pngData).toString("base64");
          pageImages.push({ pageNum, base64: pageBase64 });
        } catch (pageError) {
          console.error(`Error converting page ${pageNum + 1}:`, pageError);
        }
      }
      console.log(`Image conversion completed in ${Date.now() - conversionStart}ms`);

      // 2단계: Vision OCR 병렬 호출 (10개씩 배치로 처리)
      const ocrStart = Date.now();
      const batchSize = 10;
      const allTexts: string[] = new Array(actualPageCount).fill("");

      for (let batchStart = 0; batchStart < pageImages.length; batchStart += batchSize) {
        const batch = pageImages.slice(batchStart, batchStart + batchSize);

        const batchPromises = batch.map(async ({ pageNum, base64 }) => {
          try {
            const [result] = await visionClient.textDetection({
              image: { content: base64 },
              imageContext: { languageHints: ["ko", "en"] },
            });

            const pageText = result.fullTextAnnotation?.text || "";
            if (pageText) {
              allTexts[pageNum] = pageText;
              console.log(`Page ${pageNum + 1}: extracted ${pageText.length} chars`);
            }
          } catch (pageError) {
            console.error(`Error OCR page ${pageNum + 1}:`, pageError);
          }
        });

        await Promise.all(batchPromises);
      }

      console.log(`OCR completed in ${Date.now() - ocrStart}ms`);
      fullText = allTexts.filter(t => t).join("\n\n");
      console.log(`OCR PDF result: extracted ${fullText.length} total chars from ${allTexts.filter(t => t).length} pages`);
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

      console.log("OCR Image result:", result.fullTextAnnotation ? "has text" : "no text");
      fullText = result.fullTextAnnotation?.text || "";
    }

    if (!fullText) {
      console.log("OCR result: No text extracted from file:", file.name, "isPdf:", isPdf);
      const errorMessage = isPdf
        ? "PDF에서 텍스트를 추출할 수 없습니다. 파일이 암호화되었거나 손상되었을 수 있습니다. 다른 방법으로 PDF를 다시 저장해보세요."
        : "이미지에서 텍스트를 추출할 수 없습니다. 이미지가 선명한지 확인해주세요.";
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      );
    }

    // 거래내역 파싱 (AI 전용)
    console.log("OCR text sample (first 2000 chars):", fullText.substring(0, 2000));

    const parseResult = await parseWithAI(fullText);

    if (!parseResult || parseResult.transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 파싱할 수 없습니다. AI가 텍스트에서 거래 패턴을 인식하지 못했습니다." },
        { status: 400 }
      );
    }

    const { transactions, tokenUsage, cost } = parseResult;
    console.log(`AI parsing successful: ${transactions.length} transactions`);

    // 동적 컬럼 추출 (첫 번째 거래의 컬럼 순서 그대로 유지)
    const columns: string[] = [];
    const seenColumns = new Set<string>();

    if (transactions.length > 0) {
      // 첫 번째 거래에서 모든 컬럼을 순서대로 추출 (값에 상관없이)
      for (const key of Object.keys(transactions[0])) {
        if (!seenColumns.has(key)) {
          columns.push(key);
          seenColumns.add(key);
        }
      }

      // 나머지 거래에서 추가 컬럼 확인
      const sampleSize = Math.min(5, transactions.length);
      for (let i = 1; i < sampleSize; i++) {
        for (const key of Object.keys(transactions[i])) {
          if (!seenColumns.has(key)) {
            columns.push(key);
            seenColumns.add(key);
          }
        }
      }
    }

    // 캐시 저장 (활성화된 경우)
    if (isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      await saveParsing({
        fileHash,
        fileName: file.name,
        fileSize: file.size,
        parsingResult: transactions as Record<string, unknown>[],
        columns,
        tokenUsage: { ...tokenUsage },
        aiCost: { ...cost },
        userEmail,
      });
      console.log(`Cached parsing result for ${file.name}`);
    }

    // 작업 로그 기록
    await logAction(userEmail, "ocr_extract", {
      fileName: file.name,
      fileSize: file.size,
      extractedTextLength: fullText.length,
      transactionCount: transactions.length,
      columns: columns,
      aiCost: cost,
      tokenUsage: tokenUsage,
    });

    return NextResponse.json({
      success: true,
      rawText: fullText,
      transactions: transactions,
      columns: columns,
      usedAiParsing: true,
      message: `${transactions.length}개의 거래내역이 추출되었습니다.`,
      aiCost: {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        usd: cost.usd,
        krw: cost.krw,
      },
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
