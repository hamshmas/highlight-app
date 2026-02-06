import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { eventType, data } = body;

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
