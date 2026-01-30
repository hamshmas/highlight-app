'use client';

import { useState, useCallback } from 'react';
import type { TransactionRow } from '@/types/transaction';
import { DEFAULT_COLUMNS, ITEMS_PER_PAGE } from '@/lib/constants';

/**
 * 거래내역 편집 관련 상태 및 로직 관리 훅
 */
export function useTransactionEditor(initialColumns: string[] = DEFAULT_COLUMNS) {
    const [transactions, setTransactions] = useState<TransactionRow[]>([]);
    const [columns, setColumns] = useState<string[]>(initialColumns);
    const [currentPage, setCurrentPage] = useState(1);

    /**
     * 거래내역 업데이트
     */
    const updateTransaction = useCallback((
        index: number,
        field: keyof TransactionRow | string,
        value: string | number
    ) => {
        setTransactions((prev) =>
            prev.map((tx, i) =>
                i === index
                    ? {
                        ...tx,
                        [field]: field === 'date' || field === 'description' || field === 'time' || field === 'memo' || field === 'branch' || field === 'counterparty'
                            ? value
                            : Number(value) || 0,
                    }
                    : tx
            )
        );
    }, []);

    /**
     * 거래내역 삭제
     */
    const deleteTransaction = useCallback((index: number) => {
        setTransactions((prev) => prev.filter((_, i) => i !== index));
    }, []);

    /**
     * 빈 거래내역 추가
     */
    const addTransaction = useCallback(() => {
        const newRow: TransactionRow = {
            date: '',
            description: '',
            deposit: 0,
            withdrawal: 0,
            balance: 0,
        };
        // 동적 컬럼 초기화
        for (const col of columns) {
            if (!(col in newRow)) {
                newRow[col] = ['deposit', 'withdrawal', 'balance'].includes(col) ? 0 : '';
            }
        }
        setTransactions((prev) => [...prev, newRow]);
    }, [columns]);

    /**
     * 거래내역 일괄 설정
     */
    const setAllTransactions = useCallback((newTransactions: TransactionRow[]) => {
        setTransactions(newTransactions);
        setCurrentPage(1); // 페이지 리셋
    }, []);

    /**
     * 페이지 이동
     */
    const goToPage = useCallback((page: number) => {
        setCurrentPage(page);
    }, []);

    const goToPrevPage = useCallback(() => {
        setCurrentPage((p) => Math.max(1, p - 1));
    }, []);

    const goToNextPage = useCallback(() => {
        setCurrentPage((p) => {
            const total = Math.ceil(transactions.length / ITEMS_PER_PAGE);
            return Math.min(total, p + 1);
        });
    }, [transactions.length]);

    /**
     * 초기화
     */
    const reset = useCallback(() => {
        setTransactions([]);
        setCurrentPage(1);
    }, []);

    // 계산된 값
    const totalPages = Math.ceil(transactions.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = currentPage * ITEMS_PER_PAGE;
    const currentTransactions = transactions.slice(startIndex, endIndex);

    return {
        // 상태
        transactions,
        columns,
        currentPage,
        totalPages,
        currentTransactions,
        itemsPerPage: ITEMS_PER_PAGE,
        totalCount: transactions.length,
        isEmpty: transactions.length === 0,

        // 액션
        updateTransaction,
        deleteTransaction,
        addTransaction,
        setAllTransactions,
        setColumns,
        goToPage,
        goToPrevPage,
        goToNextPage,
        reset,
    };
}
