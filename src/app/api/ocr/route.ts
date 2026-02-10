import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { GoogleAuth } from "google-auth-library";
import { logAction } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { generateFileHash, getCachedParsing, saveParsing, isCacheEnabled, deleteCachedParsing } from "@/lib/cache";
import { downloadFileFromStorage, deleteFileFromStorage } from "@/lib/storage";
import * as mupdf from "mupdf";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseWithBankRule } from "@/lib/bank-rules";
import * as XLSX from "xlsx";

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

// Gemini Vision으로 테이블 이미지를 직접 파싱
async function parseTableImageWithGemini(
  base64Image: string,
  pageNum: number,
  mimeType: string = "image/png",
  expectedColumns?: string[] // 첫 페이지에서 추출한 컬럼명 (이후 페이지에서 일관성 유지용)
): Promise<TransactionRow[]> {
  const gemini = getGeminiClient();
  if (!gemini) return [];

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 8192,
      },
    });

    // 컬럼명 힌트 (첫 페이지 이후에만 적용)
    const columnHint = expectedColumns && expectedColumns.length > 0
      ? `\n- 반드시 다음 컬럼명을 사용: ${expectedColumns.join(", ")}`
      : "\n- 컬럼명은 테이블 헤더 그대로 사용 (거래일자, 거래종류, 적요, 통화, 출금금액, 입금금액, 잔액, 거래점, 거래시간 등)";

    const prompt = `이 이미지는 은행 거래내역 테이블입니다. 테이블의 각 행을 JSON 배열로 추출하세요.

규칙:
- 테이블의 각 행을 하나의 JSON 객체로 변환
- 헤더, 합계, 페이지번호, 안내문구 제외${columnHint}
- 금액은 숫자만 (쉼표 없이)
- 셀 내 줄바꿈은 공백으로 연결 (예: "부산은행\\n0214" → "부산은행 0214")
- 완전한 JSON 배열만 출력 (코드블록 없이)

JSON:`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
      { text: prompt },
    ]);

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
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`Page ${pageNum + 1}: No JSON array found in Gemini Vision response`);
      return [];
    }

    const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
    console.log(`Page ${pageNum + 1}: Gemini Vision extracted ${transactions.length} transactions`);

    // 금액 문자열을 숫자로 변환
    return transactions.map(tx => {
      const result = { ...tx };
      for (const key of Object.keys(result)) {
        const val = result[key];
        if (typeof val === "string") {
          const cleaned = val.replace(/[,원₩\s]/g, "");
          if (/^\d+$/.test(cleaned) && cleaned.length > 0) {
            result[key] = parseFloat(cleaned);
          }
        }
      }
      return result;
    });
  } catch (error) {
    console.error(`Page ${pageNum + 1} Gemini Vision error:`, error);
    return [];
  }
}

