import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createClient } from "@supabase/supabase-js";
import { issueBillingKey, chargeBillingKey } from "@/lib/tosspayments";
import {
  PLAN_LIMITS,
  generateCustomerKey,
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
 * POST — authKey로 billingKey 발급 + 첫 결제
 */
export async function POST(request: NextRequest) {
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
    const { authKey, plan } = await request.json();

    if (!authKey || !plan) {
      return NextResponse.json({ error: "Missing authKey or plan" }, { status: 400 });
    }

    const planInfo = PLAN_LIMITS[plan as PlanType];
    if (!planInfo || plan === "free") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const customerKey = generateCustomerKey(userId, provider);

    // 1. billingKey 발급
    const billingResult = await issueBillingKey(authKey, customerKey);

    // 카드 마지막 4자리 추출
    const cardLast4 = billingResult.cardNumber?.slice(-4) || null;
    const cardCompany = billingResult.cardCompany || null;

    // 2. 첫 결제 실행
    const orderId = generateOrderId(plan as PlanType);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    let paymentResult;
    try {
      paymentResult = await chargeBillingKey(
        billingResult.billingKey,
        customerKey,
        orderId,
        planInfo.price,
        `하이라이트 ${planInfo.label} 구독`
      );
    } catch (paymentError) {
      // 결제 실패 기록
      await supabase.from("payment_history").insert({
        user_id: userId,
        provider,
        order_id: orderId,
        amount: planInfo.price,
        plan,
        status: "failed",
        failure_reason: paymentError instanceof Error ? paymentError.message : "Unknown error",
        created_at_kst: getKSTString(),
      });

      return NextResponse.json({
        error: "결제에 실패했습니다. 다시 시도해주세요.",
        detail: paymentError instanceof Error ? paymentError.message : "Unknown error",
      }, { status: 400 });
    }

    // 3. 구독 정보 upsert
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          provider,
          plan,
          status: "active",
          billing_key: billingResult.billingKey,
          customer_key: customerKey,
          card_last4: cardLast4,
          card_company: cardCompany,
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancelled_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" }
      )
      .select()
      .single();

    if (subError) {
      console.error("Subscription upsert error:", subError);
    }

    // 4. 결제 내역 기록
    await supabase.from("payment_history").insert({
      user_id: userId,
      provider,
      subscription_id: subscription?.id || null,
      order_id: orderId,
      payment_key: paymentResult.paymentKey,
      amount: planInfo.price,
      plan,
      status: "success",
      toss_response: paymentResult as any,
      created_at_kst: getKSTString(),
    });

    // 5. user_usage의 max_limit 업데이트 + 사용량 리셋
    const maxLimit = getPlanLimit(plan as PlanType);
    const { error: usageError } = await supabase
      .from("user_usage")
      .upsert(
        {
          user_id: userId,
          provider,
          usage_count: 0,
          max_limit: maxLimit,
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" }
      );

    if (usageError) {
      console.error("Usage update error:", usageError);
    }

    return NextResponse.json({
      success: true,
      plan,
      periodEnd: periodEnd.toISOString(),
      cardLast4,
      cardCompany,
    });
  } catch (error) {
    console.error("Billing key route error:", error);
    return NextResponse.json(
      { error: "결제 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
