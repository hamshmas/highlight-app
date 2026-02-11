import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { rateLimit } from "@/lib/rate-limit";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST — 토스페이먼츠 웹훅 수신
 */
export async function POST(request: NextRequest) {
  // Rate limit: 분당 30회 (IP 기반)
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const { allowed } = rateLimit(`webhook:${clientIp}`, 30, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // 웹훅 시크릿 검증
  const webhookSecret = process.env.TOSS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("TOSS_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("x-toss-signature");
  if (!signature) {
    console.error("Missing Toss webhook signature");
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  // Raw body를 Buffer로 읽어 HMAC 계산 (바이트 정확성 보장)
  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(bodyBuffer)
    .digest("base64");

  if (!crypto.timingSafeEqual(
    Buffer.from(signature, "base64"),
    Buffer.from(expectedSignature, "base64")
  )) {
    console.error("Invalid Toss webhook signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 서명 검증 후 body 파싱
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { eventType, data } = JSON.parse(bodyBuffer.toString("utf-8"));

    console.log("Toss webhook received:", eventType, data?.orderId);

    switch (eventType) {
      case "PAYMENT_STATUS_CHANGED": {
        if (data?.orderId) {
          await supabase
            .from("payment_history")
            .update({
              status: data.status === "DONE" ? "success" : "failed",
              toss_response: data,
            })
            .eq("order_id", data.orderId);
        }
        break;
      }
      default:
        console.log("Unhandled webhook event:", eventType);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
