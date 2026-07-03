# Tutorial 28 — Stats Bar Real Data: Trust Boundaries, Concurrent Queries, and Null-Safe Aggregation

**After completing this tutorial you will understand:** why mock UI signals must be removed (not just neutralized) when real data is wired in; how `Promise.all` fires four database queries concurrently and why sequential `await` would be slower; how the PostgREST `{ count: 'exact', head: true }` pattern sends an HTTP HEAD request to get a row count without fetching data; why `"—"` is semantically different from `"0%"` and how to implement that distinction with a nullable-until-format pattern; and how each stat query's error is handled independently so a partial DB failure degrades the dashboard without breaking it.

---

> [!NOTE]
> **Prerequisites:** Tutorial 27 (`../27-dashboard-page/README.md`) — covers the Feature 14 dashboard: the Server/Client boundary, the mock data seam, `StatsBar`'s original type, and why all data flows through `page.tsx` as props. Tutorial 02 (`../02-auth/README.md`) — covers `createInsforgeServer()`, `getCurrentUser()`, and the redirect guard that every authenticated page uses. Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx) and [`components/dashboard/StatsBar.tsx`](../../../components/dashboard/StatsBar.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Concurrent futures / Promise.all | Four stat queries fired simultaneously | System design |
| HTTP HEAD request | `{ count: 'exact', head: true }` — count without body | OS fundamentals |
| Sliding / rolling time window | `sevenDaysAgo` cutoff for "Jobs This Week" | Algorithms |
| Null-safe fallback chaining (`??`) | `result.count ?? 0`, `scoredJobsResult.data ?? []` | Type theory |
| Absence vs. zero in data representation | `"—"` vs `"0%"` for Avg. Match Rate | System design |
| Single-owner data flow | All stat fetching in `page.tsx`; components only render props | Design patterns |

---

## How to use an LLM before this tutorial

Budget 25–30 minutes across these five concepts.

### Concept 1 — Promise.all and concurrent async operations

> "In JavaScript, if I write `const a = await fetchA(); const b = await fetchB();`, does `fetchB` start before `fetchA` finishes? Now explain `Promise.all([fetchA(), fetchB()])`. When does each fetch start? When does the outer `await` resolve? What happens to the total waiting time compared to sequential awaits? Give me a concrete example with timing numbers (e.g., each fetch takes 50ms) and show the difference. Then quiz me: I have three independent database queries. I write `await query1(); await query2(); await query3()`. Each takes 40ms. How long does the page wait? How long would `Promise.all` take?"

*What to listen for:* Sequential `await` forms a waterfall — each operation starts only after the previous one completes. `Promise.all` fires all operations simultaneously and resolves when the slowest one finishes. Three 40ms sequential queries = 120ms total. Three concurrent via `Promise.all` = ~40ms total. The speedup is proportional to the number of independent operations.

*Practice question:* The four stat queries in Feature 15 are all independent — none uses the result of another. Does that make them a good fit for `Promise.all`, a bad fit, or neutral? Why?

---

### Concept 2 — HTTP HEAD requests: getting metadata without the body

> "Explain the HTTP HEAD method. How does it differ from GET? What does a server send back in response to a HEAD request — just headers, the full body, or something else? Why would a client send a HEAD request instead of GET? Give a concrete example: if I HEAD a resource that returns a 50KB JSON body on GET, how much data transfers on HEAD? What kinds of information can you learn from a HEAD response that you can't get from GET? Quiz me: I want to know how many rows a database table has, but I don't want to download the rows themselves. Is HEAD a reasonable tool for that?"

*What to listen for:* HEAD returns all response headers but no body. The server processes the request identically to GET — it knows the content — but omits the body from the response. This is useful when you want metadata (content-length, content-type, a count header) without the data transfer cost. PostgREST uses this to implement row counting: `Prefer: count=exact` + HEAD request returns the count in a `Content-Range` header with zero body.

*Practice question:* A `jobs` table has 284 rows. I query with `{ count: 'exact', head: true }`. What is `result.data`? What is `result.count`?

---

### Concept 3 — Rolling windows in time-series data

