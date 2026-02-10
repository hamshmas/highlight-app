import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { chargeBillingKey } from "@/lib/tosspayments";
import {
  PLAN_LIMITS,
  generateOrderId,
  getKSTString,
  getPlanLimit,
} from "@/lib/subscription";
import type { PlanType } from "@/types/subscription";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST — 일일 자동 결제 크론잡
 * 만료된 active 구독: 자동 결제 + 갱신
 * 만료된 cancelled 구독: free로 다운그레이드
 */
export async function POST(request: NextRequest) {
  // Vercel Cron 인증
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const now = new Date();
  const results = { renewed: 0, downgraded: 0, failed: 0 };

  try {
    // 1. 만료된 active 구독 조회 (자동 결제 대상)
    const { data: activeExpired } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("status", "active")
      .neq("plan", "free")
      .not("billing_key", "is", null)
      .lt("current_period_end", now.toISOString());

    if (activeExpired) {
      for (const sub of activeExpired) {
        const plan = sub.plan as PlanType;
        const planInfo = PLAN_LIMITS[plan];
        if (!planInfo) continue;

        const orderId = generateOrderId(plan);
        const newPeriodStart = new Date();
        const newPeriodEnd = new Date();
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

        try {
          const payment = await chargeBillingKey(
            sub.billing_key,
            sub.customer_key,
            orderId,
            planInfo.price,
            `하이라이트 ${planInfo.label} 구독 갱신`
          );

          // 결제 성공: 구독 갱신
          await supabase
            .from("subscriptions")
            .update({
              current_period_start: newPeriodStart.toISOString(),
              current_period_end: newPeriodEnd.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);

          // 결제 내역 기록
          await supabase.from("payment_history").insert({
            user_id: sub.user_id,
            provider: sub.provider,
            subscription_id: sub.id,
            order_id: orderId,
            payment_key: payment.paymentKey,
            amount: planInfo.price,
            plan,
            status: "success",
            toss_response: payment as any,
            created_at_kst: getKSTString(),
          });

          // 사용량 리셋
          await supabase
            .from("user_usage")
            .update({
              usage_count: 0,
              period_start: newPeriodStart.toISOString(),
              period_end: newPeriodEnd.toISOString(),
              max_limit: getPlanLimit(plan),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", sub.user_id)
            .eq("provider", sub.provider);

          results.renewed++;
        } catch (paymentError) {
          // 결제 실패: past_due로 변경
          await supabase
            .from("subscriptions")
            .update({
              status: "past_due",
              updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);

          await supabase.from("payment_history").insert({
            user_id: sub.user_id,
            provider: sub.provider,
            subscription_id: sub.id,
            order_id: orderId,
            amount: planInfo.price,
            plan,
            status: "failed",
            failure_reason: paymentError instanceof Error ? paymentError.message : "Unknown",
            created_at_kst: getKSTString(),
          });

          results.failed++;
        }
      }
    }

    // 2. 만료된 cancelled 구독 → free로 다운그레이드
    const { data: cancelledExpired } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("status", "cancelled")
      .lt("current_period_end", now.toISOString());

    if (cancelledExpired) {
      for (const sub of cancelledExpired) {
        await supabase
          .from("subscriptions")
          .update({
            plan: "free",
            status: "expired",
            billing_key: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sub.id);

        // user_usage를 free 한도로 변경
        await supabase
          .from("user_usage")
          .update({
            max_limit: PLAN_LIMITS.free.maxLimit,
            period_start: null,
            period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", sub.user_id)
          .eq("provider", sub.provider);

        results.downgraded++;
      }
    }

    console.log("Cron billing results:", results);
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Cron billing error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
