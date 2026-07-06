# Architect Discussion — Feature 17: Analytics Charts Real Data

## 1. Why `posthog-node` cannot query PostHog

The build plan said "query PostHog for `job_found` events." This phrasing implied using the PostHog SDK to read event history. But there are two fundamentally different things you can do with an analytics service:

**Sending events (capture):** You record something that happened — "user found a job," "user searched." This is what `posthog-node` does. It fires and forgets. The SDK provides `posthog.capture()` and `posthog.identify()`. The library version on this project (`posthog-node`) is designed for this direction only.

**Querying events (read):** You ask "how many `job_found` events fired in the last 7 days for this user?" This is analytics. `posthog-node` has no methods for this — it is not in the SDK's surface area.

To query PostHog you would use their REST API: an HTTP endpoint like `GET https://us.posthog.com/api/projects/{projectId}/events/?event=job_found`. This requires:
- A numeric `projectId` from the PostHog dashboard URL (e.g., `https://app.posthog.com/project/12345`)
- The project API key as an auth header

The key insight: `NEXT_PUBLIC_POSTHOG_KEY` (the `phc_xxx` string) is for **sending** events. The numeric project ID is for **querying** them. They are different identifiers. Adding the project ID as a new env var and writing a raw `fetch()` wrapper to PostHog's REST API would be a meaningful new integration — not a small wiring step.

Given that the data already lives in the DB with better accuracy and no added complexity, the PostHog REST API approach was not worth the trade-off.

---

## 2. Why the DB is actually the right source for these charts

These three charts are personal dashboards — they show each user their own activity. The data they need:

| Chart | Question | DB column |
|---|---|---|
| Jobs Found Over Time | How many jobs did this user save each day? | `jobs.found_at` |
| Company Research Activity | How many companies did this user research each day? | `jobs.company_research.researchedAt` |
| Match Score Distribution | How are this user's job scores distributed? | `jobs.match_score` |

All three answers are in the `jobs` table, scoped to the current user. The DB is not a degraded fallback — it is the correct source of truth for per-user activity. PostHog is the correct tool for cross-user, cross-session behavioral analysis ("what percentage of users searched more than 3 times?"). For a personal dashboard, the DB wins on every dimension: accuracy, latency, cost, and simplicity.

---

## 3. The posthog-node vs PostHog REST API distinction

This comes up on any project that uses PostHog (or any analytics tool with separate ingest and query surfaces):

**`posthog-node`** — an SDK for the **ingest endpoint**. It handles batching, flushing, retries, and the PostHog event format. Think of it as a typed HTTP client for `POST /capture`. It knows nothing about reading data back.

**PostHog REST API** — a set of endpoints for managing projects, reading events, running insights queries, and accessing analytics results. It is a completely separate API surface. The SDKs for this are either PostHog's own management API client (which is not `posthog-node`) or raw `fetch()` calls.

This pattern appears in most analytics platforms: Firebase has separate SDKs for event logging vs. BigQuery export; Amplitude has separate clients for event tracking vs. analytics queries; Mixpanel separates the ingestion and data export APIs. When a build plan says "query PostHog," it is often assuming these surfaces are unified — they are not.

---

## 4. What Issue #19 actually broke, and why the fix is safe

Issue #19 was a logical bug in the event-firing loop. The original comment said "One job_found event per strong match." This was intentional at one point — maybe the goal was to count "high-value jobs found" rather than "all jobs found." But the PostHog event description in `code-standards.md` says `job_found: Each job discovered and saved` — not just strong matches. The implementation drifted from the specification.

**The impact:** PostHog's count of `job_found` events is lower than the DB's count of rows in the `jobs` table. A user who found 20 jobs in a search, where 4 were strong matches, would show only 4 `job_found` events in PostHog even though 20 jobs were saved. Any future analytics using PostHog event counts (e.g., "avg jobs found per search") would systematically undercount.

**Why the fix is safe:** The fix moves one `await captureServerEvent` call outside an `if` block. The `strongMatches` counter is preserved via a `let` + increment pattern. The success message copy is unchanged. No other downstream logic depends on the firing condition. The only behavioral change is that PostHog receives more events — which is the intended behavior per the spec.