> "Explain what a 'rolling window' (or 'sliding window') is in the context of time-series data. How is it different from a fixed calendar period (e.g., 'this calendar week' starting Monday)? If today is Thursday July 3rd, what dates does 'the last 7 days' include as a rolling window vs. 'this calendar week'? What information do you need to implement a rolling window that you don't need for a calendar week? And vice versa? Quiz me: a user found 3 jobs on Monday and 5 jobs on Sunday. Today is Thursday. Which approach shows more jobs under 'this week' — rolling 7-day window or calendar week starting Monday?"

*What to listen for:* A rolling window is always anchored to "now" and looks back a fixed duration. A calendar week is anchored to a day-of-week boundary (e.g., Monday 00:00) and requires knowing the user's timezone and the local start-of-week convention. Rolling windows are simpler to implement on a server that may not know the user's locale. The tradeoff is that the count changes continuously vs. resetting on a known day.

*Practice question:* `sevenDaysAgo` is computed with `Date.now()` on the server at request time. If the same user loads the dashboard at 9am and again at 11pm, will "Jobs This Week" return the same count? Why or why not?

---

### Concept 4 — Null-safe fallback with `??`

> "Explain the nullish coalescing operator `??` in JavaScript and TypeScript. How does it differ from the OR operator `||`? What values does `??` treat as 'nullish'? What values does `||` treat as falsy? Show me a concrete example where `||` and `??` produce different results for the value `0`. Why does `result.count ?? 0` use `??` instead of `||`? Quiz me: `result.count` is `0` (zero, not null). What does `result.count ?? 0` return? What does `result.count || 0` return?"

*What to listen for:* `??` only treats `null` and `undefined` as nullish. `||` treats `null`, `undefined`, `false`, `0`, `""`, and `NaN` as falsy. For `result.count = 0`, `result.count ?? 0` returns `0` (the real value), but `result.count || 0` also returns `0` (the fallback) — same result here, but for the wrong reason. The distinction matters: if count could legitimately be `0`, using `||` would mask a real zero with the fallback zero. `??` is explicit: "use this fallback only if the value is actually absent, not just falsy."

*Practice question:* A user with zero jobs has `count: 0` from a successful InsForge query. A user whose query errored has `count: null`. Does `result.count ?? 0` handle both correctly?

---

### Concept 5 — Absence of measurement vs. a zero measurement

> "In data display, there is a distinction between 'this value is zero' and 'this value is unknown or not yet measured.' Give me three real-world examples where showing 0 instead of a dash (—) would mislead a user. Then give me three cases where showing — instead of 0 would mislead a user. What is the rule for deciding which to use? Quiz me: a new user's account has no job applications. A dashboard shows 'Avg. Match Rate: 0%'. What does this imply? What should it show instead?"

*What to listen for:* `0` implies a measurement was taken and came back at zero — it is a data point. `—` (or `N/A`) implies the measurement could not be taken or does not apply. Showing `0%` for a new user's match rate implies their jobs were scored and scored terribly. Showing `—` implies no scoring has occurred yet. The deciding rule: is there data to calculate from? If yes, show the result even if it's zero. If no, show absence.

*Practice question:* A user has 10 jobs, all with `match_score: null`. `scoredRows` is `[]`. Should `avgMatchRate` be `"0%"` or `"—"`? Which is more accurate?

---

## Architecture overview

