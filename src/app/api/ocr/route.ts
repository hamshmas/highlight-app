import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { GoogleAuth } from "google-auth-library";
import { logAction } from "@/lib/supabase";
import { generateFileHash, getCachedParsing, saveParsing, isCacheEnabled, deleteCachedParsing } from "@/lib/cache";
import * as mupdf from "mupdf";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseWithBankRule } from "@/lib/bank-rules";

// Route Segment Config
export const maxDuration = 300; // 5분 타임아웃
export const dynamic = 'force-dynamic';

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
  // 방법 1: 개별 환경변수 사용 (Vercel에서 가장 안정적)
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    console.log("Using individual environment variables for Vision client");

    // Vercel에서 줄바꿈이 리터럴 \n으로 저장될 수 있음
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    console.log("Creating Vision client with project:", projectId);
    console.log("Client email:", clientEmail);
    console.log("Private key has newlines:", privateKey.includes('\n'));

    // GoogleAuth를 사용하여 명시적으로 인증 객체 생성
    const auth = new GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      projectId,
      scopes: ['https://www.googleapis.com/auth/cloud-vision'],
    });

    return new ImageAnnotatorClient({ auth });
  }

  // 방법 2: JSON 환경변수 (fallback)
  let credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64
    ? Buffer.from(process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64, 'base64').toString('utf-8')
    : process.env.GOOGLE_CLOUD_CREDENTIALS;

  if (!credentialsJson) {
    console.warn("Google Cloud credentials not configured");
    return null;
  }

  try {
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      console.log("First JSON parse failed, trying to unescape...");
      const unescaped = credentialsJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      credentials = JSON.parse(unescaped);
    }

    if (!credentials.private_key) {
      console.error("Google Cloud credentials missing private_key");
      return null;
    }

    let pk = credentials.private_key;
    while (pk.includes('\\n')) {
      pk = pk.replace(/\\n/g, '\n');
    }
    if (!pk.endsWith('\n')) {
      pk = pk + '\n';
    }

    console.log("Creating Vision client with project:", credentials.project_id);
    console.log("Client email:", credentials.client_email);

    const auth = new GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: pk,
      },
      projectId: credentials.project_id,
      scopes: ['https://www.googleapis.com/auth/cloud-vision'],
    });

    return new ImageAnnotatorClient({ auth });
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

// 텍스트를 청크로 분할 (날짜 경계 기준)
function splitTextIntoChunks(text: string, chunkSize: number = 3500): string[] {
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
      startIndex += chunkSize;
    }
    lastValidBreak = startIndex;
  }

  return chunks;
}

// 불완전한 JSON 복구 시도
function tryFixIncompleteJson(jsonStr: string): string | null {
  // 마지막 완전한 객체까지만 추출
  let bracketCount = 0;
  let lastCompleteIndex = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') bracketCount++;
    if (char === '}') {
      bracketCount--;
      if (bracketCount === 0) {
        lastCompleteIndex = i;
      }
    }
  }

  if (lastCompleteIndex > 0) {
    // 마지막 완전한 객체 이후의 ],를 찾아서 배열 닫기
    const fixed = jsonStr.substring(0, lastCompleteIndex + 1) + ']';
    return fixed;
  }

  return null;
}

