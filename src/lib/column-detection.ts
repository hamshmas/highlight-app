// 컬럼 감지 유틸리티
// 한국 은행 엑셀의 다양한 컬럼명 패턴 지원

import type { TransactionRow } from '@/types/transaction';

// 컬럼명 패턴 정의
export const COLUMN_PATTERNS = {
    deposit: ['입금', '맡기신', '수입', '대변', '들어온', '적립', 'deposit', 'credit'],
    withdrawal: ['출금', '찾으신', '지급', '지출', '차변', '나간', 'withdrawal', 'debit'],
    balance: ['잔액', '잔고', 'balance'],
    amount: ['금액', 'amount'],
    date: ['일시', '일자', '날짜', 'date'],
    time: ['시간', 'time'],
    description: ['적요', '내용', '기재', '메모', '비고', 'description', 'memo'],
} as const;

/**
 * 컬럼명 정규화 (공백 제거, 소문자 변환)
 */
export function normalizeColumnName(name: string): string {
    return name.replace(/\s+/g, '').toLowerCase();
}

/**
 * 입금 컬럼인지 확인
 */
export function isDepositColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.deposit.some(p => normalized.includes(p)) &&
        !COLUMN_PATTERNS.withdrawal.some(p => normalized.includes(p));
}

/**
 * 출금 컬럼인지 확인
 */
export function isWithdrawalColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.withdrawal.some(p => normalized.includes(p));
}

/**
 * 잔액 컬럼인지 확인
 */
export function isBalanceColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.balance.some(p => normalized.includes(p));
}

/**
 * 금액 컬럼인지 확인 (입금/출금/잔액 제외)
 */
export function isAmountColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return (COLUMN_PATTERNS.amount.some(p => normalized.includes(p)) ||
        normalized.includes('금액')) &&
        !isDepositColumn(name) && !isWithdrawalColumn(name) && !isBalanceColumn(name);
}

/**
 * 날짜 컬럼인지 확인
 */
export function isDateColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.date.some(p => normalized.includes(p));
}

/**
 * 시간 컬럼인지 확인
 */
export function isTimeColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.time.some(p => normalized.includes(p)) &&
        !normalized.includes('일시'); // '일시'는 날짜+시간이므로 시간만으로 분류하지 않음
}

/**
 * 설명/적요 컬럼인지 확인
 */
export function isDescriptionColumn(name: string): boolean {
    const normalized = normalizeColumnName(name);
    return COLUMN_PATTERNS.description.some(p => normalized.includes(p));
}

/**
 * 숫자형 컬럼인지 확인
 */
export function isNumericColumn(name: string): boolean {
    return isDepositColumn(name) || isWithdrawalColumn(name) ||
        isBalanceColumn(name) || isAmountColumn(name);
}

/**
 * 컬럼 타입 정보
 */
export interface ColumnType {
    name: string;
    isDeposit: boolean;
    isWithdrawal: boolean;
    isBalance: boolean;
    isAmount: boolean;
    isDate: boolean;
    isTime: boolean;
    isDescription: boolean;
    isNumeric: boolean;
}

/**
 * 컬럼 목록 분석
 */
export function analyzeColumns(columns: string[]): ColumnType[] {
    return columns.map(name => ({
        name,
        isDeposit: isDepositColumn(name),
        isWithdrawal: isWithdrawalColumn(name),
        isBalance: isBalanceColumn(name),
        isAmount: isAmountColumn(name),
        isDate: isDateColumn(name),
        isTime: isTimeColumn(name),
        isDescription: isDescriptionColumn(name),
        isNumeric: isNumericColumn(name),
    }));
}

/**
 * 거래내역에서 입금/출금 금액 추출
 */
export function extractAmounts(
    tx: TransactionRow,
    selectedDepositColumn?: string,
    selectedWithdrawalColumn?: string
): { depositAmount: number; withdrawalAmount: number } {
    let depositAmount = 0;
    let withdrawalAmount = 0;

    // 수동 선택된 컬럼이 있으면 해당 컬럼 사용
    if (selectedDepositColumn || selectedWithdrawalColumn) {
        if (selectedDepositColumn) {
            const value = tx[selectedDepositColumn];
            if (value !== undefined && value !== null && value !== '' && value !== 0) {
                const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[,\s]/g, ''));
                if (!isNaN(numValue) && numValue > 0) {
                    depositAmount = numValue;
                }
            }
        }
        if (selectedWithdrawalColumn) {
            const value = tx[selectedWithdrawalColumn];
            if (value !== undefined && value !== null && value !== '' && value !== 0) {
                const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[,\s]/g, ''));
                if (!isNaN(numValue) && numValue > 0) {
                    withdrawalAmount = numValue;
                }
            }
        }
    } else {
        // 자동 감지 모드
        for (const key of Object.keys(tx)) {
            const value = tx[key];
            if (value === undefined || value === null || value === '' || value === 0) continue;

            const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[,\s]/g, ''));
            if (isNaN(numValue) || numValue <= 0) continue;

            if (isDepositColumn(key)) {
                depositAmount = Math.max(depositAmount, numValue);
            } else if (isWithdrawalColumn(key)) {
                withdrawalAmount = Math.max(withdrawalAmount, numValue);
            }
        }
    }

    return { depositAmount, withdrawalAmount };
}

/**
 * 하이라이트 대상 여부 확인
 * threshold가 0이거나 유효하지 않으면 하이라이트하지 않음
 */
export function shouldHighlight(
    tx: TransactionRow,
    threshold: number | string,
    selectedDepositColumn?: string,
    selectedWithdrawalColumn?: string
): boolean {
    // threshold가 없거나 0이면 하이라이트 안 함
    const numThreshold = typeof threshold === 'string' ? parseInt(threshold, 10) : threshold;
    if (!numThreshold || numThreshold <= 0 || isNaN(numThreshold)) {
        return false;
    }

    const { depositAmount, withdrawalAmount } = extractAmounts(tx, selectedDepositColumn, selectedWithdrawalColumn);
    const maxAmount = Math.max(depositAmount, withdrawalAmount);
    return maxAmount >= numThreshold;
}
