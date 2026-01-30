'use client';

import { useState, useRef, useCallback } from 'react';
import type { TransactionRow, AiCost, OcrStep, ResultMessage, DocumentType } from '@/types/transaction';
import { VERCEL_BODY_LIMIT, DEFAULT_COLUMNS } from '@/lib/constants';

interface OcrState {
    step: OcrStep;
    isAiParsing: boolean;
    rawText: string;
    currentFile: File | null;
    aiCost: AiCost | null;
    documentType: DocumentType | null;
}

interface OcrExtractResult {
    transactions: TransactionRow[];
    columns: string[];
    rawText: string;
    aiCost?: AiCost;
    documentType?: DocumentType;
}

/**
 * OCR 처리 관련 상태 및 로직 관리 훅
 */
export function useOcrProcess() {
    const [state, setState] = useState<OcrState>({
        step: 'idle',
        isAiParsing: false,
        rawText: '',
        currentFile: null,
        aiCost: null,
        documentType: null,
    });

    const [result, setResult] = useState<ResultMessage | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    /**
     * OCR 추출 실행
     */
    const extract = useCallback(async (
        file: File,
        forceRefresh: boolean,
        onSuccess: (data: OcrExtractResult) => void,
        onTimerStart: () => void,
        onTimerStop: () => void
    ) => {
        setState(prev => ({
            ...prev,
            step: 'extracting',
            currentFile: file,
            isAiParsing: false,
        }));
        setResult({ message: `OCR 처리 중... - ${file.name}`, type: 'success' });
        onTimerStart();

        abortControllerRef.current = new AbortController();

        try {
            // AI 파싱 시작 표시 (텍스트 추출 후)
            const aiParsingTimer = setTimeout(() => {
                setState(prev => ({ ...prev, isAiParsing: true }));
            }, 3000);

            let res: Response;

            // 파일 크기에 따라 업로드 방식 결정
            if (file.size > VERCEL_BODY_LIMIT) {
                // 큰 파일: Storage에 먼저 업로드
                setResult({
                    message: `파일 업로드 중... - ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
                    type: 'success'
                });

                // 1. 업로드 URL 생성
                const uploadUrlRes = await fetch('/api/upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
                    signal: abortControllerRef.current.signal,
                });

                if (!uploadUrlRes.ok) {
                    const data = await uploadUrlRes.json();
                    throw new Error(data.error || '업로드 URL 생성 실패');
                }

                const { uploadUrl, path } = await uploadUrlRes.json();

                // 2. Storage에 직접 업로드
                const uploadRes = await fetch(uploadUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': file.type || 'application/octet-stream' },
                    body: file,
                    signal: abortControllerRef.current.signal,
                });

                if (!uploadRes.ok) {
                    throw new Error('Storage 업로드 실패');
                }

                setResult({ message: `OCR 처리 중... - ${file.name}`, type: 'success' });

                // 3. OCR API 호출 (Storage 경로 전달)
                res = await fetch('/api/ocr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        storagePath: path,
                        fileName: file.name,
                        forceRefresh: forceRefresh,
                    }),
                    signal: abortControllerRef.current.signal,
                });
            } else {
                // 작은 파일: 직접 업로드
                const formData = new FormData();
                formData.append('file', file);
                if (forceRefresh) {
                    formData.append('forceRefresh', 'true');
                }

                res = await fetch('/api/ocr', {
                    method: 'POST',
                    body: formData,
                    signal: abortControllerRef.current.signal,
                });
            }

            clearTimeout(aiParsingTimer);

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'OCR 오류가 발생했습니다');
            }

            const data = await res.json();

            setState(prev => ({
                ...prev,
                step: 'verifying',
                rawText: data.rawText || '',
                aiCost: data.aiCost || null,
                documentType: data.documentType || null,
                isAiParsing: false,
            }));

            onTimerStop();

            const costMessage = data.aiCost
                ? ` (AI 비용: ${data.aiCost.krw.toFixed(2)}원)`
                : '';
            setResult({
                message: `${data.transactions.length}개의 거래내역이 추출되었습니다 (${data.columns?.length || 5}개 컬럼).${costMessage} 아래에서 확인 후 수정해주세요.`,
                type: 'success',
            });

            // 성공 콜백 호출
            onSuccess({
                transactions: data.transactions,
                columns: data.columns?.length > 0 ? data.columns : DEFAULT_COLUMNS,
                rawText: data.rawText || '',
                aiCost: data.aiCost,
                documentType: data.documentType,
            });

        } catch (err) {
            setState(prev => ({ ...prev, step: 'idle', isAiParsing: false }));
            onTimerStop();

            if (err instanceof Error && err.name === 'AbortError') {
                setResult({ message: '처리가 중단되었습니다.', type: 'error' });
                return;
            }

            setResult({
                message: err instanceof Error ? err.message : 'OCR 처리 중 오류 발생',
                type: 'error',
            });
        } finally {
            abortControllerRef.current = null;
        }
    }, []);

    /**
     * OCR 처리 중단
     */
    const abort = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, []);

    /**
     * OCR 취소 및 초기화
     */
    const cancel = useCallback(() => {
        setState({
            step: 'idle',
            isAiParsing: false,
            rawText: '',
            currentFile: null,
            aiCost: null,
            documentType: null,
        });
        setResult(null);
    }, []);

    /**
     * 생성 단계로 전환
     */
    const startGenerating = useCallback(() => {
        setState(prev => ({ ...prev, step: 'generating' }));
        setResult({ message: 'Excel 파일 생성 중...', type: 'success' });
    }, []);

    /**
     * 검증 단계로 복귀
     */
    const backToVerifying = useCallback(() => {
        setState(prev => ({ ...prev, step: 'verifying' }));
    }, []);

    /**
     * 완료 후 초기화
     */
    const complete = useCallback(() => {
        setState({
            step: 'idle',
            isAiParsing: false,
            rawText: '',
            currentFile: null,
            aiCost: null,
            documentType: null,
        });
        setResult({ message: '완료! 파일이 다운로드됩니다.', type: 'success' });
    }, []);

    return {
        // 상태
        step: state.step,
        isAiParsing: state.isAiParsing,
        rawText: state.rawText,
        currentFile: state.currentFile,
        aiCost: state.aiCost,
        documentType: state.documentType,
        result,
        isIdle: state.step === 'idle',
        isExtracting: state.step === 'extracting',
        isVerifying: state.step === 'verifying',
        isGenerating: state.step === 'generating',

        // 액션
        extract,
        abort,
        cancel,
        startGenerating,
        backToVerifying,
        complete,
        setResult,
    };
}
