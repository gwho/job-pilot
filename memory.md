# Memory — Feature 16 Complete + Full Documentation Suite

Last updated: 2026-07-05

## What was built

### Feature 16 implementation — Recent Activity Real Data (fully complete)

- `components/dashboard/RecentActivity.tsx` — `ActivityItem` type gains `id: string` as first field. `key={index}` replaced with `key={item.id}`. Empty state added when `items.length === 0`: "No activity yet. Run a search to get started." with `/find-jobs` link. `Link` imported from `next/link`.
- `app/dashboard/page.tsx` — `mockActivity` constant removed. `Promise.all` expanded from 4 to 6 queries (added `agent_runs` completed query + `jobs` researched query, each limited to 20 candidates). `formatRelativeDate` added to utils import. Both sources normalized into `ActivityCandidate[]` (local type = `ActivityItem & { sortTs: number }`). Merged, sorted by timestamp descending, trimmed to 10, `sortTs` stripped. `activityItems` passed to `<RecentActivity>`. Error logging with `[dashboard/activity]` prefix.
- `context/ui-registry.md` — RecentActivity + ActivityRow entry updated: `id: string` field documented, `key={item.id}` noted, empty state copy/link pattern documented, data sources documented.
- `context/progress-tracker.md` — Feature 16 marked complete; Feature 17 set as next; Feature 16 decision entry added to Decisions Made section.

### Documentation suite for Feature 16

- `docs/architect/16-recent-activity-real-data/decisions.md` — 7 decisions from the architect session
- `docs/architect/16-recent-activity-real-data/discussion.md` — 11 deep concept sections
- `docs/architect/16-recent-activity-real-data/ai-discussion-topics.md` — 25 questions across 6 groups
- `docs/plan/16-recent-activity-real-data/plan.md` — 5 files documented, 9 invariants captured
- `docs/plan/16-recent-activity-real-data/explanation.md` — 9 sections (end-to-end flow, why found_at is wrong, JSONB filter safety, DB/JS sort gap, flatMap pattern, ActivityCandidate type, source-qualified IDs, no "use client", empty state ownership)
- `docs/plan/16-recent-activity-real-data/ai-discussion-topics.md` — 17 questions across 4 groups
- `docs/tutorials/29-recent-activity-real-data/README.md` — Tutorial 29: 8 parts, 5 LLM pre-study prompts, 3 challenges, "Good next /teach topics" section

---

## Decisions made

- **Research events use `company_research.researchedAt` as the display and sort timestamp** — `found_at` is when the job was scraped, not when research ran. These differ by days when a user finds a job and researches it later. `researchedAt` is written by `agent/research.ts:283` on every successful synthesis.
- **DB pre-sort uses `found_at`, JS re-sort uses `researchedAt`** — InsForge SDK cannot sort by JSONB subfields. `found_at` is used only for candidate pre-selection (top 20 by recency); `researchedAt` is used for the final display order.
- **20 candidates per source, 10 items in the final feed** — wider candidate pool reduces the risk of missing a recently-researched old job that falls outside the top 10 by `found_at`.
- **`company_research IS NOT NULL` is the correct filter for research events** — `synthesizeDossier` throws on any failure path, so the DB update never runs on failure. No empty objects or partial dossiers can be saved.
- **`agent_runs` filtered to `status = "completed"` only** — running rows have null `completed_at` and `jobs_found`. Failed rows are operational state, not user achievements. Neither belongs in the feed.
- **No per-source quota** — recency decides which 10 items appear. Enforcing balance (5 search, 5 research) would distort the chronological truth.
- **`id: string` added to `ActivityItem`** — source-qualified IDs: `search-${run.id}` / `research-${job.id}`. Enables `key={item.id}` and self-documenting React DevTools.
- **Empty state inside `RecentActivity`**, not `page.tsx` — the component owns all rendering states of the activity card. Page passes props, component decides what to render.
- **`RecentActivity` stays a Server Component** — `Link` from `next/link` is server-compatible. No state, no browser APIs. No `"use client"` needed.
- **Activity query errors: log with `[dashboard/activity]` prefix, produce `[]` fallback, never throw** — extends the Feature 15 degradation contract to the activity feed.

---

## Problems solved

- **TypeScript narrowing with `.filter().map()` on JSONB extraction** — `.filter()` does not carry type narrowing into the subsequent `.map()` callback. Used `.flatMap()` instead: `if (!researchedAt) return []; return [item]` narrows the type cleanly within the same callback.
- **`sortTs` field isolation** — `ActivityCandidate = ActivityItem & { sortTs: number }` declared inside `DashboardPage` function body (not exported). Stripped via explicit destructuring `.map(({ id, type, label, timeAgo }) => ...)` before passing to component.
- **`type: "research" as const` required inside `flatMap`** — TypeScript infers the string literal type as `string` without `as const`, failing the `"search" | "research"` union check.

---

## Current state

- **Feature 16 fully complete** — Recent Activity feed shows real DB data from `agent_runs` and `jobs`; verified in-browser; all documentation and Tutorial 29 written
- **29 tutorials** written
- **Build clean** — TypeScript and lint pass
- **Mock data remaining in `page.tsx`**: `mockCompanyResearchData`, `mockJobsFoundData`, `mockMatchScoreData` for the three chart components — intentional, deferred to Feature 17
- **Find Jobs save bug still fixed** — `pg_stat_statements` extension enabled from last session; E2E confirmed

---

## Next session starts with

Run `/remember restore`, check `context/build-plan.md` for Feature 17 scope (chart real data from PostHog), then `/architect Feature 17` before any code. Feature 17 wires the three chart components (`CompanyResearchChart`, `JobsFoundChart`, `MatchScoreChart`) to real PostHog analytics data, replacing the three remaining mock constants in `page.tsx`.

---

## Open questions

- **GitHub Issue #19** — `job_found` PostHog event fires only for `match_score >= 70` (should fire for all saved jobs). Fix in `app/api/agent/find/route.ts`. Must be resolved before Feature 17 (which depends on PostHog event counts being accurate).
- **`catch` path still silent** — `handleSearch` `catch` block only calls `console.error`. Needs `setSearchStatus({ message: "Network error...", isError: true })`. Deferred.
- **DB-level race condition** — concurrent `/api/agent/find` requests from same user could insert duplicate jobs. Needs `UNIQUE (user_id, source_url)`. Deferred.
- **JobsDB session expiry** — re-capture needed ~mid-July 2026. Run `node scripts/capture-jobsdb-session.mjs`.
- **`not-found.tsx`** — custom 404 page absent. Minor; deferred.
- **Fire-and-forget `agent_runs` status updates** — all error branches in `app/api/agent/find/route.ts` don't check the result of `agent_runs` UPDATE to `status: "failed"`. Pre-existing; deferred.
- **InsForge new database setup runbook** — after creating any new InsForge DB, run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` immediately or batch INSERTs will fail silently.
