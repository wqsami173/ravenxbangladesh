CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  banner_url TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE RESTRICT,
  registration_requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  registration_open BOOLEAN NOT NULL DEFAULT TRUE,
  allow_multiple_registrations BOOLEAN NOT NULL DEFAULT TRUE,
  automatic_bib_assignment BOOLEAN NOT NULL DEFAULT TRUE,
  run_submission_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  run_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  certificate_after_approval BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the original registration table and its payment columns intact.
CREATE TABLE IF NOT EXISTS registrations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  distance TEXT,
  category TEXT,
  gender TEXT,
  payment_method TEXT,
  payment_number TEXT,
  trx_id TEXT,
  registration_fee NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS platform_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS bib_number TEXT,
  ADD COLUMN IF NOT EXISTS selected_distance TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_number TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS student_id_url TEXT,
  ADD COLUMN IF NOT EXISTS student_id_public_id TEXT,
  ADD COLUMN IF NOT EXISTS student_id_format TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE registrations SET platform_id = gen_random_uuid() WHERE platform_id IS NULL;
ALTER TABLE registrations ALTER COLUMN platform_id SET DEFAULT gen_random_uuid();
ALTER TABLE registrations ALTER COLUMN platform_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS registrations_platform_id_uidx ON registrations (platform_id);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_bib_number_uidx
  ON registrations (bib_number) WHERE bib_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(platform_id) ON DELETE RESTRICT,
  activity_url TEXT NOT NULL,
  strava_profile_url TEXT,
  delivery_address TEXT,
  district TEXT,
  screenshot_url TEXT NOT NULL,
  screenshot_public_id TEXT,
  screenshot_format TEXT,
  additional_information TEXT,
  submission_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (submission_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  admin_feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS strava_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT;

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL UNIQUE REFERENCES registrations(platform_id) ON DELETE RESTRICT,
  certificate_url TEXT NOT NULL,
  cloudinary_public_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'GENERATED',
  verification_code TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  registration_id UUID REFERENCES registrations(platform_id) ON DELETE CASCADE,
  audience TEXT NOT NULL DEFAULT 'PARTICIPANT' CHECK (audience IN ('PARTICIPANT', 'ADMIN')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_path TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient TEXT NOT NULL,
  template_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bib_counters (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  distance_prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (event_id, distance_prefix)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);
CREATE INDEX IF NOT EXISTS registrations_user_status_idx ON registrations (user_id, registration_status, created_at DESC);
CREATE INDEX IF NOT EXISTS registrations_event_status_idx ON registrations (event_id, registration_status, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_registration_date_idx ON submissions (registration_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS submissions_status_date_idx ON submissions (submission_status, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_pending_per_registration_uidx
  ON submissions (registration_id) WHERE submission_status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_approved_per_registration_uidx
  ON submissions (registration_id) WHERE submission_status = 'APPROVED';
CREATE INDEX IF NOT EXISTS notifications_user_date_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_admin_date_idx ON notifications (audience, created_at DESC);
CREATE INDEX IF NOT EXISTS email_outbox_retry_idx ON email_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS password_reset_user_expiry_idx ON password_reset_tokens (user_id, expires_at);

INSERT INTO events (name, slug, description, banner_url, start_date, end_date, status, metadata)
VALUES (
  'Shadow Sprint Run 2026',
  'shadow-sprint-2026',
  'A virtual running challenge from RavenX Bangladesh. Participants can complete their selected distance anywhere and submit a Strava activity for review.',
  '/assets/shadow-sprint-banner.png',
  DATE '2026-10-01',
  DATE '2026-10-31',
  'PUBLISHED',
  '{"location":"Virtual — Run Anywhere, Anytime","distances":[{"value":"3.1km","label":"3.1 KM","category":"Silver","bib_prefix":"SR31","medal_image":"/assets/3.1KM.jpeg"},{"value":"6.66km","label":"6.66 KM","category":"Golden","bib_prefix":"SR66","medal_image":"/assets/6.66km.jpg"},{"value":"13km","label":"13 KM","category":"Black","bib_prefix":"SR13","medal_image":"/assets/13KM.jpg"}],"fees":{"student":599,"regular":649,"currency":"BDT","courier_charge_applies":true},"payment_methods":["Bkash","Nagad","Rocket"],"payment_accounts":{"Bkash":{"number":"01805749874","mode":"Payment"},"Nagad":{"number":"01687414286","mode":"Send Money"},"Rocket":{"number":"01624577374","mode":"Send Money"}},"student_id_categories":["student"],"rules":["Record the run with Strava.","Submit the activity link and a running screenshot.","Runs are reviewed by RavenX administrators."],"rewards":["Exclusive China finisher medal","Surprise gift","Personalized e-certificate","Official e-BIB"]}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO event_workflows (event_id, registration_requires_approval, registration_open, allow_multiple_registrations, automatic_bib_assignment, run_submission_enabled, run_approval_required, certificate_after_approval)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
FROM events WHERE slug = 'shadow-sprint-2026'
ON CONFLICT (event_id) DO UPDATE SET registration_open = TRUE;

UPDATE registrations
SET selected_distance = COALESCE(selected_distance, distance),
    transaction_id = COALESCE(transaction_id, trx_id),
    event_id = COALESCE(event_id, (SELECT id FROM events WHERE slug = 'shadow-sprint-2026')),
    registration_status = COALESCE(NULLIF(registration_status, ''), 'PENDING_APPROVAL'),
    created_at = COALESCE(created_at, NOW())
WHERE event_id IS NULL OR selected_distance IS NULL OR transaction_id IS NULL
   OR registration_status IS NULL OR registration_status = '';

INSERT INTO users (name, email, phone, password_hash, role)
SELECT DISTINCT ON (LOWER(BTRIM(r.email)))
  COALESCE(NULLIF(BTRIM(r.name), ''), 'RavenX participant'),
  LOWER(BTRIM(r.email)),
  NULLIF(BTRIM(r.phone), ''),
  NULL,
  'participant'
FROM registrations r
WHERE r.email IS NOT NULL AND BTRIM(r.email) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM(r.email))
  )
ORDER BY LOWER(BTRIM(r.email)), r.created_at NULLS LAST;

UPDATE registrations r
SET user_id = u.id
FROM users u
WHERE r.user_id IS NULL AND LOWER(BTRIM(r.email)) = LOWER(BTRIM(u.email));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_user_fk') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_event_fk') THEN
    ALTER TABLE registrations ADD CONSTRAINT registrations_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT;
  END IF;
END $$;

UPDATE users SET password_hash = NULL WHERE password_hash = '';


