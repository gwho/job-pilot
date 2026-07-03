# Architect Discussion — Feature 15: Stats Bar Real Data

This is the full reasoning record from the architect session. It goes deeper than the decisions file — it explains why certain questions were asked at all, what the conceptual stakes were, and what principles underlie each choice.

---

## The feature in one sentence

Replace four hardcoded numbers on the dashboard stat cards with real InsForge DB values for the current user, while removing misleading comparative signals that would look fake next to real data.

---

## Why the architect session started with language alignment

Before any implementation decision, the session established shared definitions for six terms. This is not ceremony — it is necessary. Terms like "Avg. Match Rate" and "Jobs This Week" sound obvious until you ask: average of what? Jobs with null scores or without? All jobs or just recent ones? "This week" by rolling window or calendar week?

Each of these terms had at least one interpretation that would produce different code. Aligning on definitions first meant that when a decision question was asked ("should nulls count in the denominator?"), both parties already knew what "nulls" meant in this context and why the question mattered.

**The terms and why they needed defining:**

- **"real data"** — distinguishes the feature goal (live DB, per-user, at request time) from "not mock". It also rules out cached data, aggregated data, or data shared across users.

- **"current user"** — establishes that the auth source is the existing `getCurrentUser()` call in `page.tsx`. This matters because it rules out a second auth call, a prop-drilled user ID, or a cookie read. The user is already in scope.

- **"Avg. Match Rate"** — the word "average" is unambiguous, but "across which jobs?" is not. The denominator question is real: including null scores gives a different number than excluding them, and both interpretations are defensible.

- **"Companies Researched"** — "count of jobs where company_research IS NOT NULL." This definition rules out deduplication by company name (one company with multiple researched jobs counts once per job row, not once per company). That deduplication is a future concern, not Feature 15.

- **"Jobs This Week"** — "last 7 × 24 hours from request time" vs. "calendar week Mon–Sun." These produce different numbers especially on Mondays: a job found last Thursday would be "this week" by calendar but outside the 7-day rolling window. Rolling window was chosen for simplicity and timezone-neutrality.

- **"trend indicator"** — the green badge with a percentage. Naming it explicitly allowed the session to treat it as a thing that could be removed, neutralized, or wired to real data — not as a fixed part of the design.

---

## The trust boundary concept

The session introduced "trust boundary" as the framing for Decision 1. This is worth unpacking because it is a broadly applicable principle.

A trust boundary is the point in a UI where data transitions from fake to real. Before Feature 15, every number on the dashboard was mock. After Feature 15, the four stat numbers are real. The trend badges were still mock.

The problem with a partial trust boundary is that users cannot tell which parts to trust. If they see "+12% vs last week" next to a real "47 jobs," they might act on the trend — but the trend is invented. Worse: the more realistic the real data looks, the more the fake data looks real by proximity.

This is why Option B (neutral badge reading "Live data") was rejected even though it would have avoided the fake percentage. A badge that says "Live data" uses the visual affordance of a comparative signal (badge shape, color, icon) without providing comparison. It is dishonest in a subtler way — it looks like it is telling you something about change, but it is not.

The correct resolution at a trust boundary is: either wire the signal to real data, or remove it. Do not neutralize it with vague text. The badge was removed.

**When would you add real trends?**
When the explicit goal of a feature is to provide week-over-week comparison. That would require:
- Two sets of queries (current period and prior period)
- Boundary logic (what counts as "last week"?)
- Edge case handling (what if the user had zero jobs last week?)
- A conscious design decision about how to display negative trends (is a lower avg match rate this week shown as a red badge? a grey badge?)

None of that belongs in a feature scoped to "wire stat values to real data."

---

## Why the Avg. Match Rate denominator matters

The `match_score` column in the `jobs` table is `number | null`. A job can be saved with a null score in two situations:

1. The scoring step (Nemotron) failed for that job
2. The job was imported via a path that does not run scoring (not currently possible in the app, but the schema allows it)

If null scores counted as 0 in the denominator, the average would be artificially low. A user who finds 10 jobs, 5 of which score 80% and 5 of which failed to score, would see:
- With nulls as zero: `(80+80+80+80+80+0+0+0+0+0) / 10 = 40%`
- Without nulls: `(80+80+80+80+80) / 5 = 80%`

40% is not an accurate representation of how well this user's jobs match their profile. SQL's `AVG()` function excludes nulls by default for exactly this reason — the standard behavior exists because averaging over "no data" is almost always wrong.

The InsForge SDK does not expose SQL `AVG()` directly through a PostgREST filter (you cannot write `.select('match_score.avg()')`  reliably across all PostgREST implementations). The chosen approach — fetch all non-null match_scores and compute the average in JS — is semantically identical and avoids relying on a PostgREST aggregate extension that may not be available.

**Why `?? 0` still appears in the reduce:**
```ts
scoredRows.reduce((sum, r) => sum + (r.match_score ?? 0), 0)
```
The query filtered out null scores, so `r.match_score ?? 0` will never use the `0` fallback in practice. But TypeScript types `match_score` as `number | null` (because it reflects the DB column), so without the `?? 0`, TypeScript would complain about adding `null` to a number. The fallback is for the type system, not for runtime behavior. It is correct to leave it.

---