```
  GET /dashboard
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  app/dashboard/page.tsx                    SERVER ONLY  │
│                                                         │
│  1. createInsforgeServer() + getCurrentUser()           │
│     └─ no user → redirect("/login")                    │
│                                                         │
│  2. profiles.maybeSingle()   ← existing from Feature 14│
│     └─ isComplete bool                                  │
│                                                         │
│  3. sevenDaysAgo = Date.now() - 7d (computed once)     │
│                                                         │
│  4. Promise.all([q1, q2, q3, q4])  ← four concurrent  │
│     │   q1: COUNT jobs                                  │
│     │   q2: SELECT match_score WHERE not null          │
│     │   q3: COUNT jobs WHERE company_research NOT NULL │
│     └─  q4: COUNT jobs WHERE found_at >= sevenDaysAgo  │
│                                                         │
│  5. Error log each result                               │
│                                                         │
│  6. Compute values:                                     │
│     totalJobs        = count ?? 0                       │
│     avgMatchRate     = scoredRows.length > 0 ? "X%" : "—"
│     companiesResear. = count ?? 0                       │
│     jobsThisWeek     = count ?? 0                       │
│                                                         │
│  7. stats: StatCardConfig[] → <StatsBar stats={stats}> │
└────────────────────────┬────────────────────────────────┘
                         │  props only — no DB in components
                         ▼
         ┌───────────────────────────┐
         │  StatsBar.tsx  (Server)   │
         │  maps stats → StatCard    │
         │  StatCard renders:        │
         │   label / value / subtitle│
         └───────────────────────────┘
```

**Key invariants:**
1. Every `jobs` query is scoped to `authData.user.id` — the redirect guard above guarantees `authData.user` is non-null at the query site.
2. `StatsBar` and `StatCard` never query the database — they render props only.
3. Stat query errors are logged, never thrown — a broken stat query shows `"0"` or `"—"`, not a crashed page.

---

## Part 1 — The trust boundary: why mock signals must go, not just change

Open [`components/dashboard/StatsBar.tsx`](../../../components/dashboard/StatsBar.tsx):

```ts
export type StatCardConfig = {
  label: string;
  value: string;
  subtitle: string;
};

type StatCardProps = StatCardConfig;

function StatCard({ label, value, subtitle }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <p className="text-sm font-medium text-text-secondary mb-2">{label}</p>
      <p className="text-[30px] font-semibold leading-9 text-text-primary mb-2">{value}</p>
      <p className="text-xs text-text-muted">{subtitle}</p>
    </div>
  );
}
```

Before Feature 15, `StatCardConfig` had an optional `trend?: { value: string; label: string }` field. Cards 1 and 2 (Total Jobs Found and Avg. Match Rate) passed `trend: { value: "+12%", label: "vs last week" }` — green badges showing invented comparative percentages. Cards 3 and 4 used `subtitle` already.

Feature 15 removed `trend` entirely and promoted `subtitle` to required. The reason is a principle called a **trust boundary**. Before Feature 15, every number on the dashboard was mock — the user knew (or should have known) none of it was real. After Feature 15, the four stat values become real. At that moment, every nearby element that remains fake becomes suspect. The user sees a real "47 jobs" next to "+12% vs last week" and cannot tell which part to trust.

Three options were considered. Option B was to replace the fake percentage with neutral text like "Live data". This was rejected because a badge — with its shape, green color, and upward-trending icon — is a comparative signal affordance. Putting "Live data" in a badge uses that affordance without delivering comparison. It looks like it is telling the user something changed, but it is not. That is a subtler dishonesty than a fake percentage.

Option A (remove the badge, use a plain subtitle) was chosen. The `TrendingUp` import was deleted. The `trend ? <badge> : <subtitle>` conditional was collapsed to always rendering `<p className="text-xs text-text-muted">{subtitle}</p>`. All four cards now render identically — label, big number, muted subtitle — and the subtitles are factual scope descriptors: "All time", "Scored jobs only", "Completed research", "Last 7 days".

The type change is also protective. Removing `trend` from `StatCardConfig` means any future code that tries to pass a `trend` object will fail at TypeScript compile time. Trend data cannot accidentally reappear without a deliberate type change. The type is now the enforcement mechanism.

> **Design patterns — Single-owner data flow:** `StatsBar` accepts `stats: StatCardConfig[]` and renders. It owns no data. `page.tsx` owns all data. This separation is a discipline: the component that knows how to display a stat is different from the component that knows where the stat comes from. Changing the display (the card layout, the subtitle style) never requires touching the data fetching, and changing the data source (swapping in real DB values) never requires touching the component. This is the same pattern established in Tutorial 27 for the chart components.

**Checkpoint:** Why was Option B (neutral badge saying "Live data") considered worse than simply removing the badge?

<details>
<summary>Reveal answer</summary>