**The refactor:**
```typescript
// Computes strongMatches AND fires events in one loop
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({ event: "job_found", properties: { matchScore: job.match_score, ... } });
}
```

Note: `captureServerEvent` is called sequentially (awaited in a loop) not in parallel. Each call creates a new PostHog client, sends one event, and calls `shutdown()`. For 10 jobs this adds latency. This is pre-existing behavior, not introduced by the fix. A future optimization could batch all events into one PostHog client instance rather than creating 10.

---

## 5. The rolling 7-day window: why it beats "current week"

A "current week" window (Monday through Sunday of the present week) sounds intuitive but has a concrete problem: the chart would show future days.

If today is Wednesday, a Mon–Sun current-week chart needs to render 7 slots. Mon, Tue, Wed have real data. Thu, Fri, Sat, Sun are the future — they show zero bars. The user sees 4 empty bars on the right side of the chart, which looks like "nothing happened" when actually those days haven't occurred yet. This creates a misleading visual that looks like activity dropped off.

A rolling window ending today always shows historical data. The 7 slots are:
- today - 6 days
- today - 5 days
- today - 4 days
- today - 3 days
- today - 2 days
- yesterday
- today

No future days. Every bar represents real time that has passed. Zero bars mean "nothing happened that day," not "that day is in the future."

**The weekday label observation:** 7 consecutive calendar days always contains exactly one instance of each weekday (Monday through Sunday). This is because 7 = 7 × 1. There are no duplicate labels. If today is Wednesday, the 7 labels are: Thu, Fri, Sat, Sun, Mon, Tue, Wed (oldest to newest) — all 7 weekday names, all distinct.

---

## 6. The cutoff precision problem: rolling hours vs. calendar day boundary

The implementation choice for the research chart cutoff is subtle but important.

**The naive approach:** `Date.now() - 7 * 24 * 60 * 60 * 1000`

This is a 168-hour window ending now. It sounds like "last 7 days" but it can miss events on the oldest day.

**Example:** The page renders at 2 PM on Sunday. The cutoff is 2 PM last Sunday. The oldest bucket in the chart is last Sunday. A research event that happened at 11 AM last Sunday (before the cutoff) would be excluded, even though "last Sunday" is one of the 7 displayed days. The bar for last Sunday would be missing that event.

**The correct approach:** Compute the oldest bucket as a calendar date, then set the cutoff to midnight of that date:
```typescript
const oldestDay = new Date();
oldestDay.setDate(oldestDay.getDate() - 6);
oldestDay.setHours(0, 0, 0, 0); // midnight = start of that calendar day
const cutoff = oldestDay.getTime();
```

This ensures that "any event on the oldest displayed day" is included, regardless of what time on that day it occurred.

**Why this only matters for the research chart:** The jobs-found chart uses a DB query with `.gte("found_at", sevenDaysAgo)`. The DB filter uses the same `sevenDaysAgo` value (`getIsoTimestampDaysAgo(7)`) and returns all matching rows. The JS aggregation loop then groups by `toDateString()`. Since the DB has already pre-filtered, the JS loop doesn't need a separate cutoff — every row from the query belongs in one of the 7 buckets by definition.

The research chart fetches ALL researched jobs (no date filter in the query), so the JS loop is responsible for the cutoff. This is why the cutoff precision matters only for `buildResearchByDay`.

---

## 7. Why `researchJobsResult` cannot be reused for the chart

Feature 16 established a foundational truth: `found_at` ≠ `researchedAt`. A job can be found (scraped from JobsDB) on Day 1 and researched by the user on Day 30. These are distinct timestamps.

`researchJobsResult` was designed for the Recent Activity feed. Its query:
```typescript
.select("id, company, company_research")
.not("company_research", "is", null)
.order("found_at", { ascending: false })
.limit(20)
```

It fetches the 20 most recently **found** jobs that have research. This is correct for the activity feed — you want the most recent jobs overall, and you display when each was researched (via `researchedAt`).

For the chart, the question is different: "How many jobs were researched on each of the last 7 days?" A job found 60 days ago but researched yesterday is highly relevant to the chart — it should appear in yesterday's bar. But it would not appear in `researchJobsResult` if 20 more recently-found jobs also have research.

