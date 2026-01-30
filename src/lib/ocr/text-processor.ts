// OCR 텍스트 전처리 유틸리티

/**
 * OCR 텍스트 전처리: 날짜로 시작하지 않는 줄을 이전 줄에 병합
 */
export function mergeOcrLines(text: string): string {
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

/**
 * 텍스트를 청크로 분할 (날짜 경계 기준)
 */
export function splitTextIntoChunks(text: string, chunkSize: number = 3500): string[] {
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

/**
 * 불완전한 JSON 복구 시도
 */
export function tryFixIncompleteJson(jsonStr: string): string | null {
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

/**
 * JSON 응답에서 코드블록 제거
 */
export function extractJsonFromResponse(response: string): string {
    let jsonStr = response.trim();

    // 코드블록 제거
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

    return jsonStr;
}

/**
 * 금액 문자열을 숫자로 변환
 */
export function normalizeAmountValues<T extends Record<string, unknown>>(obj: T): T {
    const result = { ...obj };
    for (const key of Object.keys(result)) {
        const val = result[key];
        if (typeof val === "string") {
            const cleaned = val.replace(/[,원₩\s]/g, "");
            if (/^\d+$/.test(cleaned) && cleaned.length > 0) {
                (result as Record<string, unknown>)[key] = parseFloat(cleaned);
            }
        }
    }
    return result;
}
