import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase credentials not configured");
    return null;
  }

  supabase = createClient(supabaseUrl, supabaseKey);
  return supabase;
}

// 한국 표준시 (KST) 타임스탬프 생성
export function getKSTTimestamp(): string {
  const now = new Date();
  const kstOffset = 9 * 60; // UTC+9
  const kstTime = new Date(now.getTime() + kstOffset * 60 * 1000);
  return kstTime.toISOString().replace("T", " ").substring(0, 19);
}

// 작업 로그 기록
export async function logAction(
  userEmail: string,
  action: string,
  details: Record<string, unknown> = {},
  userId?: string,
  provider?: string
) {
  try {
    const client = getSupabase();
    if (!client) {
      console.log("Supabase not configured, skipping log");
      return;
    }

    const { error } = await client.from("activity_logs").insert({
      user_email: userEmail,
      action: action,
      details: details,
      created_at_kst: getKSTTimestamp(),
      created_at: new Date().toISOString(),
      ...(userId && { user_id: userId }),
      ...(provider && { provider: provider }),
    });

    if (error) {
      console.error("Log error:", error);
    }
  } catch (err) {
    console.error("Failed to log action:", err);
  }
}