The chart query removes both constraints:
```typescript
.select("company_research")
.not("company_research", "is", null)
// no .order(), no .limit()
```

Every researched job for this user is returned. The JS loop then reads `researchedAt` and applies the 7-day cutoff from the oldest bucket's start of day. This correctly counts all research events within the window, regardless of when the underlying job was found.

---

## 8. The type predicate pattern for JSONB extraction

TypeScript cannot know the shape of a JSONB column at compile time — the DB stores arbitrary JSON, and the SDK returns `unknown` or `Record<string, unknown>`. The temptation is to assert:

```typescript
const research = job.company_research as { researchedAt?: string };
```

`code-standards.md` discourages assertions because they bypass runtime verification. If the JSONB shape changes (say, a migration renames `researchedAt` to `timestamp`), TypeScript won't catch it — the assertion silently passes and `research.researchedAt` returns `undefined` with no error.

A type predicate is the alternative: a function that checks the shape at runtime and tells TypeScript about the result via `v is SomeType`:

```typescript
type ResearchWithTimestamp = { researchedAt: string };

function hasResearchedAt(v: unknown): v is ResearchWithTimestamp {
  return (
    v !== null &&
    typeof v === "object" &&
    "researchedAt" in v &&
    typeof (v as Record<string, unknown>).researchedAt === "string"
  );
}
```

After calling `hasResearchedAt(v)`, TypeScript narrows the type to `ResearchWithTimestamp` inside the true branch. There is one internal `as Record<string, unknown>` — this is a safe structural refinement after the null/object check, not a blind assertion. The `typeof x.researchedAt === "string"` check catches the actual value before it's used.

Contrast the calling code:
```typescript
// With assertion — no runtime check:
const ts = (job.company_research as { researchedAt?: string })?.researchedAt;

// With type predicate — runtime-verified:
if (!hasResearchedAt(job.company_research)) continue;
const ts = new Date(job.company_research.researchedAt).getTime(); // fully typed
```

The predicate version is also reusable — `buildResearchByDay` calls it in a loop. If the predicate check were inline, the same logic would repeat on every iteration.

---

## 9. JS aggregation on the server vs. DB aggregation

A SQL-native approach to these charts would use `DATE_TRUNC`, `GROUP BY`, and `COUNT`. For the jobs-found chart:
```sql
SELECT DATE_TRUNC('day', found_at) AS day, COUNT(*) as count
FROM jobs
WHERE user_id = $1 AND found_at >= $2
GROUP BY day ORDER BY day;
```

This is one query, zero JS aggregation. InsForge's SDK doesn't expose a grouping API on the query builder (no `.groupBy()`, no aggregate functions). Raw SQL via the MCP tool is for schema operations, not for runtime queries in Server Components.

JS aggregation is the correct approach here given the tools available:
1. Fetch raw rows with the relevant columns
2. Group and count in JS on the server before passing to the component

The cost: more rows transferred from DB to server. For a personal dashboard with one user's data, the row counts are small (tens to hundreds of jobs) — JS aggregation has negligible overhead. The pattern would become a bottleneck at tens of thousands of rows, at which point a raw SQL query or a DB function would be appropriate.

---

## 10. `page.tsx` is a Server Component — aggregation functions run on the server

The aggregation functions (`buildJobsFoundByDay`, `buildResearchByDay`, `buildMatchScoreDistribution`) are module-level pure functions in `page.tsx`. Because `page.tsx` is a Server Component (no `"use client"` directive), these functions run on the server at request time — never in the browser.

This means:
- `new Date()` inside the aggregation functions uses server time, not browser time. This is correct for generating 7-day bucket boundaries.
- The functions have access to Node.js APIs if needed (though none are used here).
- The functions are not re-executed on client navigation — they run only when the Server Component renders on the server.

The chart components (`CompanyResearchChart`, `JobsFoundChart`, `MatchScoreChart`) are `"use client"` — they need Recharts, which is browser-only. But they receive already-computed data as props. No computation happens in client context.

This is the data flow: server computes → props passed → client renders. The boundary is clean.