A badge's visual design — its shape, color (green for positive change), and icon (upward trending arrow) — communicates comparison semantics. Users read a badge as "this number changed in this direction." Replacing the percentage with "Live data" keeps that affordance without delivering any comparison. A careful user would stare at it and wonder what it means. An inattentive user might assume it confirms an upward trend when it says nothing of the sort. Option A (remove entirely) is more honest: a plain subtitle says exactly what it is, nothing more.

</details>

**Try it yourself:** In the `StatCardConfig` type, try adding `trend?: { value: string; label: string }` back and passing a `trend` object to the "Total Jobs Found" card in `page.tsx`. Then remove it. Notice that TypeScript only complains when you try to USE the field — which is how the type protects future developers from accidentally reintroducing mock trend data.

---

## Part 2 — Four concurrent queries with Promise.all

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), lines 85–111:

```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const [totalJobsResult, scoredJobsResult, companiesResult, thisWeekResult] =
  await Promise.all([
    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id),

    insforge.database
      .from("jobs")
      .select("match_score")
      .eq("user_id", authData.user.id)
      .not("match_score", "is", null),

    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .not("company_research", "is", null),

    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .gte("found_at", sevenDaysAgo),
  ]);
```

The four queries are independent — none uses the result of another. That makes them ideal for `Promise.all`. Without it, the page would run them sequentially: start query 1, wait for it to finish, start query 2, wait, start query 3, wait, start query 4, wait. If each query takes 30ms, the total wait is 120ms. With `Promise.all`, all four start at the same moment and the total wait is the time of the slowest single query — approximately 30ms. For a server-rendered page, this matters directly for time-to-first-byte.

The InsForge SDK builds each query as an object and fires it as an HTTP request when awaited. Calling `.from(...).select(...).eq(...)` does not execute anything — it builds up a description of the query. Only when `await` is reached (inside `Promise.all`) does the HTTP request actually fire. `Promise.all` fires all four `await`s simultaneously.

`sevenDaysAgo` is computed once before the `Promise.all` call and reused in the fourth query. In a server component there is no re-rendering, so computing it inside the array would be technically equivalent, but naming it outside makes the intent clear: this is a fixed cutoff for the duration of this request, not a value that can drift between queries.

> **System design — Concurrent futures:** `Promise.all` is JavaScript's implementation of the "concurrent futures" pattern — start multiple independent async operations, then wait for all of them to complete. The key contract is independence: each operation must not depend on any other's result. When that contract holds, concurrency is safe and desirable. This pattern appears in distributed systems (fan-out requests to multiple services), in database clients (batch queries), and in file systems (parallel reads). The mental model is the same in all cases: "fire all, then collect."

**Checkpoint:** What is the sequential `await` total wait time for four 30ms queries? What is the `Promise.all` wait time for the same four queries?

<details>
<summary>Reveal answer</summary>

Sequential `await`: 30 + 30 + 30 + 30 = 120ms. Each query starts only after the previous one completes. `Promise.all`: ~30ms. All four fire at the same time; the outer `await` resolves when the slowest one finishes. The speedup is the difference between "waterfall" and "fan-out" concurrency.

</details>

**Try it yourself:** Comment out `Promise.all` and rewrite the four queries as sequential `await` calls. The results are identical — but check your browser's network panel (or server logs) to observe that the InsForge requests now form a waterfall instead of firing simultaneously. Then restore `Promise.all`.

---

## Part 3 — The count pattern: HTTP HEAD and why `result.data` is null

Three of the four queries use `{ count: 'exact', head: true }`:

```ts
insforge.database
  .from("jobs")
  .select("*", { count: "exact", head: true })
  .eq("user_id", authData.user.id)
```

After the `Promise.all`, the counts are extracted:

```ts
const totalJobs = totalJobsResult.count ?? 0;
const companiesResearched = companiesResult.count ?? 0;
const jobsThisWeek = thisWeekResult.count ?? 0;
```

