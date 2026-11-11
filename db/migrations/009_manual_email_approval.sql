ALTER TABLE email_outbox ALTER COLUMN status SET DEFAULT 'AWAITING_APPROVAL';

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_status_check
  CHECK (status IN ('PENDING', 'AWAITING_APPROVAL', 'READY_TO_SEND', 'SENDING', 'SENT', 'FAILED', 'DELETED'));

-- Messages that were waiting for the automatic worker become drafts for admin review.
UPDATE email_outbox SET status='AWAITING_APPROVAL', locked_at=NULL
WHERE status='PENDING';

-- Recover abandoned sends as drafts so deployment/restarts never auto-send them again.
UPDATE email_outbox SET status='AWAITING_APPROVAL', locked_at=NULL,
  last_error=COALESCE(last_error, 'Previous send was interrupted; admin review is required.')
WHERE status='SENDING' AND locked_at < NOW() - INTERVAL '5 minutes';

CREATE INDEX IF NOT EXISTS email_outbox_review_idx ON email_outbox (status, created_at DESC);
