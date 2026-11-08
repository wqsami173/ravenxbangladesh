CREATE TABLE IF NOT EXISTS site_analytics_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_hash TEXT NOT NULL,
  page_path TEXT NOT NULL CHECK (length(page_path) BETWEEN 1 AND 200),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds BETWEEN 0 AND 86400)
);

CREATE INDEX IF NOT EXISTS site_analytics_visits_started_idx
  ON site_analytics_visits (started_at DESC);
CREATE INDEX IF NOT EXISTS site_analytics_visits_visitor_idx
  ON site_analytics_visits (visitor_hash, started_at DESC);
