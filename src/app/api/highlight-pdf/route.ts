import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
import { logAction } from "@/lib/supabase";
import { generateFileHash, getCachedParsing, saveParsing, isCacheEnabled } from "@/lib/cache";
import * as mupdf from "mupdf";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ImageAnnotatorClient } from "@google-cloud/vision";

// 동적 컬럼 지원
type TransactionRow = Record<string, string | number>;

// ==================== 정규식 기반 텍스트 PDF 파싱 ====================

// 날짜 패턴 확장 (MM/DD, MM월 DD일 포함)
function isDataLine(line: string): boolean {
  const datePatterns = [
    /^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/,     // 2024.01.01, 2024-01-01, 2024/01/01
    /^\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/,     // 24.01.01, 24-01-01
    /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/,         // 2024. 1. 1 (공백 포함)
    /^\d{1,2}[\/\-]\d{1,2}(?!\d)/,            // 01/05, 1-5 (MM/DD)
    /^\d{1,2}월\s*\d{1,2}일/,                 // 1월 5일, 12월 25일
  ];
  return datePatterns.some(p => p.test(line.trim()));
}

// 금액 파싱 (괄호 음수 처리 포함)
function parseAmount(str: string): number {
  if (!str) return 0;

  // 괄호 음수 처리: (1,000) → -1000
  const isNegative = str.includes("(") && str.includes(")");

  const cleaned = str.replace(/[,\s원₩\-\(\)]/g, "").trim();
  if (!cleaned || cleaned === "") return 0;

  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;

  return isNegative ? -Math.abs(num) : Math.abs(num);
}

// 헤더 라인 감지 (완화된 조건)
function detectHeaderLine(lines: string[]): { headerIndex: number; columns: string[] } | null {
  const headerKeywords = [
    "거래일", "일자", "날짜", "date",
    "입금", "출금", "금액", "잔액",
    "적요", "내용", "거래내용", "비고", "메모",
    "맡기신", "찾으신", "받으신", "보내신",
    "거래점", "취급점", "지점",
  ];

  // 50줄까지 검색 (기존 30줄에서 확대)
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 키워드 1개 이상이면 헤더 후보 (기존 2개에서 완화)
    const matchCount = headerKeywords.filter(kw =>
      line.toLowerCase().includes(kw.toLowerCase())
    ).length;

    if (matchCount >= 1) {
      // 공백 1칸 이상으로 분리 (기존 2칸에서 완화)
      const columns = line.split(/\s+/).map(c => c.trim()).filter(c => c.length > 0);
      if (columns.length >= 2) {
        return { headerIndex: i, columns };
      }
    }
  }
  return null;
}

// 데이터 라인 파싱 (완화된 조건)
function parseDataLine(line: string, columns: string[]): TransactionRow | null {
  const trimmedLine = line.trim();
  if (!trimmedLine || !isDataLine(trimmedLine)) return null;

  // 공백 1칸 이상으로 분리 (기존 2칸에서 완화)
  const parts = trimmedLine.split(/\s+/).map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length < 2) return null;

  const row: TransactionRow = {};

  // 컬럼 수와 파트 수 매칭
  for (let i = 0; i < columns.length && i < parts.length; i++) {
    const col = columns[i];
    const val = parts[i];

    // 금액 컬럼이면 숫자로 변환
    if (isAmountColumn(col)) {
      row[col] = parseAmount(val);
    } else {
      row[col] = val;
    }
  }

  // 빈 행 체크
  const hasData = Object.values(row).some(v => v !== "" && v !== 0);
  return hasData ? row : null;
}

// 정규식 기반 텍스트 파싱 메인 함수
function parseTextWithRegex(text: string): { transactions: TransactionRow[]; columns: string[] } | null {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 3) return null;

  // 헤더 감지
  const headerResult = detectHeaderLine(lines);
  if (!headerResult) {
    console.log("정규식 파싱: 헤더를 찾을 수 없음");
    return null;
  }

  const { headerIndex, columns } = headerResult;
  console.log(`정규식 파싱: 헤더 발견 (line ${headerIndex + 1}): ${columns.join(", ")}`);

  // 데이터 행 파싱
  const transactions: TransactionRow[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const row = parseDataLine(lines[i], columns);
    if (row) {
      transactions.push(row);
    }
  }

  console.log(`정규식 파싱: ${transactions.length}개 거래 추출`);

  return transactions.length > 0 ? { transactions, columns } : null;
}

