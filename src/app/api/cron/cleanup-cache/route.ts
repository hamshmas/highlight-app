import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST — 만료된 파싱 캐시 자동 정리 크론잡
 * expires_at이 지난 캐시 레코드를 삭제
 */
export async function POST(request: NextRequest) {
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

  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("parsing_cache")
      .delete()
      .lt("expires_at", now)
      .select("id");

    if (error) {
      console.error("Cache cleanup error:", error);
      return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
    }

    const deletedCount = data?.length || 0;
    console.log(`Cache cleanup: deleted ${deletedCount} expired records`);

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error("Cache cleanup cron error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
