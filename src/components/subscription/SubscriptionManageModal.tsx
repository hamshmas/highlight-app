"use client";

import { useState } from "react";
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

interface SubscriptionManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  usage: UsageData | null;
  onUsageRefresh: () => void;
}

const PLAN_LABELS: Record<PlanType, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function SubscriptionManageModal({
  isOpen,
  onClose,
  usage,
  onUsageRefresh,
}: SubscriptionManageModalProps) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  if (!isOpen || !usage) return null;

  const plan = usage.plan || "free";
  const isPaid = plan !== "free";

  const handleCancel = async () => {
    if (!confirm("정말 구독을 취소하시겠습니까? 남은 기간까지 서비스를 이용할 수 있습니다.")) {
      return;
    }

    setCancelling(true);
    setCancelMessage(null);

    try {
      const res = await fetch("/api/subscription/cancel", { method: "POST" });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "취소 실패");

      setCancelMessage(data.message);
      onUsageRefresh();
    } catch (err) {
      setCancelMessage(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-900">구독 관리</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
          >
            &times;
          </button>
        </div>

        {/* 현재 플랜 */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">현재 플랜</span>
            <span className="font-bold text-gray-900">{PLAN_LABELS[plan]}</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">사용량</span>
            <span className="text-gray-900">
              {usage.used} / {usage.maxLimit}건
            </span>
          </div>
          {usage.periodEnd && (
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">다음 갱신일</span>
              <span className="text-gray-900">
                {new Date(usage.periodEnd).toLocaleDateString("ko-KR")}
              </span>
            </div>
          )}
          {usage.cardLast4 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">결제 카드</span>
              <span className="text-gray-900">**** {usage.cardLast4}</span>
            </div>
          )}
        </div>

        {/* 사용량 프로그레스 바 */}
        <div className="mb-4">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                usage.used / usage.maxLimit > 0.8 ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(100, (usage.used / usage.maxLimit) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            남은 변환: {usage.remaining}건
          </p>
        </div>

        {/* 알림 메시지 */}
        {cancelMessage && (
          <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded-lg text-sm">
            {cancelMessage}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="flex flex-col gap-2">
          <Link
            href="/pricing"
            className="w-full py-2 text-center bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
            onClick={onClose}
          >
            {isPaid ? "플랜 변경" : "업그레이드"}
          </Link>

          {isPaid && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full py-2 text-center bg-gray-100 text-red-600 rounded-lg hover:bg-gray-200 transition font-medium disabled:opacity-50"
            >
              {cancelling ? "취소 처리 중..." : "구독 취소"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
