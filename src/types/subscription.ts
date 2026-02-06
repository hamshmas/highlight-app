export type PlanType = 'free' | 'basic' | 'pro' | 'enterprise';

export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'expired';

export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded';

export interface Subscription {
  id: string;
  user_id: string;
  provider: string;
  plan: PlanType;
  status: SubscriptionStatus;
  billing_key: string | null;
  customer_key: string | null;
  card_last4: string | null;
  card_company: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentHistory {
  id: string;
  user_id: string;
  provider: string;
  subscription_id: string | null;
  order_id: string;
  payment_key: string | null;
  amount: number;
  plan: PlanType;
  status: PaymentStatus;
  failure_reason: string | null;
  toss_response: Record<string, unknown> | null;
  created_at: string;
  created_at_kst: string | null;
}

export interface PlanInfo {
  maxLimit: number;
  price: number;
  label: string;
  description: string;
  features: string[];
}
