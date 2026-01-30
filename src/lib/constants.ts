// 하이라이트 색상 옵션
export const HIGHLIGHT_COLORS = [
    { value: 'FFFF00', name: '노란색', bg: '#FFFF00' },
    { value: 'FF9999', name: '빨간색', bg: '#FF9999' },
    { value: '99FF99', name: '초록색', bg: '#99FF99' },
    { value: '99CCFF', name: '파란색', bg: '#99CCFF' },
    { value: 'FFCC99', name: '주황색', bg: '#FFCC99' },
    { value: 'CC99FF', name: '보라색', bg: '#CC99FF' },
    { value: '99FFFF', name: '청록색', bg: '#99FFFF' },
] as const;

export type HighlightColor = typeof HIGHLIGHT_COLORS[number];

// 컬럼 한글명 매핑
export const COLUMN_LABELS: Record<string, string> = {
    date: '날짜',
    time: '시간',
    transactionType: '거래구분',
    description: '적요/내용',
    counterparty: '거래상대',
    deposit: '입금(+)',
    withdrawal: '출금(-)',
    balance: '잔액',
    memo: '메모',
    branch: '거래점',
    accountNo: '계좌번호',
    category: '분류',
};

// 페이지네이션
export const ITEMS_PER_PAGE = 50;

// Vercel 요청 본문 크기 제한 (4.5MB)
export const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

// Gemini 가격 (2025년 1월 기준, USD per 1M tokens)
export const GEMINI_PRICING = {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.30,
    exchangeRate: 1450, // USD/KRW
} as const;

// 기본 컬럼 목록
export const DEFAULT_COLUMNS = ['date', 'description', 'deposit', 'withdrawal', 'balance'];

// 지원 파일 확장자
export const SUPPORTED_FILE_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.xlsx,.xls';
export const SUPPORTED_FILE_REGEX = /\.(pdf|png|jpg|jpeg|xlsx|xls)$/i;
