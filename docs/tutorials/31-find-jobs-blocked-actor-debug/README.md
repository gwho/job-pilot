# Tutorial 31 — Find Jobs: Debugging the Silent Blocked Actor

**After completing this tutorial you will understand:**
- How a 403 at the Apify actor layer silently propagated up through four independent system layers to produce the misleading "Found 0 jobs — all already saved" message
- How to build tight, deterministic test seams that go red on a specific bug before writing any fix code
- Why a discriminated union like `SearchOutcome` is more powerful than a boolean `isBlocked` flag — and what a caller loses with the simpler type
- How `Promise.race` eliminates timing race conditions in Single Page Application scraping, and why the `.catch(() => {})` is required
- Why local actor code changes are completely inert until `apify push` deploys a new build to Apify's cloud

> [!NOTE]
> **Prerequisites:** Tutorial 17 (`../17-adzuna-job-discovery/README.md`) — explains how `discoverJobsDbJobs` calls through `lib/apify.ts` to the Apify actor, and the overall route structure. Tutorial 19 (`../19-actor-debugging-selectors-captcha/README.md`) — explains Playwright selector strategies and why `data-automation` attributes are preferred. Open [`apify/jobsdb-hk-actor/src/search-outcome.ts`](../../apify/jobsdb-hk-actor/src/search-outcome.ts), [`apify/jobsdb-hk-actor/src/main.ts`](../../apify/jobsdb-hk-actor/src/main.ts), [`app/api/agent/find/route.ts`](../../app/api/agent/find/route.ts), and [`lib/apify.ts`](../../lib/apify.ts) alongside this tutorial.

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Discriminated union | `SearchOutcome` type in `search-outcome.ts:13–18` | Type theory |
| Monotonic invariant | `bestActorJobs` accumulation loop in `route.ts:118–142` | Algorithms |
| Promise.race as multiplexer | Four-way race in `main.ts:70–75` | System design |
| TypeScript CFA narrowing | `(page1Outcome as SearchOutcome)` cast in `main.ts:288` | Type theory |
| Seam selection | Pure-function tests in `actor-search-outcome.test.ts` | System design |
| Structured logging | `[diag] zero-cards: url=... \| title=...` pattern in `main.ts:116` | System design |

---

## How to use an LLM before this tutorial

### Concept 1 — Silent success masking upstream failure

> "Explain the concept of 'silent success' in distributed systems: when a downstream service reports success even though an upstream component failed. Give a concrete example — not from web scraping — where a system returns a success response while silently dropping data. Then ask me: if service A calls B calls C, and C fails but B catches the error and returns an empty array instead of throwing, what does A see? How would I detect that C had a problem?"

*What to listen for:* Each layer can only trust what it observes — not what actually happened. A SUCCEEDED status or HTTP 200 is a report about the layer that generated it, not all layers upstream. This is the mental model for how a 403 at the Apify actor produced "Found 0 jobs — all already saved" at the Next.js UI level.

*Practice question:* If an Apify actor calls `Actor.exit()` after its crawl loop, but 0 jobs were pushed to the dataset, does the calling code receive a success status or a failure status?

---

### Concept 2 — Discriminated unions vs boolean flags

> "Explain what a discriminated union is in TypeScript. Show me the difference between `isBlocked: boolean` and a union type like `'ok' | 'blocked' | 'empty' | 'redirect'`. Write a function that takes each type and show me code I could only write with the union, not the boolean. Then quiz me."

*What to listen for:* The union preserves distinctions between cases that happen to share a consequence. You can route `'blocked'` and `'empty'` to the same error path while still naming them differently in log messages. A boolean collapses them permanently at the type level, losing information forever.

*Practice question:* If `classifySearchPage` returned `{ isBlocked: boolean }` instead of a union, what would a caller need to do to show a different error message for "page loaded but no cards" vs "HTTP-level 403 failure"?

---

### Concept 3 — Monotonic invariants in accumulation loops

> "Explain what a monotonic value is in mathematics, then show how it applies to a data-accumulation loop. If I'm paginating through an API where each call is supposed to return a cumulative superset of all pages so far, why is a later call returning fewer items a signal that something went wrong? What real-world conditions cause this? Quiz me."

*What to listen for:* "Monotonically non-decreasing" means the value never shrinks. If page-3 must contain at least everything in page-2, a shrink means something changed between calls — most likely an upstream failure discarded earlier results. Fix: track the maximum seen value and discard any result that violates it.

*Practice question:* In a loop that calls `discoverJobsDbJobs(query, location, page * 10, page)`, what should `bestActorJobs` represent, and what condition should cause the loop to stop accumulating?

---

### Concept 4 — `Promise.race` as a multiplexer

> "Explain `Promise.race`: what it returns, what happens when the first promise rejects, and what happens to the other promises. Then explain how you would wait for whichever of these four events happens first: a job card appears, an empty-state element appears, or the URL changes to a login page. Show both a polling approach and a `Promise.race` approach. Quiz me."

*What to listen for:* `Promise.race` resolves (or rejects) with the first settled promise; the others continue running but are ignored. Latency is the minimum across all signals, not the sum. The `.catch()` is required because `Promise.race` rejects if the first settled promise is a rejection — Playwright's `waitForSelector` rejects on timeout, which must be swallowed here.

*Practice question:* If `Promise.race` is called with four promises and the third one rejects first, what happens to the race?

---

### Concept 5 — TypeScript CFA narrowing

