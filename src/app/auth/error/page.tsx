"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "next-auth/react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  let errorMessage = "로그인 중 오류가 발생했습니다.";
  let showAccountSwitch = true;

  if (error === "AccessDenied") {
    errorMessage =
      "접근이 거부되었습니다. sjinlaw.com 도메인 계정으로만 로그인할 수 있습니다.";
  } else if (error === "OAuthAccountNotLinked") {
    errorMessage = "이 이메일은 다른 로그인 방법으로 연결되어 있습니다.";
  }

  const handleSwitchAccount = () => {
    signIn("google", { callbackUrl: "/" }, { prompt: "select_account" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-4">로그인 실패</h1>
        <p className="text-gray-600 mb-6">{errorMessage}</p>
        <div className="flex flex-col gap-3">
          {showAccountSwitch && (
            <button
              onClick={handleSwitchAccount}
              className="w-full bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 transition"
            >
              다른 계정으로 로그인
            </button>
          )}
          <Link
            href="/"
            className="w-full inline-block bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition"
          >
            홈으로 돌아가기
          </Link>
        </div>
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
