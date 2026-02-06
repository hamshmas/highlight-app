import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// 관리자 권한 확인 (sjinlaw.com 도메인만)
function isAdmin(email: string | null | undefined): boolean {
  return !!email && email.endsWith("@sjinlaw.com");
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "feedback";

  try {
    let query;

    switch (table) {
      case "feedback":
        query = supabase
          .from("feedback")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        break;
      case "user_usage":
        query = supabase
          .from("user_usage")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(100);
        break;
      case "activity_logs":
        query = supabase
          .from("activity_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        break;
      case "subscriptions":
        query = supabase
          .from("subscriptions")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(100);
        break;
      case "payment_history":
        query = supabase
          .from("payment_history")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        break;
      default:
        return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    }

    const { data, error } = await query;

    if (error) {
      console.error("Query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, table });
  } catch (error) {
    console.error("Admin API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// 사용량 수정 (max_limit 증가)
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { userId, provider, maxLimit } = await request.json();

    if (!userId || !provider || typeof maxLimit !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { error } = await supabase
      .from("user_usage")
      .update({ max_limit: maxLimit, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("provider", provider);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
