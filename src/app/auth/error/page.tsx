"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  let errorMessage = "로그인 중 오류가 발생했습니다.";

  if (error === "AccessDenied") {
    errorMessage =
      "접근이 거부되었습니다. sjinlaw.com 도메인 계정으로만 로그인할 수 있습니다.";
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-4">로그인 실패</h1>
        <p className="text-gray-600 mb-6">{errorMessage}</p>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition"
        >
          다시 시도
        </Link>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">로딩 중...</div>}>
      <ErrorContent />
    </Suspense>
  );
}
