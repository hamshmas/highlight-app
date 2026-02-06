"use client";

import Link from "next/link";
import type { PlanType } from "@/types/subscription";

interface UsageData {
  provider: string;
  remaining: number;
  maxLimit: number;
  isUnlimited: boolean;
  used: number;
  plan: PlanType;
  periodEnd: string | null;
  cardLast4: string | null;
}

interface SubscriptionBadgeProps {
  usage: UsageData | null;
  onManageClick: () => void;
}

const PLAN_COLORS: Record<PlanType, string> = {
  free: "bg-gray-100 text-gray-700",
  basic: "bg-blue-100 text-blue-700",
  pro: "bg-purple-100 text-purple-700",
  enterprise: "bg-amber-100 text-amber-700",
};

const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function SubscriptionBadge({ usage, onManageClick }: SubscriptionBadgeProps) {
  if (usage === null) {
    return (
      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500">
        로딩중...
      </span>
    );
  }

  if (usage.isUnlimited) {
    return null; // 관리자(Google)는 배지 표시 안함
  }

  const plan = usage.plan || "free";
  const planColor = PLAN_COLORS[plan];

  return (
    <div className="flex items-center gap-2">
      {/* 플랜 배지 */}
      <button
        onClick={onManageClick}
        className={`text-xs px-2 py-1 rounded-full font-medium ${planColor} hover:opacity-80 transition`}
      >
        {PLAN_LABELS[plan]}
      </button>

      {/* 사용량 배지 */}
      <span
        className={`text-xs px-2 py-1 rounded-full ${
          usage.remaining > 0
            ? "bg-blue-100 text-blue-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        남은 변환: {usage.remaining}/{usage.maxLimit}
      </span>

      {/* 업그레이드 링크 (Free + 남은 변환 0) */}
      {plan === "free" && usage.remaining === 0 && (
        <Link
          href="/pricing"
          className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 transition"
        >
          업그레이드
        </Link>
      )}
    </div>
  );
}