// 단일 청크 AI 파싱 (규칙 적용) - 재시도 로직 포함
async function parseChunkWithAI(
  chunkText: string,
  chunkIndex: number,
  detectedColumns: string[],
  sampleExample: string,
  retryCount: number = 0
): Promise<TransactionRow[]> {
  const gemini = getGeminiClient();
  if (!gemini) return [];

  const maxRetries = 1;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 16384, // 충분한 출력 토큰 확보
      },
    });

    // 컬럼 힌트 (있는 경우만)
    const columnHint = detectedColumns.length > 0
      ? `\n사용할 컬럼명: ${detectedColumns.join(", ")}`
      : "";

    const sampleHint = sampleExample !== "[]"
      ? `\n출력 형식 예시:\n${sampleExample}`
      : "";

    const prompt = `은행 거래내역을 JSON 배열로 변환하세요.

규칙:
- 날짜와 금액이 있는 거래 행만 추출
- 헤더, 합계, 페이지번호, 안내문구 제외
- 컬럼명은 원본 헤더 그대로 사용
- 금액은 숫자만 (쉼표 없이)
- 완전한 JSON 배열만 출력 (코드블록 없이)${columnHint}${sampleHint}

텍스트:
${chunkText}

JSON:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // 토큰 사용량 추적
    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      addTokenUsage(usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0);
    }

    let jsonStr = response.trim();

    // 코드블록 제거
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // JSON 배열 추출
    let jsonMatch = jsonStr.match(/\[[\s\S]*\]/);

    // JSON 배열을 찾지 못한 경우
    if (!jsonMatch) {
      // [ 로 시작하는지 확인하고 불완전한 JSON 복구 시도
      const arrayStart = jsonStr.indexOf('[');
      if (arrayStart >= 0) {
        const partialJson = jsonStr.substring(arrayStart);
        const fixed = tryFixIncompleteJson(partialJson);
        if (fixed) {
          jsonStr = fixed;
          jsonMatch = [fixed];
          console.log(`Chunk ${chunkIndex + 1}: Fixed incomplete JSON`);
        }
      }
    }

    if (!jsonMatch) {
      console.log(`Chunk ${chunkIndex + 1}: No JSON array found`);
      // 재시도
      if (retryCount < maxRetries) {
        console.log(`Chunk ${chunkIndex + 1}: Retrying... (${retryCount + 1}/${maxRetries})`);
        return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
      }
      return [];
    }

    let transactions: TransactionRow[];
    try {
      transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
    } catch (parseError) {
      // JSON 파싱 실패 시 불완전한 JSON 복구 시도
      const fixed = tryFixIncompleteJson(jsonMatch[0]);
      if (fixed) {
        try {
          transactions = JSON.parse(fixed) as TransactionRow[];
          console.log(`Chunk ${chunkIndex + 1}: Recovered ${transactions.length} transactions from incomplete JSON`);
        } catch {
          console.log(`Chunk ${chunkIndex + 1}: JSON recovery failed`);
          if (retryCount < maxRetries) {
            console.log(`Chunk ${chunkIndex + 1}: Retrying... (${retryCount + 1}/${maxRetries})`);
            return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
          }
          return [];
        }
      } else {
        if (retryCount < maxRetries) {
          console.log(`Chunk ${chunkIndex + 1}: Retrying... (${retryCount + 1}/${maxRetries})`);
          return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
        }
        return [];
      }
    }

    console.log(`Chunk ${chunkIndex + 1}: parsed ${transactions.length} transactions`);

    // 필터링 없이 모든 거래 반환 (AI가 이미 거래만 추출함)
    // 금액 문자열을 숫자로 변환
    const normalized = transactions.map(tx => {
      const result = { ...tx };
      for (const key of Object.keys(result)) {
        const val = result[key];
        // 숫자와 쉼표만 있는 문자열을 숫자로 변환
        if (typeof val === "string") {
          const cleaned = val.replace(/[,원₩\s]/g, "");
          if (/^\d+$/.test(cleaned) && cleaned.length > 0) {
            result[key] = parseFloat(cleaned);
          }
        }
      }
      return result;
    });

    return normalized;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Chunk ${chunkIndex + 1} error:`, errorMessage);
    if (retryCount < maxRetries) {
      console.log(`Chunk ${chunkIndex + 1}: Retrying after error... (${retryCount + 1}/${maxRetries})`);
      return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
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
  text: string
): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    // 텍스트를 청크로 분할 (약 3,500자씩)
    const chunks = splitTextIntoChunks(text, 4000);
    console.log(`Splitting text into ${chunks.length} chunks for parallel AI processing`);

    // 1단계: 첫 번째 청크를 먼저 파싱하여 컬럼명 확인
    const firstChunkResult = await parseChunkWithAI(chunks[0], 0, [], "[]");

    // 첫 번째 청크에서 컬럼명 추출
    let columnsFromFirst: string[] = [];
    let sampleExample = "[]";

    if (firstChunkResult.length > 0) {
      columnsFromFirst = Object.keys(firstChunkResult[0]);
      sampleExample = JSON.stringify(firstChunkResult.slice(0, 3), null, 2);
      console.log(`First chunk columns: ${columnsFromFirst.join(", ")}`);
    }

    // 2단계: 나머지 청크들을 병렬 처리 (첫 번째 청크의 컬럼명과 샘플 전달)
    const startTime = Date.now();
    const remainingChunks = chunks.slice(1);

    const chunkPromises = remainingChunks.map((chunk, index) =>
      parseChunkWithAI(chunk, index + 1, columnsFromFirst, sampleExample)
    );

    const results = await Promise.all(chunkPromises);
    const elapsed = Date.now() - startTime;
    console.log(`Parallel AI processing completed in ${elapsed}ms`);

    // 모든 결과 합치기 (첫 번째 청크 포함)
    const allTransactions: TransactionRow[] = [...firstChunkResult];
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

    // 바로 AI 병렬 파싱 (샘플 파싱 생략)
    console.log(`AI 병렬 파싱 시작 (${text.length}자)`);
    const allTransactions = await parseFullTextWithAIParallel(text);
    const elapsed = Date.now() - startTime;
    console.log(`AI 병렬 파싱 완료: ${elapsed}ms`);

    if (!allTransactions || allTransactions.length === 0) {
      console.log("파싱 실패");
      return null;
    }

    const cost = calculateCost(totalTokenUsage);

    console.log(`=== 파싱 완료 ===`);
    console.log(`총 시간: ${elapsed}ms`);
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
    const forceRefresh = formData.get("forceRefresh") === "true";

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

    // forceRefresh인 경우 기존 캐시 삭제
    if (forceRefresh && isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      console.log(`Force refresh requested, deleting cache for: ${file.name} (hash: ${fileHash})`);
      await deleteCachedParsing(fileHash);
    }

    // 캐시 확인 (활성화된 경우, forceRefresh가 아닌 경우)
    if (isCacheEnabled() && !forceRefresh) {
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

      // 텍스트 기반 PDF인 경우 텍스트 직접 추출 (OCR 스킵)
      if (avgTextPerPage >= 100 && textRatio >= 0.7) {
        console.log(`Text-based PDF detected: avgTextPerPage=${avgTextPerPage}, textRatio=${textRatio}`);
        console.log("Extracting text directly from PDF (skipping OCR)...");

        // 모든 페이지에서 텍스트 직접 추출
        const allTexts: string[] = [];
        for (let i = 0; i < pageCount; i++) {
          const page = doc.loadPage(i);
          const text = page.toStructuredText("preserve-whitespace").asText();
          if (text) {
            allTexts.push(text);
          }
        }
        fullText = allTexts.join("\n\n");
        console.log(`Direct text extraction completed: ${fullText.length} characters from ${pageCount} pages`);
      } else {
        // 이미지 기반 PDF: mupdf를 사용하여 PDF를 이미지로 변환 후 Vision OCR 사용
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
      }
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

    // 거래내역 파싱
    console.log("OCR text sample (first 2000 chars):", fullText.substring(0, 2000));

    // 1단계: 규칙 기반 파싱 시도
    const ruleResult = parseWithBankRule(fullText);

    if (ruleResult.success && ruleResult.transactions.length > 0) {
      console.log(`규칙 기반 파싱 성공 (${ruleResult.bankRule?.bankName}): ${ruleResult.transactions.length}개 거래`);

      const transactions = ruleResult.transactions as unknown as TransactionRow[];
      const columns = ruleResult.columns;

      // 캐시 저장 (AI 비용 0)
      if (isCacheEnabled()) {
        const fileHash = generateFileHash(arrayBuffer);
        await saveParsing({
          fileHash,
          fileName: file.name,
          fileSize: file.size,
          parsingResult: transactions as Record<string, unknown>[],
          columns,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          aiCost: { usd: 0, krw: 0 },
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
        parsingMethod: "rule-based",
        bankId: ruleResult.bankRule?.bankId,
        aiCost: { usd: 0, krw: 0 },
      });

      return NextResponse.json({
        success: true,
        rawText: fullText,
        transactions: transactions,
        columns: columns,
        usedAiParsing: false,
        parsingMethod: "rule-based",
        bankName: ruleResult.bankRule?.bankName,
        message: `${transactions.length}개의 거래내역이 추출되었습니다. (${ruleResult.bankRule?.bankName} 규칙 사용)`,
        aiCost: {
          inputTokens: 0,
          outputTokens: 0,
          usd: 0,
          krw: 0,
        },
      });
    }

    // 2단계: 규칙 기반 파싱 실패 시 AI 파싱
    console.log(`규칙 기반 파싱 실패: ${ruleResult.error || "알 수 없는 오류"}, AI 파싱으로 폴백...`);

    const parseResult = await parseWithAI(fullText);

    if (!parseResult || parseResult.transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 파싱할 수 없습니다. AI가 텍스트에서 거래 패턴을 인식하지 못했습니다." },
        { status: 400 }
      );
    }

    const { transactions, tokenUsage, cost } = parseResult;
    console.log(`AI parsing successful: ${transactions.length} transactions`);

    // 동적 컬럼 추출 (모든 거래에서 컬럼 통합)
    const columns: string[] = [];
    const seenColumns = new Set<string>();

    if (transactions.length > 0) {
      // 첫 번째 거래에서 기본 컬럼 순서 설정
      for (const key of Object.keys(transactions[0])) {
        if (!seenColumns.has(key)) {
          columns.push(key);
          seenColumns.add(key);
        }
      }

      // 모든 거래에서 추가 컬럼 확인 (청크별로 컬럼이 다를 수 있음)
      for (const tx of transactions) {
        for (const key of Object.keys(tx)) {
          if (!seenColumns.has(key)) {
            columns.push(key);
            seenColumns.add(key);
          }
        }
      }

      console.log(`Detected columns: ${columns.join(", ")}`);
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
      parsingMethod: "ai",
      aiCost: cost,
      tokenUsage: tokenUsage,
    });

    return NextResponse.json({
      success: true,
      rawText: fullText,
      transactions: transactions,
      columns: columns,
      usedAiParsing: true,
      parsingMethod: "ai",
      message: `${transactions.length}개의 거래내역이 추출되었습니다. (AI 파싱)`,
      aiCost: {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        usd: cost.usd,
        krw: cost.krw,
      },
    });
  } catch (error) {
    console.error("OCR error:", error);
    console.error("OCR error stack:", error instanceof Error ? error.stack : "No stack");

    await logAction(userEmail, "ocr_error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });

    // 더 구체적인 에러 메시지 제공
    let errorMessage = "OCR 처리 중 오류 발생";
    if (error instanceof Error) {
      if (error.message.includes("pattern")) {
        errorMessage = "Google Cloud 인증 설정 오류입니다. 환경 변수를 확인해주세요.";
      } else if (error.message.includes("PERMISSION_DENIED")) {
        errorMessage = "Google Cloud Vision API 권한이 없습니다.";
      } else if (error.message.includes("UNAUTHENTICATED")) {
        errorMessage = "Google Cloud 인증에 실패했습니다.";
      } else {
        errorMessage = error.message;
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
