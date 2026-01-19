import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

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
  details: Record<string, unknown> = {}
) {
  try {
    const { error } = await supabase.from("activity_logs").insert({
      user_email: userEmail,
      action: action,
      details: details,
      created_at_kst: getKSTTimestamp(),
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Log error:", error);
    }
  } catch (err) {
    console.error("Failed to log action:", err);
  }
}
