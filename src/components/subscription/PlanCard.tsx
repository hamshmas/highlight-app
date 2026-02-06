"use client";

import type { PlanType } from "@/types/subscription";

interface PlanCardProps {
  plan: PlanType;
  label: string;
  price: number;
  description: string;
  features: string[];
  currentPlan: PlanType;
  isPopular?: boolean;
  onSelect: (plan: PlanType) => void;
  loading?: boolean;
}

export function PlanCard({
  plan,
  label,
  price,
  description,
  features,
  currentPlan,
  isPopular,
  onSelect,
  loading,
}: PlanCardProps) {
  const isCurrent = currentPlan === plan;
  const isDowngrade = getPlanOrder(plan) < getPlanOrder(currentPlan);

  return (
    <div
      className={`relative bg-white rounded-xl shadow-md p-6 flex flex-col ${
        isPopular ? "ring-2 ring-blue-500" : "border border-gray-200"
      }`}
    >
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          인기
        </div>
      )}

      <h3 className="text-xl font-bold text-gray-900">{label}</h3>
      <p className="text-sm text-gray-500 mt-1">{description}</p>

      <div className="mt-4 mb-6">
        {price === 0 ? (
          <div className="text-3xl font-bold text-gray-900">무료</div>
        ) : (
          <div>
            <span className="text-3xl font-bold text-gray-900">
              {price.toLocaleString()}
            </span>
            <span className="text-gray-500 text-sm">원/월</span>
          </div>
        )}
      </div>

      <ul className="flex-1 space-y-3 mb-6">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
            <svg
              className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={() => onSelect(plan)}
        disabled={isCurrent || loading}
        className={`w-full py-3 rounded-lg font-medium transition ${
          isCurrent
            ? "bg-gray-100 text-gray-500 cursor-not-allowed"
            : isDowngrade
            ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
            : isPopular
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-gray-900 text-white hover:bg-gray-800"
        } ${loading ? "opacity-50 cursor-wait" : ""}`}
      >
        {loading
          ? "처리 중..."
          : isCurrent
          ? "현재 플랜"
          : plan === "free"
          ? "무료로 시작"
          : "구독하기"}
      </button>
    </div>
  );
}

function getPlanOrder(plan: PlanType): number {
  const order: Record<PlanType, number> = {
    free: 0,
    basic: 1,
    pro: 2,
    enterprise: 3,
  };
  return order[plan] ?? 0;
}
