-- Run review uses the Strava activity link. No participant images are collected.
-- Existing screenshot URLs and student-ID references are preserved for data safety.
ALTER TABLE submissions ALTER COLUMN screenshot_url DROP NOT NULL;

UPDATE events
SET metadata = jsonb_set(
  metadata - 'student_id_categories',
  '{rules}',
  '["Record your run with Strava.","Submit your activity link for review.","The RavenX administrator reviews each run before a certificate is issued."]'::jsonb,
  TRUE
)
WHERE slug = 'shadow-sprint-2026';
