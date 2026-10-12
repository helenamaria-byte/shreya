-- Per-story approval ("approves or swaps stories individually")
ALTER TABLE issue_stories ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Graceful bounce handling: transient bounces are counted, suppressed after 3 in a row
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS soft_bounces int NOT NULL DEFAULT 0;

-- Thursday-evening delivery report, sent once per issue
ALTER TABLE issues ADD COLUMN IF NOT EXISTS report_sent_at timestamptz;

-- Where a voice guide version came from: assumed (seed) | edited (dashboard) | learned (Gemini, from Shreya's samples)
ALTER TABLE voice_guide ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'assumed';
