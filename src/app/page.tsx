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
  // 동적 컬럼 지원
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

interface PdfAnalysis {
  type: "text-based" | "image-based" | "mixed";
  confidence: number;
  textLength: number;
  pageCount: number;
  recommendation: "normal" | "ocr";
  message: string;
  fileName: string;
}

type ProcessMode = "normal" | "ocr";

type TabType = "highlight" | "guide";

export default function Home() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState<TabType>("highlight");
  const [files, setFiles] = useState<File[]>([]);
  const [threshold, setThreshold] = useState("");
  const [color, setColor] = useState("FFFF00");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // OCR 관련 상태
  const [processMode, setProcessMode] = useState<ProcessMode>("normal");
  const [ocrStep, setOcrStep] = useState<"idle" | "extracting" | "verifying" | "generating">("idle");
  const [isAiParsing, setIsAiParsing] = useState(false);
  const [ocrTransactions, setOcrTransactions] = useState<TransactionRow[]>([]);
  const [ocrColumns, setOcrColumns] = useState<string[]>(["date", "description", "deposit", "withdrawal", "balance"]);
  const [ocrRawText, setOcrRawText] = useState("");
  const [currentOcrFile, setCurrentOcrFile] = useState<File | null>(null);

  // PDF 분석 상태
  const [pdfAnalysis, setPdfAnalysis] = useState<PdfAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);

  // AI 비용 상태
  const [aiCost, setAiCost] = useState<{ inputTokens: number; outputTokens: number; usd: number; krw: number } | null>(null);

  // 처리 시간 카운터
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 요청 취소를 위한 AbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // 타이머 시작/정지 함수
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

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // PDF 분석 함수
  const analyzePdf = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return;
    }

    setAnalyzing(true);
    setPdfAnalysis(null);
    setIsPasswordProtected(false);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setPdfAnalysis({ ...data, fileName: file.name });
      } else if (data.isPasswordProtected) {
        setIsPasswordProtected(true);
      }
    } catch (error) {
      console.error("PDF analysis error:", error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(xlsx|xls|csv|pdf|png|jpg|jpeg)$/i.test(f.name)
    );
    setFiles((prev) => [...prev, ...droppedFiles]);

    // PDF 파일이 있으면 분석
    const pdfFile = droppedFiles.find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfFile) {
      analyzePdf(pdfFile);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...newFiles]);

      // PDF 파일이 있으면 분석
      const pdfFile = newFiles.find((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (pdfFile) {
        analyzePdf(pdfFile);
      }
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
    setPdfAnalysis(null);
    setIsPasswordProtected(false);
  };

  // OCR 추출
  const handleOcrExtract = async (file: File) => {
    setOcrStep("extracting");
    setCurrentOcrFile(file);
    setIsAiParsing(false);
    setResult({ message: `OCR 처리 중... - ${file.name}`, type: "success" });
    startTimer();

    // AbortController 생성
    abortControllerRef.current = new AbortController();

    const formData = new FormData();
    formData.append("file", file);

    try {
      // AI 파싱 상태 표시를 위한 타이머 (2초 후 AI 파싱 중으로 변경)
      const aiParsingTimer = setTimeout(() => {
        setIsAiParsing(true);
      }, 2000);

      const res = await fetch("/api/ocr", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      clearTimeout(aiParsingTimer);

      if (!res.ok) {
        const data = await res.json();
        // 텍스트 기반 PDF인 경우 일반 모드로 전환 안내
        if (data.isTextBasedPdf) {
          setOcrStep("idle");
          setIsAiParsing(false);
          stopTimer();
          setProcessMode("normal");
          setResult({
            message: "텍스트 기반 PDF입니다. 일반 모드로 전환되었습니다. '하이라이트 처리 및 다운로드' 버튼을 클릭하세요.",
            type: "success",
          });
          return;
        }
        throw new Error(data.error || "OCR 오류가 발생했습니다");
      }

      const data = await res.json();
      setOcrTransactions(data.transactions);
      setOcrRawText(data.rawText);
      // 동적 컬럼 설정 (서버에서 받은 컬럼 또는 기본값)
      if (data.columns && data.columns.length > 0) {
        setOcrColumns(data.columns);
      } else {
        setOcrColumns(["date", "description", "deposit", "withdrawal", "balance"]);
      }
      // AI 비용 저장
      if (data.aiCost) {
        setAiCost(data.aiCost);
      }
      setOcrStep("verifying");
      setIsAiParsing(false);
      stopTimer();

      // 비용 메시지 생성
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

      // 사용자가 취소한 경우
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
    // 동적 컬럼에 맞게 빈 행 생성
    const newRow: TransactionRow = {
      date: "",
      description: "",
      deposit: 0,
      withdrawal: 0,
      balance: 0,
    };
    // 추가 컬럼들도 초기화
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

  // OCR 취소 (검증 화면에서 뒤로가기)
  const cancelOcr = () => {
    setOcrStep("idle");
    setOcrTransactions([]);
    setOcrRawText("");
    setCurrentOcrFile(null);
    setResult(null);
    setAiCost(null);
  };

  // OCR 처리 중단 (진행 중인 요청 취소)
  const abortOcrProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // 일반 처리 (기존 로직)
  const handleNormalSubmit = async () => {
    if (files.length === 0) {
      setResult({ message: "파일을 선택해주세요.", type: "error" });
      return;
    }

    if (!threshold || parseInt(threshold) <= 0) {
      setResult({ message: "기준 금액을 입력해주세요.", type: "error" });
      return;
    }

    setProcessing(true);
    setResult(null);
    startTimer();

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setResult({
        message: `처리 중... (${i + 1}/${files.length}) - ${file.name}`,
        type: "success",
      });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("threshold", threshold);
      formData.append("color", color);

      try {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        const apiUrl = isPdf ? "/api/highlight-pdf" : "/api/highlight";

        const res = await fetch(apiUrl, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          // 암호 보호된 파일인 경우
          if (data.isPasswordProtected) {
            setIsPasswordProtected(true);
            setProcessing(false);
            stopTimer();
            return;
          }
          throw new Error(data.error || "오류가 발생했습니다");
        }

        // AI 비용 정보 헤더에서 읽기
        const inputTokens = res.headers.get("X-AI-Cost-Input-Tokens");
        const outputTokens = res.headers.get("X-AI-Cost-Output-Tokens");
        const costUsd = res.headers.get("X-AI-Cost-USD");
        const costKrw = res.headers.get("X-AI-Cost-KRW");

        if (inputTokens && outputTokens && costUsd && costKrw) {
          setAiCost({
            inputTokens: parseInt(inputTokens),
            outputTokens: parseInt(outputTokens),
            usd: parseFloat(costUsd),
            krw: parseFloat(costKrw),
          });
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `highlighted_${file.name.replace(/\.[^/.]+$/, "")}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        successCount++;

        if (i < files.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        console.error(`파일 처리 오류 (${file.name}):`, err);
        errorCount++;
      }
    }

    setProcessing(false);
    stopTimer();
    if (errorCount === 0) {
      setResult({
        message: `완료! ${successCount}개 파일이 다운로드됩니다.`,
        type: "success",
      });
    } else {
      setResult({
        message: `완료: 성공 ${successCount}개, 실패 ${errorCount}개`,
        type: "error",
      });
    }
  };

  const handleSubmit = async () => {
    if (processMode === "ocr") {
      // OCR 모드일 때
      if (files.length === 0) {
        setResult({ message: "파일을 선택해주세요.", type: "error" });
        return;
      }

      // PDF/이미지 파일만 OCR 처리
      const ocrFile = files.find((f) =>
        /\.(pdf|png|jpg|jpeg)$/i.test(f.name)
      );

      if (!ocrFile) {
        setResult({ message: "OCR 처리할 PDF 또는 이미지 파일을 선택해주세요.", type: "error" });
        return;
      }

      await handleOcrExtract(ocrFile);
    } else {
      await handleNormalSubmit();
    }
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
            엑셀/PDF 거래내역에서 기준 금액 이상 거래를 하이라이트합니다.
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

          {/* 설정 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="grid grid-cols-2 gap-6">
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
          </div>

          {/* 확인/뒤로 버튼 (상단) */}
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
              <button
                onClick={addTransaction}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold"
              >
                + 행 추가
              </button>
            </div>

            {/* 스크롤 가능한 테이블 영역 */}
            <div className="overflow-auto max-h-[500px] border rounded" style={{ scrollbarWidth: 'auto', scrollbarColor: '#888 #f1f1f1' }}>
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-300">
                    <th className="border p-2 text-center w-10 font-bold text-black">#</th>
                    {ocrColumns.map((col) => (
                      <th
                        key={col}
                        className={`border p-2 font-bold ${
                          col === "deposit" ? "text-blue-700 text-right" :
                          col === "withdrawal" ? "text-red-700 text-right" :
                          ["balance"].includes(col) ? "text-right text-black" :
                          "text-left text-black"
                        } ${
                          ["date", "time"].includes(col) ? "w-24" :
                          ["deposit", "withdrawal", "balance"].includes(col) ? "w-28" :
                          ["description", "counterparty", "memo"].includes(col) ? "min-w-32" :
                          "w-20"
                        }`}
                      >
                        {COLUMN_LABELS[col] || col}
                      </th>
                    ))}
                    <th className="border p-2 text-center w-14 font-bold text-black">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrTransactions.map((tx, index) => {
                    const maxAmount = Math.max(Number(tx.deposit) || 0, Number(tx.withdrawal) || 0);
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
                          const isNumeric = ["deposit", "withdrawal", "balance"].includes(col);
                          const value = tx[col];
                          const displayValue = isNumeric && typeof value === "number" && value > 0
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
                                  col === "deposit" ? "text-right text-blue-700" :
                                  col === "withdrawal" ? "text-right text-red-700" :
                                  isNumeric ? "text-right text-black" :
                                  "text-left text-black"
                                }`}
                                placeholder={
                                  col === "date" ? "YYYY.MM.DD" :
                                  col === "time" ? "HH:MM" :
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

  // 로그인 완료 (메인 화면)
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
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
          {/* 탭 메뉴 */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("highlight")}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
                activeTab === "highlight"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              하이라이트
            </button>
            <button
              onClick={() => setActiveTab("guide")}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition ${
                activeTab === "guide"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              사용법
            </button>
          </div>
        </div>

        {/* 하이라이트 탭 콘텐츠 */}
        {activeTab === "highlight" && (
          <>
        {/* 처리 모드 선택 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-bold text-black mb-4">처리 방식</h2>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="normal"
                checked={processMode === "normal"}
                onChange={() => setProcessMode("normal")}
                className="w-4 h-4"
              />
              <span className="font-bold text-black">일반 (텍스트 기반 PDF/Excel)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="ocr"
                checked={processMode === "ocr"}
                onChange={() => setProcessMode("ocr")}
                className="w-4 h-4"
              />
              <span className="font-bold text-black">OCR (스캔/이미지 PDF)</span>
            </label>
          </div>
          {processMode === "ocr" && (
            <p className="text-sm font-semibold text-blue-700 mt-2">
              OCR 모드: 이미지 기반 PDF나 스캔본을 텍스트로 변환합니다. 추출 후 검증 단계가 있습니다.
            </p>
          )}
        </div>

        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            파일 업로드 {processMode === "ocr" ? "(PDF/이미지)" : "(여러 파일 선택 가능)"}
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
              accept={processMode === "ocr" ? ".pdf,.png,.jpg,.jpeg" : ".xlsx,.xls,.csv,.pdf"}
              multiple={processMode !== "ocr"}
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-lg text-gray-600 mb-2">
              파일을 끌어다 놓거나 클릭하세요
            </p>
            <p className="text-sm text-gray-400">
              {processMode === "ocr"
                ? "지원 형식: .pdf, .png, .jpg, .jpeg"
                : "지원 형식: .xlsx, .xls, .csv, .pdf"}
            </p>
            {processMode !== "ocr" && (
              <p className="text-xs text-gray-400 mt-1">
                (PDF는 텍스트 기반만 지원, 스캔본은 OCR 모드 사용)
              </p>
            )}
          </div>

          {files.length > 0 && (
            <div className="mt-4 bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <span className="font-medium text-green-600">
                  선택된 파일 ({files.length}개)
                </span>
                <button
                  onClick={clearFiles}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  전체 삭제
                </button>
              </div>
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center bg-white p-3 rounded border"
                  >
                    <span className="text-gray-700">
                      {index + 1}. {file.name}
                    </span>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PDF 분석 결과 */}
          {analyzing && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="font-medium text-blue-700">PDF 분석 중...</span>
              </div>
            </div>
          )}

          {/* 암호 보호된 파일 안내 */}
          {isPasswordProtected && !analyzing && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <div>
                  <h3 className="font-bold text-red-700 mb-2">암호로 보호된 파일입니다</h3>
                  <p className="text-sm text-red-600 mb-3">
                    이 파일은 암호가 설정되어 있어 처리할 수 없습니다. 아래 방법 중 하나로 암호를 해제해주세요.
                  </p>
                  <div className="bg-white rounded p-3 text-sm text-gray-700">
                    <p className="font-semibold mb-2">PDF 암호 해제:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-600 mb-3">
                      <li><span className="font-medium">Preview (macOS)</span>: PDF 열기 → 파일 → 내보내기 → 암호화 체크 해제</li>
                      <li><span className="font-medium">Adobe Acrobat</span>: 파일 → 속성 → 보안 → &quot;보안 방법: 없음&quot;</li>
                      <li><span className="font-medium">Chrome</span>: PDF 열기 → 인쇄 → &quot;PDF로 저장&quot;</li>
                    </ul>
                    <p className="font-semibold mb-2">Excel 암호 해제:</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-600">
                      <li><span className="font-medium">Excel</span>: 파일 열기 → 파일 → 정보 → 통합 문서 보호 → 암호 해제</li>
                      <li><span className="font-medium">Excel (다른 이름으로 저장)</span>: 암호 입력 후 열기 → 다른 이름으로 저장 → 암호 없이 저장</li>
                      <li><span className="font-medium">Google Sheets</span>: 업로드 후 다운로드하면 암호가 제거됨</li>
                    </ul>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    * 암호를 해제한 파일을 다시 업로드해주세요.
                  </p>
                </div>
              </div>
            </div>
          )}

          {pdfAnalysis && !analyzing && (
            <div className={`mt-4 p-4 rounded-lg border ${
              pdfAnalysis.type === "text-based"
                ? "bg-green-50 border-green-200"
                : pdfAnalysis.type === "image-based"
                ? "bg-orange-50 border-orange-200"
                : "bg-yellow-50 border-yellow-200"
            }`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    {pdfAnalysis.type === "text-based" ? (
                      <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : pdfAnalysis.type === "image-based" ? (
                      <svg className="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <span className={`font-bold ${
                      pdfAnalysis.type === "text-based"
                        ? "text-green-700"
                        : pdfAnalysis.type === "image-based"
                        ? "text-orange-700"
                        : "text-yellow-700"
                    }`}>
                      {pdfAnalysis.type === "text-based" && "텍스트 기반 PDF"}
                      {pdfAnalysis.type === "image-based" && "스캔/이미지 기반 PDF"}
                      {pdfAnalysis.type === "mixed" && "혼합 형식 PDF"}
                    </span>
                    <span className="text-sm text-gray-500">
                      (신뢰도: {pdfAnalysis.confidence}%)
                    </span>
                  </div>
                  <p className={`text-sm ${
                    pdfAnalysis.type === "text-based"
                      ? "text-green-600"
                      : pdfAnalysis.type === "image-based"
                      ? "text-orange-600"
                      : "text-yellow-600"
                  }`}>
                    {pdfAnalysis.message}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {pdfAnalysis.pageCount}페이지 / 추출된 텍스트: {pdfAnalysis.textLength.toLocaleString()}자
                  </p>
                </div>
                {pdfAnalysis.recommendation === "ocr" && processMode === "normal" && (
                  <button
                    onClick={() => setProcessMode("ocr")}
                    className="px-3 py-1.5 bg-orange-600 text-white text-sm font-medium rounded hover:bg-orange-700 transition"
                  >
                    OCR 모드로 전환
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 설정 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-2 gap-6">
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
                이 금액 이상의 입금/출금 거래가 하이라이트됩니다. (100 = 100만원)
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
              <div
                className="w-8 h-8 rounded mt-2 border"
                style={{
                  backgroundColor: COLORS.find((c) => c.value === color)?.bg,
                }}
              />
            </div>
          </div>
        </div>

        {/* 실행 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={processing || ocrStep !== "idle"}
          className={`w-full py-4 rounded-lg text-white font-medium transition ${
            processing || ocrStep !== "idle"
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {processing || ocrStep === "extracting"
            ? isAiParsing
              ? `AI 파싱 중... (${elapsedTime}초)`
              : `처리 중... (${elapsedTime}초)`
            : processMode === "ocr"
            ? "OCR 추출 시작"
            : "하이라이트 처리 및 다운로드"}
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
            {processing && elapsedTime > 0 && (
              <span className="ml-2 font-medium">({elapsedTime}초 경과)</span>
            )}
          </div>
        )}

        {/* AI 비용 정보 (메인 화면) */}
        {aiCost && ocrStep === "idle" && !processing && (
          <div className="mt-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-center gap-2 text-blue-800">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">AI 파싱 비용</span>
            </div>
            <div className="mt-2 text-sm text-blue-700">
              <p>토큰 사용량: 입력 {aiCost.inputTokens.toLocaleString()}개 / 출력 {aiCost.outputTokens.toLocaleString()}개</p>
              <p>예상 비용: ${aiCost.usd.toFixed(6)} (약 {aiCost.krw.toFixed(2)}원)</p>
            </div>
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
              <p className="text-sm mt-2 ml-7">Gemini AI가 거래내역을 분석하고 있습니다.</p>
            )}
          </div>
        )}
        </>
        )}

        {/* 사용법 탭 콘텐츠 */}
        {activeTab === "guide" && (
          <div className="space-y-6">
            {/* 기본 사용법 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">기본 사용법</h2>
              <ol className="list-decimal list-inside space-y-3 text-gray-700">
                <li><span className="font-medium">파일 업로드</span>: 은행 거래내역 파일(Excel, PDF)을 업로드합니다.</li>
                <li><span className="font-medium">기준 금액 설정</span>: 하이라이트할 최소 금액을 만원 단위로 입력합니다. (예: 100 = 100만원)</li>
                <li><span className="font-medium">색상 선택</span>: 하이라이트 색상을 선택합니다.</li>
                <li><span className="font-medium">처리 시작</span>: 버튼을 클릭하면 기준 금액 이상의 거래가 하이라이트된 Excel 파일이 다운로드됩니다.</li>
              </ol>
            </div>

            {/* 처리 모드 설명 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">처리 모드</h2>
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-bold text-gray-800 mb-2">일반 모드</h3>
                  <p className="text-gray-600 text-sm">텍스트 기반 PDF 또는 Excel 파일을 처리합니다. 인터넷뱅킹에서 다운로드한 파일은 대부분 일반 모드로 처리할 수 있습니다.</p>
                  <p className="text-gray-500 text-xs mt-2">지원 형식: .xlsx, .xls, .csv, .pdf (텍스트 기반)</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-bold text-blue-800 mb-2">OCR 모드</h3>
                  <p className="text-gray-600 text-sm">스캔한 문서나 이미지 기반 PDF를 처리합니다. Google Vision AI로 텍스트를 추출하고, Gemini AI가 거래내역을 분석합니다.</p>
                  <p className="text-gray-500 text-xs mt-2">지원 형식: .pdf (스캔/이미지), .png, .jpg, .jpeg</p>
                  <p className="text-blue-600 text-xs mt-1">* OCR 처리 후 결과를 확인하고 수정할 수 있습니다.</p>
                </div>
              </div>
            </div>

            {/* 지원 은행 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">지원 은행/형식</h2>
              <p className="text-gray-600 text-sm mb-3">대부분의 국내 은행 거래내역 형식을 지원합니다:</p>
              <div className="flex flex-wrap gap-2">
                {["우리은행", "농협", "카카오뱅크", "케이뱅크", "신한은행", "국민은행", "하나은행", "기업은행"].map((bank) => (
                  <span key={bank} className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full">{bank}</span>
                ))}
              </div>
              <p className="text-gray-500 text-xs mt-3">* AI 파싱을 통해 다양한 형식의 거래내역을 자동으로 인식합니다.</p>
            </div>

            {/* 암호 보호된 파일 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">암호 보호된 파일</h2>
              <p className="text-gray-600 text-sm mb-3">암호로 보호된 파일은 처리할 수 없습니다. 아래 방법으로 암호를 해제해주세요:</p>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-gray-700">PDF 파일:</p>
                  <ul className="list-disc list-inside text-gray-600 ml-2">
                    <li>Preview (macOS): 파일 → 내보내기 → 암호화 체크 해제</li>
                    <li>Chrome: PDF 열기 → 인쇄 → &quot;PDF로 저장&quot;</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Excel 파일:</p>
                  <ul className="list-disc list-inside text-gray-600 ml-2">
                    <li>Excel: 다른 이름으로 저장 → 암호 없이 저장</li>
                    <li>Google Sheets: 업로드 후 다운로드</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 문의 */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-bold text-gray-800 mb-4">문의 및 지원</h2>
              <p className="text-gray-600 text-sm">
                사용 중 문제가 발생하거나 기능 개선 제안이 있으시면 담당자에게 문의해주세요.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
