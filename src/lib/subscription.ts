import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PlanType, PlanInfo, Subscription } from "@/types/subscription";

export const PLAN_LIMITS: Record<PlanType, PlanInfo> = {
  free: {
    maxLimit: 3,
    price: 0,
    label: 'Free',
    description: '무료 체험',
    features: ['월 3건 변환', '기본 PDF 지원'],
  },
  basic: {
    maxLimit: 50,
    price: 29000,
    label: 'Basic',
    description: '소규모 업무용',
    features: ['월 50건 변환', '모든 파일 형식 지원', '이메일 지원'],
  },
  pro: {
    maxLimit: 200,
    price: 59000,
    label: 'Pro',
    description: '전문가용',
    features: ['월 200건 변환', '모든 파일 형식 지원', '우선 지원'],
  },
  enterprise: {
    maxLimit: -1, // unlimited
    price: 99000,
    label: 'Enterprise',
    description: '대규모 업무용',
    features: ['무제한 변환', 'API 접근', '모든 파일 형식 지원', '전담 지원'],
  },
} as const;

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * 사용자의 현재 구독 정보 조회
 */
export async function getUserSubscription(
  userId: string,
  provider: string
): Promise<Subscription | null> {
  const client = getSupabase();
  if (!client) return null;

  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching subscription:", error);
    return null;
  }

  return data as Subscription | null;
}

/**
 * 사용자의 현재 플랜 조회 (구독 테이블 기반)
 */
export async function getUserPlan(userId: string, provider: string): Promise<PlanType> {
  const sub = await getUserSubscription(userId, provider);
  if (!sub) return 'free';
  if (sub.status === 'active' || sub.status === 'cancelled') {
    // cancelled 상태여도 기간이 남아있으면 유지
    if (sub.status === 'cancelled' && sub.current_period_end) {
      const now = new Date();
      const end = new Date(sub.current_period_end);
      if (now > end) return 'free';
    }
    return sub.plan;
  }
  return 'free';
}

/**
 * 구독 기간 내인지 확인
 */
export function isWithinPeriod(sub: Subscription | null): boolean {
  if (!sub || !sub.current_period_end) return false;
  return new Date() < new Date(sub.current_period_end);
}

/**
 * 플랜의 max_limit 값 반환
 */
export function getPlanLimit(plan: PlanType): number {
  return PLAN_LIMITS[plan].maxLimit;
}

/**
 * customerKey 생성 (토스페이먼츠용)
 */
export function generateCustomerKey(userId: string, provider: string): string {
  return `cust_${provider}_${userId}`.substring(0, 50);
}

/**
 * orderId 생성
 */
export function generateOrderId(plan: PlanType): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `order_${plan}_${timestamp}_${random}`;
}

/**
 * KST 시간 문자열 생성
 */
export function getKSTString(): string {
  return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
