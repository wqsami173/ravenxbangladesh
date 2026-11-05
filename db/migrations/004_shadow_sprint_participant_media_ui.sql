-- Student ID and run screenshot selection happens in the participant browser only.
-- Restore the event metadata flag so Student category prompts for a local image.
UPDATE events
SET description = 'A virtual Halloween running challenge from RavenX Bangladesh. Choose your distance, run anywhere, and submit a link from your running app for review.',
    metadata = jsonb_set(
      jsonb_set(
        metadata,
        '{student_id_categories}',
        '["student"]'::jsonb,
        TRUE
      ),
      '{rules}',
      '["Record your run with Strava or another running app.","Submit the activity link for review.","The RavenX administrator reviews each run before a certificate is issued."]'::jsonb,
      TRUE
    )
WHERE slug = 'shadow-sprint-2026';
