"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useMemo, useEffect } from "react";
import { useTimer, useFileUpload, useTransactionEditor, useOcrProcess } from "@/hooks";
import { HIGHLIGHT_COLORS, COLUMN_LABELS, SUPPORTED_FILE_EXTENSIONS } from "@/lib/constants";
import {
  analyzeColumns,
  extractAmounts,
  shouldHighlight,
  isNumericColumn
} from "@/lib/column-detection";
import type { TransactionRow, AccountInfo } from "@/types/transaction";

// 사용량 데이터 타입
interface UsageData {
  provider: string;
  remaining: number;
  maxLimit: number;
  isUnlimited: boolean;
  used: number;
}

export default function Home() {
  const { data: session, status } = useSession();

  // 커스텀 훅 사용
  const timer = useTimer();
  const fileUpload = useFileUpload();
  const editor = useTransactionEditor();
  const ocr = useOcrProcess();

  // 사용량 상태
  const [usage, setUsage] = useState<UsageData | null>(null);

  // 사용량 조회
  useEffect(() => {
    if (session) {
      fetch("/api/usage")
        .then((res) => res.json())
        .then((data) => setUsage(data))
        .catch((err) => console.error("Failed to fetch usage:", err));
    }
  }, [session, ocr.isVerifying]); // OCR 완료 후에도 다시 조회

  // 로컬 상태 (훅으로 분리하기 어려운 것들)
  const [threshold, setThreshold] = useState("");
  const [color, setColor] = useState("FFFF00");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [selectedDepositColumn, setSelectedDepositColumn] = useState("");
  const [selectedWithdrawalColumn, setSelectedWithdrawalColumn] = useState("");

  // 계좌 정보
  const [accountInfo, setAccountInfo] = useState<AccountInfo>({
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    queryPeriod: "",
  });

  // 컬럼 타입 분석 (메모이제이션)
  const columnTypes = useMemo(() => analyzeColumns(editor.columns), [editor.columns]);

  // OCR 추출 핸들러
  const handleSubmit = async () => {
    if (!fileUpload.file) {
      ocr.setResult({ message: "파일을 선택해주세요.", type: "error" });
      return;
    }

    await ocr.extract(
      fileUpload.file,
      forceRefresh,
      (data) => {
        editor.setAllTransactions(data.transactions);
        editor.setColumns(data.columns);
      },
      timer.start,
      timer.stop
    );
  };

  // Excel 생성 핸들러
  const handleConfirm = async () => {
    if (!threshold || parseInt(threshold) <= 0) {
      ocr.setResult({ message: "기준 금액을 입력해주세요.", type: "error" });
      return;
    }

    if (editor.isEmpty) {
      ocr.setResult({ message: "거래내역이 없습니다.", type: "error" });
      return;
    }

    ocr.startGenerating();

    try {
      const res = await fetch("/api/ocr-highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: editor.transactions,
          threshold: parseInt(threshold),
          color,
          fileName: ocr.currentFile?.name || "ocr_result",
          columns: editor.columns,
          accountInfo,
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
      a.download = `highlighted_${ocr.currentFile?.name.replace(/\.[^/.]+$/, "") || "result"}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      ocr.complete();
      editor.reset();
    } catch (err) {
      ocr.backToVerifying();
      ocr.setResult({
        message: err instanceof Error ? err.message : "Excel 생성 중 오류 발생",
        type: "error",
      });
    }
  };

  // 취소 핸들러
  const handleCancel = () => {
    ocr.cancel();
    editor.reset();
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
          <h1 className="text-2xl font-bold text-gray-800 mb-4">거래내역 하이라이트</h1>
          <p className="text-gray-600 mb-6">스캔/이미지 PDF 거래내역에서 기준 금액 이상 거래를 하이라이트합니다.</p>
          <p className="text-sm text-gray-500 mb-6">sjinlaw.com 도메인 계정으로 로그인하세요.</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => signIn("google")}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
            >
              <GoogleIcon />
              Google로 로그인
            </button>
            <button
              onClick={() => signIn("kakao")}
              className="w-full bg-[#FEE500] text-[#000000] py-3 px-4 rounded-lg hover:bg-[#FDD835] transition flex items-center justify-center gap-2"
            >
              <KakaoIcon />
              카카오로 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  // OCR 검증 화면
  if (ocr.isVerifying) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          {/* 헤더 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <button onClick={handleCancel} className="flex items-center gap-1 text-gray-600 hover:text-gray-800 transition">
                  <BackIcon />
                  뒤로
                </button>
                <h1 className="text-2xl font-bold text-gray-800">OCR 결과 확인</h1>
              </div>
              <span className="text-sm text-gray-600">{session.user?.email || session.user?.name || '사용자'}</span>
            </div>
          </div>

          {/* 결과 메시지 */}
          {ocr.result && (
            <div className={`mb-4 p-4 rounded-lg ${ocr.result.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
              {ocr.result.message}
            </div>
          )}

          {/* 기술 정보 (Google 사용자만 표시) */}
          {usage?.isUnlimited && (
            <>
              {/* 문서 타입 정보 */}
              {ocr.documentType && <DocumentTypeInfo type={ocr.documentType} />}

              {/* AI 비용 정보 */}
              {ocr.aiCost && <AiCostInfo cost={ocr.aiCost} />}

              {/* 원본 텍스트 */}
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <details className="cursor-pointer">
                  <summary className="text-lg font-semibold text-gray-700 mb-2">원본 OCR 텍스트 (클릭하여 펼치기)</summary>
                  <pre className="mt-4 p-4 bg-gray-100 rounded text-sm overflow-auto max-h-60 whitespace-pre-wrap">{ocr.rawText}</pre>
                </details>
              </div>
            </>
          )}

          {/* 계좌 정보 */}
          <AccountInfoForm value={accountInfo} onChange={setAccountInfo} />

          {/* 하이라이트 설정 */}
          <HighlightSettings
            threshold={threshold}
            color={color}
            columns={editor.columns}
            selectedDepositColumn={selectedDepositColumn}
            selectedWithdrawalColumn={selectedWithdrawalColumn}
            onThresholdChange={setThreshold}
            onColorChange={setColor}
            onDepositColumnChange={setSelectedDepositColumn}
            onWithdrawalColumnChange={setSelectedWithdrawalColumn}
          />

          {/* 확인/뒤로 버튼 */}
          <div className="flex gap-4 mb-6">
            <button onClick={handleConfirm} className="flex-1 py-4 rounded-lg text-white font-bold text-lg bg-blue-600 hover:bg-blue-700 transition">
              확인 및 Excel 다운로드
            </button>
            <button onClick={handleCancel} className="px-8 py-4 rounded-lg text-gray-700 font-bold text-lg bg-gray-200 hover:bg-gray-300 transition">
              뒤로
            </button>
          </div>

          {/* 거래내역 테이블 */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-black">추출된 거래내역 ({editor.totalCount}건)</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">페이지 {editor.currentPage} / {editor.totalPages}</span>
                <button onClick={editor.goToPrevPage} disabled={editor.currentPage === 1} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50">이전</button>
                <button onClick={editor.goToNextPage} disabled={editor.currentPage >= editor.totalPages} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50">다음</button>
                <button onClick={editor.addTransaction} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold">+ 행 추가</button>
              </div>
            </div>

            <TransactionTable
              transactions={editor.currentTransactions}
              columns={editor.columns}
              columnTypes={columnTypes}
              threshold={parseInt(threshold) || 0}
              color={color}
              selectedDepositColumn={selectedDepositColumn}
              selectedWithdrawalColumn={selectedWithdrawalColumn}
              startIndex={(editor.currentPage - 1) * editor.itemsPerPage}
              onUpdate={editor.updateTransaction}
              onDelete={editor.deleteTransaction}
            />

            {editor.isEmpty && (
              <p className="text-center text-gray-500 py-8">추출된 거래내역이 없습니다. 행을 추가하여 수동으로 입력해주세요.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 메인 화면
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">거래내역 하이라이트</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{session.user?.email || session.user?.name || '사용자'}</span>
              {/* 사용량 배지: Kakao 사용자만 표시 (로딩 중에도 표시) */}
              {usage === null ? (
                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                  로딩중...
                </span>
              ) : !usage.isUnlimited ? (
                <span className={`text-xs px-2 py-1 rounded-full ${usage.remaining > 0
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-red-100 text-red-700'
                  }`}>
                  남은 변환: {usage.remaining}/{usage.maxLimit}
                </span>
              ) : null}
              <button onClick={() => signOut()} className="text-sm text-red-600 hover:text-red-800">로그아웃</button>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">스캔/이미지 PDF를 업로드하면 OCR로 텍스트를 추출하고 AI가 거래내역을 파싱합니다.</p>
          <div className="mt-4">
            <a href="/bank-rules" className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium">
              <DocumentIcon />
              은행 파싱 규칙 보기
            </a>
          </div>
        </div>

        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">파일 업로드 (PDF/이미지/엑셀)</h2>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${fileUpload.dragOver ? "border-green-500 bg-green-50" : "border-gray-300 hover:border-blue-500 hover:bg-blue-50"
              }`}
            onDragOver={fileUpload.handleDragOver}
            onDragLeave={fileUpload.handleDragLeave}
            onDrop={fileUpload.handleDrop}
            onClick={() => document.getElementById("fileInput")?.click()}
          >
            <input id="fileInput" type="file" accept={SUPPORTED_FILE_EXTENSIONS} className="hidden" onChange={fileUpload.handleFileChange} />
            <p className="text-lg text-gray-600 mb-2">파일을 끌어다 놓거나 클릭하세요</p>
            <p className="text-sm text-gray-400">지원 형식: .pdf, .png, .jpg, .jpeg, .xlsx, .xls</p>
          </div>

          {fileUpload.hasFile && (
            <div className="mt-4 bg-gray-50 p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium text-green-600">선택된 파일: {fileUpload.file!.name}</span>
                <button onClick={fileUpload.clearFiles} className="text-sm text-red-600 hover:text-red-800">삭제</button>
              </div>
              {fileUpload.fileTypeInfo && <FileTypeInfoDisplay info={fileUpload.fileTypeInfo} />}
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
            <span className="text-sm font-medium text-gray-700">캐시 무시하고 다시 파싱</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">이전에 파싱한 결과가 잘못된 경우 체크하세요.</p>
        </div>

        {/* 실행 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={!ocr.isIdle}
          className={`w-full py-4 rounded-lg text-white font-medium transition ${!ocr.isIdle ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
        >
          {ocr.isExtracting ? (ocr.isAiParsing ? `AI 파싱 중... (${timer.elapsedTime}초)` : `OCR 처리 중... (${timer.elapsedTime}초)`) : "OCR 추출 시작"}
        </button>

        {/* 결과 메시지 */}
        {ocr.result && ocr.isIdle && (
          <div className={`mt-4 p-4 rounded-lg ${ocr.result.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {ocr.result.message}
          </div>
        )}

        {/* OCR 처리 중 상태 */}
        {ocr.isExtracting && (
          <div className="mt-4 p-4 rounded-lg bg-blue-100 text-blue-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SpinnerIcon />
                <span className="font-medium">{ocr.isAiParsing ? "AI 파싱 중..." : "OCR 텍스트 추출 중..."}</span>
                <span className="text-sm">({timer.elapsedTime}초)</span>
              </div>
              <button onClick={ocr.abort} className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded hover:bg-red-600 transition">중단</button>
            </div>
            {ocr.isAiParsing && (
              <p className="mt-3 ml-7 text-sm">
                {usage?.isUnlimited
                  ? "Gemini AI가 거래내역을 분석하고 있습니다. 파일 크기에 따라 1~3분 정도 소요될 수 있습니다."
                  : "거래내역을 분석하고 있습니다. 파일 크기에 따라 1~3분 정도 소요될 수 있습니다."
                }
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ===================== 하위 컴포넌트들 =====================

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3C7.58 3 4 5.79 4 9.24c0 2.22 1.5 4.14 3.75 5.19-.16.59-.59 2.13-.67 2.45-.11.41.15.41.32.29.21-.14 2.43-1.64 2.83-1.91.56.08 1.14.12 1.77.12 4.42 0 8-2.79 8-6.14S16.42 3 12 3z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function DocumentTypeInfo({ type }: { type: string }) {
  const isTextBased = type === "text-based";
  return (
    <div className={`mb-4 p-4 rounded-lg border ${isTextBased ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}`}>
      <div className={`flex items-center gap-2 ${isTextBased ? "text-green-800" : "text-orange-800"}`}>
        <DocumentIcon />
        <span className="font-medium">
          {type === "text-based" ? "텍스트 기반 PDF" : type === "image-based" ? "이미지/스캔 기반 PDF" : "이미지 파일"}
        </span>
      </div>
      <p className={`mt-2 text-sm ${isTextBased ? "text-green-700" : "text-orange-700"}`}>
        {type === "text-based" ? "PDF에서 텍스트를 직접 추출했습니다. (OCR 불필요)" :
          type === "image-based" ? "스캔/이미지 PDF를 OCR로 텍스트를 추출했습니다." :
            "이미지 파일을 OCR로 텍스트를 추출했습니다."}
      </p>
    </div>
  );
}

function AiCostInfo({ cost }: { cost: { inputTokens: number; outputTokens: number; usd: number; krw: number } }) {
  return (
    <div className="mb-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
      <div className="flex items-center gap-2 text-blue-800">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium">AI 파싱 비용</span>
      </div>
      <div className="mt-2 text-sm text-blue-700">
        <p>토큰 사용량: 입력 {(cost.inputTokens ?? 0).toLocaleString()}개 / 출력 {(cost.outputTokens ?? 0).toLocaleString()}개</p>
        <p>예상 비용: ${(cost.usd ?? 0).toFixed(6)} (약 {(cost.krw ?? 0).toFixed(2)}원)</p>
      </div>
    </div>
  );
}

function AccountInfoForm({ value, onChange }: { value: AccountInfo; onChange: (v: AccountInfo) => void }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h3 className="text-sm font-bold text-gray-700 mb-4">📋 계좌 정보 (엑셀 상단에 표시됨)</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">금융기관</label>
          <input
            type="text"
            value={value.bankName}
            onChange={(e) => onChange({ ...value, bankName: e.target.value })}
            placeholder="예: 국민은행"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">계좌주명</label>
          <input
            type="text"
            value={value.accountHolder}
            onChange={(e) => onChange({ ...value, accountHolder: e.target.value })}
            placeholder="예: 홍길동"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">계좌번호</label>
          <input
            type="text"
            value={value.accountNumber}
            onChange={(e) => onChange({ ...value, accountNumber: e.target.value })}
            placeholder="예: 123-456-789012"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">조회기간</label>
          <input
            type="text"
            value={value.queryPeriod}
            onChange={(e) => onChange({ ...value, queryPeriod: e.target.value })}
            placeholder="예: 2024.01.01 ~ 2024.12.31"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-black"
          />
        </div>
      </div>
    </div>
  );
}

function HighlightSettings({
  threshold, color, columns,
  selectedDepositColumn, selectedWithdrawalColumn,
  onThresholdChange, onColorChange,
  onDepositColumnChange, onWithdrawalColumnChange,
}: {
  threshold: string;
  color: string;
  columns: string[];
  selectedDepositColumn: string;
  selectedWithdrawalColumn: string;
  onThresholdChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onDepositColumnChange: (v: string) => void;
  onWithdrawalColumnChange: (v: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="grid grid-cols-2 gap-6 mb-4">
        <div>
          <label className="block text-sm font-bold text-black mb-2">기준 금액 (만원)</label>
          <input
            type="number"
            value={threshold ? Math.round(parseInt(threshold) / 10000) : ""}
            onChange={(e) => onThresholdChange(e.target.value ? String(parseInt(e.target.value) * 10000) : "")}
            placeholder="예: 100"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-bold text-black"
          />
          <p className="text-xs font-semibold text-gray-700 mt-1">100 = 100만원</p>
        </div>
        <div>
          <label className="block text-sm font-bold text-black mb-2">하이라이트 색상</label>
          <select
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-bold text-black"
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <option key={c.value} value={c.value}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm font-bold text-gray-600 mb-3">컬럼 자동 감지가 안 될 경우 수동 선택:</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-blue-700 mb-2">입금 컬럼</label>
            <select
              value={selectedDepositColumn}
              onChange={(e) => onDepositColumnChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-black"
            >
              <option value="">자동 감지</option>
              {columns.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-red-700 mb-2">출금 컬럼</label>
            <select
              value={selectedWithdrawalColumn}
              onChange={(e) => onWithdrawalColumnChange(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-black"
            >
              <option value="">자동 감지</option>
              {columns.map((col) => <option key={col} value={col}>{col}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileTypeInfoDisplay({ info }: { info: { documentType: string | null; pageCount?: number; rowCount?: number; sheetCount?: number; message: string; estimatedTime: string | null; warning: string | null; isChecking: boolean } }) {
  if (info.isChecking) {
    return (
      <div className="mt-3 p-3 rounded-lg bg-gray-100 text-gray-600 flex items-center gap-2">
        <SpinnerIcon />
        <span>파일 분석 중...</span>
      </div>
    );
  }

  const bgClass = info.documentType === "text-based" ? "bg-green-100 text-green-800" :
    info.documentType === "excel" ? "bg-emerald-100 text-emerald-800" :
      info.documentType === "image-based" ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800";

  return (
    <div className={`mt-3 p-3 rounded-lg ${bgClass}`}>
      <div className="flex items-center gap-2 mb-1">
        <DocumentIcon />
        <span className="font-semibold">{info.message}</span>
      </div>
      {info.pageCount && <p className="text-sm ml-7">총 {info.pageCount}페이지</p>}
      {info.rowCount && <p className="text-sm ml-7">총 {info.rowCount}행 (시트 {info.sheetCount}개)</p>}
      {info.estimatedTime && <p className="text-sm ml-7">예상 소요시간: {info.estimatedTime}</p>}
      {info.warning && <p className="text-sm ml-7 mt-1 font-medium text-orange-600">⚠️ {info.warning}</p>}
    </div>
  );
}

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

function TransactionTable({
  transactions, columns, columnTypes, threshold, color,
  selectedDepositColumn, selectedWithdrawalColumn, startIndex,
  onUpdate, onDelete,
}: {
  transactions: TransactionRow[];
  columns: string[];
  columnTypes: ColumnTypeInfo[];
  threshold: number;
  color: string;
  selectedDepositColumn: string;
  selectedWithdrawalColumn: string;
  startIndex: number;
  onUpdate: (index: number, field: string, value: string | number) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className="overflow-auto max-h-[500px] border rounded">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-300">
            <th className="border p-2 text-center w-10 font-bold text-black">#</th>
            {columnTypes.map((ct) => (
              <th
                key={ct.name}
                className={`border p-2 font-bold ${ct.isDeposit ? "text-blue-700 text-right" :
                  ct.isWithdrawal ? "text-red-700 text-right" :
                    ct.isBalance ? "text-green-700 text-right" :
                      ct.isAmount ? "text-purple-700 text-right" :
                        "text-left text-black"
                  } ${ct.isDate || ct.isTime ? "w-28" : ct.isNumeric ? "w-28" : ct.isDescription ? "min-w-32" : "w-20"}`}
              >
                {COLUMN_LABELS[ct.name] || ct.name}
              </th>
            ))}
            <th className="border p-2 text-center w-14 font-bold text-black">삭제</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, pageIndex) => {
            const index = startIndex + pageIndex;
            const isHighlighted = shouldHighlight(tx, threshold, selectedDepositColumn, selectedWithdrawalColumn);

            return (
              <tr key={index} style={{ backgroundColor: isHighlighted ? `#${color}` : "transparent" }}>
                <td className="border p-1 text-center text-gray-500">{index + 1}</td>
                {columns.map((col) => {
                  const ct = columnTypes.find(c => c.name === col);
                  const value = tx[col];
                  const displayValue = ct?.isNumeric && typeof value === "number" && value !== 0 ? value.toLocaleString() : (value || "");

                  return (
                    <td key={col} className="border p-1">
                      <input
                        type="text"
                        value={displayValue}
                        onChange={(e) => {
                          const newValue = ct?.isNumeric ? e.target.value.replace(/,/g, "") : e.target.value;
                          onUpdate(index, col, newValue);
                        }}
                        className={`w-full px-2 py-1 border rounded font-medium ${ct?.isDeposit ? "text-right text-blue-700" :
                          ct?.isWithdrawal ? "text-right text-red-700" :
                            ct?.isBalance ? "text-right text-green-700" :
                              ct?.isAmount ? "text-right text-purple-700" :
                                ct?.isNumeric ? "text-right text-black" : "text-left text-black"
                          }`}
                      />
                    </td>
                  );
                })}
                <td className="border p-1 text-center">
                  <button onClick={() => onDelete(index)} className="text-red-600 hover:text-red-800 font-bold">X</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