The `{ count: 'exact', head: true }` option sends an HTTP HEAD request to the PostgREST API with the header `Prefer: count=exact`. PostgREST processes the query exactly as it would for a GET request — it knows which rows match the filter — but it omits the response body entirely. The count is returned in the `Content-Range` response header (e.g., `Content-Range: 0-*/284`). The InsForge SDK parses this header and exposes the number as `result.count`.

Because no body is transferred, `result.data` is `null` by design. This is not an error — it is the expected state for a HEAD request. The invariant is: **for count-only queries, never use `result.data`; always use `result.count`.**

The fallback `?? 0` handles two cases identically. When the query succeeds and there are zero rows, `result.count` is `0` — and `0 ?? 0` returns `0` (the real value). When the query fails, `result.count` is `null` — and `null ?? 0` returns `0` (the safe fallback). The user sees "0 jobs found" in both cases, which is correct: a failed count and a genuinely empty account are indistinguishable to the UI, and both are safe to display as zero.

> **OS fundamentals — HTTP HEAD request:** The HTTP HEAD method is defined in RFC 9110. It is identical to GET except the server MUST NOT send a response body. This makes it ideal for "give me metadata without the data" use cases: checking if a resource exists, getting a file size before downloading it, or — as here — getting a row count without fetching the rows. The server does the same computational work either way; HEAD just omits the transfer. This is why `{ head: true }` still produces an accurate count even though no rows are returned.

**Checkpoint:** `companiesResult.count` is `null` because the query errored. What does `companiesResult.count ?? 0` return, and what does the "Companies Researched" card display?

<details>
<summary>Reveal answer</summary>

`null ?? 0` returns `0`. The card displays `"0"` with subtitle `"Completed research"`. This is the correct safe-default behavior: a DB error on the companies query should not crash the page or show a broken stat. It degrades to showing zero, which is a valid (if possibly inaccurate) value. The error is logged separately with `console.error("[dashboard/stats] companies researched", ...)` so it can be investigated in server logs without the user ever seeing a broken UI.

</details>

---

## Part 4 — The scored jobs query and JS-side average computation

The second query is different from the three count queries — it returns actual row data:

```ts
insforge.database
  .from("jobs")
  .select("match_score")
  .eq("user_id", authData.user.id)
  .not("match_score", "is", null),
```

And the average is computed in JavaScript after the queries resolve:

```ts
const scoredRows = scoredJobsResult.data ?? [];
const avgMatchRate =
  scoredRows.length > 0
    ? `${Math.round(
        scoredRows.reduce((sum, r) => sum + (r.match_score ?? 0), 0) /
          scoredRows.length
      )}%`
    : "—";
```

The query selects only `match_score` (not `*`) and filters to rows where `match_score IS NOT NULL`. This is load-bearing: the `jobs` table stores `match_score` as `number | null` because scoring can fail. Including null rows in the average would be wrong — it would drag down the average score by counting unscored jobs as zero. The `.not("match_score", "is", null)` filter excludes them before any data is transferred.

The `?? 0` inside the `reduce` is technically unreachable — the query filtered out all nulls, so `r.match_score` will never be `null` at runtime. But TypeScript types `match_score` as `number | null` because it reflects the database column definition. Without the fallback, TypeScript would report `Type 'number | null' is not assignable to type 'number'` on the addition. The `?? 0` satisfies the type checker while documenting the intent: if, somehow, a null value appeared, treat it as zero rather than produce `NaN`.

The value stays nullable through the entire computation. Only at the format step does it become a string:

```
scoredRows.length > 0  →  `${Math.round(...)}%`   (measurement exists)
scoredRows.length === 0  →  "—"                    (no measurement)
```

This is the nullable-until-format pattern: compute in the value's natural domain (`number` or "nothing"), format for display at the last moment. The condition and the format are co-located, making the logic readable in one glance.

> **Type theory — Null-safe fallback chaining:** The `??` operator is TypeScript's (and JavaScript's) nullish coalescing operator. It evaluates the right side only when the left side is `null` or `undefined` — not for `false`, `0`, or `""`. This matters for count values: `count = 0` is a real measurement that must not be replaced by a fallback. `count = null` is an absent value that should fall back to `0`. Using `||` instead of `??` would incorrectly replace a genuine zero count with the fallback zero. `??` is the correct tool when zero is a valid data point.

