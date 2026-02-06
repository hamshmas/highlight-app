-- 구독 테이블
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'kakao',
  plan TEXT NOT NULL DEFAULT 'free',        -- 'free' | 'basic' | 'pro' | 'enterprise'
  status TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'cancelled' | 'past_due' | 'expired'
  billing_key TEXT,                         -- 토스 billingKey
  customer_key TEXT,                        -- 토스 customerKey
  card_last4 TEXT,
  card_company TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- 결제 내역 테이블
CREATE TABLE IF NOT EXISTS payment_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'kakao',
  subscription_id UUID REFERENCES subscriptions(id),
  order_id TEXT NOT NULL UNIQUE,
  payment_key TEXT,
  amount INTEGER NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'success' | 'failed' | 'refunded'
  failure_reason TEXT,
  toss_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_at_kst TEXT
);

-- user_usage 테이블에 기간 컬럼 추가
ALTER TABLE user_usage ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE user_usage ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions(current_period_end);
CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_payment_history_subscription ON payment_history(subscription_id);