// Google Cloud Vision 클라이언트 초기화
function getVisionClient(): ImageAnnotatorClient | null {
  let credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentialsJson) {
    console.warn("Google Cloud credentials not configured");
    return null;
  }

  try {
    credentialsJson = credentialsJson.replace(/\n/g, "\\n");
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

// 토큰 사용량 추적
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

let totalTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

function resetTokenUsage() {
  totalTokenUsage = { inputTokens: 0, outputTokens: 0 };
}

function addTokenUsage(input: number, output: number) {
  totalTokenUsage.inputTokens += input;
  totalTokenUsage.outputTokens += output;
}

// Gemini 가격 계산
const GEMINI_PRICING = {
  inputPricePerMillion: 0.075,
  outputPricePerMillion: 0.30,
};

function calculateCost(usage: TokenUsage): { usd: number; krw: number } {
  const inputCost = (usage.inputTokens / 1_000_000) * GEMINI_PRICING.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * GEMINI_PRICING.outputPricePerMillion;
  const totalUsd = inputCost + outputCost;
  const totalKrw = totalUsd * 1450;
  return { usd: totalUsd, krw: totalKrw };
}

// AI로 샘플 거래 파싱 (처음 5개)
async function parseSampleTransactions(sampleText: string): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

    const prompt = `당신은 한국 은행 거래내역을 정확하게 파싱하는 전문가입니다.

## 작업
아래 텍스트에서 처음 5개의 거래내역만 추출하여 JSON 배열로 반환하세요.

## 입력 텍스트
${sampleText}

## 중요: 컬럼명 규칙
- 원본 문서에 있는 컬럼명(헤더)을 그대로 JSON 키로 사용하세요
- 공백이 있는 컬럼명은 공백을 제거하세요

## 파싱 규칙
- 날짜 값은 "YYYY.MM.DD" 형식으로 통일
- 금액 값은 숫자만 (쉼표, 원, ₩ 제거)
- 빈 값은 문자열 컬럼은 "", 숫자 컬럼은 0으로 설정

JSON 배열만 반환하세요:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      addTokenUsage(usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0);
    }

    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];

    // 유효한 거래만 필터링
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

    const validTransactions = transactions
      .filter(tx => {
        const dateVal = findDateColumn(tx);
        const depositVal = findAmountValue(tx, depositKeywords);
        const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
        const generalAmount = findAmountValue(tx, generalAmountKeywords);
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

// 텍스트를 청크로 분할
function splitTextIntoChunks(text: string, chunkSize: number = 15000): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  const datePattern = /\n(?=\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}|\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2})/g;

  let startIndex = 0;
  let lastValidBreak = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + chunkSize, text.length);

    if (endIndex < text.length) {
      const searchText = text.substring(startIndex, endIndex + 500);
      const matches = [...searchText.matchAll(datePattern)];

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
    if (chunk.length > 0) chunks.push(chunk);

    startIndex = endIndex;
    if (startIndex === lastValidBreak) startIndex += chunkSize;
    lastValidBreak = startIndex;
  }

  return chunks;
}

// 단일 청크 AI 파싱
async function parseChunkWithAI(
  chunkText: string,
  chunkIndex: number,
  detectedColumns: string[],
  sampleExample: string
): Promise<TransactionRow[]> {
  const gemini = getGeminiClient();
  if (!gemini) return [];

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

    const columnsDescription = detectedColumns.length > 0
      ? `사용할 컬럼명: ${detectedColumns.join(", ")}`
      : "";

    const prompt = `당신은 한국 은행 거래내역을 정확하게 파싱하는 전문가입니다.

## 작업
아래 텍스트에서 모든 거래내역을 추출하여 JSON 배열로 반환하세요.

## 참고: 이 문서의 형식 예시
${sampleExample}

${columnsDescription ? `## ${columnsDescription}` : ""}

## 입력 텍스트 (청크 ${chunkIndex + 1})
${chunkText}

## 파싱 규칙
- 날짜 값은 "YYYY.MM.DD" 형식으로 통일
- 금액 값은 숫자만 (쉼표, 원, ₩ 제거)
- 빈 값은 문자열 컬럼은 "", 숫자 컬럼은 0으로 설정

JSON 배열만 반환하세요:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    const usageMetadata = result.response.usageMetadata;
    if (usageMetadata) {
      addTokenUsage(usageMetadata.promptTokenCount || 0, usageMetadata.candidatesTokenCount || 0);
    }

    let jsonStr = response;
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
    console.log(`Chunk ${chunkIndex + 1}: parsed ${transactions.length} transactions`);

    // 필터링 및 정규화
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

    return transactions
      .filter(tx => {
        const dateVal = findDateColumn(tx);
        const depositVal = findAmountValue(tx, depositKeywords);
        const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
        const generalAmount = findAmountValue(tx, generalAmountKeywords);
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
  } catch (error) {
    console.error(`Chunk ${chunkIndex + 1} parsing error:`, error);
    return [];
  }
}

// 병렬 AI 파싱
async function parseFullTextWithAI(
  text: string,
  detectedColumns: string[],
  sampleTransactions: TransactionRow[]
): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    const sampleExample = sampleTransactions.length > 0
      ? JSON.stringify(sampleTransactions.slice(0, 3), null, 2)
      : "[]";

    const chunks = splitTextIntoChunks(text, 15000);
    console.log(`Splitting text into ${chunks.length} chunks`);

    const startTime = Date.now();
    const results = await Promise.all(
      chunks.map((chunk, index) => parseChunkWithAI(chunk, index, detectedColumns, sampleExample))
    );
    console.log(`Parallel AI processing completed in ${Date.now() - startTime}ms`);

    const allTransactions: TransactionRow[] = [];
    for (const chunkTransactions of results) {
      allTransactions.push(...chunkTransactions);
    }

    // 중복 제거
    const seen = new Set<string>();
    const uniqueTransactions = allTransactions.filter(tx => {
      const key = Object.keys(tx).sort().map(k => `${k}:${tx[k]}`).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total: ${allTransactions.length}, after dedup: ${uniqueTransactions.length}`);
    return uniqueTransactions;
  } catch (error) {
    console.error("Parallel AI parsing error:", error);
    return null;
  }
}

// AI 기반 파싱 메인 함수
interface ParseResult {
  transactions: TransactionRow[];
  tokenUsage: TokenUsage;
  cost: { usd: number; krw: number };
}

async function parseWithAI(text: string): Promise<ParseResult | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  resetTokenUsage();

  try {
    // 1단계: 샘플 AI 파싱
    const sampleText = text.substring(0, 3000);
    console.log(`[1단계] 샘플 AI 파싱 시작`);

    const sampleTransactions = await parseSampleTransactions(sampleText);

    if (!sampleTransactions || sampleTransactions.length === 0) {
      console.log("샘플 파싱 실패, 전체 파싱 시도");
      const result = await parseFullTextWithAI(text, [], []);
      const cost = calculateCost(totalTokenUsage);
      return result ? { transactions: result, tokenUsage: { ...totalTokenUsage }, cost } : null;
    }

    // 샘플에서 발견된 컬럼 추출
    const detectedColumns = new Set<string>();
    for (const tx of sampleTransactions) {
      for (const key of Object.keys(tx)) {
        if (tx[key] !== undefined && tx[key] !== null && tx[key] !== "" && tx[key] !== 0) {
          detectedColumns.add(key);
        }
      }
    }

    // 2단계: AI 병렬 전체 파싱
    console.log(`[2단계] AI 병렬 파싱 시작`);
    const allTransactions = await parseFullTextWithAI(text, [...detectedColumns], sampleTransactions);

    if (!allTransactions || allTransactions.length === 0) {
      const cost = calculateCost(totalTokenUsage);
      return { transactions: sampleTransactions, tokenUsage: { ...totalTokenUsage }, cost };
    }

    const cost = calculateCost(totalTokenUsage);
    console.log(`=== 파싱 완료: ${allTransactions.length}개 거래, 비용: ${cost.krw.toFixed(0)}원 ===`);

    return { transactions: allTransactions, tokenUsage: { ...totalTokenUsage }, cost };
  } catch (error) {
    console.error("AI parsing error:", error);
    return null;
  }
}

// 금액 컬럼 판별 헬퍼 함수들
function isAmountColumn(col: string): boolean {
  const keywords = ["금액", "잔액", "입금", "출금", "맡기신", "찾으신", "받으신", "보내신", "balance", "deposit", "withdrawal"];
  return keywords.some(kw => col.toLowerCase().includes(kw.toLowerCase()));
}

function isDepositColumn(col: string): boolean {
  const keywords = ["입금", "맡기신", "받으신", "deposit"];
  return keywords.some(kw => col.toLowerCase().includes(kw.toLowerCase()));
}

function isWithdrawalColumn(col: string): boolean {
  const keywords = ["출금", "찾으신", "보내신", "withdrawal"];
  return keywords.some(kw => col.toLowerCase().includes(kw.toLowerCase()));
}

// Excel 생성 함수
function createExcelFromTransactions(
  transactions: TransactionRow[],
  columns: string[],
  threshold: number,
  color: string
): { workbook: ExcelJS.Workbook; highlightedRows: number } {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("거래내역");

  // 컬럼 설정
  worksheet.columns = columns.map((col) => ({
    header: col,
    key: col,
    width: isAmountColumn(col) ? 15 : col.includes("일") || col.includes("날짜") ? 15 : 25,
  }));

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
    const rowData: Record<string, unknown> = {};
    for (const col of columns) {
      rowData[col] = tx[col] ?? "";
    }
    const row = worksheet.addRow(rowData);

    // 기준 금액 이상이면 하이라이트
    let maxAmount = 0;
    for (const col of columns) {
      if ((isDepositColumn(col) || isWithdrawalColumn(col)) && typeof tx[col] === "number") {
        maxAmount = Math.max(maxAmount, tx[col] as number);
      }
    }

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
    for (const col of columns) {
      if (isAmountColumn(col) && typeof tx[col] === "number" && tx[col] > 0) {
        row.getCell(col).numFmt = "#,##0";
      }
    }
  }

  return { workbook, highlightedRows };
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

    // API 클라이언트 확인
    const visionClient = getVisionClient();
    const geminiClient = getGeminiClient();

    if (!visionClient) {
      return NextResponse.json(
        { error: "OCR 서비스가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    if (!geminiClient) {
      return NextResponse.json(
        { error: "AI 파싱 서비스가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    // 캐시 확인
    if (isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      const cached = await getCachedParsing(fileHash);

      if (cached) {
        console.log(`Cache HIT for ${file.name}`);
        const transactions = cached.parsing_result as TransactionRow[];
        const columns = cached.columns;

        const { workbook, highlightedRows } = createExcelFromTransactions(
          transactions, columns, threshold, color
        );

        const outputBuffer = await workbook.xlsx.writeBuffer();
        const originalName = file.name.replace(/\.[^/.]+$/, "");
        const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);

        return new NextResponse(outputBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
          },
        });
      }
    }

    // PDF를 처리
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    let fullText = "";
    let isTextPdf = false;

    if (isPdf) {
      const pdfBuffer = Buffer.from(arrayBuffer);
      const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
      const pageCount = Math.min(doc.countPages(), 50); // 최대 50페이지

      // 1. 먼저 텍스트 PDF인지 확인 (텍스트 직접 추출 시도)
      console.log("Checking if PDF has embedded text...");
      const extractedTexts: string[] = [];

      for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        try {
          const page = doc.loadPage(pageNum);
          const pageText = page.toStructuredText("preserve-whitespace").asText();
          if (pageText && pageText.trim().length > 0) {
            extractedTexts.push(pageText);
          }
        } catch (err) {
          console.error(`Text extraction error page ${pageNum + 1}:`, err);
        }
      }

      const directText = extractedTexts.join("\n\n");

      // 텍스트가 충분히 있으면 텍스트 PDF로 판단
      if (directText.length > 500) {
        console.log(`텍스트 PDF 감지: ${directText.length} chars`);
        fullText = directText;
        isTextPdf = true;

        // 텍스트 PDF: 정규식 파싱 우선 시도
        console.log("정규식 파싱 시도...");
        const regexResult = parseTextWithRegex(fullText);

        if (regexResult && regexResult.transactions.length >= 3) {
          console.log(`정규식 파싱 성공: ${regexResult.transactions.length}개 거래`);

          const { transactions, columns } = regexResult;

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
          }

          // Excel 생성
          const { workbook, highlightedRows } = createExcelFromTransactions(
            transactions, columns, threshold, color
          );

          // 로그 기록
          await logAction(userEmail, "highlight_pdf_transactions", {
            fileName: file.name,
            fileSize: file.size,
            threshold,
            color,
            totalRows: transactions.length,
            highlightedRows,
            columns,
            parsingMethod: "regex",
            aiCost: { usd: 0, krw: 0 },
          });

          // 응답
          const outputBuffer = await workbook.xlsx.writeBuffer();
          const originalName = file.name.replace(/\.[^/.]+$/, "");
          const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);

          return new NextResponse(outputBuffer, {
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
            },
          });
        }

        console.log("정규식 파싱 실패, AI 파싱으로 폴백...");
      } else {
        // 2. 스캔본 PDF: OCR 필요
        console.log("스캔본 PDF 감지, OCR 시작...");

        // PDF → 이미지 변환
        const pageImages: { pageNum: number; base64: string }[] = [];
        for (let pageNum = 0; pageNum < pageCount; pageNum++) {
          try {
            const page = doc.loadPage(pageNum);
            const scale = 2.0; // 150 DPI
            const pixmap = page.toPixmap(
              mupdf.Matrix.scale(scale, scale),
              mupdf.ColorSpace.DeviceRGB,
              false,
              true
            );
            const pngData = pixmap.asPNG();
            pageImages.push({ pageNum, base64: Buffer.from(pngData).toString("base64") });
          } catch (pageError) {
            console.error(`Error converting page ${pageNum + 1}:`, pageError);
          }
        }

        // Vision OCR 병렬 호출 (10개씩 배치)
        const allTexts: string[] = new Array(pageCount).fill("");
        const batchSize = 10;

        for (let batchStart = 0; batchStart < pageImages.length; batchStart += batchSize) {
          const batch = pageImages.slice(batchStart, batchStart + batchSize);
          await Promise.all(
            batch.map(async ({ pageNum, base64 }) => {
              try {
                const [result] = await visionClient.textDetection({
                  image: { content: base64 },
                  imageContext: { languageHints: ["ko", "en"] },
                });
                const pageText = result.fullTextAnnotation?.text || "";
                if (pageText) {
                  allTexts[pageNum] = pageText;
                  console.log(`Page ${pageNum + 1}: ${pageText.length} chars`);
                }
              } catch (err) {
                console.error(`OCR error page ${pageNum + 1}:`, err);
              }
            })
          );
        }

        fullText = allTexts.filter(t => t).join("\n\n");
      }
    } else {
      // 이미지 파일 OCR
      const base64Content = Buffer.from(arrayBuffer).toString("base64");
      const [result] = await visionClient.textDetection({
        image: { content: base64Content },
        imageContext: { languageHints: ["ko", "en"] },
      });
      fullText = result.fullTextAnnotation?.text || "";
    }

    if (!fullText) {
      return NextResponse.json(
        { error: "텍스트를 추출할 수 없습니다. 파일을 확인해주세요." },
        { status: 400 }
      );
    }

    console.log(`텍스트 추출 완료: ${fullText.length} chars (isTextPdf: ${isTextPdf})`);

    // AI 파싱 (스캔본 PDF 또는 정규식 파싱 실패 시)
    const parseResult = await parseWithAI(fullText);

    if (!parseResult || parseResult.transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 파싱할 수 없습니다." },
        { status: 400 }
      );
    }

    const { transactions, tokenUsage, cost } = parseResult;

    // 컬럼 추출
    const columns: string[] = [];
    const seenColumns = new Set<string>();
    if (transactions.length > 0) {
      for (const key of Object.keys(transactions[0])) {
        if (!seenColumns.has(key)) {
          columns.push(key);
          seenColumns.add(key);
        }
      }
    }

    // 캐시 저장
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
    }

    // Excel 생성
    const { workbook, highlightedRows } = createExcelFromTransactions(
      transactions, columns, threshold, color
    );

    // 로그 기록
    await logAction(userEmail, "highlight_pdf_transactions", {
      fileName: file.name,
      fileSize: file.size,
      threshold,
      color,
      totalRows: transactions.length,
      highlightedRows,
      columns,
      aiCost: cost,
    });

    // 응답
    const outputBuffer = await workbook.xlsx.writeBuffer();
    const originalName = file.name.replace(/\.[^/.]+$/, "");
    const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);

    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
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
