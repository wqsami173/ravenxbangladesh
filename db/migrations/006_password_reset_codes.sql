ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 0
  CHECK (attempts BETWEEN 0 AND 5);

CREATE INDEX IF NOT EXISTS password_reset_recent_request_idx
  ON password_reset_tokens (user_id, created_at DESC);

