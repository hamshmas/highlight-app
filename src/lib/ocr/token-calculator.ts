// 토큰 사용량 추적 및 비용 계산

import { GEMINI_PRICING } from '@/lib/constants';
import type { TokenUsage } from '@/types/transaction';

/**
 * 요청별 토큰 사용량 추적 클래스
 */
export class TokenTracker {
    private usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    reset(): void {
        this.usage = { inputTokens: 0, outputTokens: 0 };
    }

    add(input: number, output: number): void {
        this.usage.inputTokens += input;
        this.usage.outputTokens += output;
    }

    getUsage(): TokenUsage {
        return { ...this.usage };
    }

    calculateCost(): { usd: number; krw: number } {
        const inputCost = (this.usage.inputTokens / 1_000_000) * GEMINI_PRICING.inputPricePerMillion;
        const outputCost = (this.usage.outputTokens / 1_000_000) * GEMINI_PRICING.outputPricePerMillion;
        const totalUsd = inputCost + outputCost;
        const totalKrw = totalUsd * GEMINI_PRICING.exchangeRate;
        return { usd: totalUsd, krw: totalKrw };
    }
}

/**
 * 전역 토큰 트래커 (요청당 하나씩 사용)
 */
let globalTracker: TokenTracker | null = null;

export function getTokenTracker(): TokenTracker {
    if (!globalTracker) {
        globalTracker = new TokenTracker();
    }
    return globalTracker;
}

export function resetTokenTracker(): TokenTracker {
    globalTracker = new TokenTracker();
    return globalTracker;
}

// 편의 함수들
export function addTokenUsage(input: number, output: number): void {
    getTokenTracker().add(input, output);
}

export function getTotalUsage(): TokenUsage {
    return getTokenTracker().getUsage();
}

export function calculateTotalCost(): { usd: number; krw: number } {
    return getTokenTracker().calculateCost();
}