**Checkpoint:** A user has 10 jobs. 5 have `match_score` of 80. The other 5 have `match_score: null`. What does `avgMatchRate` display — and why is that the right answer rather than `"40%"`?

<details>
<summary>Reveal answer</summary>

`avgMatchRate` displays `"80%"`. The query filters `.not("match_score", "is", null)`, so `scoredRows` contains only the 5 scored jobs. The average is `(80+80+80+80+80)/5 = 80`. The 5 unscored jobs are excluded entirely. `"40%"` would be the result if nulls were counted as zero: `(80×5 + 0×5)/10 = 40`. That would be misleading — it implies the user's jobs are a poor match, when in fact the unscored jobs failed to score for a technical reason unrelated to match quality.

</details>

---

## Part 5 — The "—" distinction: absence of measurement vs. zero

```ts
const avgMatchRate =
  scoredRows.length > 0
    ? `${Math.round(...)}%`
    : "—";
```

When `scoredRows` is empty, the card value is the string `"—"` rather than `"0%"`. This encodes a semantic rule: `0%` is a real measurement (something was measured and scored zero); `"—"` means no measurement exists.

For a brand-new user whose account has no jobs, showing `"0%"` would look like a system error or a report that their (nonexistent) jobs are terrible matches. `"—"` reads as an expected empty state. The subtitle `"Scored jobs only"` reinforces this — it tells the user what this stat counts and implies that once they have scored jobs, the percentage will appear.

This distinction is not aesthetic. It appears in data tables everywhere: a revenue cell showing `$0` means the sale happened with zero revenue; a cell showing `—` means no sale occurred. A job application showing `0 interviews` means zero were scheduled; a `—` means the application is too new to count. The rule is: if the computation happened and produced a result, show that result (even if it is zero). If the computation could not happen because there was nothing to compute from, show absence.

The implementation keeps the commitment: `avgMatchRate` is computed as either a formatted string or `"—"`, never as a nullable value passed downstream. `StatCard` receives a `value: string` and renders it — it does not know or need to know whether the string came from a calculation or an empty-state branch.

> **System design — Absence vs. zero in data representation:** Database systems distinguish `NULL` (unknown or not applicable) from `0` (a real zero value) for exactly this reason. `NULL` propagates through calculations — `NULL + 5` is `NULL`, not `5` — because you cannot compute with unknown values. JavaScript's `undefined` and `null` play a similar role. When displaying data, the same distinction applies: `"—"` (or `null`, or `N/A`) is the display analog of SQL `NULL`. The choice between them is not cosmetic; it determines what the user concludes about the state of their data.

**Checkpoint:** `scoredRows.length` is `0` because all the user's jobs have `match_score: null` (scoring failed for all of them). Is `"—"` the right display value? What would `"0%"` incorrectly imply?

<details>
<summary>Reveal answer</summary>

Yes, `"—"` is correct. The user's jobs exist but none have been scored. There is no average to compute. `"0%"` would incorrectly imply that the jobs were scored and scored at zero percent — suggesting they are a terrible match for the user's profile. That is false. The scoring failure is a technical condition, not a signal about match quality. `"—"` with subtitle `"Scored jobs only"` communicates that scoring data is absent, not that the match rate is zero.

</details>

---

## Part 6 — Independent error handling after Promise.all

```ts
if (totalJobsResult.error)
  console.error("[dashboard/stats] total jobs", totalJobsResult.error);
if (scoredJobsResult.error)
  console.error("[dashboard/stats] scored jobs", scoredJobsResult.error);
if (companiesResult.error)
  console.error("[dashboard/stats] companies researched", companiesResult.error);
if (thisWeekResult.error)
  console.error("[dashboard/stats] jobs this week", thisWeekResult.error);
```

Each of the four results is checked independently. The InsForge SDK returns `{ data, error }` — it does not throw on DB errors. This is the property that makes `Promise.all` safe here: if any query encounters a DB error, it resolves with `{ data: null, count: null, error: <message> }` rather than rejecting the promise. `Promise.all` only rejects if a promise throws. Because the SDK never throws, `Promise.all` always resolves with all four results — some may contain errors, but all are present.

