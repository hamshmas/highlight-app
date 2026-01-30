// OCR 유틸리티 배럴 익스포트

export { getVisionClient, getGeminiClient, resetClients } from './clients';
export {
    TokenTracker,
    getTokenTracker,
    resetTokenTracker,
    addTokenUsage,
    getTotalUsage,
    calculateTotalCost
} from './token-calculator';
export {
    mergeOcrLines,
    splitTextIntoChunks,
    tryFixIncompleteJson,
    extractJsonFromResponse,
    normalizeAmountValues
} from './text-processor';
export {
    parseTableImageWithGemini,
    parseChunkWithAI,
    parseWithAI,
    type ParseResult
} from './ai-parser';
