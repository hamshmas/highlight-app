import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * 처리 시간 타이머 훅
 */
export function useTimer() {
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const start = useCallback(() => {
        setElapsedTime(0);
        timerRef.current = setInterval(() => {
            setElapsedTime((prev) => prev + 1);
        }, 1000);
    }, []);

    const stop = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const reset = useCallback(() => {
        stop();
        setElapsedTime(0);
    }, [stop]);

    // 클린업
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    return {
        elapsedTime,
        start,
        stop,
        reset,
        isRunning: timerRef.current !== null,
    };
}
