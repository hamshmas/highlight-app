import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
    if (supabaseClient) return supabaseClient;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.warn("Supabase credentials not configured");
        return null;
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey);
    return supabaseClient;
}

export interface UserUsage {
    user_id: string;
    provider: string;
    usage_count: number;
    max_limit: number;
}

// 카카오 사용자 기본 제한
const KAKAO_DEFAULT_LIMIT = 3;

/**
 * 사용자 사용량 조회
 */
export async function getUserUsage(
    userId: string,
    provider: string
): Promise<UserUsage | null> {
    const client = getSupabase();
    if (!client) return null;

    const { data, error } = await client
        .from("user_usage")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", provider)
        .single();

    if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found
        console.error("Error fetching user usage:", error);
        return null;
    }

    return data as UserUsage | null;
}

/**
 * 사용량 증가 (사용 시 호출)
 */
export async function incrementUsage(
    userId: string,
    provider: string
): Promise<{ success: boolean; currentCount: number; maxLimit: number }> {
    const client = getSupabase();
    if (!client) {
        return { success: true, currentCount: 0, maxLimit: KAKAO_DEFAULT_LIMIT };
    }

    // 기존 레코드 조회
    const existing = await getUserUsage(userId, provider);

    if (existing) {
        // 기존 레코드 업데이트
        const newCount = existing.usage_count + 1;
        const { error } = await client
            .from("user_usage")
            .update({
                usage_count: newCount,
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("provider", provider);

        if (error) {
            console.error("Error updating usage:", error);
            return { success: false, currentCount: existing.usage_count, maxLimit: existing.max_limit };
        }

        return { success: true, currentCount: newCount, maxLimit: existing.max_limit };
    } else {
        // 새 레코드 생성
        const { error } = await client.from("user_usage").insert({
            user_id: userId,
            provider: provider,
            usage_count: 1,
            max_limit: KAKAO_DEFAULT_LIMIT,
        });

        if (error) {
            console.error("Error creating usage record:", error);
            return { success: false, currentCount: 0, maxLimit: KAKAO_DEFAULT_LIMIT };
        }

        return { success: true, currentCount: 1, maxLimit: KAKAO_DEFAULT_LIMIT };
    }
}

/**
 * 서비스 사용 가능 여부 확인
 */
export async function canUseService(
    userId: string,
    provider: string
): Promise<{ canUse: boolean; remaining: number; maxLimit: number }> {
    // 구글 사용자는 무제한
    if (provider === "google") {
        return { canUse: true, remaining: -1, maxLimit: -1 }; // -1 = unlimited
    }

    const client = getSupabase();
    if (!client) {
        // Supabase 없으면 기본 허용
        return { canUse: true, remaining: KAKAO_DEFAULT_LIMIT, maxLimit: KAKAO_DEFAULT_LIMIT };
    }

    const usage = await getUserUsage(userId, provider);

    if (!usage) {
        // 첫 사용자
        return { canUse: true, remaining: KAKAO_DEFAULT_LIMIT, maxLimit: KAKAO_DEFAULT_LIMIT };
    }

    const remaining = usage.max_limit - usage.usage_count;
    return {
        canUse: remaining > 0,
        remaining: Math.max(0, remaining),
        maxLimit: usage.max_limit,
    };
}

/**
 * 남은 사용량 조회 (UI용)
 */
export async function getRemainingUsage(
    userId: string,
    provider: string
): Promise<{ remaining: number; maxLimit: number; isUnlimited: boolean }> {
    if (provider === "google") {
        return { remaining: -1, maxLimit: -1, isUnlimited: true };
    }

    const { remaining, maxLimit } = await canUseService(userId, provider);
    return { remaining, maxLimit, isUnlimited: false };
}