The logging uses a `[dashboard/stats]` prefix so server log searches for `[dashboard/stats]` find all stat errors in one grep. After logging, execution continues. The safe defaults (`count ?? 0`, `data ?? []`) produce display values that look like an empty account rather than a broken page. This is the correct tradeoff: a stat failure should degrade gracefully, not crash the dashboard.

This pattern is different from the auth check at the top of the page (`if (!authData.user) redirect("/login")`). Auth failure is not recoverable — you must redirect. Stat failure is recoverable — you can show zeroed cards and continue. The code reflects that distinction: auth throws (redirects), stats log and fall back.

**Checkpoint:** `Promise.all` is described as rejecting "if any promise throws." The InsForge SDK queries return `{ data, error }` instead of throwing. Why does that design choice matter specifically in this context?

<details>
<summary>Reveal answer</summary>

If any of the four SDK queries threw on error, `Promise.all` would reject on the first failure, and the outer `await` would throw — propagating to Next.js's error boundary and showing an error page. The other three queries' results (which may have succeeded) would be discarded. By returning `{ data, error }` instead of throwing, the SDK ensures that all four results are always available after `Promise.all` resolves. Each can be checked independently. A single failed stat does not abort the other three.

</details>

**Try it yourself:** Add `.eq("user_id", "fake-user-id-that-does-not-exist")` to one of the three count queries (in addition to the real user_id filter). This will cause that query to return `count: 0` (not an error — it simply matches zero rows). Observe that the dashboard renders with one stat showing `"0"` while the others show real data. This simulates the safe-degradation behavior without actually causing a DB error.

---

## Full data flow: a page load that shows "47 / 78% / 12 / 5"

Here is a complete trace of what happens when a user with 47 total jobs, 35 scored jobs averaging 78%, 12 researched companies, and 5 jobs found in the last 7 days loads the dashboard.

1. **Browser:** Sends `GET /dashboard`. Next.js routes to `app/dashboard/page.tsx`.

2. **`createInsforgeServer()`** — `lib/insforge-server.ts`: creates an InsForge server client backed by the request cookies. Used for all subsequent queries.

3. **`insforge.auth.getCurrentUser()`** — sends an auth check to InsForge. `authData.user.id` is now the authenticated user's UUID.

4. **Profile query** — `insforge.database.from("profiles")...maybeSingle()`: returns the profile row or `null`. `isComplete = !!profileData?.is_complete` — if no profile row exists, `false`.

5. **`sevenDaysAgo`** — `new Date(Date.now() - 604800000).toISOString()` produces e.g. `"2026-06-27T08:00:00.000Z"`.

6. **`Promise.all` fires four HTTP requests simultaneously** to the InsForge API:
   - Query 1: `HEAD /jobs?user_id=eq.<uuid>&select=*&prefer=count%3Dexact` → responds with header `Content-Range: 0-*/47`, no body. `totalJobsResult.count = 47`.
   - Query 2: `GET /jobs?user_id=eq.<uuid>&match_score=not.is.null&select=match_score` → responds with 35 rows, each `{ match_score: number }`. `scoredJobsResult.data = [{match_score:82},{match_score:75},...]`.
   - Query 3: `HEAD /jobs?user_id=eq.<uuid>&company_research=not.is.null&select=*&prefer=count%3Dexact` → `Content-Range: 0-*/12`. `companiesResult.count = 12`.
   - Query 4: `HEAD /jobs?user_id=eq.<uuid>&found_at=gte.<sevenDaysAgo>&select=*&prefer=count%3Dexact` → `Content-Range: 0-*/5`. `thisWeekResult.count = 5`.

7. **Error checks** — all four `result.error` fields are `null`. No logging occurs.

8. **Value extraction:**
   - `totalJobs = 47 ?? 0 = 47`
   - `companiesResearched = 12 ?? 0 = 12`
   - `jobsThisWeek = 5 ?? 0 = 5`
   - `scoredRows = [{match_score:82},{match_score:75},...]` (35 elements)
   - `scoredRows.length > 0` → true
   - `sum = 82+75+... = 2730`, `2730 / 35 = 78`, `Math.round(78) = 78`
   - `avgMatchRate = "78%"`

