import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserSubscription, PLAN_LIMITS, getPlanLimit } from "@/lib/subscription";
import type { PlanType } from "@/types/subscription";

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
    period_start?: string | null;
    period_end?: string | null;
}

// 카카오 사용자 기본 제한 (Free 플랜)
const DEFAULT_LIMIT = PLAN_LIMITS.free.maxLimit;

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
        console.error("Error fetching user usage:", error);
        return null;
    }

    return data as UserUsage | null;
}

/**
 * 기간 만료 시 사용량 리셋 체크
 */
async function checkPeriodReset(userId: string, provider: string, usage: UserUsage): Promise<UserUsage> {
    if (!usage.period_end) return usage;

    const now = new Date();
    const periodEnd = new Date(usage.period_end);

    if (now > periodEnd) {
        // 기간 만료: 구독 상태 확인 후 리셋
        const sub = await getUserSubscription(userId, provider);
        if (sub && (sub.status === 'active') && sub.plan !== 'free') {
            // active 구독이면 크론잡이 처리하므로 여기서는 사용량만 체크
            // 크론잡이 아직 안 돌았을 수 있으므로 현재 값 반환
            return usage;
        }
        // cancelled/expired이면 free로 리셋
        const client = getSupabase();
        if (client) {
            await client
                .from("user_usage")
                .update({
                    usage_count: 0,
                    max_limit: DEFAULT_LIMIT,
                    period_start: null,
                    period_end: null,
                    updated_at: new Date().toISOString(),
                })
                .eq("user_id", userId)
                .eq("provider", provider);

            return { ...usage, usage_count: 0, max_limit: DEFAULT_LIMIT, period_start: null, period_end: null };
        }
    }

    return usage;
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
        return { success: true, currentCount: 0, maxLimit: DEFAULT_LIMIT };
    }

    let existing = await getUserUsage(userId, provider);

    if (existing) {
        // 기간 리셋 체크
        existing = await checkPeriodReset(userId, provider, existing);

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
        const { error } = await client.from("user_usage").insert({
            user_id: userId,
            provider: provider,
            usage_count: 1,
            max_limit: DEFAULT_LIMIT,
        });

        if (error) {
            console.error("Error creating usage record:", error);
            return { success: false, currentCount: 0, maxLimit: DEFAULT_LIMIT };
        }

        return { success: true, currentCount: 1, maxLimit: DEFAULT_LIMIT };
    }
}

/**
 * 서비스 사용 가능 여부 확인 (플랜 인식)
 */
export async function canUseService(
    userId: string,
    provider: string,
    userEmail?: string
): Promise<{ canUse: boolean; remaining: number; maxLimit: number; plan: PlanType }> {
    // 구글 @sjinlaw.com 관리자만 무제한
    if (provider === "google" && userEmail?.endsWith("@sjinlaw.com")) {
        return { canUse: true, remaining: -1, maxLimit: -1, plan: 'enterprise' as PlanType };
    }

    const client = getSupabase();
    if (!client) {
        return { canUse: true, remaining: DEFAULT_LIMIT, maxLimit: DEFAULT_LIMIT, plan: 'free' };
    }

    // 구독 정보 조회
    const sub = await getUserSubscription(userId, provider);
    let plan: PlanType = 'free';

    if (sub && sub.status === 'active') {
        plan = sub.plan as PlanType;
    } else if (sub && sub.status === 'cancelled' && sub.current_period_end) {
        // 취소했지만 기간 남은 경우
        if (new Date() < new Date(sub.current_period_end)) {
            plan = sub.plan as PlanType;
        }
    }

    // enterprise는 무제한
    if (plan === 'enterprise') {
        return { canUse: true, remaining: -1, maxLimit: -1, plan };
    }

    let usage = await getUserUsage(userId, provider);

    if (!usage) {
        return { canUse: true, remaining: getPlanLimit(plan), maxLimit: getPlanLimit(plan), plan };
    }

    // 기간 리셋 체크
    usage = await checkPeriodReset(userId, provider, usage);

    const maxLimit = usage.max_limit;
    const remaining = maxLimit - usage.usage_count;
    return {
        canUse: remaining > 0,
        remaining: Math.max(0, remaining),
        maxLimit,
        plan,
    };
}

/**
 * 남은 사용량 조회 (UI용)
 */
export async function getRemainingUsage(
    userId: string,
    provider: string,
    userEmail?: string
): Promise<{
    remaining: number;
    maxLimit: number;
    isUnlimited: boolean;
    plan: PlanType;
    periodEnd: string | null;
    cardLast4: string | null;
}> {
    // 구글 @sjinlaw.com 관리자만 무제한
    if (provider === "google" && userEmail?.endsWith("@sjinlaw.com")) {
        return { remaining: -1, maxLimit: -1, isUnlimited: true, plan: 'enterprise', periodEnd: null, cardLast4: null };
    }

    const { remaining, maxLimit, plan } = await canUseService(userId, provider, userEmail);

    // 구독 정보에서 추가 데이터 가져오기
    const sub = await getUserSubscription(userId, provider);

    return {
        remaining,
        maxLimit,
        isUnlimited: plan === 'enterprise',
        plan,
        periodEnd: sub?.current_period_end || null,
        cardLast4: sub?.card_last4 || null,
    };
}
