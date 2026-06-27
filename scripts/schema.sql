-- ============================================================
-- JobPilot Database Schema
-- Created: 2026-06-17
-- Execute via InsForge run-raw-sql MCP tool
-- Note: documents initial state. Future ALTER TABLE changes
-- must be manually reflected here.
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

-- profiles: one row per authenticated user, extends auth.users.
-- id is the auth UUID — same value as auth.users.id.
-- Row is created on first profile save (Feature 06) via upsert.
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT,
  email               TEXT,
  phone               TEXT,
  location            TEXT,
  current_title       TEXT,
  experience_level    TEXT,
  years_experience    INTEGER,
  skills              TEXT[]      DEFAULT '{}',
  industries          TEXT[]      DEFAULT '{}',
  work_experience     JSONB       DEFAULT '[]',
  education           JSONB       DEFAULT '{}',
  job_titles_seeking  TEXT[]      DEFAULT '{}',
  remote_preference   TEXT,
  preferred_locations TEXT[]      DEFAULT '{}',
  salary_expectation  TEXT,
  cover_letter_tone   TEXT,
  linkedin_url        TEXT,
  portfolio_url       TEXT,
  work_authorization  TEXT,
  resume_pdf_url      TEXT,
  resume_pdf_key      TEXT,
  linkedin_connected  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_tailored         BOOLEAN     NOT NULL DEFAULT FALSE,
  is_complete         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_runs: one row per job search the agent executes
CREATE TABLE IF NOT EXISTS agent_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'running',
  job_title_searched  TEXT,
  location_searched   TEXT,
  jobs_found          INTEGER     DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

-- jobs: one row per discovered job listing.
-- run_id is nullable — NULL when job is added via direct URL (source = 'url').
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID        REFERENCES agent_runs(id) ON DELETE SET NULL,
  user_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source              TEXT        NOT NULL,
  source_provider     TEXT,
  source_url          TEXT,
  external_apply_url  TEXT,
  title               TEXT,
  company             TEXT,
  location            TEXT,
  salary              TEXT,
  job_type            TEXT,
  about_role          TEXT,
  responsibilities    TEXT[]      DEFAULT '{}',
  requirements        TEXT[]      DEFAULT '{}',
  nice_to_have        TEXT[]      DEFAULT '{}',
  benefits            TEXT[]      DEFAULT '{}',
  about_company       TEXT,
  match_score         INTEGER,
  match_reason        TEXT,
  matched_skills      TEXT[]      DEFAULT '{}',
  missing_skills      TEXT[]      DEFAULT '{}',
  company_research    JSONB,
  found_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_logs: append-only operation log written by agent code.
-- run_id and job_id are nullable — logs can exist outside a specific run or job.
CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  level       TEXT        NOT NULL DEFAULT 'info',
  job_id      UUID        REFERENCES jobs(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- TRIGGER: auto-update profiles.updated_at on every save
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- INDEXES
-- RLS policies append WHERE user_id = auth.uid() to every
-- query. Without indexes on user_id, PostgreSQL scans the
-- full table. Composite indexes on (user_id, sort_column)
-- cover both the RLS filter and sort in a single scan.
-- ============================================================

-- jobs: RLS user filter
CREATE INDEX IF NOT EXISTS idx_jobs_user_id
  ON jobs(user_id);

-- jobs: user filter + date sort (Feature 11 sort by newest/oldest)
CREATE INDEX IF NOT EXISTS idx_jobs_user_found_at
  ON jobs(user_id, found_at DESC);

-- jobs: user filter + match score sort (Feature 11 sort by match score)
CREATE INDEX IF NOT EXISTS idx_jobs_user_match_score
  ON jobs(user_id, match_score DESC);

-- agent_logs: RLS user filter
CREATE INDEX IF NOT EXISTS idx_agent_logs_user_id
  ON agent_logs(user_id);

-- agent_logs: fetch all logs for a specific agent run
CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id
  ON agent_logs(run_id);

-- agent_runs: RLS user filter + recent activity queries (Feature 16)
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id
  ON agent_runs(user_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- All four tables: full CRUD restricted to the owning user.
-- profiles uses id = auth.uid() (id IS the user's UUID).
-- All other tables use user_id = auth.uid().
-- ============================================================

ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles: select own" ON profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles: insert own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles: update own" ON profiles
  FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles: delete own" ON profiles
  FOR DELETE USING (id = auth.uid());

-- agent_runs
CREATE POLICY "agent_runs: select own" ON agent_runs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "agent_runs: insert own" ON agent_runs
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "agent_runs: update own" ON agent_runs
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "agent_runs: delete own" ON agent_runs
  FOR DELETE USING (user_id = auth.uid());

-- jobs
CREATE POLICY "jobs: select own" ON jobs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "jobs: insert own" ON jobs
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "jobs: update own" ON jobs
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "jobs: delete own" ON jobs
  FOR DELETE USING (user_id = auth.uid());

-- agent_logs
CREATE POLICY "agent_logs: select own" ON agent_logs
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "agent_logs: insert own" ON agent_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "agent_logs: update own" ON agent_logs
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "agent_logs: delete own" ON agent_logs
  FOR DELETE USING (user_id = auth.uid());