9. **Stats array assembled:**
   ```ts
   [
     { label: "Total Jobs Found",     value: "47",  subtitle: "All time" },
     { label: "Avg. Match Rate",      value: "78%", subtitle: "Scored jobs only" },
     { label: "Companies Researched", value: "12",  subtitle: "Completed research" },
     { label: "Jobs This Week",       value: "5",   subtitle: "Last 7 days" },
   ]
   ```

10. **`<StatsBar stats={stats} />`** — receives the array. `StatsBar` maps it, passing each entry to `StatCard`. `StatCard` renders the label, `text-[30px]` value, and muted subtitle. No data fetching occurs inside any component.

11. **HTML streamed to browser.** The four stat cards render with real values. The three chart components (Client Components) hydrate separately, receiving mock data until Feature 17.

---

## Extend it (challenges)

### Challenge 1 — Trace (15–20 min)

A user loads the dashboard at exactly midnight on a Monday. `sevenDaysAgo` is computed as last Monday at midnight. The user found 3 jobs last Sunday (just inside the 7-day window) and 4 jobs last Monday at 1am (also inside).

Trace through what "Jobs This Week" shows and explain why. Then consider: if the same user had used a calendar-week boundary (Mon 00:00 → Sun 23:59) instead of a rolling window, would the count be different? Write out your reasoning.

<details>
<summary>Hint</summary>

Think about when `found_at >= sevenDaysAgo` is evaluated. What is `sevenDaysAgo` when `Date.now()` is Monday midnight? Which jobs fall inside that window? A calendar week starting Monday would use Monday 00:00:00 of the current week — which is the same point in time when accessed exactly at midnight Monday.

</details>

---

### Challenge 2 — Extend (20–30 min)

Feature 16 will wire "Recent Activity" to real `agent_runs` DB data. Following the exact pattern Feature 15 established:

1. What query or queries would you add to the `Promise.all` block to fetch the 5 most recent `agent_runs` for the current user?
2. Where would you compute the formatted `ActivityItem[]` array — in `page.tsx` or inside `RecentActivity`?
3. What safe default would you use if the agent_runs query fails?

Write out the query, the result extraction, and the `ActivityItem[]` construction. You do not need to implement it — write the code as it would appear.

<details>
<summary>Hint</summary>

Look at the `AgentRun` type in `types/index.ts` and the `ActivityItem` type exported from `RecentActivity.tsx`. The `ActivityItem` shape is `{ type: "search" | "research"; label: string; timeAgo: string }`. The `agent_runs` table has `job_title_searched`, `jobs_found`, `started_at`, and `status`. How do you convert an `AgentRun` row into an `ActivityItem`?

</details>

---

### Challenge 3 — Design (30–45 min)

The Avg. Match Rate currently computes the average of ALL a user's scored jobs (over all time). Suppose the product team asks for "Avg. Match Rate this week" — the average of only the jobs found in the last 7 days.

1. What change to the `scoredJobsResult` query would produce this?
2. What edge case emerges that doesn't exist for the all-time average?
3. The "Scored jobs only" subtitle would become misleading — what should the new subtitle say?
4. If a user found 10 jobs this week but none were scored yet, what should the card show?

Write out the query change and the subtitle change. No implementation required — explain your reasoning.

<details>
<summary>Hint</summary>

The existing query filters to non-null `match_score` rows. Adding a `gte("found_at", sevenDaysAgo)` filter narrows to this-week scored rows. The new edge case: a user can have scored jobs all-time but zero scored jobs this week — the `"—"` branch already handles this, but the subtitle needs updating.

</details>

---

For deeper exploration, [`docs/plan/15-stats-bar-real-data/ai-discussion-topics.md`](../../plan/15-stats-bar-real-data/ai-discussion-topics.md) has 17 prompts covering trust boundaries and mock-to-real transitions, null value semantics, `Promise.all` mechanics, and the data-ownership pattern. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
