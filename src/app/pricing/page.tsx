"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { PlanCard } from "@/components/subscription/PlanCard";
import type { PlanType } from "@/types/subscription";

const PLANS: {
  plan: PlanType;
  label: string;
  price: number;
  description: string;
  features: string[];
  isPopular?: boolean;
}[] = [
  {
    plan: "free",
    label: "Free",
    price: 0,
    description: "무료 체험",
    features: ["월 3건 변환", "기본 PDF 지원"],
  },
  {
    plan: "basic",
    label: "Basic",
    price: 29000,
    description: "소규모 업무용",
    features: ["월 50건 변환", "모든 파일 형식 지원", "이메일 지원"],
  },
  {
    plan: "pro",
    label: "Pro",
    price: 59000,
    description: "전문가용",
    features: ["월 200건 변환", "모든 파일 형식 지원", "우선 지원"],
    isPopular: true,
  },
  {
    plan: "enterprise",
    label: "Enterprise",
    price: 99000,
    description: "대규모 업무용",
    features: ["무제한 변환", "API 접근", "모든 파일 형식 지원", "전담 지원"],
  },
];

export default function PricingPage() {
  const { data: session, status } = useSession();
  const [currentPlan, setCurrentPlan] = useState<PlanType>("free");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      fetch("/api/usage")
        .then((res) => res.json())
        .then((data) => {
          if (data.plan) setCurrentPlan(data.plan);
        })
        .catch(console.error);
    }
  }, [session]);

  const handleSelectPlan = async (plan: PlanType) => {
    if (!session) {
      window.location.href = "/";
      return;
    }

    if (plan === "free") return;

    setLoading(true);
    setError(null);

    try {
      // 1. 서버에서 customerKey 가져오기
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "구독 시작 실패");
      }

      // 2. 토스페이먼츠 SDK로 카드 등록 팝업
      const clientKey = data.clientKey;
      if (!clientKey) {
        throw new Error("토스페이먼츠 설정이 필요합니다.");
      }

      const { loadTossPayments } = await import("@tosspayments/tosspayments-sdk");
      const tossPayments = await loadTossPayments(clientKey);

      // 토스 SDK v2: payment 인스턴스 생성 후 billingAuth 요청
      const payment = tossPayments.payment({ customerKey: data.customerKey });

      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: `${window.location.origin}/pricing/success?plan=${plan}`,
        failUrl: `${window.location.origin}/pricing/fail?plan=${plan}`,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("사용자가 결제를 취소")) {
        // 사용자가 팝업 닫음 — 에러 아님
      } else {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="text-center mb-12">
          <Link href="/" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
            &larr; 메인으로
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">요금제</h1>
          <p className="text-gray-600 mt-2">
            업무에 맞는 요금제를 선택하세요
          </p>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 text-red-800 rounded-lg text-center">
            {error}
          </div>
        )}

        {/* 플랜 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((p) => (
            <PlanCard
              key={p.plan}
              {...p}
              currentPlan={currentPlan}
              onSelect={handleSelectPlan}
              loading={loading}
            />
          ))}
        </div>

        {/* 하단 안내 */}
        <div className="mt-12 text-center text-sm text-gray-500">
          <p>모든 유료 플랜은 월 단위 자동 결제됩니다.</p>
          <p className="mt-1">언제든지 구독을 취소할 수 있으며, 남은 기간까지 서비스를 이용할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
