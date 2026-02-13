import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * GET: 놓친 사용량 확인 (dry run)
 * POST: 실제 보정 적용
 *
 * 버그: image-based PDF와 direct image 경로에서 incrementUsage 호출 누락
 * 대상: activity_logs에 ocr_extract로 기록됐지만 user_usage에 미반영된 건
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email?.endsWith("@sjinlaw.com")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    // 1. activity_logs에서 전체 실제 사용 횟수 집계 (관리자 제외)
    // ocr_extract + ocr_extract_cached = 실제 사용 횟수
    const { data: logs, error: logsError } = await supabase
      .from("activity_logs")
      .select("user_id, provider, action, details, created_at")
      .in("action", ["ocr_extract", "ocr_extract_cached"])
      .not("user_email", "like", "%@sjinlaw.com");

    if (logsError) {
      return NextResponse.json({ error: logsError.message }, { status: 500 });
    }

    // 2. user_usage 전체 조회
    const { data: usages, error: usageError } = await supabase
      .from("user_usage")
      .select("*");

    if (usageError) {
      return NextResponse.json({ error: usageError.message }, { status: 500 });
    }

    // 3. 유저별 실제 사용 횟수 계산 (현재 구간 내 로그만)
    const usageMap = new Map<string, { user_id: string; provider: string; period_start: string | null }>();
    for (const u of usages || []) {
      usageMap.set(`${u.user_id}:${u.provider}`, {
        user_id: u.user_id,
        provider: u.provider,
        period_start: u.period_start,
      });
    }

    // 유저별 로그 카운트 (현재 기간 내만)
    const logCounts = new Map<string, number>();
    const missedLogs = new Map<string, number>(); // gemini-vision만 (놓친 건)

    for (const log of logs || []) {
      if (!log.user_id || !log.provider) continue;

      const key = `${log.user_id}:${log.provider}`;
      const usage = usageMap.get(key);

      // period_start가 있으면 그 이후 로그만 카운트
      if (usage?.period_start) {
        const logDate = new Date(log.created_at);
        const periodStart = new Date(usage.period_start);
        if (logDate < periodStart) continue;
      }

      logCounts.set(key, (logCounts.get(key) || 0) + 1);

      // 놓친 건수 별도 집계 (gemini-vision parsingMethod)
      const details = log.details as Record<string, unknown> | null;
      const method = details?.parsingMethod;
      if (log.action === "ocr_extract" && method === "gemini-vision") {
        missedLogs.set(key, (missedLogs.get(key) || 0) + 1);
      }
    }

    // 4. 차이 계산
    const discrepancies: Array<{
      user_id: string;
      provider: string;
      current_usage_count: number;
      expected_from_logs: number;
      missed_gemini_vision: number;
      difference: number;
    }> = [];

    for (const u of usages || []) {
      const key = `${u.user_id}:${u.provider}`;
      const expectedCount = logCounts.get(key) || 0;
      const missedCount = missedLogs.get(key) || 0;
      const diff = expectedCount - u.usage_count;

      if (diff > 0) {
        discrepancies.push({
          user_id: u.user_id,
          provider: u.provider,
          current_usage_count: u.usage_count,
          expected_from_logs: expectedCount,
          missed_gemini_vision: missedCount,
          difference: diff,
        });
      }
    }

    return NextResponse.json({
      message: "Dry run - 보정 전 확인",
      total_discrepancies: discrepancies.length,
      total_missed: discrepancies.reduce((sum, d) => sum + d.difference, 0),
      discrepancies,
      hint: "POST 요청으로 실제 보정을 적용하세요",
    });
  } catch (error) {
    console.error("Fix usage error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email?.endsWith("@sjinlaw.com")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    // GET과 동일한 로직으로 차이 계산
    const { data: logs, error: logsError } = await supabase
      .from("activity_logs")
      .select("user_id, provider, action, details, created_at")
      .in("action", ["ocr_extract", "ocr_extract_cached"])
      .not("user_email", "like", "%@sjinlaw.com");

    if (logsError) {
      return NextResponse.json({ error: logsError.message }, { status: 500 });
    }

    const { data: usages, error: usageError } = await supabase
      .from("user_usage")
      .select("*");

    if (usageError) {
      return NextResponse.json({ error: usageError.message }, { status: 500 });
    }

    const usageMap = new Map<string, { user_id: string; provider: string; period_start: string | null; usage_count: number }>();
    for (const u of usages || []) {
      usageMap.set(`${u.user_id}:${u.provider}`, {
        user_id: u.user_id,
        provider: u.provider,
        period_start: u.period_start,
        usage_count: u.usage_count,
      });
    }

    const logCounts = new Map<string, number>();
    for (const log of logs || []) {
      if (!log.user_id || !log.provider) continue;
      const key = `${log.user_id}:${log.provider}`;
      const usage = usageMap.get(key);
      if (usage?.period_start) {
        const logDate = new Date(log.created_at);
        const periodStart = new Date(usage.period_start);
        if (logDate < periodStart) continue;
      }
      logCounts.set(key, (logCounts.get(key) || 0) + 1);
    }

    // 보정 적용
    const fixes: Array<{ user_id: string; provider: string; old_count: number; new_count: number }> = [];

    for (const u of usages || []) {
      const key = `${u.user_id}:${u.provider}`;
      const expectedCount = logCounts.get(key) || 0;

      if (expectedCount > u.usage_count) {
        const { error: updateError } = await supabase
          .from("user_usage")
          .update({
            usage_count: expectedCount,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", u.user_id)
          .eq("provider", u.provider);

        if (updateError) {
          console.error(`Failed to fix ${key}:`, updateError);
          continue;
        }

        fixes.push({
          user_id: u.user_id,
          provider: u.provider,
          old_count: u.usage_count,
          new_count: expectedCount,
        });
      }
    }

    return NextResponse.json({
      message: "보정 완료",
      fixed_count: fixes.length,
      fixes,
    });
  } catch (error) {
    console.error("Fix usage POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
