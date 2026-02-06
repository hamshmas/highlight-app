import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createClient } from "@supabase/supabase-js";
import {
  getUserSubscription,
  PLAN_LIMITS,
  generateCustomerKey,
} from "@/lib/subscription";
import type { PlanType } from "@/types/subscription";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * GET — 현재 구독 조회
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = (session as any).provider || "google";
  const userId = (session as any).providerAccountId || session.user.email || "unknown";

  const subscription = await getUserSubscription(userId, provider);

  if (!subscription) {
    return NextResponse.json({
      plan: "free",
      status: "active",
      ...PLAN_LIMITS.free,
    });
  }

  const planInfo = PLAN_LIMITS[subscription.plan as PlanType] || PLAN_LIMITS.free;

  return NextResponse.json({
    ...subscription,
    ...planInfo,
  });
}

/**
 * POST — 구독 시작 (customerKey 생성, 프론트에서 토스 SDK 호출에 필요)
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = (session as any).provider || "google";
  const userId = (session as any).providerAccountId || session.user.email || "unknown";

  try {
    const { plan } = await request.json();

    if (!plan || !PLAN_LIMITS[plan as PlanType] || plan === "free") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const customerKey = generateCustomerKey(userId, provider);

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    // 기존 구독 확인
    const existing = await getUserSubscription(userId, provider);
    if (existing && existing.status === "active" && existing.plan !== "free") {
      return NextResponse.json({
        error: "이미 활성 구독이 있습니다. 기존 구독을 취소한 후 새 플랜을 선택하세요.",
      }, { status: 400 });
    }

    return NextResponse.json({
      customerKey,
      plan,
      amount: PLAN_LIMITS[plan as PlanType].price,
      clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    });
  } catch (error) {
    console.error("Subscription POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
