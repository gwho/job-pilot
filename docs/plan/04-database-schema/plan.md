# Plan — Feature 04: Database Schema

## What was built

Four PostgreSQL tables created in InsForge via the `run-raw-sql` MCP tool:

- **`profiles`** — one row per authenticated user. Extends `auth.users` via shared primary key. Holds all profile form data, resume URL, and completion state. Includes an `updated_at` trigger that fires automatically on every save.
- **`agent_runs`** — one row per job search the agent executes. Tracks status, search parameters, and job count.
- **`jobs`** — one row per discovered job listing. Holds Adzuna data, GPT-4o match scoring, and a `company_research` JSONB column for the research agent dossier (Feature 13).
- **`agent_logs`** — append-only operation log written by agent code. Used for debugging and the Recent Activity panel (Feature 16).

Supporting infrastructure:

- **`updated_at` trigger** on `profiles` — DB-level `BEFORE UPDATE` function ensures `updated_at` is always current without relying on application code.
- **6 performance indexes** — composite indexes on `(user_id, found_at DESC)` and `(user_id, match_score DESC)` on `jobs` cover the RLS filter and sort in a single scan for Feature 11. Single-column indexes on `user_id` across `agent_runs` and `agent_logs` cover RLS filters for Features 15 and 16.
- **16 RLS policies** — 4 per table (SELECT, INSERT, UPDATE, DELETE). `profiles` uses `id = auth.uid()`; all other tables use `user_id = auth.uid()`.
- **`resumes` storage bucket** — private bucket created via `create-bucket` MCP tool. Resume PDFs stored at `resumes/{user_id}/resume.pdf` in Features 06 and 08.
- **`types/index.ts`** — canonical TypeScript interfaces for all four tables. Includes literal union types for constrained text columns, named sub-types for JSONB columns, and `Insert` variants reflecting DB defaults.
- **`scripts/schema.sql`** — durable reference file containing the full DDL.

## Files created or modified

| File | Action |
|------|--------|
| `scripts/schema.sql` | Created — full DDL reference |
| `types/index.ts` | Created — all table types |

## Verification

- All four tables verified via `get-table-schema` — columns, indexes, RLS policies, and trigger confirmed against `context/architecture.md`
- `resumes` bucket confirmed via `list-buckets`
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
