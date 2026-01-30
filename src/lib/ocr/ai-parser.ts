// AI 파싱 로직 - Gemini를 사용한 거래내역 파싱

import type { TransactionRow } from '@/types/transaction';
import { getGeminiClient } from './clients';
import { addTokenUsage, resetTokenTracker, getTotalUsage, calculateTotalCost } from './token-calculator';
import { mergeOcrLines, splitTextIntoChunks, tryFixIncompleteJson, extractJsonFromResponse, normalizeAmountValues } from './text-processor';

/**
 * 파싱 결과
 */
export interface ParseResult {
    transactions: TransactionRow[];
    tokenUsage: { inputTokens: number; outputTokens: number };
    cost: { usd: number; krw: number };
}

/**
 * Gemini Vision으로 테이블 이미지를 직접 파싱
 */
export async function parseTableImageWithGemini(
    base64Image: string,
    pageNum: number,
    mimeType: string = "image/png",
    expectedColumns?: string[]
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

        const jsonStr = extractJsonFromResponse(response);

        // JSON 배열 추출
        const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.log(`Page ${pageNum + 1}: No JSON array found in Gemini Vision response`);
            return [];
        }

        const transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
        console.log(`Page ${pageNum + 1}: Gemini Vision extracted ${transactions.length} transactions`);

        // 금액 문자열을 숫자로 변환
        return transactions.map(tx => normalizeAmountValues(tx));
    } catch (error) {
        console.error(`Page ${pageNum + 1} Gemini Vision error:`, error);
        return [];
    }
}

/**
 * 단일 청크 AI 파싱 (재시도 로직 포함)
 */
export async function parseChunkWithAI(
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
                maxOutputTokens: 16384,
            },
        });

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

        let jsonStr = extractJsonFromResponse(response);

        // JSON 배열 추출
        let jsonMatch = jsonStr.match(/\[[\s\S]*\]/);

        // JSON 배열을 찾지 못한 경우
        if (!jsonMatch) {
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
            if (retryCount < maxRetries) {
                console.log(`Chunk ${chunkIndex + 1}: Retrying... (${retryCount + 1}/${maxRetries})`);
                return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
            }
            return [];
        }

        let transactions: TransactionRow[];
        try {
            transactions = JSON.parse(jsonMatch[0]) as TransactionRow[];
        } catch {
            const fixed = tryFixIncompleteJson(jsonMatch[0]);
            if (fixed) {
                try {
                    transactions = JSON.parse(fixed) as TransactionRow[];
                    console.log(`Chunk ${chunkIndex + 1}: Recovered ${transactions.length} transactions from incomplete JSON`);
                } catch {
                    console.log(`Chunk ${chunkIndex + 1}: JSON recovery failed`);
                    if (retryCount < maxRetries) {
                        return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
                    }
                    return [];
                }
            } else {
                if (retryCount < maxRetries) {
                    return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
                }
                return [];
            }
        }

        console.log(`Chunk ${chunkIndex + 1}: parsed ${transactions.length} transactions`);

        return transactions.map(tx => normalizeAmountValues(tx));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Chunk ${chunkIndex + 1} error:`, errorMessage);
        if (retryCount < maxRetries) {
            return parseChunkWithAI(chunkText, chunkIndex, detectedColumns, sampleExample, retryCount + 1);
        }
        return [];
    }
}

/**
 * 병렬 AI 파싱
 */
async function parseFullTextWithAIParallel(text: string): Promise<TransactionRow[] | null> {
    const gemini = getGeminiClient();
    if (!gemini) return null;

    try {
        const chunks = splitTextIntoChunks(text, 4000);
        console.log(`Splitting text into ${chunks.length} chunks for parallel AI processing`);

        // 1단계: 첫 번째 청크를 먼저 파싱하여 컬럼명 확인
        const firstChunkResult = await parseChunkWithAI(chunks[0], 0, [], "[]");

        let columnsFromFirst: string[] = [];
        let sampleExample = "[]";

        if (firstChunkResult.length > 0) {
            columnsFromFirst = Object.keys(firstChunkResult[0]);
            sampleExample = JSON.stringify(firstChunkResult.slice(0, 3), null, 2);
            console.log(`First chunk columns: ${columnsFromFirst.join(", ")}`);
        }

        // 2단계: 나머지 청크들을 병렬 처리
        const startTime = Date.now();
        const remainingChunks = chunks.slice(1);

        const chunkPromises = remainingChunks.map((chunk, index) =>
            parseChunkWithAI(chunk, index + 1, columnsFromFirst, sampleExample)
        );

        const results = await Promise.all(chunkPromises);
        const elapsed = Date.now() - startTime;
        console.log(`Parallel AI processing completed in ${elapsed}ms`);

        // 모든 결과 합치기
        const allTransactions: TransactionRow[] = [...firstChunkResult];
        for (const chunkTransactions of results) {
            allTransactions.push(...chunkTransactions);
        }

        // 중복 제거
        const seen = new Set<string>();
        const uniqueTransactions = allTransactions.filter(tx => {
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

/**
 * AI 기반 파싱 메인 함수
 */
export async function parseWithAI(text: string): Promise<ParseResult | null> {
    const gemini = getGeminiClient();
    if (!gemini) {
        console.log("Gemini API not configured");
        return null;
    }

    // 토큰 사용량 초기화
    resetTokenTracker();

    try {
        const startTime = Date.now();

        // OCR 텍스트 전처리
        const mergedText = mergeOcrLines(text);
        console.log(`OCR 줄 병합: ${text.split('\n').length}줄 → ${mergedText.split('\n').length}줄`);

        // AI 병렬 파싱
        console.log(`AI 병렬 파싱 시작 (${mergedText.length}자)`);
        const allTransactions = await parseFullTextWithAIParallel(mergedText);
        const elapsed = Date.now() - startTime;
        console.log(`AI 병렬 파싱 완료: ${elapsed}ms`);

        if (!allTransactions || allTransactions.length === 0) {
            console.log("파싱 실패");
            return null;
        }

        const tokenUsage = getTotalUsage();
        const cost = calculateTotalCost();

        console.log(`=== 파싱 완료 ===`);
        console.log(`총 시간: ${elapsed}ms`);
        console.log(`총 거래: ${allTransactions.length}개`);
        console.log(`토큰 사용량: 입력 ${tokenUsage.inputTokens}, 출력 ${tokenUsage.outputTokens}`);
        console.log(`예상 비용: $${cost.usd.toFixed(6)} (약 ${cost.krw.toFixed(2)}원)`);

        return { transactions: allTransactions, tokenUsage, cost };
    } catch (error) {
        console.error("AI parsing error:", error);
        return null;
    }
}
