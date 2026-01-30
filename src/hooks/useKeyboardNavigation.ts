'use client';

import { useRef, useCallback, KeyboardEvent } from 'react';

interface UseKeyboardNavigationOptions {
    /** 활성화 여부 */
    enabled?: boolean;
    /** 방향 (수직/수평) */
    direction?: 'vertical' | 'horizontal' | 'both';
    /** 순환 여부 */
    loop?: boolean;
    /** 포커스 이동 시 콜백 */
    onNavigate?: (index: number) => void;
}

/**
 * 키보드 네비게이션 훅
 * 리스트/테이블에서 방향키로 포커스 이동
 */
export function useKeyboardNavigation<T extends HTMLElement>(
    itemCount: number,
    options: UseKeyboardNavigationOptions = {}
) {
    const {
        enabled = true,
        direction = 'vertical',
        loop = true,
        onNavigate,
    } = options;

    const containerRef = useRef<T>(null);
    const currentIndexRef = useRef(0);

    const focusItem = useCallback((index: number) => {
        if (!containerRef.current) return;

        const items = containerRef.current.querySelectorAll<HTMLElement>('[data-focusable="true"]');
        if (items[index]) {
            items[index].focus();
            currentIndexRef.current = index;
            onNavigate?.(index);
        }
    }, [onNavigate]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!enabled || !containerRef.current) return;

        const isVertical = direction === 'vertical' || direction === 'both';
        const isHorizontal = direction === 'horizontal' || direction === 'both';

        let nextIndex = currentIndexRef.current;
        let handled = false;

        switch (e.key) {
            case 'ArrowUp':
                if (isVertical) {
                    nextIndex = currentIndexRef.current - 1;
                    if (nextIndex < 0) nextIndex = loop ? itemCount - 1 : 0;
                    handled = true;
                }
                break;
            case 'ArrowDown':
                if (isVertical) {
                    nextIndex = currentIndexRef.current + 1;
                    if (nextIndex >= itemCount) nextIndex = loop ? 0 : itemCount - 1;
                    handled = true;
                }
                break;
            case 'ArrowLeft':
                if (isHorizontal) {
                    nextIndex = currentIndexRef.current - 1;
                    if (nextIndex < 0) nextIndex = loop ? itemCount - 1 : 0;
                    handled = true;
                }
                break;
            case 'ArrowRight':
                if (isHorizontal) {
                    nextIndex = currentIndexRef.current + 1;
                    if (nextIndex >= itemCount) nextIndex = loop ? 0 : itemCount - 1;
                    handled = true;
                }
                break;
            case 'Home':
                nextIndex = 0;
                handled = true;
                break;
            case 'End':
                nextIndex = itemCount - 1;
                handled = true;
                break;
        }

        if (handled) {
            e.preventDefault();
            focusItem(nextIndex);
        }
    }, [enabled, direction, loop, itemCount, focusItem]);

    return {
        containerRef,
        handleKeyDown,
        focusItem,
        currentIndex: currentIndexRef.current,
    };
}

/**
 * 포커스 트랩 훅
 * 모달 등에서 포커스가 외부로 나가지 않도록 함
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean = true) {
    const containerRef = useRef<T>(null);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (!active || e.key !== 'Tab' || !containerRef.current) return;

        const focusables = containerRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
        }
    }, [active]);

    return {
        containerRef,
        handleKeyDown,
    };
}
