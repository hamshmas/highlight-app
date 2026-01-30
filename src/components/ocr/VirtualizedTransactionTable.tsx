'use client';

import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TransactionRow } from '@/types/transaction';
import { COLUMN_LABELS } from '@/lib/constants';
import { analyzeColumns, shouldHighlight } from '@/lib/column-detection';

interface ColumnTypeInfo {
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

interface VirtualizedTransactionTableProps {
    transactions: TransactionRow[];
    columns: string[];
    threshold: number;
    color: string;
    selectedDepositColumn: string;
    selectedWithdrawalColumn: string;
    onUpdate: (index: number, field: string, value: string | number) => void;
    onDelete: (index: number) => void;
}

const ROW_HEIGHT = 40;

/**
 * 가상화된 거래내역 테이블
 * 수백~수천 건의 거래를 효율적으로 렌더링
 */
export function VirtualizedTransactionTable({
    transactions,
    columns,
    threshold,
    color,
    selectedDepositColumn,
    selectedWithdrawalColumn,
    onUpdate,
    onDelete,
}: VirtualizedTransactionTableProps) {
    const parentRef = useRef<HTMLDivElement>(null);

    const columnTypes = useMemo(() => analyzeColumns(columns), [columns]);

    const rowVirtualizer = useVirtualizer({
        count: transactions.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
        <div className="border rounded overflow-hidden">
            {/* 헤더 (고정) */}
            <div className="sticky top-0 z-10 bg-gray-300 flex border-b">
                <div className="w-12 flex-shrink-0 p-2 text-center font-bold text-black border-r">#</div>
                {columnTypes.map((ct) => (
                    <div
                        key={ct.name}
                        className={`flex-1 min-w-[100px] p-2 font-bold border-r ${ct.isDeposit ? "text-blue-700 text-right" :
                                ct.isWithdrawal ? "text-red-700 text-right" :
                                    ct.isBalance ? "text-green-700 text-right" :
                                        ct.isAmount ? "text-purple-700 text-right" :
                                            "text-left text-black"
                            }`}
                    >
                        {COLUMN_LABELS[ct.name] || ct.name}
                    </div>
                ))}
                <div className="w-14 flex-shrink-0 p-2 text-center font-bold text-black">삭제</div>
            </div>

            {/* 가상화된 본문 */}
            <div
                ref={parentRef}
                className="overflow-auto custom-scrollbar"
                style={{ height: 'min(500px, 100vh - 300px)' }}
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        const index = virtualRow.index;
                        const tx = transactions[index];
                        const isHighlighted = shouldHighlight(tx, threshold, selectedDepositColumn, selectedWithdrawalColumn);

                        return (
                            <div
                                key={virtualRow.key}
                                data-index={index}
                                className="flex absolute w-full border-b"
                                style={{
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                    backgroundColor: isHighlighted ? `#${color}` : 'transparent',
                                }}
                            >
                                <div className="w-12 flex-shrink-0 p-1 text-center text-gray-500 border-r flex items-center justify-center">
                                    {index + 1}
                                </div>
                                {columns.map((col) => {
                                    const ct = columnTypes.find(c => c.name === col);
                                    const value = tx[col];
                                    const displayValue = ct?.isNumeric && typeof value === "number" && value !== 0
                                        ? value.toLocaleString()
                                        : (value || "");

                                    return (
                                        <div key={col} className="flex-1 min-w-[100px] p-1 border-r">
                                            <input
                                                type="text"
                                                value={displayValue}
                                                onChange={(e) => {
                                                    const newValue = ct?.isNumeric
                                                        ? e.target.value.replace(/,/g, "")
                                                        : e.target.value;
                                                    onUpdate(index, col, newValue);
                                                }}
                                                className={`w-full h-full px-2 py-1 border rounded text-sm ${ct?.isDeposit ? "text-right text-blue-700" :
                                                        ct?.isWithdrawal ? "text-right text-red-700" :
                                                            ct?.isBalance ? "text-right text-green-700" :
                                                                ct?.isAmount ? "text-right text-purple-700" :
                                                                    ct?.isNumeric ? "text-right text-black" : "text-left text-black"
                                                    }`}
                                            />
                                        </div>
                                    );
                                })}
                                <div className="w-14 flex-shrink-0 p-1 flex items-center justify-center">
                                    <button
                                        onClick={() => onDelete(index)}
                                        className="text-red-600 hover:text-red-800 font-bold"
                                    >
                                        X
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 빈 상태 */}
            {transactions.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                    추출된 거래내역이 없습니다. 행을 추가하여 수동으로 입력해주세요.
                </div>
            )}
        </div>
    );
}
