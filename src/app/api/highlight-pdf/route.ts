import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import ExcelJS from "exceljs";
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
  [key: string]: string | number;
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

// Gemini 2.5 Flash Lite 가격 (2025년 1월 기준)
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

// PDF에서 텍스트 추출 (mupdf 사용)
function extractTextFromPdf(buffer: ArrayBuffer): string {
  const pdfBuffer = Buffer.from(buffer);
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageCount = doc.countPages();

  const allTexts: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText();
    if (text) {
      allTexts.push(text);
    }
  }

  return allTexts.join("\n\n");
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

    const validTransactions = transactions
      .filter(tx => {
        const dateVal = findDateColumn(tx);
        const depositVal = findAmountValue(tx, depositKeywords);
        const withdrawalVal = findAmountValue(tx, withdrawalKeywords);
        const generalAmount = findAmountValue(tx, generalAmountKeywords);
        return dateVal && (depositVal > 0 || withdrawalVal > 0 || generalAmount > 0);
      })
      .map(tx => {
        // 금액 컬럼 정규화
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
    console.error("Sample parsing error:", error);
    return null;
  }
}

// 텍스트를 청크로 분할
function splitTextIntoChunks(text: string, chunkSize: number = 4000): string[] {
  const chunks: string[] = [];

  if (text.length <= chunkSize) {
    return [text];
  }

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

// 단일 청크 AI 파싱
async function parseChunkWithAI(
  chunkText: string,
  chunkIndex: number,
  sampleExample: string
): Promise<TransactionRow[]> {
  const gemini = getGeminiClient();
  if (!gemini) return [];

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `당신은 한국 은행 거래내역을 정확하게 파싱하는 전문가입니다.

## 작업
아래 텍스트에서 모든 거래내역을 추출하여 JSON 배열로 반환하세요.

## 참고: 이 문서의 형식 예시
${sampleExample}

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
      console.log(`Chunk ${chunkIndex + 1}: No JSON array found`);
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
    console.error(`Chunk ${chunkIndex + 1} parsing error:`, error);
    return [];
  }
}

// AI 병렬 파싱
async function parseWithAIParallel(
  text: string,
  sampleTransactions: TransactionRow[]
): Promise<TransactionRow[] | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  try {
    // 샘플 예시 생성
    const sampleExample = sampleTransactions.length > 0
      ? JSON.stringify(sampleTransactions.slice(0, 3), null, 2)
      : "샘플 없음";

    // 텍스트를 청크로 분할 (4000자로 줄여 병렬성 증가)
    const chunks = splitTextIntoChunks(text, 4000);
    console.log(`Splitting text into ${chunks.length} chunks for parallel AI processing`);

    // 병렬 처리
    const chunkPromises = chunks.map((chunk, index) =>
      parseChunkWithAI(chunk, index, sampleExample)
    );

    const startTime = Date.now();
    const results = await Promise.all(chunkPromises);
    const elapsed = Date.now() - startTime;
    console.log(`Parallel AI processing completed in ${elapsed}ms`);

    // 결과 병합
    const allTransactions = results.flat();

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

// AI 기반 파싱 결과 인터페이스
interface ParseResult {
  transactions: TransactionRow[];
  tokenUsage: TokenUsage;
  cost: { usd: number; krw: number };
}

// AI 기반 파싱 (샘플 파싱 → 병렬 전체 파싱)
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

    // 1단계: 샘플 AI 파싱
    const sampleText = text.substring(0, 3000);
    console.log(`AI parsing: analyzing sample (${sampleText.length} chars)`);

    const sampleTransactions = await parseSampleTransactions(sampleText);

    if (!sampleTransactions || sampleTransactions.length === 0) {
      console.log("Sample parsing failed, trying full text parsing...");
      const result = await parseWithAIParallel(text, []);
      const cost = calculateCost(totalTokenUsage);
      return result ? { transactions: result, tokenUsage: { ...totalTokenUsage }, cost } : null;
    }

    console.log(`Sample parsing successful: ${sampleTransactions.length} transactions`);

    // 2단계: 병렬 전체 파싱
    console.log("Parsing full text with AI (parallel)...");
    const allTransactions = await parseWithAIParallel(text, sampleTransactions);

    if (!allTransactions || allTransactions.length === 0) {
      console.log("Full text parsing failed, returning sample");
      const cost = calculateCost(totalTokenUsage);
      return { transactions: sampleTransactions, tokenUsage: { ...totalTokenUsage }, cost };
    }

    const elapsed = Date.now() - startTime;
    const cost = calculateCost(totalTokenUsage);

    console.log(`AI parsing complete: ${allTransactions.length} transactions in ${elapsed}ms`);
    console.log(`Token usage: input ${totalTokenUsage.inputTokens}, output ${totalTokenUsage.outputTokens}`);
    console.log(`Estimated cost: $${cost.usd.toFixed(6)} (~${cost.krw.toFixed(2)} KRW)`);

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
    const threshold = parseInt(formData.get("threshold") as string) || 0;
    const color = (formData.get("color") as string) || "FFFF00";

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
    }

    // PDF 읽기
    const arrayBuffer = await file.arrayBuffer();

    // 캐시 확인 (활성화된 경우)
    if (isCacheEnabled()) {
      const fileHash = generateFileHash(arrayBuffer);
      console.log(`Checking cache for file: ${file.name} (hash: ${fileHash})`);

      const cached = await getCachedParsing(fileHash);
      if (cached) {
        console.log(`Cache HIT for ${file.name}`);

        // 캐시된 결과로 Excel 생성
        const transactions = cached.parsing_result as TransactionRow[];
        const columns = cached.columns as string[];

        // Excel 파일 생성
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("거래내역");

        // 헤더 설정
        worksheet.columns = columns.map((col) => ({
          header: col,
          key: col,
          width: col.includes("금액") || col.includes("잔액") || col.includes("입금") || col.includes("출금") ? 15 :
                 col.includes("일") || col.includes("date") ? 15 : 25,
        }));

        // 헤더 스타일
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };

        // 금액 컬럼 판별 함수
        const isAmountColumn = (key: string): boolean => {
          const amountKeywords = ["금액", "잔액", "입금", "출금", "deposit", "withdrawal", "balance", "amount"];
          return amountKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
        };

        const isDepositColumn = (key: string): boolean => {
          const depositKeywords = ["입금", "맡기신", "받으신", "deposit"];
          return depositKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
        };

        const isWithdrawalColumn = (key: string): boolean => {
          const withdrawalKeywords = ["출금", "찾으신", "보내신", "withdrawal"];
          return withdrawalKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
        };

        const isGeneralAmountColumn = (key: string): boolean => {
          const generalAmountKeywords = ["거래금액"];
          return generalAmountKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
        };

        // 데이터 추가 및 하이라이트
        let highlightedRows = 0;
        for (const tx of transactions) {
          const rowData: Record<string, unknown> = {};
          for (const col of columns) {
            rowData[col] = tx[col] ?? "";
          }
          const row = worksheet.addRow(rowData);

          let maxAmount = 0;
          for (const col of columns) {
            if (isDepositColumn(col) || isWithdrawalColumn(col) || isGeneralAmountColumn(col)) {
              const val = typeof tx[col] === "number" ? tx[col] : 0;
              if (val > maxAmount) maxAmount = val;
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

          for (const col of columns) {
            if (isAmountColumn(col) && typeof tx[col] === "number" && tx[col] > 0) {
              row.getCell(col).numFmt = "#,##0";
            }
          }
        }

        await logAction(userEmail, "highlight_pdf_cached", {
          fileName: file.name,
          fileSize: file.size,
          threshold: threshold,
          color: color,
          totalRows: transactions.length,
          highlightedRows: highlightedRows,
          cacheHitCount: cached.hit_count + 1,
        });

        const outputBuffer = await workbook.xlsx.writeBuffer();
        const originalName = file.name.replace(/\.[^/.]+$/, "");
        const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);

        return new NextResponse(outputBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
            "X-Cache-Hit": "true",
            "X-AI-Cost-Input-Tokens": "0",
            "X-AI-Cost-Output-Tokens": "0",
            "X-AI-Cost-USD": "0",
            "X-AI-Cost-KRW": "0",
          },
        });
      }
      console.log(`Cache MISS for ${file.name}`);
    }

    const text = extractTextFromPdf(arrayBuffer);

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "PDF에서 텍스트를 추출할 수 없습니다. 스캔/이미지 PDF인 경우 OCR 모드를 사용해주세요." },
        { status: 400 }
      );
    }

    console.log(`PDF text extracted: ${text.length} chars`);

    // AI 파싱 (전용)
    const parseResult = await parseWithAI(text);

    if (!parseResult || parseResult.transactions.length === 0) {
      return NextResponse.json(
        { error: "거래내역을 파싱할 수 없습니다. AI가 텍스트에서 거래 패턴을 인식하지 못했습니다." },
        { status: 400 }
      );
    }

    const { transactions, tokenUsage, cost } = parseResult;
    console.log(`AI parsing successful: ${transactions.length} transactions`);

    // Excel 파일 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("거래내역");

    // 동적 컬럼 추출 (첫 번째 거래의 컬럼 순서 그대로 유지)
    const columns: string[] = [];
    const seenColumns = new Set<string>();

    // 첫 번째 거래에서 모든 컬럼을 순서대로 추출 (값에 상관없이)
    if (transactions.length > 0) {
      for (const key of Object.keys(transactions[0])) {
        if (!seenColumns.has(key)) {
          columns.push(key);
          seenColumns.add(key);
        }
      }
    }

    // 나머지 거래에서 추가 컬럼 확인 (혹시 첫 번째에 없는 컬럼이 있을 경우)
    const sampleSize = Math.min(5, transactions.length);
    for (let i = 1; i < sampleSize; i++) {
      for (const key of Object.keys(transactions[i])) {
        if (!seenColumns.has(key)) {
          columns.push(key);
          seenColumns.add(key);
        }
      }
    }

    // 헤더 설정 (컬럼명 그대로 사용)
    worksheet.columns = columns.map((col) => ({
      header: col,
      key: col,
      width: col.includes("금액") || col.includes("잔액") || col.includes("입금") || col.includes("출금") ? 15 :
             col.includes("일") || col.includes("date") ? 15 : 25,
    }));

    // 헤더 스타일
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // 금액 컬럼 판별 함수
    const isAmountColumn = (key: string): boolean => {
      const amountKeywords = ["금액", "잔액", "입금", "출금", "deposit", "withdrawal", "balance", "amount"];
      return amountKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
    };

    // 입금성 컬럼 판별
    const isDepositColumn = (key: string): boolean => {
      const depositKeywords = ["입금", "맡기신", "받으신", "deposit"];
      return depositKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
    };

    // 출금성 컬럼 판별
    const isWithdrawalColumn = (key: string): boolean => {
      const withdrawalKeywords = ["출금", "찾으신", "보내신", "withdrawal"];
      return withdrawalKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
    };

    // 일반 금액 컬럼 판별 (거래금액 등)
    const isGeneralAmountColumn = (key: string): boolean => {
      const generalAmountKeywords = ["거래금액"];
      return generalAmountKeywords.some((kw) => key.toLowerCase().includes(kw.toLowerCase()));
    };

    // 데이터 추가 및 하이라이트
    let highlightedRows = 0;
    for (const tx of transactions) {
      const rowData: Record<string, unknown> = {};
      for (const col of columns) {
        rowData[col] = tx[col] ?? "";
      }
      const row = worksheet.addRow(rowData);

      // 기준 금액 이상이면 하이라이트 (입금/출금/거래금액 컬럼에서 최대값 찾기)
      let maxAmount = 0;
      for (const col of columns) {
        if (isDepositColumn(col) || isWithdrawalColumn(col) || isGeneralAmountColumn(col)) {
          const val = typeof tx[col] === "number" ? tx[col] : 0;
          if (val > maxAmount) maxAmount = val;
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

      // 금액 컬럼 포맷
      for (const col of columns) {
        if (isAmountColumn(col) && typeof tx[col] === "number" && tx[col] > 0) {
          row.getCell(col).numFmt = "#,##0";
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
    await logAction(userEmail, "highlight_pdf_transactions", {
      fileName: file.name,
      fileSize: file.size,
      threshold: threshold,
      color: color,
      totalRows: transactions.length,
      highlightedRows: highlightedRows,
      aiCost: cost,
      tokenUsage: tokenUsage,
    });

    // 결과 파일 생성
    const outputBuffer = await workbook.xlsx.writeBuffer();

    const originalName = file.name.replace(/\.[^/.]+$/, "");
    const encodedFileName = encodeURIComponent(`highlighted_${originalName}.xlsx`);
    return new NextResponse(outputBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
        "X-AI-Cost-Input-Tokens": String(tokenUsage.inputTokens),
        "X-AI-Cost-Output-Tokens": String(tokenUsage.outputTokens),
        "X-AI-Cost-USD": cost.usd.toFixed(6),
        "X-AI-Cost-KRW": cost.krw.toFixed(2),
      },
    });
  } catch (error) {
    console.error("PDF Highlight error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await logAction(userEmail, "highlight_pdf_error", {
      error: errorMessage,
    });

    // 암호 보호된 PDF 감지
    if (errorMessage.toLowerCase().includes("password") || errorMessage.includes("encrypted")) {
      return NextResponse.json(
        { error: "암호로 보호된 PDF입니다. 암호를 해제한 후 다시 시도해주세요." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: errorMessage || "PDF 처리 중 오류 발생" },
      { status: 500 }
    );
  }
}