// OCR 텍스트 전처리: 날짜로 시작하지 않는 줄을 이전 줄에 병합
function mergeOcrLines(text: string): string {
  const lines = text.split('\n');
  const merged: string[] = [];

  // 날짜 패턴: YYYY.MM.DD, YYYY-MM-DD, YYYY/MM/DD, YY.MM.DD 등
  const datePattern = /^\d{2,4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 날짜로 시작하면 새 줄
    if (datePattern.test(trimmed)) {
      merged.push(trimmed);
    } else if (merged.length > 0) {
      // 날짜로 시작하지 않으면 이전 줄에 붙이기
      merged[merged.length - 1] += ' ' + trimmed;
    } else {
      // 첫 줄인데 날짜가 아니면 (헤더 등) 그대로 추가
      merged.push(trimmed);
    }
  }

  return merged.join('\n');
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
        maxOutputTokens: 32768, // 충분한 출력 토큰 확보
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
- 완전한 JSON 배열만 출력 (코드블록 없이)
- OCR로 인해 한 거래가 여러 줄로 분리될 수 있음. 새 거래는 반드시 완전한 날짜(YYYY.MM.DD 또는 YY.MM.DD 형식)로 시작함. 숫자만 있거나 은행명/지점코드만 있는 줄은 이전 거래의 연속이니 병합하세요${columnHint}${sampleHint}

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
    // 텍스트를 청크로 분할 (약 2000자씩 - 작은 청크로 정확도 향상)
    const chunks = splitTextIntoChunks(text, 2000);
    console.log(`Splitting text into ${chunks.length} chunks for parallel AI processing`);

    // 1단계: 첫 번째 청크를 먼저 파싱하여 컬럼명 확인
    const startTime = Date.now();
    const firstChunkResult = await parseChunkWithAI(chunks[0], 0, [], "[]");

    // 첫 번째 청크에서 컬럼명 추출
    let columnsFromFirst: string[] = [];
    let sampleExample = "[]";

    if (firstChunkResult.length > 0) {
      columnsFromFirst = Object.keys(firstChunkResult[0]);
      sampleExample = JSON.stringify(firstChunkResult.slice(0, 2), null, 2);
      console.log(`First chunk columns: ${columnsFromFirst.join(", ")}`);
    }

    // 2단계: 나머지 청크들을 병렬 처리 (첫 번째 청크의 컬럼명과 샘플 전달)
    const remainingChunks = chunks.slice(1);

    const chunkPromises = remainingChunks.map((chunk, index) =>
      parseChunkWithAI(chunk, index + 1, columnsFromFirst, sampleExample)
    );

    const results = await Promise.all(chunkPromises);
    const elapsed = Date.now() - startTime;
    console.log(`Parallel AI processing completed in ${elapsed}ms`);

    // 모든 결과 합치기 (첫 번째 청크 포함)
    const allTransactions: TransactionRow[] = [...firstChunkResult, ...results.flat()];

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

    // OCR 텍스트 전처리: 날짜로 시작하지 않는 줄 병합
    const mergedText = mergeOcrLines(text);
    console.log(`OCR 줄 병합: ${text.split('\n').length}줄 → ${mergedText.split('\n').length}줄`);

    // 바로 AI 병렬 파싱 (샘플 파싱 생략)
    console.log(`AI 병렬 파싱 시작 (${mergedText.length}자)`);
    const allTransactions = await parseFullTextWithAIParallel(mergedText);
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
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  const provider = (session as any).provider;
  const providerAccountId = (session as any).providerAccountId;

  // 세션 정보 불완전 시 요청 차단 (세션 유실로 인한 무제한 사용 방지)
  if (!userEmail || !provider || !providerAccountId) {
    console.error("Incomplete session info:", { userEmail, provider, providerAccountId: !!providerAccountId });
    return NextResponse.json(
      { error: "세션 정보가 유효하지 않습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  const userId = providerAccountId;

  // Rate limit: 분당 10회 (Gemini API 비용 보호)
  const { allowed, remaining: rlRemaining } = rateLimit(`ocr:${userId}`, 10, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // 사용량 제한 체크 (Google @sjinlaw.com 관리자 제외)
  const isAdmin = provider === "google" && userEmail.endsWith("@sjinlaw.com");
  if (!isAdmin) {
    const { canUseService } = await import("@/lib/usage");
    const { canUse, remaining, plan } = await canUseService(userId, provider, userEmail);

    if (!canUse) {
      const upgradeMessage = plan === 'free'
        ? "무료 사용량(3회)을 모두 사용하셨습니다. 프리미엄 플랜으로 업그레이드하면 더 많은 변환을 이용할 수 있습니다."
        : `현재 플랜의 월 사용량을 모두 사용하셨습니다. 더 높은 플랜으로 업그레이드하세요.`;
      return NextResponse.json(
        {
          error: "사용 한도 초과",
          message: upgradeMessage,
          limitReached: true,
          plan,
          upgradeUrl: "/pricing",
        },
        { status: 403 }
      );
    }
  }

  try {
    // Content-Type에 따라 요청 처리 방식 결정
    const contentType = request.headers.get("content-type") || "";

    let arrayBuffer: ArrayBuffer;
    let fileName: string;
    let fileSize: number;
    let forceRefresh = false;
    let storagePath: string | null = null;

    if (contentType.includes("application/json")) {
      // JSON 요청: Storage에서 파일 다운로드
      const body = await request.json();
      storagePath = body.storagePath;
      fileName = body.fileName;
      forceRefresh = body.forceRefresh === true;

      if (!storagePath || !fileName) {
        return NextResponse.json({ error: "storagePath와 fileName이 필요합니다" }, { status: 400 });
      }

      console.log(`Downloading file from storage: ${storagePath}`);
      const downloadResult = await downloadFileFromStorage(storagePath);

      if (downloadResult.error || !downloadResult.data) {
        console.error("Storage download error:", downloadResult.error);
        return NextResponse.json(
          { error: "파일 다운로드 실패: " + downloadResult.error },
          { status: 500 }
        );
      }

      arrayBuffer = downloadResult.data;
      fileSize = arrayBuffer.byteLength;
      console.log(`Downloaded file: ${fileName}, size: ${fileSize}`);
    } else {
      // FormData 요청: 직접 업로드 (작은 파일용, 4.5MB 이하)
      const formData = await request.formData();
      const file = formData.get("file") as File;
      forceRefresh = formData.get("forceRefresh") === "true";

      if (!file) {
        return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
      }

      fileName = file.name;
      fileSize = file.size;
      arrayBuffer = await file.arrayBuffer();
    }

    // Gemini API 확인 (이미지 기반 문서에 필요)
    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return NextResponse.json(
        { error: "AI 서비스(Gemini)가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 500 }
      );
    }

    // forceRefresh인 경우 기존 캐시 삭제
    if (forceRefresh && isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      console.log(`Force refresh requested, deleting cache for: ${fileName} (hash: ${fileHash})`);
      await deleteCachedParsing(fileHash);
    }

    // 캐시 확인 (활성화된 경우, forceRefresh가 아닌 경우)
    if (isCacheEnabled() && !forceRefresh) {
      const fileHash = generateFileHash(arrayBuffer);
      console.log(`Checking cache for file: ${fileName} (hash: ${fileHash})`);

      const cached = await getCachedParsing(fileHash);
      if (cached) {
        console.log(`Cache HIT for ${fileName}`);

        // Storage 파일 정리 (캐시 히트 시)
        if (storagePath) {
          deleteFileFromStorage(storagePath).catch(err =>
            console.error("Failed to delete storage file:", err)
          );
        }

        await logAction(userEmail, "ocr_extract_cached", {
          fileName: fileName,
          fileSize: fileSize,
          transactionCount: cached.parsing_result.length,
          columns: cached.columns,
          cacheHitCount: cached.hit_count + 1,
        }, userId, provider);

        // 디버그: 캐시 데이터 출력
        console.log("Cached columns:", cached.columns);
        if (cached.parsing_result.length > 0) {
          console.log("Cached first transaction:", JSON.stringify(cached.parsing_result[0]));
        }

        // 사용량 증가 (캐시 히트도 1회 사용으로 카운트, 관리자 제외)
        if (!isAdmin) {
          const { incrementUsage } = await import("@/lib/usage");
          await incrementUsage(userId, provider);
          console.log(`Usage incremented for ${provider} user: ${userId} (cache hit)`);
        }

        return NextResponse.json({
          success: true,
          rawText: "(캐시에서 로드됨)",
          transactions: cached.parsing_result,
          columns: cached.columns,
          cached: true,
          documentType: "image-based", // 캐시된 데이터는 대부분 이미지 기반
          message: `캐시에서 ${cached.parsing_result.length}개의 거래내역을 로드했습니다.`,
          aiCost: cached.ai_cost || { inputTokens: 0, outputTokens: 0, usd: 0, krw: 0 },
        });
      }
      console.log(`Cache MISS for ${fileName}`);
    }

    // 변수 선언 (모든 파일 타입에서 공유)
    let fullText = "";
    let documentType: "text-based" | "image-based" | "image" | "excel" = "image";
    const isPdf = fileName.toLowerCase().endsWith(".pdf");
    const isExcel = fileName.toLowerCase().match(/\.(xlsx|xls)$/);

    // 엑셀 파일인 경우: 직접 JSON 변환 (빠름) + AI 컬럼 감지
    if (isExcel) {
      console.log("Processing Excel file with direct parsing...");
      const startTime = Date.now();

      try {
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // 직접 JSON으로 변환 (즉시 완료)
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

        if (!rawData || rawData.length < 2) {
          return NextResponse.json(
            { error: "엑셀 파일에 데이터가 없습니다." },
            { status: 400 }
          );
        }

        console.log(`Excel direct parse: ${rawData.length} rows extracted in ${Date.now() - startTime}ms`);

        // 헤더 행 자동 감지 (날짜, 거래, 입금, 출금 등 키워드로 찾기)
        const headerKeywords = ["날짜", "거래일", "입금", "출금", "잔액", "적요", "내용", "금액", "거래내역"];
        let headerRowIndex = 0;

        for (let i = 0; i < Math.min(rawData.length, 20); i++) {
          const row = rawData[i];
          if (!row) continue;

          const rowText = row.map(cell => String(cell || "").toLowerCase()).join(" ");
          const matchCount = headerKeywords.filter(keyword => rowText.includes(keyword)).length;

          if (matchCount >= 2) {
            headerRowIndex = i;
            console.log(`Header row detected at index ${i}: ${row.slice(0, 5).join(", ")}`);
            break;
          }
        }

        // 헤더 행과 데이터 행 분리
        const headers = (rawData[headerRowIndex] as unknown[]).map(h => String(h || "").trim()).filter(h => h);
        const dataRows = rawData.slice(headerRowIndex + 1);

        // 데이터를 객체 배열로 변환
        const transactions = dataRows
          .filter(row => row && row.length > 0 && row.some(cell => cell !== null && cell !== undefined && cell !== ""))
          .map(row => {
            const obj: Record<string, unknown> = {};
            headers.forEach((header, idx) => {
              if (header && row[idx] !== undefined && row[idx] !== null) {
                obj[String(header).trim()] = row[idx];
              }
            });
            return obj;
          })
          .filter(obj => Object.keys(obj).length > 0);

        console.log(`Excel parsed: ${transactions.length} transactions with columns: ${headers.join(", ")}`);

        // 캐시 저장
        if (isCacheEnabled()) {
          const fileHash = generateFileHash(arrayBuffer);
          await saveParsing({
            fileHash,
            fileName,
            fileSize,
            parsingResult: transactions as Record<string, unknown>[],
            columns: headers.filter(h => h),
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            aiCost: { usd: 0, krw: 0 },
            userEmail,
            userId,
            provider,
          });
          console.log(`Cached Excel parsing result for ${fileName}`);
        }

        // Storage 파일 정리
        if (storagePath) {
          deleteFileFromStorage(storagePath).catch(err =>
            console.error("Failed to delete storage file:", err)
          );
        }

        // 작업 로그 기록
        await logAction(userEmail, "ocr_extract", {
          fileName,
          fileSize,
          transactionCount: transactions.length,
          columns: headers,
          parsingMethod: "excel-direct",
          documentType: "excel",
          aiCost: { usd: 0, krw: 0 },
        }, userId, provider);

        const elapsed = Date.now() - startTime;
        console.log(`Excel processing completed in ${elapsed}ms`);

        // 사용량 증가 (관리자 제외)
        if (!isAdmin) {
          const { incrementUsage } = await import("@/lib/usage");
          await incrementUsage(userId, provider);
          console.log(`Usage incremented for ${provider} user: ${userId} (excel direct)`);
        }

        return NextResponse.json({
          success: true,
          rawText: "(엑셀 직접 파싱)",
          transactions,
          columns: headers.filter(h => h),
          usedAiParsing: false,
          parsingMethod: "excel-direct",
          documentType: "excel",
          message: `${transactions.length}개의 거래내역이 추출되었습니다. (${elapsed}ms)`,
          aiCost: {
            inputTokens: 0,
            outputTokens: 0,
            usd: 0,
            krw: 0,
          },
        });
      } catch (excelError) {
        console.error("Excel parsing error:", excelError);
        return NextResponse.json(
          { error: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다." },
          { status: 400 }
        );
      }
    }

    // PDF 또는 이미지 파일 처리 (Excel이 아닌 경우에만)
    if (!isExcel) {
      // 버퍼 복사 (여러 라이브러리에서 사용하기 위해)
      const bufferCopy = Buffer.from(arrayBuffer).buffer.slice(0);
      const buffer = Buffer.from(bufferCopy);
      const base64Content = buffer.toString("base64");

      console.log("OCR: Processing file:", fileName, "isPdf:", isPdf, "size:", fileSize);

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
          documentType = "text-based";
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
          documentType = "image-based";
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

              // 108 DPI로 이미지 생성 (72 DPI가 기본, 1.5배 스케일 = 108 DPI) - 속도 최적화
              const scale = 1.5;
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

          // 2단계: Gemini Vision으로 직접 테이블 파싱 (10개씩 배치)
          const ocrStart = Date.now();
          const batchSize = 10;
          console.log(`Starting Gemini Vision parsing for ${pageImages.length} pages...`);
          const allTransactionsFromImages: TransactionRow[] = [];

          // 토큰 사용량 초기화
          resetTokenUsage();

          // 1단계: 첫 번째 페이지만 먼저 처리하여 컬럼명 추출
          let extractedColumns: string[] | undefined;

          if (pageImages.length > 0) {
            console.log("Processing first page to extract column names...");
            const firstPageResult = await parseTableImageWithGemini(
              pageImages[0].base64,
              pageImages[0].pageNum,
              "image/png"
            );

            if (firstPageResult.length > 0) {
              allTransactionsFromImages.push(...firstPageResult);
              extractedColumns = Object.keys(firstPageResult[0]);
              console.log(`First page: ${firstPageResult.length} transactions, columns: ${extractedColumns.join(", ")}`);
            }
          }

          // 2단계: 나머지 페이지들을 배치로 처리 (첫 페이지에서 추출한 컬럼명 전달)
          const remainingPages = pageImages.slice(1);

          for (let batchStart = 0; batchStart < remainingPages.length; batchStart += batchSize) {
            const batchNum = Math.floor(batchStart / batchSize) + 1;
            const totalBatches = Math.ceil(remainingPages.length / batchSize);
            const pageStart = batchStart + 2; // 2페이지부터 시작
            const pageEnd = Math.min(batchStart + batchSize + 1, remainingPages.length + 1);
            console.log(`Batch ${batchNum}/${totalBatches} starting (pages ${pageStart}-${pageEnd})...`);

            const batch = remainingPages.slice(batchStart, batchStart + batchSize);

            // 첫 페이지에서 추출한 컬럼명을 모든 페이지에 전달하여 일관성 유지
            const batchPromises = batch.map(({ pageNum, base64 }) =>
              parseTableImageWithGemini(base64, pageNum, "image/png", extractedColumns)
            );

            const batchResults = await Promise.all(batchPromises);
            let batchTransactionCount = 0;
            for (const transactions of batchResults) {
              allTransactionsFromImages.push(...transactions);
              batchTransactionCount += transactions.length;
            }
            console.log(`Batch ${batchNum}/${totalBatches} completed: ${batchTransactionCount} transactions`);
          }

          console.log(`Gemini Vision completed in ${Date.now() - ocrStart}ms`);
          console.log(`Total transactions from images: ${allTransactionsFromImages.length}`);

          // 디버그: 첫 번째 거래 데이터 샘플 출력
          if (allTransactionsFromImages.length > 0) {
            console.log("Sample transaction (first):", JSON.stringify(allTransactionsFromImages[0]));
          }

          // 이미지 기반 PDF는 Gemini Vision 결과를 직접 반환
          if (allTransactionsFromImages.length === 0) {
            // Storage 파일 정리
            if (storagePath) {
              deleteFileFromStorage(storagePath).catch(err =>
                console.error("Failed to delete storage file:", err)
              );
            }
            return NextResponse.json(
              { error: "이미지에서 거래내역을 추출할 수 없습니다. 테이블이 명확한지 확인해주세요." },
              { status: 400 }
            );
          }

          // 컬럼 추출 (첫 번째 거래에서 - 프롬프트로 일관성 보장됨)
          const columns: string[] = allTransactionsFromImages.length > 0
            ? Object.keys(allTransactionsFromImages[0])
            : [];
          console.log(`Columns from first transaction: ${columns.length} columns - ${columns.join(", ")}`);

          const cost = calculateCost(totalTokenUsage);

          // 캐시 저장
          if (isCacheEnabled()) {
            const fileHash = generateFileHash(arrayBuffer);
            await saveParsing({
              fileHash,
              fileName,
              fileSize,
              parsingResult: allTransactionsFromImages as Record<string, unknown>[],
              columns,
              tokenUsage: { ...totalTokenUsage },
              aiCost: { ...cost },
              userEmail,
              userId,
              provider,
            });
          }

          // Storage 파일 정리
          if (storagePath) {
            deleteFileFromStorage(storagePath).catch(err =>
              console.error("Failed to delete storage file:", err)
            );
          }

          // 로그 기록
          await logAction(userEmail, "ocr_extract", {
            fileName,
            fileSize,
            transactionCount: allTransactionsFromImages.length,
            columns,
            parsingMethod: "gemini-vision",
            documentType,
            aiCost: cost,
            tokenUsage: totalTokenUsage,
          }, userId, provider);

          // 디버그: 컬럼과 첫 번째 거래 출력
          console.log("Returning columns:", columns);
          if (allTransactionsFromImages.length > 0) {
            console.log("First transaction keys:", Object.keys(allTransactionsFromImages[0]));
          }

          return NextResponse.json({
            success: true,
            rawText: "(Gemini Vision으로 이미지에서 직접 추출)",
            transactions: allTransactionsFromImages,
            columns,
            usedAiParsing: true,
            parsingMethod: "gemini-vision",
            documentType,
            message: `${allTransactionsFromImages.length}개의 거래내역이 추출되었습니다. (Gemini Vision)`,
            aiCost: {
              inputTokens: totalTokenUsage.inputTokens,
              outputTokens: totalTokenUsage.outputTokens,
              usd: cost.usd,
              krw: cost.krw,
            },
          });
        }
      } else {
        // 이미지의 경우 - Gemini Vision으로 직접 파싱
        documentType = "image";
        console.log("Processing image with Gemini Vision...");

        resetTokenUsage();
        const transactions = await parseTableImageWithGemini(base64Content, 0, "image/png");

        if (transactions.length === 0) {
          // Storage 파일 정리
          if (storagePath) {
            deleteFileFromStorage(storagePath).catch(err =>
              console.error("Failed to delete storage file:", err)
            );
          }
          return NextResponse.json(
            { error: "이미지에서 거래내역을 추출할 수 없습니다. 테이블이 명확한지 확인해주세요." },
            { status: 400 }
          );
        }

        // 컬럼 추출 (첫 번째 거래에서만 - 일관성 보장)
        const columns: string[] = transactions.length > 0
          ? Object.keys(transactions[0])
          : [];

        const cost = calculateCost(totalTokenUsage);

        // 캐시 저장
        if (isCacheEnabled()) {
          const fileHash = generateFileHash(arrayBuffer);
          await saveParsing({
            fileHash,
            fileName,
            fileSize,
            parsingResult: transactions as Record<string, unknown>[],
            columns,
            tokenUsage: { ...totalTokenUsage },
            aiCost: { ...cost },
            userEmail,
            userId,
            provider,
          });
        }

        // Storage 파일 정리
        if (storagePath) {
          deleteFileFromStorage(storagePath).catch(err =>
            console.error("Failed to delete storage file:", err)
          );
        }

        // 로그 기록
        await logAction(userEmail, "ocr_extract", {
          fileName,
          fileSize,
          transactionCount: transactions.length,
          columns,
          parsingMethod: "gemini-vision",
          documentType,
          aiCost: cost,
          tokenUsage: totalTokenUsage,
        }, userId, provider);

        return NextResponse.json({
          success: true,
          rawText: "(Gemini Vision으로 이미지에서 직접 추출)",
          transactions,
          columns,
          usedAiParsing: true,
          parsingMethod: "gemini-vision",
          documentType,
          message: `${transactions.length}개의 거래내역이 추출되었습니다. (Gemini Vision)`,
          aiCost: {
            inputTokens: totalTokenUsage.inputTokens,
            outputTokens: totalTokenUsage.outputTokens,
            usd: cost.usd,
            krw: cost.krw,
          },
        });
      }
    } // End of if (!isExcel) block - OCR processing

    // Excel과 텍스트 기반 PDF 공통: AI 텍스트 파싱
    // (Excel은 위에서 fullText 설정됨, 텍스트 기반 PDF도 fullText 설정됨)

    // 텍스트가 없으면 에러
    if (!fullText) {
      return NextResponse.json(
        { error: "텍스트를 추출할 수 없습니다." },
        { status: 400 }
      );
    }

    // 거래내역 파싱 (Gemini AI 사용)
    console.log("OCR text sample (first 2000 chars):", fullText.substring(0, 2000));
    console.log("Starting Gemini AI parsing...");

    const parseResult = await parseWithAI(fullText);

    if (!parseResult || parseResult.transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 파싱할 수 없습니다. AI가 텍스트에서 거래 패턴을 인식하지 못했습니다." },
        { status: 400 }
      );
    }

    const { transactions, tokenUsage, cost } = parseResult;
    console.log(`AI parsing successful: ${transactions.length} transactions`);

    // 컬럼 추출 (첫 번째 거래에서만 - 일관성 보장)
    const columns: string[] = transactions.length > 0
      ? Object.keys(transactions[0])
      : [];
    console.log(`Columns from first transaction: ${columns.length} columns - ${columns.join(", ")}`);

    // 캐시 저장 (활성화된 경우)
    if (isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      await saveParsing({
        fileHash,
        fileName: fileName,
        fileSize: fileSize,
        parsingResult: transactions as Record<string, unknown>[],
        columns,
        tokenUsage: { ...tokenUsage },
        aiCost: { ...cost },
        userEmail,
        userId,
        provider,
      });
      console.log(`Cached parsing result for ${fileName}`);
    }

    // Storage 파일 정리
    if (storagePath) {
      deleteFileFromStorage(storagePath).catch(err =>
        console.error("Failed to delete storage file:", err)
      );
    }

    // 작업 로그 기록
    await logAction(userEmail, "ocr_extract", {
      fileName: fileName,
      fileSize: fileSize,
      extractedTextLength: fullText.length,
      transactionCount: transactions.length,
      columns: columns,
      parsingMethod: "ai",
      aiCost: cost,
      tokenUsage: tokenUsage,
    }, userId, provider);

    // 사용량 증가 (관리자 제외)
    if (!isAdmin) {
      const { incrementUsage } = await import("@/lib/usage");
      await incrementUsage(userId, provider);
    }

    return NextResponse.json({
      success: true,
      rawText: fullText,
      transactions: transactions,
      columns: columns,
      usedAiParsing: true,
      parsingMethod: "ai",
      documentType: documentType,
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
    }, userId, provider);

    // 사용자에게는 일반적인 에러 메시지만 노출 (내부 정보 차단)
    let errorMessage = "OCR 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    if (error instanceof Error) {
      if (error.message.includes("pattern") || error.message.includes("UNAUTHENTICATED")) {
        errorMessage = "서비스 인증 오류가 발생했습니다. 관리자에게 문의해주세요.";
      } else if (error.message.includes("PERMISSION_DENIED")) {
        errorMessage = "서비스 권한 오류가 발생했습니다. 관리자에게 문의해주세요.";
      } else if (error.message.includes("RESOURCE_EXHAUSTED") || error.message.includes("429")) {
        errorMessage = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
