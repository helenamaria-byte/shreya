-- The Dispatch — initial schema
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sources (
  id              serial PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  type            text NOT NULL CHECK (type IN ('rss', 'gnews')),
  url_or_query    text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  last_fetched_at timestamptz,
  last_status     text,              -- ok | failed
  last_error      text,
  last_count      int
);

CREATE TABLE IF NOT EXISTS articles (
  id               serial PRIMARY KEY,
  source_id        int REFERENCES sources(id),
  source_name      text NOT NULL,
  title            text NOT NULL,
  url              text NOT NULL,
  canonical_url    text NOT NULL,
  url_hash         text NOT NULL UNIQUE,          -- sha256 of the raw link: exact re-fetches are dropped
  canonical_hash   text NOT NULL,                 -- sha256 of the normalised link: tracking variants are flagged same_url
  summary          text,
  published_at     timestamptz,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  topic            text,
  topic_confidence real,
  topic_method     text,                          -- gemini | keyword
  duplicate_of     int REFERENCES articles(id),
  duplicate_reason text CHECK (duplicate_reason IN ('same_url', 'similar_title', 'covered_in_past_issue')),
  duplicate_score  real,
  issue_week       text NOT NULL,
  is_sample        boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS articles_canonical_hash_idx ON articles (canonical_hash);
CREATE INDEX IF NOT EXISTS articles_issue_week_idx ON articles (issue_week);
CREATE INDEX IF NOT EXISTS articles_title_trgm_idx ON articles USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS issues (
  id                        serial PRIMARY KEY,
  issue_number              int NOT NULL UNIQUE,
  week_key                  text NOT NULL UNIQUE,
  status                    text NOT NULL CHECK (status IN ('collecting', 'drafting', 'insufficient_stories', 'pending_approval',
                              'approved', 'rejected', 'sending', 'sent', 'skipped')),
  draft_sent_to_telegram_at timestamptz,
  reminder_sent_at          timestamptz,
  approved_at               timestamptz,
  approved_via              text CHECK (approved_via IN ('telegram', 'dashboard')),
  sent_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  is_sample                 boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS issue_stories (
  id                  serial PRIMARY KEY,
  issue_id            int NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  article_id          int NOT NULL REFERENCES articles(id),
  position            int,
  commentary          text,
  original_commentary text,
  state               text NOT NULL CHECK (state IN ('selected', 'rejected', 'reserve', 'swapped_out')),
  edited_at           timestamptz,
  gemini_rationale    text,
  connects_with       text,
  reserve_rank        int,
  needs_review        boolean NOT NULL DEFAULT false,
  review_notes        text,
  UNIQUE (issue_id, article_id)
);

CREATE TABLE IF NOT EXISTS issue_events (
  id         serial PRIMARY KEY,
  issue_id   int NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  event      text NOT NULL,      -- draft_created, draft_sent, edited, swapped, story_rejected, reminder_sent, approved, approval_revoked, rejected, sent, skipped ...
  channel    text,               -- telegram | dashboard | cron | system
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS voice_guide (
  id            serial PRIMARY KEY,
  content       text NOT NULL,
  version       int NOT NULL UNIQUE,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_assumption boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS subscribers (
  id                serial PRIMARY KEY,
  email             text NOT NULL UNIQUE,
  name              text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'complained')),
  is_test_recipient boolean NOT NULL DEFAULT false,
  is_sample         boolean NOT NULL DEFAULT false,
  unsubscribed_at   timestamptz,
  status_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriber_events (
  id            serial PRIMARY KEY,
  subscriber_id int NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  status        text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id              serial PRIMARY KEY,
  issue_id        int NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  subscriber_id   int NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  resend_email_id text,
  status          text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'dry_run')),
  mode            text,
  last_event_at   timestamptz NOT NULL DEFAULT now(),
  error           text,
  UNIQUE (issue_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS deliveries_resend_idx ON deliveries (resend_email_id);

CREATE TABLE IF NOT EXISTS telegram_pending_actions (
  id             serial PRIMARY KEY,
  chat_id        text NOT NULL,
  action         text NOT NULL CHECK (action IN ('edit_commentary')),
  issue_story_id int NOT NULL REFERENCES issue_stories(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id          serial PRIMARY KEY,
  job         text NOT NULL,
  trigger     text NOT NULL CHECK (trigger IN ('cron', 'manual', 'test')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text CHECK (status IN ('success', 'failed', 'skipped')),
  summary     text,
  details     jsonb,
  simulated_now timestamptz
);
CREATE INDEX IF NOT EXISTS workflow_runs_started_idx ON workflow_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
