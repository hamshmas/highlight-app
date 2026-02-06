"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function FailContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") || "UNKNOWN";
  const message = searchParams.get("message") || "결제 중 오류가 발생했습니다.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">결제 실패</h1>
        <p className="text-gray-600 mb-2">{message}</p>
        <p className="text-sm text-gray-400 mb-6">오류 코드: {code}</p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/pricing"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-medium"
          >
            다시 시도
          </Link>
          <Link
            href="/"
            className="inline-block bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300 transition font-medium"
          >
            메인으로
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PricingFailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-gray-500">로딩 중...</div>
        </div>
      }
    >
      <FailContent />
    </Suspense>
  );
}
