# Tutorial 30 — Analytics Charts Real Data: DB Aggregation, Rolling Windows, and Type-Safe JSONB

**After completing this tutorial you will understand:** why `posthog-node` cannot query event history and why the DB is the correct source for per-user personal dashboards; how to build a rolling 7-day bucket array that never shows future days and why "current calendar week" produces misleading empty bars; how a calendar-day cutoff (`setHours(0,0,0,0)`) prevents a rolling-hours cutoff from silently excluding early-morning events on the oldest displayed day; why a type predicate (`v is SomeType`) provides runtime safety that a type assertion (`as SomeType`) does not; and how a hash map initialised from a constant array produces an O(1) frequency distribution without scanning the array twice.

---

> [!NOTE]
> **Prerequisites:** Tutorial 29 (`../29-recent-activity-real-data/README.md`) — covers the `found_at` vs `researchedAt` invariant (why a job's scrape timestamp differs from its research timestamp), the 8-query `Promise.all` degradation contract, and module-level aggregation placement. Tutorial 28 (`../28-stats-bar-real-data/README.md`) — covers concurrent queries with `Promise.all`, the `[dashboard/stats]` error-logging prefix pattern, and `?? 0` safe fallback chaining. Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx) and [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Hash map for frequency counting | `new Map<string, number>(SCORE_RANGES.map(...))` in `buildMatchScoreDistribution` | Data structures |
| Type predicate (type refinement) | `function hasResearchedAt(v: unknown): v is ResearchWithTimestamp` | Type theory |
| Rolling window with calendar-day anchor | `setHours(0, 0, 0, 0)` in `buildResearchByDay` | Algorithms |
| Capture-only vs. query SDK (write vs. read) | `posthog-node` is write-only; DB is the read source for charts | System design |
| Bounded fan-out with per-source degradation | 8 concurrent queries, each with independent `null` fallback | System design |

---

## How to use an LLM before this tutorial

Budget 30–35 minutes across these five concepts.

### Concept 1 — Analytics SDKs: capture vs. query

> "Explain the difference between an analytics SDK's *capture* surface and its *query* surface. PostHog's `posthog-node` SDK is listed as an npm package for server-side event tracking. Does that mean I can use it to query event history — for example, 'how many `job_found` events did this user produce in the last 7 days'? What endpoint would I need to call to read PostHog event history, and what authentication identifier would that require — the same project API key used for capturing, or a different one? Give a concrete example of two distinct identifiers an analytics platform might use for write vs. read access. Quiz me: I have `posthog.capture({ event: 'job_found' })` working in my server code. Can I call `posthog.getEvents({ event: 'job_found', since: '7d' })` to get a count?"

*What to listen for:* Most analytics platforms separate the *ingest endpoint* (you write events to it) from the *query API* (you read aggregated history from it). These use different authentication identifiers — a write key (often public, can be embedded in client-side JS) vs. a project ID or read key (private, used for management API calls). `posthog-node` only wraps the ingest endpoint. Reading history requires the PostHog REST API, a separate numeric project ID, and a raw `fetch()` call. The SDK surface has no `getEvents` method because it was never designed for reads.

*Practice question:* You have `NEXT_PUBLIC_POSTHOG_KEY = "phc_xxx"` in your env file. Can this key be used to query event history? What does `NEXT_PUBLIC_` in the name tell you about where it is safe to use?

---

### Concept 2 — Rolling windows vs. calendar periods

> "I want to show a bar chart with 7 bars, one per day, covering the last week. Explain the difference between a 'rolling 7-day window ending today' and a 'current Mon–Sun calendar week.' If today is Wednesday, draw the bar labels for each approach. Which approach shows days in the future as empty bars? Why is an empty bar for a future day visually misleading for an activity chart? Then: for a rolling window ending today, how many unique weekday names (Mon, Tue, …, Sun) appear across the 7 bars? Can any weekday name appear twice? Quiz me: today is Saturday. List the 7 bar labels for a rolling window ending today, oldest to newest."

*What to listen for:* A rolling window always shows 7 days of historical data — no future bars. A calendar-week approach shows future days as zero bars, which looks like "activity dropped off" rather than "those days haven't happened yet." Seven consecutive calendar days spans exactly one full week cycle, so all 7 weekday names appear exactly once — there are never duplicate labels or missing weekdays. The key implementation detail: generate buckets as `new Date(); d.setDate(d.getDate() - i)` for `i` from 6 down to 0.

*Practice question:* Today is Tuesday. List the 7 labels for a rolling window, oldest to newest. Now list what a Mon–Sun calendar week would show. Which approach has empty future bars?

---

### Concept 3 — Hash maps for frequency counting

> "I have an array of 500 objects, each with a `score` property between 0 and 100. I want to count how many scores fall into each of 5 ranges: 50–59, 60–69, 70–79, 80–89, 90–100. Show me two approaches: (a) for each score, scan all 5 ranges; (b) pre-build a hash map keyed by range label and increment the matching entry. What is the time complexity of each? In JavaScript, how do I initialise a `Map<string, number>` so every key already exists with a count of 0 before I start scanning the input array? Show me the syntax for creating a Map from an array of `[key, value]` pairs. Quiz me: what does `new Map([['a', 0], ['b', 0], ['c', 0]])` produce?"

*What to listen for:* Both approaches are O(n × k) where n is the number of items and k is the number of buckets, but the hash map approach is practically faster because lookups are O(1) with no inner loop overhead. More importantly, the Map approach pre-declares all buckets with zero counts, so every key is guaranteed to exist — no "key not found" checks needed. `new Map(array)` accepts an iterable of `[key, value]` pairs, which pairs perfectly with `.map(item => [item.label, 0])` on a constant array of range definitions.

*Practice question:* I have `SCORE_RANGES = [{ range: '50-60%', min: 50, max: 59 }, ...]`. Write the one-liner that initialises a `Map<string, number>` with every range label mapped to 0.

---

### Concept 4 — TypeScript type predicates

> "In TypeScript, what is a type predicate? Explain the difference between `function isString(v: unknown): v is string` and `function isString(v: unknown): boolean`. When you use the first form inside an `if` condition, what does TypeScript know about `v` inside the true branch? Now: I have a variable `data: unknown` that I believe is an object with a `researchedAt: string` property. Show me a type predicate that verifies this at runtime — checking that `data` is not null, is an object, has the key `researchedAt`, and that `researchedAt` is a string. Compare this to just writing `(data as { researchedAt: string })`. What runtime safety does the predicate add that the assertion does not? Quiz me: after `if (hasResearchedAt(data)) { ... }`, what does TypeScript infer as the type of `data` inside the braces?"

*What to listen for:* A type predicate (`v is SomeType`) is a return type annotation that tells TypeScript: "when this function returns `true`, narrow `v` to `SomeType` in the surrounding context." A plain `boolean` return provides no narrowing. A type assertion (`as SomeType`) is purely a compile-time instruction — it adds no runtime check and silently passes even if the value has the wrong shape. The predicate actually executes checks at runtime; the assertion does not. After `if (hasResearchedAt(data))`, TypeScript narrows `data` to `ResearchWithTimestamp` inside the true branch, making all field accesses type-safe.

*Practice question:* A type predicate checks `'researchedAt' in v`. A DB migration later renames the field to `researched_at`. Does TypeScript catch the mismatch at compile time? What happens at runtime?

---

### Concept 5 — Cutoff precision: rolling hours vs. calendar-day anchor

> "I want to filter database records to only those from the last 7 days. I have two options: (a) compute `Date.now() - 7 * 24 * 60 * 60 * 1000` as the cutoff; (b) take today's date, go back 6 calendar days, and set the time to midnight (`00:00:00`). Explain the difference. If my page renders at 2:00 PM on Sunday, what is the earliest moment included by option (a) vs. option (b)? Construct a specific event — with a real timestamp — that option (a) would exclude but option (b) would include, even though that event occurred on one of the 7 displayed days. Quiz me: I display day buckets for 'Sun, Mon, Tue, Wed, Thu, Fri, Sat' and today is Saturday. With option (a) (rolling hours cutoff at render time), could an event from last Saturday at 8 AM be excluded from the 'Sat' bucket even though 'Sat' is displayed? Why?"

*What to listen for:* Option (a) is a floating window: it includes exactly 168 hours before the moment the page renders. If the page renders at 2 PM Sunday, events from last Sunday before 2 PM are excluded — even though "last Sunday" is one of the 7 displayed bars. Option (b) is anchored to midnight of the oldest calendar day, so any event on that calendar day — at any hour — is included. The mismatch between "7 displayed buckets" and "168 floating hours" is only visible on the oldest bucket: events early in that day can fall outside the rolling window even though their day's bar is shown.

*Practice question:* The page renders at 3:45 PM on Friday. The oldest displayed bucket is "last Friday." With a rolling-hours cutoff, are events from last Friday at 9 AM included or excluded?

---

## Architecture overview

```
  GET /dashboard
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  app/dashboard/page.tsx                                      SERVER ONLY  │
│                                                                           │
│  Module-level (run once at startup, not per request):                     │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  hasResearchedAt(v): v is ResearchWithTimestamp  (type predicate)  │   │
│  │  SCORE_RANGES = [{range, min, max}, ...]         (5 buckets)       │   │
│  │  buildJobsFoundByDay(jobs)  → {day, count}[]                       │   │
│  │  buildResearchByDay(jobs)   → {day, count}[]                       │   │
│  │  buildMatchScoreDistribution(jobs) → {range, count}[]              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  Per request:                                                             │
│  1. createInsforgeServer() + getCurrentUser()                             │
│     └─ no user → redirect("/login")                                      │
│                                                                           │
│  2. Profile query → isComplete bool                                       │
│                                                                           │
│  3. sevenDaysAgo = getIsoTimestampDaysAgo(7)                              │
│                                                                           │
│  4. Promise.all([q1..q8])  ← 8 concurrent queries                       │
│     │   q1–q4: stats (Tutorial 28, unchanged)                            │
│     │   q5–q6: activity feed (Tutorial 29, unchanged)                    │
│     │   q7: found_at for jobs WHERE found_at >= sevenDaysAgo             │
│     └─  q8: company_research for all non-null rows (no limit)            │
│                                                                           │
│  5. Log errors for all 8 queries                                          │
│                                                                           │
│  6. Aggregate chart data:                                                 │
│     jobsFoundData       = buildJobsFoundByDay(q7.data ?? [])             │
│     companyResearchData = buildResearchByDay(q8.data ?? [])               │
│     matchScoreData      = buildMatchScoreDistribution(q2.data ?? [])     │
│                                                                           │
│  7. Pass arrays as props to chart components                              │
└──────────────────┬───────────────────────────────────────────────────────┘
                   │  fully computed {day,count}[] and {range,count}[]
                   ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  "use client" chart components  (Recharts, browser-only)        │
   │  CompanyResearchChart  data={companyResearchData}               │
   │  JobsFoundChart        data={jobsFoundData}                     │
   │  MatchScoreChart        data={matchScoreData}                    │
   │  No aggregation. No DB calls. Render props only.                │
   └─────────────────────────────────────────────────────────────────┘
```

**Key invariants:**
1. `chartResearchJobsResult` (query 8) must never be replaced with `researchJobsResult` (query 6). Query 6 is `.limit(20)` ordered by `found_at` — it misses recently-researched older jobs. Query 8 has no limit and no order.
2. The cutoff in `buildResearchByDay` must be anchored to `setHours(0,0,0,0)` on the oldest bucket, never `Date.now() - 7 * 24 * 60 * 60 * 1000`.
3. Chart components receive fully computed arrays as props and do no aggregation themselves — all computation happens in `page.tsx` before the JSX return.

---

## Part 1 — Why the build plan said "PostHog" and why the implementation uses the DB

The Feature 17 build plan originally specified "query PostHog for `job_found` events" for the Jobs Found Over Time chart. This phrasing implied that `posthog-node` — the PostHog SDK already installed in the project — could fetch event history at render time. It cannot.

Open [`lib/posthog-server.ts`](../../../lib/posthog-server.ts) and scan its exported surface: `captureServerEvent`. That is the entire public API. No `getEvents`, no `queryEvents`, no `fetchCounts`. `posthog-node` is a **capture-only SDK** — its entire purpose is sending events to PostHog's ingest endpoint via `posthog.capture()`. The direction of data flow is one-way: application → PostHog. The SDK was never designed for the reverse.

To read PostHog event history you would need PostHog's REST API — an HTTP endpoint like `GET https://us.posthog.com/api/projects/{projectId}/events/?event=job_found`. This requires a *numeric* project ID found in the PostHog dashboard URL (e.g., `https://app.posthog.com/project/12345`), which is completely different from the `NEXT_PUBLIC_POSTHOG_KEY` (`phc_xxx` string) used for event capture. Adding the project ID as a new env var plus a raw `fetch()` wrapper would be a meaningful new integration — not a small wiring step.

More importantly, the DB is the correct source for these charts anyway. The three charts answer per-user questions: "How many jobs did *I* save each day? How many companies did *I* research? How are *my* job scores distributed?" All the data for those questions lives in the `jobs` table, scoped to the current user. PostHog is the correct tool for cross-user, aggregate behavioral analysis ("what percentage of all users research companies after saving jobs?"). The DB is the correct tool for per-user personal dashboards.

> **System design — Capture-only vs. query SDK:** Many analytics platforms separate their ingest and query surfaces. Firebase has separate SDKs for event logging vs. BigQuery export. Amplitude separates its event tracking client from its data export API. Mixpanel separates ingestion from data export. This split is intentional: write keys can be embedded in client-side code without risk (they can only add events, not read them); read keys require server-side protection. When a build plan says "query PostHog," it often assumes these surfaces are unified — they are not.

**Checkpoint:** `posthog-node` requires `await posthog.shutdown()` after each server-side `captureServerEvent` call. Could you use `posthog-node` to query event history if you called different methods, or is the limitation architectural? What would you need to add to the project to query PostHog event history?

<details>
<summary>Reveal answer</summary>

The limitation is architectural. `posthog-node` wraps the PostHog *capture* HTTP endpoint (`POST /capture`). It has no methods for querying — not because those methods are missing from this version, but because the underlying HTTP endpoint it talks to does not support reads. To query event history you would need to call a completely different URL: PostHog's REST API (e.g., `GET /api/projects/{projectId}/events/`). This requires a numeric `POSTHOG_PROJECT_ID` env var (not present in this project), a different authentication header, and a new `fetch()` wrapper in the codebase. None of this is available by calling different `posthog-node` methods.

</details>

**Try it yourself:** Search the project for `posthog` to find every file that imports the PostHog SDK. List which files use `captureServerEvent` (write path) and confirm there is no file that calls a PostHog read method. This confirms the SDK is used exclusively for capture in this codebase.

---

## Part 2 — Issue #19: the job_found event gating bug

Before Feature 17, there was a bug in [`app/api/agent/find/route.ts`](../../../app/api/agent/find/route.ts): the `job_found` PostHog event only fired for jobs scoring at or above `MATCH_THRESHOLD` (70). The code used a `.filter().length` to count strong matches separately, then only fired events inside that threshold guard.

Open `app/api/agent/find/route.ts`, lines 260–274:

```ts
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({
    distinctId: userId,
    event: "job_found",
    properties: {
      userId,
      source: "search",
      sourceProvider: "jobsdb_hk",
      matchScore: job.match_score,
      company: job.company,
    },
  });
}
```

This is the fixed version. `captureServerEvent` is called unconditionally for every inserted job. `strongMatches` is still counted — it appears in the success message returned to the client ("Found 20 jobs and saved 12 new jobs") — but it no longer gates the event.

Before the fix, a search that inserted 20 jobs with 4 strong matches would produce 4 `job_found` events in PostHog even though 20 rows were added to the DB. The `code-standards.md` definition for `job_found` is explicit: *"Each job discovered and saved."* Not "each strong match discovered." The implementation had drifted from the specification.

The refactor combines two things that were previously separate:

```ts
// Before (simplified):
const strongMatches = insertedJobs.filter(
  (j) => (j.match_score ?? 0) >= MATCH_THRESHOLD,
).length;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) {
    await captureServerEvent({ event: "job_found", ... });
  }
}

// After:
let strongMatches = 0;
for (const job of insertedJobs) {
  if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
  await captureServerEvent({ event: "job_found", ... });
}
```

The `.filter().length` becomes a `let` counter incremented inside the loop. One pass does both jobs — count strong matches and fire an event for every job. This fix was applied before the chart work because the Jobs Found Over Time chart counts on job_found events being accurate going forward. The historical PostHog data before the fix is permanently undercounted, but the DB data (from `found_at`) was always accurate — which is why the DB is used as the chart source.

**Checkpoint:** Before the fix, a user ran 10 searches over 7 days, each saving 8 jobs with 2 strong matches per search. What is the discrepancy between the `job_found` event count in PostHog vs. the row count in the DB? What visual effect would this have caused if the Jobs Found chart had used PostHog as its source?

<details>
<summary>Reveal answer</summary>

PostHog would have 20 `job_found` events (10 searches × 2 strong matches each). The DB would have 80 rows (10 searches × 8 jobs each). That is a 4× undercount in PostHog. If the Jobs Found chart had used PostHog as its source, each day's bar height would be roughly one-quarter of the real value. The chart would show low activity even on productive search days. The DB source is immune to this bug because `found_at` is written on every `INSERT` regardless of match score.

</details>

---

## Part 3 — Two new queries: why `chartResearchJobsResult` must be its own query

Feature 17 adds two queries to the existing `Promise.all` block in `app/dashboard/page.tsx`. Open lines 113–174:

```ts
const [
  totalJobsResult,
  scoredJobsResult,
  companiesResult,
  thisWeekResult,
  agentRunsResult,
  researchJobsResult,
  recentJobsResult,
  chartResearchJobsResult,
] = await Promise.all([
  // ... q1–q6 unchanged from Tutorials 28 and 29 ...

  // q7 — Jobs Found Over Time chart
  insforge.database
    .from("jobs")
    .select("found_at")
    .eq("user_id", authData.user.id)
    .gte("found_at", sevenDaysAgo)
    .order("found_at", { ascending: false }),

  // q8 — Company Research Activity chart (no limit — must not miss recently researched older jobs)
  insforge.database
    .from("jobs")
    .select("company_research")
    .eq("user_id", authData.user.id)
    .not("company_research", "is", null),
]);
```

Query 7 (`recentJobsResult`) fetches only `found_at` for jobs in the last 7 days — the raw timestamps that `buildJobsFoundByDay` will bucket. The DB does the date filtering; JavaScript just groups by calendar day.

Query 8 (`chartResearchJobsResult`) fetches `company_research` for all non-null researched jobs with **no limit and no ordering**. This is the critical design decision. Tutorial 29 established the `found_at` ≠ `researchedAt` invariant: a job can be scraped on Day 1 and researched on Day 30. Query 6 (`researchJobsResult`, used for the activity feed) is `.order("found_at", ascending: false).limit(20)` — it returns the 20 most recently *found* jobs that have research. That is correct for the activity feed.

For the chart, the question is different: "how many research runs happened on each of the last 7 days?" A job found 90 days ago but researched yesterday belongs in yesterday's bar. If the user has 25 researched jobs and query 8 were replaced with query 6, the oldest 5 by `found_at` would be silently excluded. If the recently-researched-but-old-job is among those 5, yesterday's bar is wrong.

Query 8 removes both constraints. Every researched job is returned. The 7-day filtering happens in JavaScript by reading `researchedAt` from the JSONB column — because `found_at` is the wrong clock for research events.

> **System design — Bounded fan-out with per-source degradation:** The `Promise.all` block now has 8 queries. As established in Tutorial 28, concurrent independent queries do not stack their latency — all 8 fire at the same moment and the page wait is the time of the slowest one. Each result is checked independently after `Promise.all` resolves: `recentJobsResult.error` logs as `[dashboard/charts] recent jobs`, `chartResearchJobsResult.error` logs as `[dashboard/charts] research chart`. A failure in either chart query degrades that chart to all-zero bars while leaving all other stats and charts intact.

**Checkpoint:** Query 8 has no `.limit()`. In theory, a user could have researched hundreds of companies. Is an unbounded query safe here? At what scale would it become a problem, and what would you do at that scale?

<details>
<summary>Reveal answer</summary>

For the user base this application targets, hundreds of researched jobs per user is an unlikely extreme. The query is safe in practice. At scale — say, tens of thousands of researched jobs per user — an unbounded query would transfer large amounts of data from the DB to the server just to aggregate it down to 7 numbers. At that point, the correct solution is a DB-side aggregation: a raw SQL query using `DATE_TRUNC('day', (company_research->>'researchedAt')::timestamptz)` with `GROUP BY` and `COUNT(*)`. The InsForge SDK does not expose a `.groupBy()` method, so this would require a serverless DB function or raw SQL. For the current scale, the JavaScript aggregation approach is correct and simple.

</details>

**Try it yourself:** Search `page.tsx` for the string `researchJobsResult` and confirm it is used for the activity feed only. Then find `chartResearchJobsResult` and confirm it is used only for chart aggregation. The two queries serve different purposes and neither can substitute for the other.

---

## Part 4 — Rolling 7-day windows: building buckets that never show future days

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 33–50:

```ts
function buildJobsFoundByDay(
  jobs: { found_at: string }[],
): { day: string; count: number }[] {
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    const ds = new Date(job.found_at).toDateString();
    const b = buckets.find((bk) => bk.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}
```

The bucket generation loop starts at `i = 6` (oldest day) and counts down to `i = 0` (today). At each step, `d.setDate(d.getDate() - i)` moves a `Date` object to the target day. Each bucket stores two keys: `dateStr` (the full calendar date string used for matching) and `day` (the short weekday name shown on the chart X-axis).

The alternative — anchoring to Monday of the current calendar week — was rejected for a concrete visual reason: if today is Wednesday, Monday-anchored buckets would include Thursday, Friday, Saturday, and Sunday as future days. A user opening the dashboard on Wednesday would see 4 empty bars on the right side of the chart. Empty bars look like "activity dropped off" — not "those days haven't happened yet." The rolling window always shows 7 days of real history.

An important geometric property makes rolling windows work cleanly for weekday labels: 7 consecutive calendar days always contains exactly one of each weekday. Starting from any day, counting back 6 days gives you one Monday, one Tuesday, one Wednesday, one Thursday, one Friday, one Saturday, and one Sunday — all 7, all distinct. If today is Wednesday, the labels are Thu, Fri, Sat, Sun, Mon, Tue, Wed — seven distinct names with no repeats. The chart X-axis is always fully labeled without duplicates.

Matching is done by `toDateString()`. `new Date().toDateString()` returns a string like `"Sun Jul 06 2026"` — locale-independent, UTC-independent (it uses the local timezone of the JavaScript runtime), day-of-month precision. Two dates that are on the same calendar day in the server's local timezone will produce identical `toDateString()` outputs and match to the same bucket.

> **Algorithms — Rolling window:** A rolling window algorithm maintains a sliding view of a fixed-width time interval that moves forward as time passes. The invariant is that the window always contains exactly the most recent N units, ending at "now." Implementing it requires knowing "now" (here, `new Date()`) and the unit size (here, 1 calendar day). Rolling windows appear in network rate limiting (a request counter that resets over a rolling 60s), analytics (rolling 30-day conversion rates), and monitoring (rolling 5-minute error rates). The common implementation detail: generate the endpoints first, then scan the input data and assign each item to its slot.

**Checkpoint:** Today is Wednesday. A user ran a job search last Thursday at 11 PM. `buildJobsFoundByDay` is called. Which bucket does this job land in, and what does the chart show for that bar?

<details>
<summary>Reveal answer</summary>

The buckets are: Thu (6 days ago), Fri, Sat, Sun, Mon, Tue, Wed (today). The Thursday bucket is the oldest displayed day. The job's `found_at` is last Thursday — `new Date(job.found_at).toDateString()` produces `"Thu Jul XX 2026"`, which matches the Thursday bucket's `dateStr`. The chart shows count = 1 for the Thu bar. This is the correct behavior — the job was found within the 7-day window and appears in its calendar-day bucket.

</details>

**Try it yourself:** In a Node.js REPL, run:
```js
const DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  console.log(DAY[d.getDay()], d.toDateString());
}
```
Confirm the output is 7 lines with distinct weekday names ending in today's name. This is the exact bucket-generation logic in `buildJobsFoundByDay`.

---

## Part 5 — Cutoff precision: why `setHours(0,0,0,0)` beats `Date.now() - 168h`

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 52–77:

```ts
function buildResearchByDay(
  jobs: { company_research: unknown }[],
): { day: string; count: number }[] {
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const oldestDay = new Date();
  oldestDay.setDate(oldestDay.getDate() - 6);
  oldestDay.setHours(0, 0, 0, 0);
  const cutoff = oldestDay.getTime();

  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    if (!hasResearchedAt(job.company_research)) continue;
    const ts = new Date(job.company_research.researchedAt).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const ds = new Date(ts).toDateString();
    const b = buckets.find((bk) => bk.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}
```

`buildResearchByDay` differs from `buildJobsFoundByDay` in one critical detail: it needs its own cutoff filter in JavaScript. `buildJobsFoundByDay` operates on rows already pre-filtered by the DB query (`WHERE found_at >= sevenDaysAgo`), so every row in the input array belongs in one of the 7 buckets by definition — no JS cutoff needed.

`buildResearchByDay` operates on *all* researched jobs (query 8 has no date filter). The JS loop is responsible for excluding research events older than 7 days. The naive cutoff would be `Date.now() - 7 * 24 * 60 * 60 * 1000` — exactly 168 hours ago. The problem: if the page renders at 3 PM on Sunday, that cutoff is 3 PM last Sunday. The oldest displayed bucket is "last Sunday" — the full calendar day. A research event that happened at 9 AM last Sunday (before the cutoff) would be excluded, even though "last Sunday" has a bar on the chart.

The fix is `setHours(0, 0, 0, 0)` on the oldest bucket's date:

```ts
const oldestDay = new Date();          // Sunday 3:00 PM
oldestDay.setDate(oldestDay.getDate() - 6);   // last Sunday 3:00 PM
oldestDay.setHours(0, 0, 0, 0);       // last Sunday 00:00:00.000
const cutoff = oldestDay.getTime();
```

This anchors the cutoff to midnight of the oldest displayed calendar day, not to "168 hours before render time." Any research event that occurred at any time on the oldest displayed day is included.

`isNaN(ts)` is the other guard in the loop. `new Date().toISOString()` always produces a valid ISO 8601 string, so `isNaN` is unreachable under normal conditions. But if `company_research` were ever written by a different code path that stored `researchedAt` in a non-ISO format, `new Date("malformed").getTime()` returns `NaN`. Without the guard, `NaN < cutoff` evaluates to `false`, allowing the malformed event through — where `new Date(NaN).toDateString()` produces `"Invalid Date"`, which matches no bucket. The `isNaN` guard is a cheap defensive check that silently drops malformed timestamps rather than letting them corrupt the sort or bucket logic.

> **Algorithms — Calendar-day anchor vs. floating window:** The distinction between "midnight of the oldest calendar day" and "168 hours ago" is an instance of a broader alignment principle: when your output is organized into calendar-day buckets, your cutoff should align with calendar-day boundaries. A floating-hours cutoff creates a misalignment between what the chart shows (full calendar days) and what the filter includes (a rolling 168-hour slice). The general rule: choose the cutoff granularity that matches your output granularity.

**Checkpoint:** The page renders at 11:45 PM on Saturday. The oldest displayed bucket is "last Sunday." A user researched a company last Sunday at 6 AM. With a rolling-hours cutoff (`Date.now() - 168h`), is this event included or excluded? With the `setHours(0,0,0,0)` cutoff, what happens?

<details>
<summary>Reveal answer</summary>

Rolling-hours cutoff: `Date.now()` is Saturday 11:45 PM. Subtract 168 hours: last Saturday 11:45 PM. The research event (last Sunday 6 AM) is *after* last Saturday 11:45 PM, so it is included. In this scenario the rolling cutoff is fine.

Now try a different render time: the page renders at 8:00 AM on Sunday. `Date.now() - 168h` = last Sunday 8:00 AM. The research event (last Sunday 6 AM) is *before* 8:00 AM and is **excluded** — even though "last Sunday" is the oldest displayed bar.

With `setHours(0,0,0,0)`: the cutoff is always midnight of last Sunday, regardless of render time. The research event at 6 AM is *after* midnight and always included. The `setHours` approach is render-time invariant: a user loading the page at 8 AM and another loading it at 3 PM see the same data for the oldest displayed day.

</details>

---

## Part 6 — Type predicate for JSONB: `hasResearchedAt`

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 14–23:

```ts
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

The `company_research` column is typed as `unknown` by the InsForge SDK — JSONB has no compile-time structure. The temptation is to write `(job.company_research as { researchedAt?: string })?.researchedAt` and proceed. `code-standards.md` discourages type assertions because they bypass runtime verification. If the JSONB schema ever changes (a migration renames `researchedAt` to `researched_at`), the assertion silently passes, and `new Date(undefined)` produces `NaN` — the malformed timestamp guard in `buildResearchByDay` then silently drops the event with no error or warning.

A type predicate is different. The signature `v is ResearchWithTimestamp` tells TypeScript: "when this function returns `true`, narrow `v` to `ResearchWithTimestamp` in the calling code." The function body executes real runtime checks in sequence:

1. `v !== null` — eliminates null (JSONB can be null for unresearched jobs, though the query filters these out)
2. `typeof v === "object"` — confirms it is an object, not a string or number
3. `"researchedAt" in v` — confirms the key exists
4. `typeof (v as Record<string, unknown>).researchedAt === "string"` — confirms the value is a string

The one `as Record<string, unknown>` inside the predicate body is a safe structural refinement. After the null/object checks have passed, TypeScript knows `v` is a non-null object but cannot index into it without a cast (TypeScript cannot index into `unknown` directly). `Record<string, unknown>` is the minimal widening that enables the property access — it adds no type safety assumptions beyond "this is an indexable object." The subsequent `typeof ... === "string"` check provides the actual runtime verification.

The calling code in `buildResearchByDay` is fully clean:

```ts
if (!hasResearchedAt(job.company_research)) continue;
const ts = new Date(job.company_research.researchedAt).getTime();
// TypeScript knows job.company_research.researchedAt is a string here
```

No assertions at the call site. No optional chaining. No `!` non-null assertions. TypeScript narrows to `ResearchWithTimestamp` inside the `if` guard — access to `.researchedAt` is fully typed. Compare to the pre-existing activity feed code in `page.tsx` (lines 227–228), which uses `as { researchedAt?: string } | null` — that is the old approach this feature moves away from.

> **Type theory — Type predicate (type refinement):** A type predicate is TypeScript's mechanism for user-defined type narrowing. In most type systems, narrowing is done by the compiler using control flow analysis (`if (typeof x === 'string')`). Type predicates extend this to functions: calling `f(x)` and getting `true` narrows `x` in the calling context. This is related to the concept of *refinement types* in type theory — types that carry a predicate as part of their definition. The practical benefit over assertions is that the check exists at runtime: a schema change that breaks the predicate will produce a `continue` (silent skip) rather than a runtime crash or wrong output.

**Checkpoint:** The activity feed code at line 227 uses `as { researchedAt?: string } | null` directly. `buildResearchByDay` uses `hasResearchedAt`. Both extract `researchedAt` from the same JSONB column. Why is the assertion acceptable in the activity feed but `hasResearchedAt` is the better choice for the chart aggregation loop?

<details>
<summary>Reveal answer</summary>

The activity feed assertion is pre-existing code from Tutorial 29 — Feature 17 did not touch it. The architectural principle is: change only what the feature requires. Refactoring the activity feed's JSONB extraction to use the predicate would be correct, but it is out of scope for a feature about chart data. For the new chart aggregation code, `hasResearchedAt` is the right approach from the start: it is called in a tight loop over all researched jobs, and the type predicate documents the expected JSONB shape as a reusable, named function rather than an inline assertion that must be repeated at every callsite.

</details>

**Try it yourself:** In `buildResearchByDay`, temporarily remove the `hasResearchedAt` guard and replace the line with `const research = job.company_research as { researchedAt: string }; const ts = new Date(research.researchedAt).getTime();`. Note that TypeScript compiles without error — the assertion is perfectly legal. Then ask yourself: if a row had `company_research: { researchedAt: null }`, would this code crash? (Answer: `new Date(null)` returns the Unix epoch in milliseconds — `ts` would be `0`, which is less than `cutoff`, so the `ts < cutoff` guard would filter it out. But only by coincidence, not by design.) Restore `hasResearchedAt`.

---

## Part 7 — Match score distribution: hash map aggregation with `SCORE_RANGES`

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 25–93:

```ts
const SCORE_RANGES = [
  { range: "50-60%", min: 50, max: 59 },
  { range: "60-70%", min: 60, max: 69 },
  { range: "70-80%", min: 70, max: 79 },
  { range: "80-90%", min: 80, max: 89 },
  { range: "90-100%", min: 90, max: 100 },
] as const;

function buildMatchScoreDistribution(
  jobs: { match_score: number | null }[],
): { range: string; count: number }[] {
  const counts = new Map<string, number>(SCORE_RANGES.map((r) => [r.range, 0]));
  for (const job of jobs) {
    if (job.match_score == null) continue;
    for (const { range, min, max } of SCORE_RANGES) {
      if (job.match_score >= min && job.match_score <= max) {
        counts.set(range, (counts.get(range) ?? 0) + 1);
        break;
      }
    }
  }
  return SCORE_RANGES.map(({ range }) => ({ range, count: counts.get(range) ?? 0 }));
}
```

`buildMatchScoreDistribution` takes the same `scoredJobsResult.data` already fetched by query 2 for the Avg. Match Rate stat — no new query is needed. That query already returns all non-null `match_score` values for the current user.

The hash map initialization pattern is the key design choice:

```ts
const counts = new Map<string, number>(SCORE_RANGES.map((r) => [r.range, 0]));
```

This creates a `Map` using the `[key, value][]` constructor form — it maps each `SCORE_RANGES` entry's `range` label to `0`. The result: every bucket label already exists in `counts` with a zero count before any jobs are processed. This removes the need for "does this key exist?" checks during the counting loop — `counts.get(range)` will always return `0` or a positive number, never `undefined`.

The inner `for...of SCORE_RANGES` with `break` exits after finding the first matching range. The ranges are defined as non-overlapping integer buckets: `[50,59]`, `[60,69]`, `[70,79]`, `[80,89]`, `[90,100]`. Each score can match at most one range. The `break` is load-bearing — without it, a score of 70 would match both `[70,79]` and be checked against the remaining ranges unnecessarily. With `break`, the loop is effectively O(1) per score (at most 5 comparisons).

Scores below 50 are silently excluded — `job.match_score == null` skips nulls, and no range covers values below 50. This is intentional: the `MatchScoreChart` component renders exactly 5 bars with fixed labels `"50-60%"` through `"90-100%"`. A score of 45 has no bar to land in. Excluding these is documented in `plan.md` as a key invariant.

The final `.map(({ range }) => ({ range, count: counts.get(range) ?? 0 }))` iterates `SCORE_RANGES` (not `counts`) to produce the output. This guarantees the output array is in `SCORE_RANGES` order — the same order as the chart's X-axis labels — regardless of insertion order in the `Map`. The `?? 0` is technically unreachable (all keys were pre-initialized), but satisfies TypeScript's awareness that `Map.get` can return `undefined`.

> **Data structures — Hash map for frequency counting:** Frequency counting with a pre-initialized hash map is a standard pattern: (1) initialise the map with all expected keys set to zero; (2) iterate the input, incrementing the count for each matching key. The pre-initialization step eliminates the "does key exist?" conditional branch from the hot path, making the counting loop cleaner and slightly faster. The same pattern appears in histograms, character frequency counters, and word count algorithms. In JavaScript, `new Map([[k1,0],[k2,0]])` is the idiomatic pre-initialization for small fixed key sets.

**Checkpoint:** `SCORE_RANGES` is declared with `as const`. What does `as const` do here, and why does it matter for the `range` label type used as the `Map` key?

<details>
<summary>Reveal answer</summary>

Without `as const`, TypeScript infers the type of `SCORE_RANGES[0].range` as `string` — any string. With `as const`, TypeScript infers it as the literal type `"50-60%"`. This narrows the `Map<string, number>` initialization: the keys are known at compile time to be exactly the five literal strings, not arbitrary strings. It also makes the `range` field on the return type a specific union (`"50-60%" | "60-70%" | ...`) rather than `string`. The chart component's `dataKey="range"` prop matches against these exact label strings — `as const` ensures the label values cannot be accidentally changed to something the chart does not recognize.

</details>

**Try it yourself:** Open the `MatchScoreChart` component at [`components/dashboard/MatchScoreChart.tsx`](../../../components/dashboard/MatchScoreChart.tsx). Find the `BarChart` definition and confirm the XAxis `dataKey` matches the `range` field in `SCORE_RANGES`. This is the contract between the aggregation constant in `page.tsx` and the chart's rendering logic — they must use identical label strings.

---

## Full data flow: a dashboard load that shows real data in all three charts

Here is a complete trace for a user who has found 15 jobs in the last 7 days and researched 3 companies, loading the dashboard on Sunday at 2 PM.

**1. Browser:** Sends `GET /dashboard`. Next.js routes to `app/dashboard/page.tsx`.

**2. Auth + Profile:** `createInsforgeServer()`, `getCurrentUser()`, profile query. `authData.user.id` confirmed non-null.

**3. `sevenDaysAgo`:** `getIsoTimestampDaysAgo(7)` produces `"2026-06-29T00:00:00.000Z"`.

**4. `Promise.all` fires 8 HTTP requests simultaneously.** Only the chart-relevant queries are traced here:

- **q2 (`scoredJobsResult`):** `GET /jobs?user_id=eq.<uuid>&match_score=not.is.null&select=match_score` → returns, say, 10 rows with scores: `[82, 75, 88, 91, 70, 65, 78, 85, 72, 93]`.
- **q7 (`recentJobsResult`):** `GET /jobs?user_id=eq.<uuid>&found_at=gte.2026-06-29T00:00:00.000Z&select=found_at` → returns 15 rows, one `{ found_at }` per job found in the last 7 days.
- **q8 (`chartResearchJobsResult`):** `GET /jobs?user_id=eq.<uuid>&company_research=not.is.null&select=company_research` → returns 3 rows with full JSONB dossiers.

**5. Error checks:** All 8 `result.error` fields are `null`. No logging.

**6. Chart data computation (after error checks, lines 248–250):**

```ts
const jobsFoundData = buildJobsFoundByDay(recentJobsResult.data ?? []);
const companyResearchData = buildResearchByDay(chartResearchJobsResult.data ?? []);
const matchScoreData = buildMatchScoreDistribution(scoredJobsResult.data ?? []);
```

**`buildJobsFoundByDay` with 15 rows:**
- Generates 7 buckets: Mon, Tue, Wed, Thu, Fri, Sat, Sun (oldest to newest).
- Iterates 15 rows, calling `new Date(job.found_at).toDateString()` on each.
- For example, 4 jobs found Saturday → Sat bucket count = 4.
- Output: `[{day:"Mon",count:1},{day:"Tue",count:2},{day:"Wed",count:3},{day:"Thu",count:0},{day:"Fri",count:2},{day:"Sat",count:4},{day:"Sun",count:3}]`

**`buildResearchByDay` with 3 rows:**
- `oldestDay` = last Monday at midnight. `cutoff` = Monday 00:00:00.000 in ms.
- Row 1: `hasResearchedAt` passes → `researchedAt: "2026-07-04T14:00:00Z"` (Saturday) → `ts >= cutoff` → matches Sat bucket → Sat count = 1.
- Row 2: `researchedAt: "2026-07-06T09:00:00Z"` (today, Sunday) → matches Sun bucket → Sun count = 1.
- Row 3: `researchedAt: "2026-06-25T11:00:00Z"` (11 days ago) → `ts < cutoff` → `continue`. Excluded.
- Output: `[{day:"Mon",count:0},...,{day:"Sat",count:1},{day:"Sun",count:1}]`

**`buildMatchScoreDistribution` with 10 scores:**
- Initial map: `{"50-60%":0,"60-70%":0,"70-80%":0,"80-90%":0,"90-100%":0}`.
- Scores: 82→`80-90%`, 75→`70-80%`, 88→`80-90%`, 91→`90-100%`, 70→`70-80%`, 65→`60-70%`, 78→`70-80%`, 85→`80-90%`, 72→`70-80%`, 93→`90-100%`.
- Final map: `{"50-60%":0,"60-70%":1,"70-80%":4,"80-90%":3,"90-100%":2}`.
- Output: `[{range:"50-60%",count:0},{range:"60-70%",count:1},{range:"70-80%",count:4},{range:"80-90%",count:3},{range:"90-100%",count:2}]`

**7. JSX render (lines 261–265):**

```tsx
<CompanyResearchChart data={companyResearchData} />
<JobsFoundChart data={jobsFoundData} />
<MatchScoreChart data={matchScoreData} />
```

Each chart component receives a fully computed array. No DB access, no aggregation, no JSONB parsing happens inside the components.

**8. HTML streamed to browser.** The three chart components hydrate on the client with Recharts. `JobsFoundChart` shows an area chart with a Saturday spike. `CompanyResearchChart` shows Saturday and Sunday bars. `MatchScoreChart` shows `70-80%` as the most common range.

---

## Extend it (challenges)

### Challenge 1 — Trace (15–20 min)

A user has 30 researched jobs. The 20 most recently *found* jobs all have `researchedAt` timestamps from 2 weeks ago. The 10 oldest *found* jobs were all researched yesterday.

Trace through what happens in query 8 (`chartResearchJobsResult`) vs. what would happen if query 6 (`researchJobsResult`, limit 20) were used instead. What does each query return? What does `buildResearchByDay` produce from each result? Which chart is accurate?

<details>
<summary>Hint</summary>

Query 8 returns all 30 jobs with `company_research IS NOT NULL`. `buildResearchByDay` extracts `researchedAt` from each — the 20 rows researched 2 weeks ago have `ts < cutoff` and are skipped; the 10 rows researched yesterday have `ts >= cutoff` and land in yesterday's bucket. Yesterday's bar = 10.

Query 6 (limit 20 by `found_at` desc) returns the 20 most recently found jobs — which are the ones researched 2 weeks ago, not yesterday. All 20 have `ts < cutoff`. Yesterday's bucket = 0. The chart incorrectly shows no research activity yesterday even though the user researched 10 companies.

</details>

---

### Challenge 2 — Extend (20–30 min)

Extend the match score distribution to show all scores, including those below 50. The `MatchScoreChart` currently has 5 bars using `SCORE_RANGES` labels. Suppose the chart is updated to show 6 bars: `"0-49%"`, `"50-60%"`, `"60-70%"`, `"70-80%"`, `"80-90%"`, `"90-100%"`.

1. What change is needed in `SCORE_RANGES` (in `page.tsx`)?
2. What change is needed in `buildMatchScoreDistribution`?
3. What change is needed in `MatchScoreChart.tsx` — specifically the XAxis labels and any hardcoded bar count?
4. What would you name the `[0,49]` range in `SCORE_RANGES` to match the chart label format? Does `max: 49` correctly exclude 50?

Write out the code changes. No implementation required — show the modified sections.

<details>
<summary>Hint</summary>

Add `{ range: "0-49%", min: 0, max: 49 }` as the first entry in `SCORE_RANGES`. The `buildMatchScoreDistribution` function requires no logic changes — the new range is picked up automatically by the `for...of SCORE_RANGES` loop. The `MatchScoreChart` component's XAxis will need to list "0-49%" as the first label. Check whether `MatchScoreChart` hardcodes the number of bars or derives them from the `data` prop length.

</details>

---

### Challenge 3 — Break and fix (30–45 min)

In `buildResearchByDay`, change the cutoff line from:

```ts
oldestDay.setHours(0, 0, 0, 0);
const cutoff = oldestDay.getTime();
```

to:

```ts
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
```

1. Deploy the change. At what time of day would a user loading the dashboard see an incorrect chart? What would be wrong — would bars be higher or lower than they should be?
2. Is the bug deterministic (always wrong) or intermittent (wrong only sometimes)? At what render time does it produce the most incorrect result?
3. Write the exact scenario — with concrete times — where a research event is excluded by the rolling-hours cutoff but should be included.
4. What diagnostic step would help you discover this bug? (Hint: think about how render time affects the output.)

Restore the `setHours` version after your analysis.

<details>
<summary>Hint</summary>

The bug only affects events on the oldest displayed day (6 days ago). Events from the previous 5 days are far enough inside both windows that neither cutoff excludes them. The worst case is when the page renders late in the day (e.g., 11:55 PM): the rolling-hours cutoff is nearly 24 hours into the oldest day, excluding almost all events from that day's chart bar. The bar shows lower (or zero) activity even though the user researched companies that morning.

</details>

---

For deeper exploration, [`docs/plan/17-analytics-charts-real-data/ai-discussion-topics.md`](../../plan/17-analytics-charts-real-data/ai-discussion-topics.md) has 16 prompts covering PostHog SDK architecture, Issue #19 mechanics, rolling window design, the `found_at` vs `researchedAt` invariant applied to charts, and type predicates vs. assertions. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.

---

## Good next /teach topics

These concepts appeared in this tutorial and each has enough depth to become a standalone `/teach` lesson:

**1. Analytics platforms: ingest vs. query separation** — Why write keys are designed to be public while read keys are private. How PostHog, Firebase, Amplitude, and Mixpanel each structure this split. The HTTP endpoints involved and what authentication each requires.

**2. Rolling window algorithms** — The general pattern: anchor to "now", generate N buckets, scan input and assign to buckets. Timezone complications when the server and user are in different timezones. The difference between calendar-day buckets and fixed-duration buckets. Real-world uses in rate limiting, monitoring, and analytics.

**3. Hash maps for frequency counting** — Pre-initialisation vs. lazy initialisation. Time complexity analysis. The JavaScript `Map` API vs. plain objects. When to use a Map vs. an array for accumulation. The "histogram" problem in general.

**4. TypeScript type predicates in depth** — Narrowing via user-defined type guards, the `v is T` return type syntax, the limits of type predicates (they are "promises" the compiler trusts, not enforcement mechanisms), and how they compare to assertion functions (`asserts v is T`). Equivalent patterns in other typed languages.

**5. Calendar math: setDate, setHours, toDateString** — Why `new Date()` uses local timezone, what `toDateString()` returns, timezone-safe date comparison patterns, and when to reach for a date library vs. the built-in Date API.
