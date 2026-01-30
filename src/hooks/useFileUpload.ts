'use client';

import { useState, useCallback } from 'react';
import type { FileTypeInfo } from '@/types/transaction';
import { SUPPORTED_FILE_REGEX } from '@/lib/constants';

/**
 * 파일 업로드 관련 상태 및 로직 관리 훅
 */
export function useFileUpload() {
    const [files, setFiles] = useState<File[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [fileTypeInfo, setFileTypeInfo] = useState<FileTypeInfo | null>(null);

    /**
     * 파일 타입 확인 (서버 API 호출)
     */
    const checkFileType = useCallback(async (file: File) => {
        setFileTypeInfo({
            documentType: null,
            message: '파일 분석 중...',
            estimatedTime: null,
            warning: null,
            isChecking: true
        });

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/check-pdf-type', {
                method: 'POST',
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                setFileTypeInfo({
                    documentType: data.documentType,
                    pageCount: data.pageCount,
                    sheetCount: data.sheetCount,
                    rowCount: data.rowCount,
                    message: data.message,
                    estimatedTime: data.estimatedTime,
                    warning: data.warning,
                    isChecking: false,
                });
            } else {
                setFileTypeInfo(null);
            }
        } catch {
            setFileTypeInfo(null);
        }
    }, []);

    /**
     * 드래그 앤 드롭 핸들러
     */
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
            SUPPORTED_FILE_REGEX.test(f.name)
        );
        if (droppedFiles.length > 0) {
            setFiles([droppedFiles[0]]);
            checkFileType(droppedFiles[0]);
        }
    }, [checkFileType]);

    /**
     * 파일 선택 핸들러
     */
    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            setFiles([file]);
            checkFileType(file);
        }
    }, [checkFileType]);

    /**
     * 파일 초기화
     */
    const clearFiles = useCallback(() => {
        setFiles([]);
        setFileTypeInfo(null);
    }, []);

    /**
     * 드래그 오버 핸들러
     */
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    /**
     * 드래그 떠남 핸들러
     */
    const handleDragLeave = useCallback(() => {
        setDragOver(false);
    }, []);

    return {
        // 상태
        files,
        file: files[0] || null,
        dragOver,
        fileTypeInfo,
        hasFile: files.length > 0,

        // 액션
        handleDrop,
        handleFileChange,
        handleDragOver,
        handleDragLeave,
        clearFiles,
        checkFileType,
    };
}
