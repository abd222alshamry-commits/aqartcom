CREATE TABLE IF NOT EXISTS regional_agent_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at TIMESTAMPTZ,
  verified_key_hash TEXT,
  verified_at TIMESTAMPTZ,
  calls_per_cycle INTEGER NOT NULL DEFAULT 42 CHECK(calls_per_cycle BETWEEN 1 AND 1000),
  calls_per_day INTEGER NOT NULL DEFAULT 84 CHECK(calls_per_day BETWEEN 1 AND 2000),
  auto_publish BOOLEAN NOT NULL DEFAULT TRUE,
  next_cursor INTEGER NOT NULL DEFAULT 0,
  pause_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO regional_agent_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE regional_agent_settings ADD COLUMN IF NOT EXISTS verified_model TEXT;
ALTER TABLE regional_agent_settings ADD COLUMN IF NOT EXISTS search_plan TEXT;
CREATE TABLE IF NOT EXISTS regional_agent_runs (
  id BIGSERIAL PRIMARY KEY,
  slot TEXT UNIQUE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  skipped_reason TEXT,
  planned_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS regional_agent_jobs (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES regional_agent_runs(id),
  target_id TEXT NOT NULL,
  governorate_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('facebook','instagram','tiktok')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','empty','error','interrupted')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  published_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  response_id TEXT,
  usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  UNIQUE(run_id,target_id,platform)
);
CREATE INDEX IF NOT EXISTS regional_agent_jobs_queue ON regional_agent_jobs(state,id);
CREATE INDEX IF NOT EXISTS regional_agent_jobs_coverage ON regional_agent_jobs(target_id,platform,finished_at);
ALTER TABLE regional_agent_jobs ADD COLUMN IF NOT EXISTS model TEXT;