> "Explain TypeScript's control flow analysis: how the compiler tracks variable types at different points in the code. Show an example of narrowing inside an `if` block. Then explain: if `let x: 'a' | 'b' | 'c' = 'a'` is declared, can TypeScript ever narrow it to just `'a'` inside a later `if` block? What triggers that? Quiz me."

*What to listen for:* TypeScript narrows based on assignments it can observe. If a variable was last assigned a literal before an `if` block, the compiler may narrow to that literal inside — even if the declared type is broader. This becomes a problem when a function call creates a conditional context that produces incorrect narrowing.

*Practice question:* If `let page1Outcome: SearchOutcome = "ok"` is assigned later inside callbacks, will TypeScript always know the runtime value at a subsequent `if` check?

---

## Architecture overview

A 403 at the Apify cloud layer silently propagated up through four independent layers:

```
┌──────────────────────────────────────────────────────────────┐
│  Browser: FindJobsClient.tsx                                 │
│  catch block logged only — no error banner set              │
└──────────────────────────────┬───────────────────────────────┘
                               │ POST /api/agent/find
┌──────────────────────────────▼───────────────────────────────┐
│  Route: app/api/agent/find/route.ts                          │
│  [] from actor → records.length === 0 → "all already saved" │
└──────────────────────────────┬───────────────────────────────┘
                               │ runJobsDbActor()
┌──────────────────────────────▼───────────────────────────────┐
│  lib/apify.ts                                                │
│  run.status === "SUCCEEDED" → no throw → returns []         │
└──────────────────────────────┬───────────────────────────────┘
                               │ actor call
┌──────────────────────────────▼───────────────────────────────┐
│  Apify Cloud: jobsdb-hk-actor                                │
│  403 → failedRequestHandler logs → Actor.exit() → SUCCEEDED │
└──────────────────────────────────────────────────────────────┘
```

Two key invariants govern the fix:

1. **The actor owns the failure signal.** Only the actor observes the 403. Every layer above it can only trust what the actor reports — so the actor must report the failure correctly.

2. **The route owns the accumulation logic.** The actor returns pages 1..N cumulatively. The route is responsible for ensuring a later call can never shrink the discovered set.

---

## Part 1 — The silent failure chain: SUCCEEDED with empty dataset

The bug arrived as this user-facing banner:

```
Found 0 jobs — all already saved.
```

The same search had worked a day earlier. Server logs showed:

```
Request blocked - received 403 status code
PlaywrightCrawler: Finished! Total 1 requests: 0 succeeded, 1 failed.
[jobsdb-actor] Done. Pushed 0 jobs across up to 1 page(s).
```

Yet the Next.js route returned HTTP 200 with `success: true`. The word "failed" never appeared in the route logs.

The failure chain had four steps, each individually defensible in isolation:

```
1. Crawlee retries page-1 search 3× → failedRequestHandler logs, does NOT call Actor.fail()
2. Actor reaches Actor.exit() normally → Apify marks run SUCCEEDED, dataset = []
3. lib/apify.ts: run.status === "SUCCEEDED" → no throw → returns []
4. route.ts: [] treated as valid result → records.length === 0 → "all already saved"
```

This is the **silent success masking upstream failure** pattern. Each layer correctly handles the message it receives — but the message was wrong from the first step.

**Checkpoint:** Why does `lib/apify.ts`'s existing guard (`run.status !== "SUCCEEDED"`) not catch this failure? What would need to change at step 2 for the guard to work?

<details>
<summary>Reveal answer</summary>

The guard checks whether the Apify run itself failed. A SUCCEEDED run is one where the actor ran to completion without an unhandled error — and in this case, the actor did run to completion. `failedRequestHandler` returned normally; the crawler finished; `Actor.exit()` was called. Apify has no way to know the "success" was hollow — 0 dataset items is not an error signal to the Apify SDK.

For the guard to catch this, the actor must call `Actor.fail()` when it detects the block. Then `run.status` becomes `"FAILED"`, `lib/apify.ts` throws, and the route returns 500. The existing guard was already correct — the missing piece was at step 2.

</details>

**Checkpoint:** Crawlee calls `failedRequestHandler` instead of throwing when a request exhausts retries. Why is this design useful in general, even though it caused this bug?

<details>
<summary>Reveal answer</summary>

`failedRequestHandler` gives actor code control over what to do when a specific request fails — log, save partial results, retry with different parameters — without aborting the entire crawl. If Crawlee threw instead, one bad URL would kill a 10,000-item crawl.

The cost: the handler must explicitly call `Actor.fail()` if the failure is fatal and no jobs should be returned. If it doesn't, the actor silently exits successfully with whatever data it collected — which may be nothing.

</details>

