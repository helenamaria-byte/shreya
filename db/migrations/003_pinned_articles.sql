-- "Save for next issue": Shreya pins an article from Telegram; the next draft must include it.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
