# Plan — Feature 16: Recent Activity Real Data

## What was built

- **`components/dashboard/RecentActivity.tsx`** — `ActivityItem` type gains `id: string` as first field; `key={index}` replaced with `key={item.id}`; empty state added when `items.length === 0` ("No activity yet. Run a search to get started." with `/find-jobs` link); `Link` imported from `next/link`
- **`app/dashboard/page.tsx`** — `mockActivity` constant removed; `Promise.all` expanded from 4 to 6 queries (added completed `agent_runs` query and researched `jobs` query, each limited to 20 candidates); `formatRelativeDate` added to utils import; both sources normalized into `ActivityItem[]` via `ActivityCandidate` intermediate type; merged, sorted by timestamp descending, trimmed to 10; `activityItems` passed to `<RecentActivity>`
- **`context/ui-registry.md`** — RecentActivity + ActivityRow entry updated: `id: string` field noted, `key={item.id}` noted, empty state copy and link pattern documented, data sources documented
- **`context/progress-tracker.md`** — Feature 16 marked complete; Feature 17 set as next; Feature 16 decision entry added to Decisions Made section
- **`docs/plan/16-recent-activity-real-data/plan.md`** — this file (saved pre-implementation as the architect plan)

---

## Schema changes

None. Feature 16 queries existing columns only: `agent_runs` (`id`, `job_title_searched`, `jobs_found`, `completed_at`, `status`, `user_id`) and `jobs` (`id`, `company`, `company_research`, `found_at`, `user_id`).

---

## Key invariants

- **Every activity query must be scoped to `authData.user.id`.** The guard `if (!authData.user) redirect("/login")` fires before `Promise.all`, so `authData.user` is non-null at the query site. Never add an activity query without `.eq("user_id", authData.user.id)`.

- **Research events use `company_research.researchedAt` as the display and sort timestamp.** `found_at` is only used as a DB pre-sort for candidate selection. Never use `found_at` to label or order research events in the feed.

- **`company_research IS NOT NULL` is the correct filter for research events.** It is sufficient because `synthesizeDossier` in `agent/research.ts` throws on any failure path, preventing the DB update from running. No empty objects or partial dossiers can be saved.

- **agent_runs are filtered to `status = "completed"` only.** Running rows have no `completed_at` or `jobs_found`. Failed rows are operational state, not user progress. Never include `"running"` or `"failed"` in the activity feed.

- **The 10-item cap is a UI cap, not a per-source quota.** Recency decides which 10 items appear — do not enforce a per-type balance. If all 10 most recent events are searches, that is correct.

- **`ActivityCandidate` is a local non-exported type inside `DashboardPage`.** `sortTs` must be stripped before `activityItems` is passed to `<RecentActivity>`. The component must never receive `sortTs`.

- **Source-qualified IDs must follow the `search-${run.id}` / `research-${job.id}` pattern.** Both tables use UUIDs; the prefix distinguishes the source. Never use bare UUIDs or index-based keys for activity items.

- **Activity query errors are logged with `[dashboard/activity]` prefix and produce `[]` fallbacks.** Never throw from activity loading. The feed degrading to an empty state is correct behavior when queries fail.

- **`RecentActivity` must stay a Server Component.** It receives typed props from `page.tsx`, uses `Link` from `next/link` (server-compatible), and has no state or browser APIs. Do not add `"use client"` without a concrete reason.
