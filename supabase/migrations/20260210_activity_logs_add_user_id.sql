-- activity_logs 테이블에 user_id, provider 컬럼 추가 (식별자 통일)
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS provider TEXT;

-- 조회 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_provider ON activity_logs(provider);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_provider ON activity_logs(user_id, provider);
