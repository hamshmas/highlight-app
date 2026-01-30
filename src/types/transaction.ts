// 공유 타입 정의
// 모든 거래내역 관련 타입을 한 곳에서 관리

export interface TransactionRow {
  date: string;
  time?: string;
  transactionType?: string;
  description: string;
  counterparty?: string;
  deposit: number;
  withdrawal: number;
  balance: number;
  memo?: string;
  branch?: string;
  accountNo?: string;
  category?: string;
  [key: string]: string | number | undefined;
}

export interface AiCost {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  krw: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface OcrResult {
  transactions: TransactionRow[];
  rawText: string;
  columns: string[];
  documentType: DocumentType;
  aiCost?: AiCost;
  cached?: boolean;
}

export type DocumentType = 'text-based' | 'image-based' | 'image' | 'excel';

export interface AccountInfo {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  queryPeriod: string;
}

export interface FileTypeInfo {
  documentType: DocumentType | null;
  pageCount?: number;
  sheetCount?: number;
  rowCount?: number;
  message: string;
  estimatedTime: string | null;
  warning: string | null;
  isChecking: boolean;
}

export type OcrStep = 'idle' | 'extracting' | 'verifying' | 'generating';

export interface ResultMessage {
  message: string;
  type: 'success' | 'error';
}