## The "—" vs "0%" distinction and what it teaches

This distinction appears simple but encodes an important principle: **absence of measurement is not the same as a zero measurement.**

`0%` says: "I measured this, and it came back at zero."
`"—"` says: "There is nothing to measure yet."

In the context of Avg. Match Rate:
- `0%` would mean: "Your jobs have been scored and they all scored zero."
- `"—"` means: "No scoring data exists for your account yet."

For a new user with no jobs, `0%` looks like a bug or a system error. `"—"` reads as an expected empty state that will fill in after they use the app.

This same distinction applies broadly. In a data table, a cell showing `0` in a revenue column means the value is zero. A cell showing `—` means the value is unknown or not applicable. These are different states and deserve different representations.

**The implementation pattern that makes this work:**
```ts
const avgMatchRate =
  scoredRows.length > 0
    ? `${Math.round(...)}%`
    : "—";
```
The value stays in its "domain" form (either a number or nothing) until it reaches the format step. The condition is simple and co-located with the format. Anyone reading this code understands: if there are scored rows, produce a percentage string; if not, produce a dash. The logic is at the right altitude — it is in the page component that owns data, not in the display component that receives it.

---

## Promise.all and why it matters for page performance

`Promise.all` is not just syntactic convenience. It is a fundamental concurrency pattern.

Without it:
```ts
const totalJobsResult = await insforge.database.from("jobs")...;    // wait ~30ms
const scoredJobsResult = await insforge.database.from("jobs")...;   // wait another ~30ms
const companiesResult = await insforge.database.from("jobs")...;    // wait another ~30ms
const thisWeekResult = await insforge.database.from("jobs")...;     // wait another ~30ms
// Total: ~120ms sequential
```

With it:
```ts
const [a, b, c, d] = await Promise.all([query1, query2, query3, query4]);
// All four fire at once. Total: ~30ms (slowest single query)
```

For a server-rendered page, every millisecond added to the data-fetching phase is a millisecond added to time-to-first-byte. Four sequential queries at 30ms each would add 90ms of unnecessary latency compared to concurrent queries.

The `Promise.all` pattern only works when queries are independent — when none depends on the result of another. All four stats queries here are independent: they each query the `jobs` table for the same user but with different filters. No result feeds into another.

**What happens if one query fails?**
InsForge SDK queries return `{ data, error }` — they do not throw. So `Promise.all` will not reject if one query fails; it will resolve with all four results, each containing either data or an error. The error logging checks each result independently after the await.

If the SDK ever did throw, `Promise.all` would reject on the first throw, and the remaining three queries (which may have already started) would be ignored. That is not a risk here given the SDK's design, but it is worth knowing.

---

## Why four SDK queries instead of one raw SQL aggregation

The alternative considered was a single SQL query run via InsForge MCP's `run-raw-sql` tool or a stored RPC function:

```sql
SELECT
  COUNT(*) AS total_jobs,
  AVG(match_score) AS avg_match_score,
  COUNT(*) FILTER (WHERE company_research IS NOT NULL) AS companies_researched,
  COUNT(*) FILTER (WHERE found_at >= NOW() - INTERVAL '7 days') AS jobs_this_week
FROM jobs
WHERE user_id = $1;
```

This is one network round-trip and returns all four values at once. It is the SQL-native solution.

**Why it was not chosen:**

1. **New infrastructure surface:** The `run-raw-sql` MCP tool is for infrastructure setup, not runtime application queries. Runtime queries must go through the SDK. To run raw SQL at runtime, you need a stored function (RPC) deployed in InsForge. Deploying a function is an infrastructure step that belongs to Feature 04 (Database Schema) or a dedicated function-creation feature — not to a feature whose scope is wiring stat values.

2. **Pattern mismatch:** Every data-fetching operation in this app uses the SDK's chainable query builder. Introducing raw SQL in application code creates a second pattern to maintain and a second mental model to hold.

3. **Negligible performance difference:** Four lightweight count queries on indexed columns take approximately the same total time as one aggregation query. The performance argument for a single query only becomes compelling at much larger scale.

4. **Each result independently typed and handled:** Four separate results let you log and fall back each one independently. A single aggregation result either succeeds or fails as a unit — a failure means all four stats show their fallback, with no way to distinguish which part of the query failed.

The four-query approach is correct for this stage of the project. If scale eventually requires optimization, a stored function is the right path — but that decision belongs to a future feature, not to Feature 15.

---

## What the `sevenDaysAgo` computation teaches about server rendering

```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
```

Two things to note:

**Computed once, used once.** In a server component, there is no re-rendering. `Date.now()` is called once at request time, and the result is used for exactly one query. The "compute once before `Promise.all`" instruction in the session was defensive — in a server component it is technically irrelevant whether you compute it inside or outside the array. But computing it outside is still clearer: it makes the query filter value visible as a named constant rather than an inline expression inside a method chain.

**Rolling window, not calendar week.** The ISO string produced is something like `"2026-06-27T14:23:00.000Z"` — an exact timestamp 7 × 24 hours before the request. The DB query filter `.gte("found_at", sevenDaysAgo)` returns all jobs found after that timestamp. Calendar weeks would require computing the start of the current week in the user's timezone — which the server does not know without user profile data. Rolling window avoids that entirely.
