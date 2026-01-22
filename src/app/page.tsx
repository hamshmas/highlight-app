"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useCallback, useRef, useEffect } from "react";

const COLORS = [
  { value: "FFFF00", name: "노란색", bg: "#FFFF00" },
  { value: "FF9999", name: "빨간색", bg: "#FF9999" },
  { value: "99FF99", name: "초록색", bg: "#99FF99" },
  { value: "99CCFF", name: "파란색", bg: "#99CCFF" },
  { value: "FFCC99", name: "주황색", bg: "#FFCC99" },
  { value: "CC99FF", name: "보라색", bg: "#CC99FF" },
  { value: "99FFFF", name: "청록색", bg: "#99FFFF" },
];

interface TransactionRow {
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
  [key: string]: string | number;
}

// 컬럼 한글명 매핑
const COLUMN_LABELS: Record<string, string> = {
  date: "날짜",
  time: "시간",
  transactionType: "거래구분",
  description: "적요/내용",
  counterparty: "거래상대",
  deposit: "입금(+)",
  withdrawal: "출금(-)",
  balance: "잔액",
  memo: "메모",
  branch: "거래점",
  accountNo: "계좌번호",
  category: "분류",
};

export default function Home() {
  const { data: session, status } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [threshold, setThreshold] = useState("");
  const [color, setColor] = useState("FFFF00");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // OCR 관련 상태
  const [ocrStep, setOcrStep] = useState<"idle" | "extracting" | "verifying" | "generating">("idle");
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [ocrTransactions, setOcrTransactions] = useState<TransactionRow[]>([]);
  const [ocrColumns, setOcrColumns] = useState<string[]>(["date", "description", "deposit", "withdrawal", "balance"]);
  const [ocrRawText, setOcrRawText] = useState("");
  const [currentOcrFile, setCurrentOcrFile] = useState<File | null>(null);

  // AI 비용 상태
  const [aiCost, setAiCost] = useState<{ inputTokens: number; outputTokens: number; usd: number; krw: number } | null>(null);

  // 문서 타입 (text-based, image-based, image)
  const [documentType, setDocumentType] = useState<"text-based" | "image-based" | "image" | null>(null);

  // 캐시 무시 옵션
  const [forceRefresh, setForceRefresh] = useState(false);

  // 수동 컬럼 선택 (엑셀 파일의 다양한 형식 지원)
  const [selectedDepositColumn, setSelectedDepositColumn] = useState<string>("");
  const [selectedWithdrawalColumn, setSelectedWithdrawalColumn] = useState<string>("");

  // 엑셀 상단 표시용 계좌 정보
  const [bankName, setBankName] = useState<string>("");
  const [accountHolder, setAccountHolder] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [queryPeriod, setQueryPeriod] = useState<string>("");

  // 파일 타입 정보 (업로드 전 안내용)
  const [fileTypeInfo, setFileTypeInfo] = useState<{
    documentType: "text-based" | "image-based" | "image" | "excel" | null;
    pageCount?: number;
    sheetCount?: number;
    rowCount?: number;
    message: string;
    estimatedTime: string | null;
    warning: string | null;
    isChecking: boolean;
  } | null>(null);

  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // 처리 시간 카운터
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 요청 취소를 위한 AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  const startTimer = () => {
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // 파일 타입 확인 함수
  const checkFileType = useCallback(async (file: File) => {
    setFileTypeInfo({ documentType: null, message: "파일 분석 중...", estimatedTime: null, warning: null, isChecking: true });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/check-pdf-type", {
        method: "POST",
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(pdf|png|jpg|jpeg|xlsx|xls)$/i.test(f.name)
    );
    if (droppedFiles.length > 0) {
      setFiles([droppedFiles[0]]);
      checkFileType(droppedFiles[0]);
    }
  }, [checkFileType]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setFiles([file]);
      checkFileType(file);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setFileTypeInfo(null);
  };

  // Vercel 요청 본문 크기 제한 (4.5MB)
  const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

  // OCR 추출
  const handleOcrExtract = async (file: File) => {
    setOcrStep("extracting");
    setCurrentOcrFile(file);
    setIsAiParsing(false);
    setResult({ message: `OCR 처리 중... - ${file.name}`, type: "success" });
    startTimer();

    abortControllerRef.current = new AbortController();

    try {
      // AI 파싱 시작 표시 (텍스트 추출 후)
      const aiParsingTimer = setTimeout(() => {
        setIsAiParsing(true);
      }, 3000);

      let res: Response;

      // 파일 크기에 따라 업로드 방식 결정
      if (file.size > VERCEL_BODY_LIMIT) {
        // 큰 파일: Storage에 먼저 업로드
        setResult({ message: `파일 업로드 중... - ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`, type: "success" });

        // 1. 업로드 URL 생성
        const uploadUrlRes = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
          signal: abortControllerRef.current.signal,
        });

        if (!uploadUrlRes.ok) {
          const data = await uploadUrlRes.json();
          throw new Error(data.error || "업로드 URL 생성 실패");
        }

        const { uploadUrl, path } = await uploadUrlRes.json();

        // 2. Storage에 직접 업로드
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
          signal: abortControllerRef.current.signal,
        });

        if (!uploadRes.ok) {
          throw new Error("Storage 업로드 실패");
        }

        setResult({ message: `OCR 처리 중... - ${file.name}`, type: "success" });

        // 3. OCR API 호출 (Storage 경로 전달)
        res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        formData.append("file", file);
        if (forceRefresh) {
          formData.append("forceRefresh", "true");
        }

        res = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
          signal: abortControllerRef.current.signal,
        });
      }

      clearTimeout(aiParsingTimer);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "OCR 오류가 발생했습니다");
      }

      const data = await res.json();

      setOcrTransactions(data.transactions);
      setCurrentPage(1); // 페이지 리셋
      setOcrRawText(data.rawText);
      if (data.columns && data.columns.length > 0) {
        setOcrColumns(data.columns);
      } else {
        setOcrColumns(["date", "description", "deposit", "withdrawal", "balance"]);
      }
      if (data.aiCost) {
        setAiCost(data.aiCost);
      }
      if (data.documentType) {
        setDocumentType(data.documentType);
      }
      setOcrStep("verifying");
      setIsAiParsing(false);
      stopTimer();

      const costMessage = data.aiCost
        ? ` (AI 비용: ${data.aiCost.krw.toFixed(2)}원)`
        : "";
      setResult({
        message: `${data.transactions.length}개의 거래내역이 추출되었습니다 (${data.columns?.length || 5}개 컬럼).${costMessage} 아래에서 확인 후 수정해주세요.`,
        type: "success",
      });
    } catch (err) {
      console.error("OCR error:", err);
      setOcrStep("idle");
      setIsAiParsing(false);
      stopTimer();

      if (err instanceof Error && err.name === "AbortError") {
        setResult({
          message: "처리가 중단되었습니다.",
          type: "error",
        });
        return;
      }

      setResult({
        message: err instanceof Error ? err.message : "OCR 처리 중 오류 발생",
        type: "error",
      });
    } finally {
      abortControllerRef.current = null;
    }
  };

  // OCR 거래내역 수정
  const updateTransaction = (index: number, field: keyof TransactionRow, value: string | number) => {
    setOcrTransactions((prev) =>
      prev.map((tx, i) =>
        i === index
          ? {
              ...tx,
              [field]: field === "date" || field === "description" ? value : Number(value) || 0,
            }
          : tx
      )
    );
  };

  // OCR 거래내역 삭제
  const deleteTransaction = (index: number) => {
    setOcrTransactions((prev) => prev.filter((_, i) => i !== index));
  };

  // OCR 거래내역 추가
  const addTransaction = () => {
    const newRow: TransactionRow = {
      date: "",
      description: "",
      deposit: 0,
      withdrawal: 0,
      balance: 0,
    };
    for (const col of ocrColumns) {
      if (!(col in newRow)) {
        newRow[col] = ["deposit", "withdrawal", "balance"].includes(col) ? 0 : "";
      }
    }
    setOcrTransactions((prev) => [...prev, newRow]);
  };

  // OCR 검증 후 Excel 생성
  const handleOcrConfirm = async () => {
    if (!threshold || parseInt(threshold) <= 0) {
      setResult({ message: "기준 금액을 입력해주세요.", type: "error" });
      return;
    }

    if (ocrTransactions.length === 0) {
      setResult({ message: "거래내역이 없습니다.", type: "error" });
      return;
    }

    setOcrStep("generating");
    setResult({ message: "Excel 파일 생성 중...", type: "success" });

    try {
      const res = await fetch("/api/ocr-highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: ocrTransactions,
          threshold: parseInt(threshold),
          color: color,
          fileName: currentOcrFile?.name || "ocr_result",
          columns: ocrColumns,
          // 계좌 정보 (엑셀 상단에 표시)
          accountInfo: {
            bankName: bankName || "",
            accountHolder: accountHolder || "",
            accountNumber: accountNumber || "",
            queryPeriod: queryPeriod || "",
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Excel 생성 오류");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `highlighted_${currentOcrFile?.name.replace(/\.[^/.]+$/, "") || "result"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setResult({ message: "완료! 파일이 다운로드됩니다.", type: "success" });
      setOcrStep("idle");
      setOcrTransactions([]);
      setCurrentOcrFile(null);
    } catch (err) {
      console.error("Excel generation error:", err);
      setOcrStep("verifying");
      setResult({
        message: err instanceof Error ? err.message : "Excel 생성 중 오류 발생",
        type: "error",
      });
    }
  };

  // OCR 취소
  const cancelOcr = () => {
    setOcrStep("idle");
    setOcrTransactions([]);
    setOcrRawText("");
    setCurrentOcrFile(null);
    setResult(null);
    setAiCost(null);
    setDocumentType(null);
  };

  // OCR 처리 중단
  const abortOcrProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      setResult({ message: "파일을 선택해주세요.", type: "error" });
      return;
    }
    await handleOcrExtract(files[0]);
  };

  // 로딩 중
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  // 로그인 필요
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">
            거래내역 하이라이트
          </h1>
          <p className="text-gray-600 mb-6">
            스캔/이미지 PDF 거래내역에서 기준 금액 이상 거래를 하이라이트합니다.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            sjinlaw.com 도메인 계정으로 로그인하세요.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => signIn("google")}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google로 로그인
            </button>
            <button
              onClick={() => signIn("google", { callbackUrl: "/" }, { prompt: "select_account" })}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition"
            >
              다른 계정으로 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  // OCR 검증 화면
  if (ocrStep === "verifying") {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          {/* 헤더 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <button
                  onClick={cancelOcr}
                  className="flex items-center gap-1 text-gray-600 hover:text-gray-800 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  뒤로
                </button>
                <h1 className="text-2xl font-bold text-gray-800">
                  OCR 결과 확인
                </h1>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">{session.user?.email}</span>
              </div>
            </div>
          </div>

          {/* 결과 메시지 */}
          {result && (
            <div
              className={`mb-4 p-4 rounded-lg ${
                result.type === "success"
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {result.message}
            </div>
          )}

          {/* 문서 타입 정보 */}
          {documentType && (
            <div className={`mb-4 p-4 rounded-lg border ${
              documentType === "text-based"
                ? "bg-green-50 border-green-200"
                : "bg-orange-50 border-orange-200"
            }`}>
              <div className={`flex items-center gap-2 ${
                documentType === "text-based" ? "text-green-800" : "text-orange-800"
              }`}>
                {documentType === "text-based" ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                <span className="font-medium">
                  {documentType === "text-based" ? "텍스트 기반 PDF" :
                   documentType === "image-based" ? "이미지/스캔 기반 PDF" : "이미지 파일"}
                </span>
              </div>
              <div className={`mt-2 text-sm ${
                documentType === "text-based" ? "text-green-700" : "text-orange-700"
              }`}>
                {documentType === "text-based" ? (
                  <p>PDF에서 텍스트를 직접 추출했습니다. (OCR 불필요)</p>
                ) : documentType === "image-based" ? (
                  <p>스캔/이미지 PDF를 OCR로 텍스트를 추출했습니다.</p>
                ) : (
                  <p>이미지 파일을 OCR로 텍스트를 추출했습니다.</p>
                )}
              </div>
            </div>
          )}

          {/* AI 비용 정보 */}
          {aiCost && (
            <div className="mb-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex items-center gap-2 text-blue-800">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">AI 파싱 비용</span>
              </div>
              <div className="mt-2 text-sm text-blue-700">
                <p>토큰 사용량: 입력 {(aiCost.inputTokens ?? 0).toLocaleString()}개 / 출력 {(aiCost.outputTokens ?? 0).toLocaleString()}개</p>
                <p>예상 비용: ${(aiCost.usd ?? 0).toFixed(6)} (약 {(aiCost.krw ?? 0).toFixed(2)}원)</p>
              </div>
            </div>
          )}

          {/* 원본 텍스트 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <details className="cursor-pointer">
              <summary className="text-lg font-semibold text-gray-700 mb-2">
                원본 OCR 텍스트 (클릭하여 펼치기)
              </summary>
              <pre className="mt-4 p-4 bg-gray-100 rounded text-sm overflow-auto max-h-60 whitespace-pre-wrap">
                {ocrRawText}
              </pre>
            </details>
          </div>

          {/* 계좌 정보 (엑셀 상단에 표시) */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-4">📋 계좌 정보 (엑셀 상단에 표시됨)</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">금융기관</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="예: 국민은행"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">계좌주명</label>
                <input
                  type="text"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  placeholder="예: 홍길동"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">계좌번호</label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="예: 123-456-789012"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">조회기간</label>
                <input
                  type="text"
                  value={queryPeriod}
                  onChange={(e) => setQueryPeriod(e.target.value)}
                  placeholder="예: 2024.01.01 ~ 2024.12.31"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                />
              </div>
            </div>
          </div>

          {/* 하이라이트 설정 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="grid grid-cols-2 gap-6 mb-4">
              <div>
                <label className="block text-sm font-bold text-black mb-2">
                  기준 금액 (만원)
                </label>
                <input
                  type="number"
                  value={threshold ? Math.round(parseInt(threshold) / 10000) : ""}
                  onChange={(e) => setThreshold(e.target.value ? String(parseInt(e.target.value) * 10000) : "")}
                  placeholder="예: 100"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold text-black"
                />
                <p className="text-xs font-semibold text-gray-700 mt-1">
                  100 = 100만원
                </p>
              </div>
              <div>
                <label className="block text-sm font-bold text-black mb-2">
                  하이라이트 색상
                </label>
                <select
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-bold text-black"
                >
                  {COLORS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 수동 컬럼 선택 (엑셀 파일용) */}
            <div className="border-t pt-4">
              <p className="text-sm font-bold text-gray-600 mb-3">
                컬럼 자동 감지가 안 될 경우 수동 선택:
              </p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-blue-700 mb-2">
                    입금 컬럼
                  </label>
                  <select
                    value={selectedDepositColumn}
                    onChange={(e) => setSelectedDepositColumn(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                  >
                    <option value="">자동 감지</option>
                    {ocrColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-red-700 mb-2">
                    출금 컬럼
                  </label>
                  <select
                    value={selectedWithdrawalColumn}
                    onChange={(e) => setSelectedWithdrawalColumn(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                  >
                    <option value="">자동 감지</option>
                    {ocrColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 확인/뒤로 버튼 */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={handleOcrConfirm}
              className="flex-1 py-4 rounded-lg text-white font-bold text-lg bg-blue-600 hover:bg-blue-700 transition"
            >
              확인 및 Excel 다운로드
            </button>
            <button
              onClick={cancelOcr}
              className="px-8 py-4 rounded-lg text-gray-700 font-bold text-lg bg-gray-200 hover:bg-gray-300 transition"
            >
              뒤로
            </button>
          </div>

          {/* 거래내역 테이블 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-black">
                추출된 거래내역 ({ocrTransactions.length}건)
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  페이지 {currentPage} / {Math.ceil(ocrTransactions.length / itemsPerPage)}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  이전
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(ocrTransactions.length / itemsPerPage), p + 1))}
                  disabled={currentPage >= Math.ceil(ocrTransactions.length / itemsPerPage)}
                  className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  다음
                </button>
                <button
                  onClick={addTransaction}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold"
                >
                  + 행 추가
                </button>
              </div>
            </div>

            <div className="overflow-auto max-h-[500px] border rounded" style={{ scrollbarWidth: 'auto', scrollbarColor: '#888 #f1f1f1' }}>
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-300">
                    <th className="border p-2 text-center w-10 font-bold text-black">#</th>
                    {ocrColumns.map((col) => {
                      // 입금/출금/잔액 컬럼 동적 탐지 (부분 문자열 매칭으로 다양한 엑셀 형식 지원)
                      const normalized = col.replace(/\s+/g, "").toLowerCase();

                      // 한국 은행 엑셀의 다양한 컬럼명 지원
                      const isDepositCol = (
                        normalized.includes("입금") ||
                        normalized.includes("맡기신") ||
                        normalized.includes("수입") ||
                        normalized.includes("대변") ||
                        normalized.includes("들어온") ||
                        normalized.includes("적립") ||
                        normalized === "deposit" ||
                        normalized === "credit"
                      ) && !normalized.includes("출금") && !normalized.includes("지출");
                      const isWithdrawalCol =
                        normalized.includes("출금") ||
                        normalized.includes("찾으신") ||
                        normalized.includes("지급") ||
                        normalized.includes("지출") ||
                        normalized.includes("차변") ||
                        normalized.includes("나간") ||
                        normalized === "withdrawal" ||
                        normalized === "debit";
                      const isBalanceCol = normalized.includes("잔액") || normalized.includes("잔고") || normalized === "balance";
                      const isAmountCol = (normalized.includes("금액") || normalized === "amount") && !isDepositCol && !isWithdrawalCol && !isBalanceCol;
                      const isDateCol = normalized.includes("일시") || normalized.includes("일자") || normalized.includes("날짜") || normalized.includes("시간") || normalized === "date" || normalized === "time";
                      const isDescCol = normalized.includes("적요") || normalized.includes("내용") || normalized.includes("기재") || normalized.includes("메모") || normalized.includes("비고") || normalized === "description" || normalized === "memo";

                      return (
                        <th
                          key={col}
                          className={`border p-2 font-bold ${
                            isDepositCol ? "text-blue-700 text-right" :
                            isWithdrawalCol ? "text-red-700 text-right" :
                            isBalanceCol ? "text-green-700 text-right" :
                            isAmountCol ? "text-purple-700 text-right" :
                            "text-left text-black"
                          } ${
                            isDateCol ? "w-28" :
                            isDepositCol || isWithdrawalCol || isBalanceCol || isAmountCol ? "w-28" :
                            isDescCol ? "min-w-32" :
                            "w-20"
                          }`}
                        >
                          {COLUMN_LABELS[col] || col}
                        </th>
                      );
                    })}
                    <th className="border p-2 text-center w-14 font-bold text-black">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrTransactions
                    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                    .map((tx, pageIndex) => {
                    const index = (currentPage - 1) * itemsPerPage + pageIndex;
                    // 입금/출금 금액 추출
                    let depositAmount = 0;
                    let withdrawalAmount = 0;

                    // 수동 선택된 컬럼이 있으면 해당 컬럼 사용
                    if (selectedDepositColumn || selectedWithdrawalColumn) {
                      if (selectedDepositColumn) {
                        const value = tx[selectedDepositColumn];
                        if (value !== undefined && value !== null && value !== "" && value !== 0) {
                          const numValue = typeof value === "number" ? value : parseFloat(String(value).replace(/[,\s]/g, ""));
                          if (!isNaN(numValue) && numValue > 0) {
                            depositAmount = numValue;
                          }
                        }
                      }
                      if (selectedWithdrawalColumn) {
                        const value = tx[selectedWithdrawalColumn];
                        if (value !== undefined && value !== null && value !== "" && value !== 0) {
                          const numValue = typeof value === "number" ? value : parseFloat(String(value).replace(/[,\s]/g, ""));
                          if (!isNaN(numValue) && numValue > 0) {
                            withdrawalAmount = numValue;
                          }
                        }
                      }
                    } else {
                      // 자동 감지 모드: 트랜잭션 객체의 실제 키를 사용
                      for (const key of Object.keys(tx)) {
                        const normalizedKey = key.replace(/\s+/g, "").toLowerCase();
                        const value = tx[key];
                        if (value === undefined || value === null || value === "" || value === 0) continue;

                        const numValue = typeof value === "number" ? value : parseFloat(String(value).replace(/[,\s]/g, ""));
                        if (isNaN(numValue) || numValue <= 0) continue;

                        // 한국 은행 엑셀의 다양한 컬럼명 지원
                        const isDeposit = (
                          normalizedKey.includes("입금") ||
                          normalizedKey.includes("맡기신") ||
                          normalizedKey.includes("수입") ||
                          normalizedKey.includes("대변") ||
                          normalizedKey.includes("들어온") ||
                          normalizedKey.includes("적립") ||
                          normalizedKey === "deposit" ||
                          normalizedKey === "credit"
                        ) && !normalizedKey.includes("출금") && !normalizedKey.includes("지출");
                        const isWithdrawal =
                          normalizedKey.includes("출금") ||
                          normalizedKey.includes("찾으신") ||
                          normalizedKey.includes("지급") ||
                          normalizedKey.includes("지출") ||
                          normalizedKey.includes("차변") ||
                          normalizedKey.includes("나간") ||
                          normalizedKey === "withdrawal" ||
                          normalizedKey === "debit";

                        if (isDeposit) {
                          depositAmount = Math.max(depositAmount, numValue);
                        } else if (isWithdrawal) {
                          withdrawalAmount = Math.max(withdrawalAmount, numValue);
                        }
                      }
                    }

                    // 디버그: 첫 번째 행에서 감지된 금액 출력
                    if (index === 0) {
                      console.log("Highlight debug - columns:", Object.keys(tx), "selectedDeposit:", selectedDepositColumn, "selectedWithdrawal:", selectedWithdrawalColumn, "deposit:", depositAmount, "withdrawal:", withdrawalAmount);
                    }

                    const maxAmount = Math.max(depositAmount, withdrawalAmount);
                    const isHighlighted = threshold && maxAmount >= parseInt(threshold);
                    return (
                      <tr
                        key={index}
                        style={{
                          backgroundColor: isHighlighted
                            ? `#${color}`
                            : "transparent",
                        }}
                      >
                        <td className="border p-1 text-center text-gray-500">
                          {index + 1}
                        </td>
                        {ocrColumns.map((col) => {
                          // 입금/출금/잔액 컬럼 동적 탐지 (부분 문자열 매칭으로 다양한 엑셀 형식 지원)
                          const normalizedCol = col.replace(/\s+/g, "").toLowerCase();

                          // 한국 은행 엑셀의 다양한 컬럼명 지원
                          const isDepositCol = (
                            normalizedCol.includes("입금") ||
                            normalizedCol.includes("맡기신") ||
                            normalizedCol.includes("수입") ||
                            normalizedCol.includes("대변") ||
                            normalizedCol.includes("들어온") ||
                            normalizedCol.includes("적립") ||
                            normalizedCol === "deposit" ||
                            normalizedCol === "credit"
                          ) && !normalizedCol.includes("출금") && !normalizedCol.includes("지출");
                          const isWithdrawalCol =
                            normalizedCol.includes("출금") ||
                            normalizedCol.includes("찾으신") ||
                            normalizedCol.includes("지급") ||
                            normalizedCol.includes("지출") ||
                            normalizedCol.includes("차변") ||
                            normalizedCol.includes("나간") ||
                            normalizedCol === "withdrawal" ||
                            normalizedCol === "debit";
                          const isBalanceCol = normalizedCol.includes("잔액") || normalizedCol.includes("잔고") || normalizedCol === "balance";
                          const isAmountCol = (normalizedCol.includes("금액") || normalizedCol === "amount") && !isDepositCol && !isWithdrawalCol && !isBalanceCol;
                          const isNumeric = isDepositCol || isWithdrawalCol || isBalanceCol || isAmountCol;

                          const value = tx[col];
                          const displayValue = isNumeric && typeof value === "number" && value !== 0
                            ? value.toLocaleString()
                            : (value || "");

                          return (
                            <td key={col} className="border p-1">
                              <input
                                type="text"
                                value={displayValue}
                                onChange={(e) => {
                                  const newValue = isNumeric
                                    ? e.target.value.replace(/,/g, "")
                                    : e.target.value;
                                  updateTransaction(index, col, newValue);
                                }}
                                className={`w-full px-2 py-1 border rounded font-medium ${
                                  isDepositCol ? "text-right text-blue-700" :
                                  isWithdrawalCol ? "text-right text-red-700" :
                                  isBalanceCol ? "text-right text-green-700" :
                                  isAmountCol ? "text-right text-purple-700" :
                                  isNumeric ? "text-right text-black" :
                                  "text-left text-black"
                                }`}
                                placeholder={
                                  normalizedCol.includes("일시") || normalizedCol.includes("일자") || normalizedCol.includes("날짜") || normalizedCol === "date" ? "YYYY.MM.DD" :
                                  normalizedCol.includes("시간") || normalizedCol === "time" ? "HH:MM" :
                                  isNumeric ? "0" :
                                  ""
                                }
                              />
                            </td>
                          );
                        })}
                        <td className="border p-1 text-center">
                          <button
                            onClick={() => deleteTransaction(index)}
                            className="text-red-600 hover:text-red-800 font-bold"
                          >
                            X
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ocrTransactions.length === 0 && (
              <p className="text-center text-gray-500 py-8">
                추출된 거래내역이 없습니다. 행을 추가하여 수동으로 입력해주세요.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 메인 화면 (OCR 모드만)
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">
              거래내역 하이라이트
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{session.user?.email}</span>
              <button
                onClick={() => signOut()}
                className="text-sm text-red-600 hover:text-red-800"
              >
                로그아웃
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            스캔/이미지 PDF를 업로드하면 OCR로 텍스트를 추출하고 AI가 거래내역을 파싱합니다.
          </p>
          <div className="mt-4">
            <a
              href="/bank-rules"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              은행 파싱 규칙 보기
            </a>
          </div>
        </div>

        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            파일 업로드 (PDF/이미지/엑셀)
          </h2>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
              dragOver
                ? "border-green-500 bg-green-50"
                : "border-gray-300 hover:border-blue-500 hover:bg-blue-50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("fileInput")?.click()}
          >
            <input
              id="fileInput"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-lg text-gray-600 mb-2">
              파일을 끌어다 놓거나 클릭하세요
            </p>
            <p className="text-sm text-gray-400">
              지원 형식: .pdf, .png, .jpg, .jpeg, .xlsx, .xls
            </p>
          </div>

          {files.length > 0 && (
            <div className="mt-4 bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium text-green-600">
                  선택된 파일: {files[0].name}
                </span>
                <button
                  onClick={clearFiles}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  삭제
                </button>
              </div>

              {/* 파일 타입 정보 */}
              {fileTypeInfo && (
                <div className={`mt-3 p-3 rounded-lg ${
                  fileTypeInfo.isChecking
                    ? "bg-gray-100 text-gray-600"
                    : fileTypeInfo.documentType === "text-based"
                      ? "bg-green-100 text-green-800"
                      : fileTypeInfo.documentType === "excel"
                        ? "bg-emerald-100 text-emerald-800"
                        : fileTypeInfo.documentType === "image-based"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-800"
                }`}>
                  {fileTypeInfo.isChecking ? (
                    <div className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>파일 분석 중...</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        {fileTypeInfo.documentType === "text-based" ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        ) : fileTypeInfo.documentType === "excel" ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                        <span className="font-semibold">{fileTypeInfo.message}</span>
                      </div>
                      {fileTypeInfo.pageCount && (
                        <p className="text-sm ml-7">총 {fileTypeInfo.pageCount}페이지</p>
                      )}
                      {fileTypeInfo.rowCount && (
                        <p className="text-sm ml-7">총 {fileTypeInfo.rowCount}행 (시트 {fileTypeInfo.sheetCount}개)</p>
                      )}
                      {fileTypeInfo.estimatedTime && (
                        <p className="text-sm ml-7">예상 소요시간: {fileTypeInfo.estimatedTime}</p>
                      )}
                      {fileTypeInfo.warning && (
                        <p className="text-sm ml-7 mt-1 font-medium text-orange-600">⚠️ {fileTypeInfo.warning}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 캐시 무시 옵션 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={forceRefresh}
              onChange={(e) => setForceRefresh(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">
              캐시 무시하고 다시 파싱
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            이전에 파싱한 결과가 잘못된 경우 체크하세요.
          </p>
        </div>

        {/* 실행 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={ocrStep !== "idle"}
          className={`w-full py-4 rounded-lg text-white font-medium transition ${
            ocrStep !== "idle"
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {ocrStep === "extracting"
            ? isAiParsing
              ? `AI 파싱 중... (${elapsedTime}초)`
              : `OCR 처리 중... (${elapsedTime}초)`
            : "OCR 추출 시작"}
        </button>

        {/* 결과 메시지 */}
        {result && ocrStep === "idle" && (
          <div
            className={`mt-4 p-4 rounded-lg ${
              result.type === "success"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {result.message}
          </div>
        )}

        {/* OCR 처리 중 상태 표시 */}
        {ocrStep === "extracting" && (
          <div className="mt-4 p-4 rounded-lg bg-blue-100 text-blue-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="font-medium">
                  {isAiParsing ? "AI 파싱 중..." : "OCR 텍스트 추출 중..."}
                </span>
                <span className="text-sm">({elapsedTime}초)</span>
              </div>
              <button
                onClick={abortOcrProcessing}
                className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded hover:bg-red-600 transition"
              >
                중단
              </button>
            </div>
            {isAiParsing && (
              <div className="mt-3 ml-7">
                <p className="text-sm">Gemini AI가 거래내역을 분석하고 있습니다. 파일 크기에 따라 1~3분 정도 소요될 수 있습니다.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
