-- parsing_cache 테이블에 user_id, provider 컬럼 추가 (식별자 통일)
ALTER TABLE parsing_cache ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE parsing_cache ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE INDEX IF NOT EXISTS idx_parsing_cache_user_id ON parsing_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_parsing_cache_provider ON parsing_cache(provider);
