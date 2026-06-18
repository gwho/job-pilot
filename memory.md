# Memory — Feature 04 Database Schema + Architect Session

Last updated: 2026-06-18

## What was built

### Infrastructure (InsForge MCP tools)
- Four tables created via `run-raw-sql`: `profiles`, `agent_runs`, `jobs`, `agent_logs`
- `updated_at` trigger (`set_updated_at` function + `profiles_updated_at` trigger) on `profiles`
- 6 performance indexes: `idx_jobs_user_id`, `idx_jobs_user_found_at`, `idx_jobs_user_match_score`, `idx_agent_logs_user_id`, `idx_agent_logs_run_id`, `idx_agent_runs_user_id`
- 16 RLS policies — SELECT/INSERT/UPDATE/DELETE on all four tables, scoped to `auth.uid()`
- Private `resumes` storage bucket created via `create-bucket`
- All tables verified via `get-table-schema`; bucket confirmed via `list-buckets`

### Files created or modified
- `scripts/schema.sql` — full DDL reference (tables, trigger, indexes, RLS)
- `types/index.ts` — canonical TypeScript interfaces for all four tables, including literal union types (`ExperienceLevel`, `JobSource`, `AgentRunStatus`, etc.), JSONB sub-types (`WorkExperienceEntry`, `Education`, `CompanyResearchDossier`), and `Insert` variants
- `docs/architect/04-database-schema/discussion.md` — comprehensive record of all architect session decisions and topics (RLS + index performance, shared PK vs surrogate key, migration files vs direct SQL, TypeScript type generation vs manual)
- `docs/architect/04-database-schema/ai-discussion-topics.md` — 25 AI discussion prompts
- `docs/plan/04-database-schema/plan.md`, `explanation.md`, `ai-discussion-topics.md`
- `context/progress-tracker.md` — Feature 04 marked complete, next set to Feature 05
- `context/code-standards.md` — new "InsForge Schema & Infrastructure Changes" section added

## Decisions made

- **profiles.id = auth UUID**: Shared primary key — profiles.id is the same UUID as auth.users.id. RLS uses `id = auth.uid()`, not `user_id = auth.uid()`. All other tables use `user_id = auth.uid()`.
- **Profile row created on first save (Feature 06)**: upsert via `ON CONFLICT (id) DO UPDATE`. Not auto-created in OAuth callback. RLS INSERT policy allows `auth.uid() = id`.
- **DB-level `updated_at` trigger**: `BEFORE UPDATE` trigger on `profiles` — application code never needs to set `updated_at` manually.
- **Schema via MCP tools, not migrations**: `scripts/schema.sql` is documentation only. Known trade-off: future ALTER TABLE changes must be manually reflected in the file. Migration tooling deferred until second environment or developer is needed.
- **Manual TypeScript types**: `types/index.ts` written manually, anchored to live `get-table-schema` output. Includes literal union types for constrained columns and Insert variants.
- **Indexes added at creation time**: Composite indexes on `(user_id, found_at DESC)` and `(user_id, match_score DESC)` on jobs cover RLS filter + sort in a single scan for Features 11 and 16.
- **`get-backend-metadata` before any schema work**: Now a required first step before DDL or infrastructure changes (added to `code-standards.md`). Was an oversight in Feature 04 — made standard going forward.

## Problems solved

- Identified two schema discrepancies vs another AI tool's plan: `linkedin_connected` and `is_tailored DEFAULT false` columns are not in `context/architecture.md`. Decided to follow architecture.md — those columns were not added.
- Identified missing `handle_new_user` trigger (auto-create profile on auth.users INSERT) in comparison plan. Our approach (upsert on first save) is a deliberate decision from the architect session — not an oversight.
- Missing `get-backend-metadata` connectivity check was an oversight, not intentional — now documented as a required step in `code-standards.md`.

## Current state

All verification passing:
- `get-table-schema` confirmed all four tables: correct columns, indexes, RLS policies, and trigger
- `list-buckets` confirmed `resumes` bucket (private)
- `npx tsc --noEmit` — clean
- `npm run lint` — clean

Feature 04 is fully complete. Phase 1 Foundation is done (01 Homepage, 02 Auth, 03 PostHog, 04 Database Schema).

Git status: new and modified files not yet committed.

## Next session starts with

Begin **Feature 05: Profile Page — Full UI**.

Per build plan: build the complete profile page UI with mock data first. No save logic yet. Key sections:
- Profile needs attention banner (completion percentage ring, missing field tags)
- Resume upload area
- Profile Information form (Personal Info, Professional Info, Work Experience ×3, Education, Job Preferences)
- Save Profile button

Run `/architect feature 05` before starting to think through the UI decisions. Then build the page with mock data and verify visually at `http://localhost:3000/profile`.

## Open questions

- Should `linkedin_connected` and `is_tailored` columns be added to the schema? They appear in another AI tool's plan but are absent from `context/architecture.md`. Needs a decision before those features are built.
- Are Google and GitHub OAuth providers fully configured in InsForge for `http://localhost:3000`? Manual OAuth smoke test still not done.
- Should production PostHog `/ingest` rewrite be verified before Feature 05, or deferred to pre-launch?
