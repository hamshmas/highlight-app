import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createClient } from "@supabase/supabase-js";
import { getUserSubscription } from "@/lib/subscription";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST — 구독 취소 (기간 만료까지 유지)
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = (session as any).provider;
  const userId = (session as any).providerAccountId || session.user?.email;

  if (!provider || !userId) {
    return NextResponse.json({ error: "세션 정보가 유효하지 않습니다. 다시 로그인해주세요." }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const subscription = await getUserSubscription(userId, provider);

    if (!subscription || subscription.plan === "free") {
      return NextResponse.json({ error: "활성 구독이 없습니다." }, { status: 400 });
    }

    if (subscription.status === "cancelled") {
      return NextResponse.json({ error: "이미 취소된 구독입니다." }, { status: 400 });
    }

    // 구독 상태를 cancelled로 변경 (기간 만료까지 서비스 유지)
    const { error } = await supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);

    if (error) {
      console.error("Cancel subscription error:", error);
      return NextResponse.json({ error: "구독 취소 처리 중 오류" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `구독이 취소되었습니다. ${subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString("ko-KR") + "까지" : ""} 기존 플랜을 이용하실 수 있습니다.`,
      periodEnd: subscription.current_period_end,
    });
  } catch (error) {
    console.error("Cancel route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