**Try it yourself:** Open [`lib/apify.ts`](../../lib/apify.ts#L42) and find the thrown error. Notice that `run.statusMessage` is now included in the error detail. Before build 0.1.8, this field was absent. What would the route log say about *why* the actor failed with the old error format?

---

## Part 2 — Building the feedback loop: five tests before one line of implementation

The `diagnosing-bugs` skill's core discipline is Phase 1: build a tight feedback loop before theorising. This bug required two loops:

**Loop A — Pure function tests** in [`__tests__/find-jobs/actor-search-outcome.test.ts`](../../__tests__/find-jobs/actor-search-outcome.test.ts). These test `classifySearchPage` and `shouldFailRun` with no Playwright, no Apify SDK, no mocking — just input → output.

**Loop B — Route-level seam tests** in `__tests__/find-jobs/blocked-actor.test.ts`. These mock `discoverJobsDbJobs` at the route's import boundary to simulate multi-page pagination behavior.

Open [`__tests__/find-jobs/actor-search-outcome.test.ts`](../../__tests__/find-jobs/actor-search-outcome.test.ts):

```typescript
import { describe, it, expect } from "vitest";
import {
  classifySearchPage,
  shouldFailRun,
  type SearchPageInput,
} from "@/apify/jobsdb-hk-actor/src/search-outcome";

describe("classifySearchPage", () => {
  const base: SearchPageInput = {
    url: "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong",
    cardCount: 0,
    hasKnownEmptySelector: false,
    hasEmptyTextFallback: false,
  };

  it("login redirect URL → 'login-redirect'", () => {
    expect(classifySearchPage({ ...base, url: "https://hk.jobsdb.com/login" })).toBe("login-redirect");
    expect(classifySearchPage({ ...base, url: "https://hk.jobsdb.com/sign-in?redirect=/jobs" })).toBe("login-redirect");
  });

  it("cards found → 'ok'", () => {
    expect(classifySearchPage({ ...base, cardCount: 10 })).toBe("ok");
  });

  it("zero cards + known empty-state selector → 'legit-empty'", () => {
    expect(classifySearchPage({ ...base, hasKnownEmptySelector: true })).toBe("legit-empty");
  });

  it("zero cards + text fallback only (no known selector) → 'suspicious-empty'", () => {
    expect(classifySearchPage({ ...base, hasEmptyTextFallback: true })).toBe("suspicious-empty");
  });

  it("zero cards + neither selector nor text → 'suspicious-empty'", () => {
    expect(classifySearchPage(base)).toBe("suspicious-empty");
  });
});
```

`classifySearchPage` is a pure function — a plain object in, a string out. No Playwright `Page` object to mock, no Apify KV store, no async operations. This seam was created deliberately: the classification logic was extracted from `extractCardLinks` into a separate module so it could be tested without a browser.

> **System design — Seam selection:** A "seam" is a boundary where behaviour can be observed and controlled independently of its dependencies. Pure functions are the ideal seam: zero dependencies means zero mocking surface, and the test is a direct specification of the function's contract. Extracting logic from a side-effecting context (Playwright page interactions) into a pure function creates a seam where tests are deterministic, fast, and readable as documentation.

The five route-level scenarios were written as RED tests before implementation:

| Scenario | Mock setup | Expected |
|---|---|---|
| Trace-2 repro | call 1: 10 dups, call 2: 20 dups, call 3: `[]` | `jobsFound ≥ 20` (not 0) |
| Legit empty | call 1: `[]` | "Found 0 jobs. Try different keywords." |
| Blocked upstream | call 1 throws | 500 response |
| Partial block (dups) | call 3 throws after 20 dups | 200 + warning suffix |
| Partial block (new jobs) | call 2 throws after mixed results | 200 + new jobs + warning |

**Checkpoint:** Why must calls 1–2 in the trace-2 repro test return dup jobs rather than new jobs?

<details>
<summary>Reveal answer</summary>

The route only continues paginating when it hasn't found enough *fresh* (not-yet-saved) jobs. If calls 1–2 returned new jobs, the route would find `freshCount >= TARGET_NEW = 10` and stop at call 2, never reaching call 3 where the `[]` shrink happens. The test would pass for the wrong reason — the loop terminated early, not because the shrink-detection guard worked.

Using dup jobs ensures the loop keeps paginating to call 3, where the `[]` shrink actually occurs.

</details>

**Checkpoint:** The `actor-search-outcome.test.ts` tests run entirely on the local TypeScript source. The route tests mock `discoverJobsDbJobs`. Why does this mean 73 passing tests do NOT verify that the deployed Apify actor works correctly?

<details>
<summary>Reveal answer</summary>

None of the tests call `runJobsDbActor` or contact Apify's cloud. The pure-function tests run `classifySearchPage` directly. The route tests mock at `discoverJobsDbJobs` — they never exercise the actor invocation path at all. All 73 tests could pass with no actor deployed, or with the wrong build deployed. Verification of actor changes always requires a separate live search in the app after `apify push`.

</details>

**Try it yourself:** Run `npm run test:run -- __tests__/find-jobs/actor-search-outcome.test.ts`. Find the `base` object — it has `cardCount: 0` and both selector flags `false`. What does `classifySearchPage(base)` return, and why?

---

## Part 3 — The discriminated union: classifying what the page returned

Open [`apify/jobsdb-hk-actor/src/search-outcome.ts`](../../apify/jobsdb-hk-actor/src/search-outcome.ts):

```typescript
export type SearchOutcome =
  | "ok"
  | "login-redirect"
  | "legit-empty"
  | "suspicious-empty"   // page loaded (200), zero cards, no recognised empty-state marker
  | "blocked-http";      // HTTP-level failure (403/429/etc.) — page never loaded

export function classifySearchPage(input: SearchPageInput): SearchOutcome {
  const { url, cardCount, hasKnownEmptySelector } = input;

  if (url.includes("/login") || url.includes("/sign-in")) {
    return "login-redirect";
  }

  if (cardCount > 0) {
    return "ok";
  }

  if (hasKnownEmptySelector) {
    return "legit-empty";
  }

  return "suspicious-empty";
}
```

The detection priority is deliberate:

1. **Login redirect** — authoritative. A URL change to `/login` is unambiguous regardless of card count.
2. **Cards found** — the page worked.
3. **Known empty-state selector** — `[data-automation="searchZeroResults"]` is a specific element JobsDB renders for genuine zero-results pages. Its presence is positive evidence.
4. **Default** — `"suspicious-empty"`. No evidence either way: suspect blocking or failed render.

Notice that `"blocked-http"` is not returned by `classifySearchPage` at all. It is only ever assigned in `failedRequestHandler` — the path where Crawlee exhausted all retries at the HTTP layer, before the page loaded. `classifySearchPage` only runs from inside `requestHandler` (the page did load). This separation by assignment site encodes the failure mode directly in the code.

> **Type theory — Discriminated union:** A discriminated union is a type where each variant is a distinct literal string tag. The compiler tracks which variant is active at each control flow point. `SearchOutcome` is a textbook discriminated union: the tag IS the value, every case in `classifySearchPage` maps to a distinct tag, and adding a new variant (`"blocked-http"`) causes TypeScript to surface any `switch`/`if-else` chains that don't handle it.

**Checkpoint:** What does a caller lose if `classifySearchPage` returns `{ isBlocked: boolean }` instead of the full `SearchOutcome` union?

<details>
<summary>Reveal answer</summary>

`isBlocked: boolean` collapses five cases into two: "blocked" and "not blocked." A caller needing to behave differently for `"login-redirect"` vs `"suspicious-empty"` can no longer do so — both are just `isBlocked: true`. The `Actor.fail()` message can't say "blocked at HTTP level" vs "page loaded but no cards." Metrics lose the ability to break down failure modes. Tests can only assert "was blocked," not which specific outcome occurred.

More subtly: `"legit-empty"` and `"ok"` are both `isBlocked: false` — but they mean different things for `shouldFailRun`. With the union, `"legit-empty"` is explicitly excluded from the failure set because we have positive evidence of a real empty page. With a boolean, that distinction is gone.

</details>

**Checkpoint:** `hasEmptyTextFallback` is in `SearchPageInput` but `classifySearchPage` never reads it. Why isn't it trusted as evidence for `"legit-empty"`?

<details>
<summary>Reveal answer</summary>

A regex like `/no results|0 jobs found/i` matches any page containing that text — including bot-detection challenge pages that commonly use phrases like "no results were found" in their challenge UI. A false `"legit-empty"` classification on a challenge page would cause `shouldFailRun` to return `false`, the actor would exit successfully with 0 jobs, and the route would say "Found 0 jobs. Try different keywords." — the same message as a genuine zero-results search.

`[data-automation="searchZeroResults"]` is authoritative because it requires the actual JobsDB UI component to have rendered. Text content can appear anywhere; a specific `data-automation` attribute requires the real frontend framework to have produced it.

</details>

---

## Part 4 — `Actor.fail()` and `shouldFailRun`: making blocked runs propagate

Open [`apify/jobsdb-hk-actor/src/main.ts`](../../apify/jobsdb-hk-actor/src/main.ts#L286):

```typescript
if (shouldFailRun({ page1Outcome, jobsPushed })) {
  let failMessage: string;
  if ((page1Outcome as SearchOutcome) === "blocked-http") {
    failMessage = `Search request blocked at HTTP level (status ${page1HttpStatus}) — page never loaded, no jobs discovered.`;
  } else {
    failMessage = `Search page loaded but returned no recognisable content (outcome: ${page1Outcome}) — no jobs discovered. Check diagnostics KV store for screenshot.`;
  }
  await Actor.fail(failMessage);
} else {
  await Actor.exit();
}
```

And `shouldFailRun` from `search-outcome.ts`:

```typescript
export function shouldFailRun({
  page1Outcome,
  jobsPushed,
}: {
  page1Outcome: SearchOutcome;
  jobsPushed: number;
}): boolean {
  if (jobsPushed > 0) return false;
  return (
    page1Outcome === "suspicious-empty" ||
    page1Outcome === "login-redirect" ||
    page1Outcome === "blocked-http"
  );
}
```

`shouldFailRun` checks `jobsPushed > 0` first and returns false immediately. This is the safety valve: if the actor pushed jobs despite the page-1 outcome looking suspicious, those jobs are real data. The page-1 outcome is a diagnostic signal, not a veto — it only matters when no other evidence of success exists.

**Checkpoint:** `shouldFailRun` returns `false` for `"legit-empty"` even though `jobsPushed` is 0 in that case. Why is `"legit-empty"` excluded from the failure set?

<details>
<summary>Reveal answer</summary>

`"legit-empty"` means: the page loaded successfully, rendered fully, and a verified JobsDB empty-state element was present. This is a valid result — the user searched for a title with no listings. The correct user-facing response is "Found 0 jobs. Try different keywords." (handled by the route), not "Search failed. Please try again."

`Actor.fail()` is for cases where something unexpected went wrong. A confirmed empty result is expected and should not fire an error banner.

</details>

**Checkpoint:** What would happen if the actor called `process.exit(1)` instead of `Actor.fail(message)`?

<details>
<summary>Reveal answer</summary>

`process.exit(1)` terminates the Node.js process with exit code 1. Apify detects the non-zero exit and marks the run FAILED — so `lib/apify.ts`'s guard would throw and the route would return 500. However, `run.statusMessage` would be empty or contain a generic Apify platform message. The detailed failure reason ("blocked at HTTP level (status 403)") would be lost from the error thrown upstream.

`Actor.fail(message)` is the idiomatic SDK method for a controlled failure: it sets both the FAILED status AND the `statusMessage` field, which `lib/apify.ts` includes in the thrown error's detail string.

</details>

**Try it yourself:** Open [`lib/apify.ts`](../../lib/apify.ts#L42). Find the `throw new Error(...)` line. The `run.statusMessage` detail was added in build 0.1.8 precisely to carry the actor's `Actor.fail(message)` text. Write out what the thrown error message says for a 403-blocked run.

---

## Part 5 — The route's monotonic guard and four-scenario policy

Open [`app/api/agent/find/route.ts`](../../app/api/agent/find/route.ts#L112):

```typescript
const TARGET_NEW = 10;
const MAX_PAGES = 5;
let bestActorJobs: JobsDbJob[] = [];
let jobsDbError: Error | null = null;
let searchIncomplete = false;

for (let page = 1; page <= MAX_PAGES; page++) {
  let pageResult: JobsDbJob[];
  try {
    pageResult = await discoverJobsDbJobs(jobTitle, location, page * 10, page);
  } catch (err) {
    jobsDbError = err as Error;
    if (bestActorJobs.length > 0) searchIncomplete = true;
    break;
  }

  // Monotonic invariant: a later call must never shrink the discovered URL
  // set. If it does, the actor was likely blocked mid-crawl; retain the
  // best result accumulated so far and stop pagination.
  if (pageResult.length < bestActorJobs.length) {
    if (bestActorJobs.length > 0) searchIncomplete = true;
    break;
  }

  bestActorJobs = pageResult;

  const freshCount = bestActorJobs.filter(
    (j) => j.sourceUrl && !existingByUrl.has(j.sourceUrl),
  ).length;
  if (freshCount >= TARGET_NEW || bestActorJobs.length < page * 10) break;
}
```

The actor's design: each call returns ALL results from pages 1..N cumulatively. Call 1 (maxPages=1) returns up to 10 results. Call 2 (maxPages=2) returns up to 20 — a superset of call 1. This design makes the actor output monotonically non-decreasing with respect to page count.

`bestActorJobs` enforces this invariant at the route level: it only updates when `pageResult.length >= bestActorJobs.length`. A shrink is treated as a suspicious signal — the actor may have been blocked mid-crawl — so the last valid result is kept and pagination stops.

> **Algorithms — Monotonic invariant:** A monotonic invariant is a property that only moves in one direction (here: the set only grows). Maintaining a "high-water mark" and only advancing it is a common data-processing pattern. The variable name `bestActorJobs` names this directly — it is the largest valid result seen so far, not merely the most recent result.

**Checkpoint:** What specific failure does the old `allActorJobs = pageResult` (assign on every iteration) create vs. the `bestActorJobs` pattern?

<details>
<summary>Reveal answer</summary>

With `allActorJobs = pageResult`: if call 3 returns `[]` (blocked mid-crawl), `allActorJobs` becomes `[]`, overwriting the 20 real jobs found in calls 1–2. The route then computes `records = []` and returns "Found 0 jobs — all already saved."

With `bestActorJobs`: when call 3 returns `[]`, `pageResult.length (0) < bestActorJobs.length (20)` — the shrink is detected, `searchIncomplete = true`, and the loop breaks with `bestActorJobs` intact at 20 jobs. Those 20 jobs are scored and returned.

</details>

After the loop, the route applies a four-scenario policy:

| Condition | Response | Banner |
|---|---|---|
| `jobsDbError && bestActorJobs.length === 0` | 500 | "Job search failed. Please try again." |
| `totalFound === 0` | 200 | "Found 0 jobs. Try different keywords." |
| `records.length === 0` (all dups) | 200 | "Found N jobs — all already saved." |
| New jobs found | 200 | "Found N jobs and saved X new jobs." |

Each path adds `incompleteSuffix` / `incompleteSuffixNew` when `searchIncomplete = true`.

**Checkpoint:** Could a legitimate (non-blocked) actor run ever return fewer items on page N+1 than page N, triggering the shrink detection incorrectly?

<details>
<summary>Reveal answer</summary>

In theory, yes — if JobsDB removes listings between calls. In practice this is extremely unlikely within seconds. The design choice favors false positives over false negatives: a false-positive shrink detection returns `searchIncomplete = true` and stops pagination early (the user sees a partial results warning). A false-negative (missing the shrink) would replace real jobs with an empty array. The asymmetry favors stopping early.

</details>

---

## Part 6 — `lib/apify.ts` and the UI catch block

Open [`lib/apify.ts`](../../lib/apify.ts):

```typescript
export async function runJobsDbActor(
  input: JobsDbActorInput,
): Promise<JobsDbActorOutput[]> {
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

  const run = await client
    .actor(process.env.APIFY_JOBSDB_ACTOR_ID!)
    .call(input, { timeout: 270 });

  if (run.status !== "SUCCEEDED") {
    const detail = run.statusMessage ? ` — ${run.statusMessage}` : "";
    throw new Error(`JobsDB actor run ${run.status}${detail} (runId: ${run.id})`);
  }

  const { items } = await client
    .dataset(run.defaultDatasetId!)
    .listItems();

  return items as JobsDbActorOutput[];
}
```

This file required only a minor change: adding `run.statusMessage` to the thrown error. The `run.status !== "SUCCEEDED"` guard was already correct — a FAILED run throws immediately. The only gap was that the actor was reporting SUCCEEDED when it should have reported FAILED.

The UI catch block in [`components/find-jobs/FindJobsClient.tsx`](../../components/find-jobs/FindJobsClient.tsx) also needed closing. Before the fix, the catch block only called `console.error`. When the route returned 500, the loading spinner disappeared silently — the old table persisted with no user feedback.

```typescript
} catch (error) {
  console.error("[FindJobsClient] search error:", error);
  setSearchStatus({
    message: "Search failed. Please try again.",
    isError: true,  // ← added
  });
} finally {
  setIsLoading(false);
}
```

**Checkpoint:** Among the four layers fixed (actor, route, lib, UI), which single fix has the highest user impact if you could only ship one?

<details>
<summary>Reveal answer</summary>

The actor fix (`Actor.fail()`) has the highest impact. Once the actor correctly reports FAILED, `lib/apify.ts` throws, the route returns 500, and the UI (after the catch fix) shows an error banner. Three layers start working correctly because one layer corrected its signal. The route's monotonic guard addresses a second failure mode (shrink on partial block) that the actor fix alone doesn't cover — both are necessary, but the actor fix is the higher-leverage single change.

</details>

---

## Part 7 — Precision: `"blocked-http"` as a distinct outcome

Build 0.1.8 confirmed the actor correctly called `Actor.fail()` on HTTP 403. But `failedRequestHandler` was setting `page1Outcome = "suspicious-empty"` — a type meaning "page loaded but showed no cards." An HTTP failure means the page never loaded. Two different failure modes; one type.

The `failedRequestHandler` in [`main.ts`](../../apify/jobsdb-hk-actor/src/main.ts#L267):

```typescript
failedRequestHandler({ request, error }) {
  const statusMatch = (error as Error).message?.match(/\b(\d{3})\b/);
  const httpStatus = statusMatch?.[1] ?? "unknown";
  console.warn(
    `[jobsdb-actor][diag] Request failed: url=${request.url} | label=${request.label} | page=${(request.userData as { page?: number }).page ?? 1} | httpStatus=${httpStatus} | error=${(error as Error).message}`,
  );
  if (request.label === "SEARCH" && (request.userData as { page?: number }).page === 1) {
    page1Outcome = "blocked-http";
    page1HttpStatus = httpStatus;
  }
},
```

`"blocked-http"` is only ever assigned here. `"suspicious-empty"` is only ever returned from `extractCardLinks` (where the page did load). The assignment site encodes the failure mode.

The HTTP status is extracted from Crawlee's error message with `/\b(\d{3})\b/` — a three-digit word-boundary match. This feeds `page1HttpStatus`, which appears in the `Actor.fail()` message: "blocked at HTTP level (status 403)."

**Checkpoint (TypeScript narrowing):** Adding `"blocked-http"` introduced a type error: "This comparison appears to be unintentional because the types `'ok'` and `'blocked-http'` have no overlap" — for `page1Outcome === "blocked-http"` inside `if (shouldFailRun(...))`. The fix was `(page1Outcome as SearchOutcome) === "blocked-http"`. Why did TypeScript narrow `page1Outcome` to `'ok'` inside that block?

<details>
<summary>Reveal answer</summary>

TypeScript's CFA (control flow analysis) tracks assignments and narrows variable types based on what it can prove. `page1Outcome` is initialized as `"ok"` (`let page1Outcome: SearchOutcome = "ok"`). Inside `if (shouldFailRun(...))`, TypeScript reasons: `shouldFailRun` returns `true` only when `page1Outcome` is `"suspicious-empty"`, `"login-redirect"`, or `"blocked-http"`. So if we're inside this branch... TypeScript intersects the declared type with the implied type and concludes `page1Outcome` must be `"ok"` (the complement). This is backwards reasoning that produces the wrong result for a mutable variable assigned inside callbacks.

`(page1Outcome as SearchOutcome)` breaks the narrowing by casting to the full declared type before the comparison. This is the correct approach when you know the declared type is right but CFA is incorrectly narrowing it.

</details>

**Checkpoint:** Would a TypeScript type predicate fix this more cleanly? What would the `shouldFailRun` signature look like with one?

<details>
<summary>Reveal answer</summary>

Yes. A type predicate signature:

```typescript
function shouldFailRun({ page1Outcome, jobsPushed }: ...): 
  page1Outcome is "suspicious-empty" | "login-redirect" | "blocked-http" {
```

Inside `if (shouldFailRun(...))`, TypeScript would narrow `page1Outcome` to `"suspicious-empty" | "login-redirect" | "blocked-http"` — making `page1Outcome === "blocked-http"` a valid comparison without a cast. The `as SearchOutcome` workaround exists because `shouldFailRun` does not have a type predicate, so TypeScript cannot infer the narrowing intent from the function's return type.

</details>

---

## Part 8 — Race-based DOM waiting and structured observability

The original `extractCardLinks` waited 15 seconds for job cards, then checked `[data-automation="searchZeroResults"]` with no preceding wait. `isVisible()` is a synchronous DOM snapshot — if the empty-state element was still hydrating (React component not yet mounted), it returned `false`, misclassifying the page as `"suspicious-empty"`.

Open [`main.ts`](../../apify/jobsdb-hk-actor/src/main.ts#L70):

```typescript
// Race: resolve as soon as any meaningful DOM signal appears (or on timeout).
await Promise.race([
  page.waitForSelector('[data-testid="job-card"]', { timeout: 15000 }),
  page.waitForSelector('[data-automation="searchZeroResults"]', { timeout: 15000 }),
  page.waitForURL("**/login**", { timeout: 15000 }),
  page.waitForURL("**/sign-in**", { timeout: 15000 }),
]).catch(() => {});
```

The first signal to fire wins:
- Job card appears → cards found, proceed
- Empty-state element appears → legit empty
- URL changes to `/login` or `/sign-in` → session redirect
- 15 seconds elapse with no signal → timeout

`.catch(() => {})` discards rejections from the race. Playwright's `waitForSelector` rejects when its timeout expires. Without `.catch()`, a 15-second timeout on any of the four promises would propagate as an unhandled rejection and crash `extractCardLinks` — even though "no signal within 15s" is a handled case, not a crash.

> **System design — Promise.race as multiplexer:** Serial waiting ("wait 15s for cards, then check empty state, then check login URL") takes up to 45 seconds worst case. The race starts all four signals simultaneously and resolves as soon as any fires — latency is the minimum across all signals, not the sum. This pattern is called a "multiplexer": multiple inputs combined into a single output that emits the first to arrive.

**Checkpoint:** `Promise.race` is called with four promises, and one rejects before any resolves. What does `Promise.race` do?

<details>
<summary>Reveal answer</summary>

`Promise.race` rejects with the same reason as the first-settling promise — whether that settlement is a resolve or a reject. The other three promises continue running but their outcomes are ignored. This is why `.catch(() => {})` is essential: Playwright's `waitForSelector` rejects after 15s if the element never appeared. Without `.catch()`, the first timeout would propagate out of `extractCardLinks` as an unhandled rejection.

</details>

After the race, zero-card results collect five diagnostic fields before classification ([`main.ts:104–117`](../../apify/jobsdb-hk-actor/src/main.ts#L104)):

```typescript
const diagUrl = page.url();
const diagTitle = await page.title().catch(() => "");
const diagEmptyState = await page
  .locator('[data-automation="searchZeroResults"]')
  .isVisible()
  .catch(() => false);
const diagLoginMarker = diagUrl.includes("/login") || diagUrl.includes("/sign-in");
const diagBlockMarker = await page
  .locator('[data-testid="captcha"], [id*="captcha"], [class*="captcha"], [id*="challenge"]')
  .isVisible()
  .catch(() => false);

console.log(
  `[jobsdb-actor][diag] zero-cards: url=${diagUrl} | title="${diagTitle}" | emptyState=${diagEmptyState} | login=${diagLoginMarker} | block=${diagBlockMarker}`,
);
```

The log format is **pipe-delimited key=value pairs** — structured logging. Every field has a consistent name across runs. `grep "\[diag\] zero-cards"` extracts all zero-card events from a log export. `grep "block=true"` finds all runs where a captcha element was visible. Free-form text ("the page had a captcha") is easy to write and hard to query; this format is readable to humans and parseable by tools.

> **System design — Structured logging:** Structured logs trade readability-at-a-glance for machine-parseability. The pipe-delimited key=value format is a middle ground: a human reading the log immediately understands it; a grep or log aggregation tool can extract individual fields without a JSON parser. This matters at scale — when reviewing 100 actor runs, you want to query across all of them, not read each one individually.

On `"suspicious-empty"`, a per-run screenshot is saved ([`main.ts:127–137`](../../apify/jobsdb-hk-actor/src/main.ts#L127)):

```typescript
if (outcome === "suspicious-empty") {
  const store = await Actor.openKeyValueStore();
  const runId = Actor.getEnv().actorRunId ?? "unknown";
  const buf = await page.screenshot({ fullPage: false }).catch(() => null);
  if (buf) {
    await store.setValue(`diagnostics/${runId}/suspicious-empty.png`, buf, {
      contentType: "image/png",
    });
    console.log(`[jobsdb-actor] Screenshot saved to diagnostics/${runId}/suspicious-empty.png`);
  }
}
```

The key `diagnostics/${runId}/suspicious-empty.png` scopes the artifact to a specific run. Without `runId`, every suspicious-empty run would overwrite the same key — only the most recent failure would be inspectable.

**Checkpoint:** Session loading now logs `${cookies.length} cookies (store: ${storeId ?? "default"})`. Why log the count but not the cookie names, values, or domains?

<details>
<summary>Reveal answer</summary>

Cookie values from a real authenticated JobsDB session are credentials. If they appeared in Apify actor logs, anyone with read access to the run console could use them to hijack that session. Even domain names reveal the authentication target and session scope.

Cookie count answers the diagnostic question without leaking anything: `12 cookies` suggests a real authenticated session; `0 cookies` suggests the session file exists but is empty — a distinct failure mode from the session file not existing at all. Both states are diagnosable from the count; neither requires the values.

</details>

**A note on `apify push`:** Every actor change in this session — `"blocked-http"` outcome type, race-based wait, session logging, per-run screenshots — was completely inert until `apify push` deployed build 0.1.9. The Next.js app calls the actor by `APIFY_JOBSDB_ACTOR_ID`, which points to the latest deployed build. Testing a live search between a local code change and `apify push` tests the previous build regardless of what the local files say.

```bash
cd apify/jobsdb-hk-actor && apify push
```

Build 0.1.8 → 0.1.9 for these changes.

---

## Full data flow: a blocked search from click to error banner

Tracing a 403-blocked search through all four layers:

```
1.  User clicks Find Jobs ("sales coordinator")
    → FindJobsClient.tsx: setIsLoading(true), POST /api/agent/find

2.  route.ts: auth check, profile fetch, agent_run INSERT (status: "running")
    → PostHog: job_search_started

3.  route.ts: page=1 loop iteration
    → discoverJobsDbJobs("sales coordinator", "Hong Kong", 10, 1)
    → lib/apify.ts: runJobsDbActor({ maxItems:10, maxPages:1 })
    → ApifyClient.actor(id).call(input) — blocks until run terminates

4.  Apify cloud: actor starts
    → loadStorageState(): "Session loaded: 12 cookies (store: default)"
    → PlaywrightCrawler requests https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
    → JobsDB returns HTTP 403 on all 3 Crawlee retries

5.  main.ts: failedRequestHandler fires
    → statusMatch: "403", httpStatus = "403"
    → page1Outcome = "blocked-http", page1HttpStatus = "403"
    → console.warn: "[diag] Request failed: url=... | label=SEARCH | page=1 | httpStatus=403 | ..."

6.  main.ts: shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 0 }) → true
    → Actor.fail("Search request blocked at HTTP level (status 403) — page never loaded, no jobs discovered.")
    → Apify: run.status = "FAILED", run.statusMessage = "Search request blocked at HTTP level..."

7.  lib/apify.ts: run.status === "FAILED" (≠ "SUCCEEDED")
    → throw new Error("JobsDB actor run FAILED — Search request blocked at HTTP level (status 403)... (runId: abc)")

8.  route.ts catch block:
    → jobsDbError = Error("JobsDB actor run FAILED...")
    → bestActorJobs.length === 0 → searchIncomplete unchanged (false)
    → loop exits

9.  route.ts: jobsDbError && bestActorJobs.length === 0 → hard failure
    → agent_runs UPDATE (status: "failed")
    → return NextResponse.json({ success: false, error: "Job search failed. Please try again." }, { status: 500 })

10. FindJobsClient.tsx: res.ok === false → throw → catch block fires
    → setSearchStatus({ message: "Search failed. Please try again.", isError: true })
    → setIsLoading(false)

11. UI renders error banner: "Search failed. Please try again."
```

---

## Extend it (challenges)

**Challenge 1 — Trace (15–20 min):** Follow what happens when `page1Outcome = "legit-empty"` through all four layers. Does `shouldFailRun` return true or false? Does `Actor.fail()` get called? What does `lib/apify.ts` receive? What response does the route return, and what does the banner say? Write out each step with the relevant code lines.

<details>
<summary>Hint</summary>

Start at `shouldFailRun` in `search-outcome.ts` — check if `"legit-empty"` is in the failure set. Then follow the `Actor.exit()` path through `lib/apify.ts` (what does `run.status` equal?). In the route, what are `bestActorJobs`, `totalFound`, and `records.length` when the actor returned 0 items legitimately? Find the exact banner copy.

</details>

---

**Challenge 2 — Extend (20–30 min):** Add a `"rate-limited"` outcome to `SearchOutcome` for HTTP 429 (too many requests), distinct from `"blocked-http"` (403). Update `failedRequestHandler` to set `"rate-limited"` when `httpStatus === "429"`. Update `shouldFailRun` to include it. Update the `Actor.fail()` message to say "rate-limited" for this case. Add two tests. Run `npm run test:run` and confirm all pass.

<details>
<summary>Hint</summary>

Steps: (1) add `"rate-limited"` to the `SearchOutcome` union; (2) update `shouldFailRun`'s return condition; (3) in `failedRequestHandler`, check `httpStatus === "429"` and set `"rate-limited"` instead of `"blocked-http"`; (4) add a third branch in the `Actor.fail()` message block. TypeScript will surface any exhaustive check gaps when you add to the union.

</details>

---

**Challenge 3 — Break and fix (30–45 min):** In `route.ts`, change the monotonic guard from:

```typescript
if (pageResult.length < bestActorJobs.length) {
```

to:

```typescript
if (pageResult.length <= bestActorJobs.length) {
```

Run `npm run test:run -- __tests__/find-jobs/blocked-actor.test.ts`. Which test fails, and why? What real-world scenario does this break — specifically, what happens on the very first loop iteration? Revert after reasoning through it.

<details>
<summary>Hint</summary>

On page=1, `bestActorJobs.length` starts at 0. With `<=`: `pageResult.length (10) <= 0` is false — the first call still works. The scenario that breaks is different. Think about what happens when page N+1 returns the exact same number of items as page N. Is that a legitimate result or a shrink?

</details>

---

For deeper exploration, [`docs/diagnosing-bugs/find-jobs-blocked-actor/ai-discussion-topics.md`](../../docs/diagnosing-bugs/find-jobs-blocked-actor/ai-discussion-topics.md) has 20 prompts covering the silent-success pattern, monotonic invariants, classification evidence quality, test seam design, and policy tradeoffs. [`docs/plan/find-jobs-actor-diagnostics/ai-discussion-topics.md`](../../docs/plan/find-jobs-actor-diagnostics/ai-discussion-topics.md) has 18 more covering outcome type precision, race-based DOM waiting, observability design, security logging, and TypeScript narrowing edge cases. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
