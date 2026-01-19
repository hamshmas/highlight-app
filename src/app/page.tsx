"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useCallback } from "react";

const COLORS = [
  { value: "FFFF00", name: "노란색", bg: "#FFFF00" },
  { value: "FF9999", name: "빨간색", bg: "#FF9999" },
  { value: "99FF99", name: "초록색", bg: "#99FF99" },
  { value: "99CCFF", name: "파란색", bg: "#99CCFF" },
  { value: "FFCC99", name: "주황색", bg: "#FFCC99" },
  { value: "CC99FF", name: "보라색", bg: "#CC99FF" },
  { value: "99FFFF", name: "청록색", bg: "#99FFFF" },
];

export default function Home() {
  const { data: session, status } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [threshold, setThreshold] = useState("");
  const [color, setColor] = useState("FFFF00");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(xlsx|xls|csv|pdf)$/i.test(f.name)
    );
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
  };

  const handleSubmit = async () => {
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
        // PDF와 Excel 파일에 따라 다른 API 사용
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        const apiUrl = isPdf ? "/api/highlight-pdf" : "/api/highlight";

        const res = await fetch(apiUrl, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "오류가 발생했습니다");
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

  // 로그인 완료
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
        </div>

        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            파일 업로드 (여러 파일 선택 가능)
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
              accept=".xlsx,.xls,.csv,.pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-lg text-gray-600 mb-2">
              파일을 끌어다 놓거나 클릭하세요
            </p>
            <p className="text-sm text-gray-400">
              지원 형식: .xlsx, .xls, .csv, .pdf
            </p>
            <p className="text-xs text-gray-400 mt-1">
              (PDF는 텍스트 기반만 지원, 스캔본 불가)
            </p>
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
        </div>

        {/* 설정 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                기준 금액 (원)
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="예: 1000000"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                이 금액 이상의 입금/출금 거래가 하이라이트됩니다.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                하이라이트 색상
              </label>
              <select
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
          disabled={processing}
          className={`w-full py-4 rounded-lg text-white font-medium transition ${
            processing
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {processing ? "처리 중..." : "하이라이트 처리 및 다운로드"}
        </button>

        {/* 결과 메시지 */}
        {result && (
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
      </div>
    </div>
  );
}
