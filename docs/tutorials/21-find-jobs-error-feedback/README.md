# Tutorial 21 — Find Jobs Error Feedback: Diagnosing Silent Failures with Seam Tests

**After completing this tutorial you will understand:** what a "silent failure" is and why it is harder to notice than an outright crash; how to build a red-capable seam test that goes RED on the exact bug being hunted — not just "some failure"; how a GREEN test eliminates three hypotheses at once, shrinking the search space before a single line of code changes; why `isError?: boolean` on an existing state type is the minimal correct fix over a new state slot or an Error Boundary; and how `finally` guarantees cleanup in JavaScript async functions regardless of which branch executes.

---

> [!NOTE]
> **Prerequisites:** Tutorial 20 (`../20-filter-sort-pagination/README.md`) — introduces `FindJobsClient` state, the seam test pattern, and the URL-state architecture this tutorial extends.
> Tutorial 19 (`../19-actor-debugging-selectors-captcha/README.md`) — establishes the actor/route pipeline and the `/api/agent/find` route lifecycle that produces the error responses debugged here.
>
> Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx), [`components/find-jobs/SearchControls.tsx`](../../../components/find-jobs/SearchControls.tsx), and [`__tests__/find-jobs/seam.test.tsx`](../../../__tests__/find-jobs/seam.test.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Silent failure | `console.error` + `return` with no `setSearchStatus` — error is unobservable to the user | System design |
| Binary search on hypotheses | GREEN consecutive-search test eliminates 3 hypotheses at once, leaving exactly 1 | Algorithms |
| RAII / guaranteed cleanup | `finally { setIsLoading(false) }` — runs on all paths including early `return` and thrown exceptions | Design patterns |
| Optional discriminant | `isError?: boolean` vs `{ type: "success" | "error" }` discriminated union — when each is appropriate | Type theory |
| Seam testing | Mock at the `fetch` boundary so the component runs in isolation with zero network dependency | System design |

---

## How to use an LLM before this tutorial

Budget 20–30 minutes on these five concepts before reading code.

### Concept 1 — Silent failure: errors with no observable state change

> "Explain the 'silent failure' class of bug in software. Why is a silent failure harder to notice and debug than an error that throws an exception or shows a red screen? Give a concrete example in a UI component where calling `console.error` and returning early produces a worse user experience than re-throwing the error. Quiz me on how you would detect whether a code path is silently failing."

*What to listen for:* A silent failure leaves the system in an unchanged state after an error — the user cannot distinguish "nothing happened" from "the thing worked but had no effect." This is worse than a crash because at least a crash announces itself. The key insight: silent failures are invisible without test coverage specifically targeting the error path.

*Practice question:* A search button shows a spinner for 30 seconds, then the spinner disappears and the results table is unchanged. Name two distinct causes that produce this exact observable behaviour.

---

### Concept 2 — Red-capable tests: what "red-capable" means

> "In test-driven debugging, a 'red-capable' test is one that can go RED specifically on the bug being hunted — not just any failure. Explain the difference between a test that asserts 'the function didn't crash' and one that asserts 'the specific symptom the user reported appears in the DOM'. Give an example of both for a search feature, and explain why the second form is needed to confirm a bug is fixed vs. just not crashing."

*What to listen for:* A test that asserts "the component renders" will pass even if the bug is present. A red-capable test asserts the specific symptom: "after an API failure, an error message appears in the DOM." The test must be able to go RED on this bug — not some other bug, not a crash — and go GREEN only after the specific fix is applied.

*Practice question:* You write a test that mocks a 500 response and asserts `expect(component).toBeTruthy()`. Does this test go RED if the banner never appears? Is it red-capable for the silent failure bug?

---

### Concept 3 — Binary search on hypotheses

> "When debugging a system with 4 competing hypotheses about why something is broken, how does binary search apply? Explain the strategy of ordering tests to eliminate the maximum number of hypotheses per test run. Give a concrete example: if you have H1, H2, H3, H4 and one test rules out H2, H3, H4 simultaneously, what can you conclude from a GREEN result? What can you conclude from a RED result?"

*What to listen for:* Binary search applies to hypothesis elimination, not just sorted arrays. The goal is to pick the test that maximizes the number of hypotheses eliminated on a GREEN result. If a GREEN test rules out H2/H3/H4, then H1 becomes the sole remaining candidate. You haven't confirmed H1 yet — you've falsified everything else. The next test should be specifically designed to confirm or falsify H1.

*Practice question:* You have 4 hypotheses. Test A eliminates H2 and H3 (goes GREEN). Test B eliminates H4 (goes GREEN). What do you know about H1 without running any test directly targeting it?

---

### Concept 4 — RAII and `finally` in async JavaScript

> "Explain the RAII (Resource Acquisition Is Initialization) pattern from C++ and how the same principle appears in JavaScript's `try/finally` block. Give an example of an async function that acquires a 'resource' (like a loading state), uses it, and must release it on ALL code paths — including exceptions and early returns. Explain why putting the release in `finally` is safer than putting it in each branch of `try`. Quiz me."

*What to listen for:* RAII is the principle that resource release should be tied to scope exit, not to specific code paths. In JavaScript, `finally` implements this — it runs on normal exit, on `return`, on `throw`, and even after a `Promise` rejection. Putting `setIsLoading(false)` in `finally` means the button always re-enables — you can't accidentally write a code path that leaves the spinner spinning forever.

*Practice question:* An async function has three `return` statements inside a `try` block. You put `setIsLoading(false)` in `finally`. How many times do you need to write `setIsLoading(false)` to be sure it always runs?

---

### Concept 5 — Discriminated unions vs. optional flags

> "In TypeScript, two ways to add a variant to a type are: (1) add an optional property `isError?: boolean` to an existing type, or (2) create a discriminated union `{ type: 'success'; message: string } | { type: 'error'; message: string }`. Explain the trade-offs. When does the optional property produce ambiguous state? When does the discriminated union's exhaustiveness checking become worth the extra verbosity? Quiz me on which to prefer for a component that has exactly two distinct visual states (green banner vs. red banner)."

*What to listen for:* An optional `isError?: boolean` is ambiguous when undefined — is undefined the same as `false`? Does it mean "no error" or "not yet checked"? A discriminated union is exhaustive — TypeScript will warn at compile time if you add a third type and forget to handle it in a switch. For two clean states with no ambiguity, an optional flag is acceptable; for three or more states, or when states have different data shapes, a discriminated union is mandatory.

*Practice question:* If a type has `isError?: boolean`, what are the three possible values of `isError`, and which two are supposed to mean the same thing?

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (client component)                             │
│                                                         │
│  FindJobsClient                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  jobs: Job[]          ← setJobs(data.jobs)       │   │
│  │  searchStatus: {...}  ← setSearchStatus(...)     │   │
│  │  isLoading: bool      ← setIsLoading(false)      │   │
│  └─────────────┬───────────────────────────────────┘   │
│                │ handleSearch() fires on button click   │
└────────────────┼────────────────────────────────────────┘
                 │ fetch POST /api/agent/find
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Server (API route)                                     │
│                                                         │
│  app/api/agent/find/route.ts                           │
│  → discoverJobsDbJobs() → Apify actor (30–60s)         │
│  → scoreJobs() → insert DB                             │
│                                                         │
│  Path A (all saved): { success, jobs, successMessage } │
│  Path B (new jobs):  { success, jobs, successMessage } │
│  Error:              { success: false, error: "..." }  │
└─────────────────────────────────────────────────────────┘
```

**Key invariants:**
1. `searchStatus` is the SOLE state slot for post-search feedback — success and error both flow through it.
2. `setJobs` is only called on the success path — errors must never clear the table.
3. `setIsLoading(false)` is in `finally` — it runs on every path including early return.

---

## Part 1 — The symptom and why it was invisible

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) at lines 99–106:

```typescript
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  return;
}

// After an agent search, the table represents the latest search result.
setJobs(data.jobs as Job[]);
setSearchStatus({ message: data.successMessage as string });
```

This is the code before the fix. The error path does two things: logs to console, and exits the function via `return`. It does NOT call `setSearchStatus` — so the banner stays `null`, the table stays unchanged, and `isLoading` is cleared by `finally`.

From the user's perspective, the observable outcome of a silent failure was:
1. Button shows "Finding jobs…" for 30–60 seconds
2. Button re-enables (the `finally` block ran)
3. Table is unchanged — same jobs from `initialJobs` visible
4. No banner appears

This is identical to what happens after a successful search that finds no new jobs — except a successful search WOULD have shown a banner. The only thing that would distinguish failure from success to the user was the missing banner — and since the banner was what was broken, the distinction was invisible.

The `console.error` was descriptive and correct. But `console.error` writes to the browser's DevTools console. Most users never open DevTools.

> **System design — Silent failure:** A silent failure is an error that produces no observable state change in the UI. It is harder to notice than an outright crash because crashes announce themselves. The danger: a silent failure and a successful no-op produce the same user-visible outcome, making user-reported symptoms misleading. The fix always involves causing the error to produce a distinct observable state.

**Checkpoint:** The `finally` block ran correctly — `setIsLoading(false)` fired and the button re-enabled. Given this, why is "the button re-enabled" not evidence that the search succeeded?

<details>
<summary>Reveal answer</summary>

`finally` runs on ALL code paths: success, early `return`, and thrown exceptions. `setIsLoading(false)` in `finally` means the button ALWAYS re-enables regardless of outcome. So "button re-enabled" is evidence that `handleSearch` completed — not that it completed successfully. A successful search and a failed search both re-enable the button. The only thing that would distinguish them is `setSearchStatus` being called — which the error path wasn't doing.

</details>

**Try it yourself:** Open `handleSearch` and add a temporary `console.log("isLoading set to false")` inside `finally`. Trigger a successful search. Then, in your browser's network tab, find the `/api/agent/find` request and simulate a 500 by temporarily adding `throw new Error("test")` at the top of the route. Notice whether the log fires in both cases.

---

## Part 2 — Building a red-capable feedback loop

Open [`__tests__/find-jobs/seam.test.tsx`](../../../__tests__/find-jobs/seam.test.tsx). Before the fix was written, 7 tests existed — all using this mock helper:

```typescript
function mockFetch(body: object) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}
```

`ok: true` is hardcoded. Every test assumed the API succeeded. The error path — the code that actually had the bug — had zero test coverage.

The diagnosing-bugs skill's Phase 1 rule: **build a feedback loop before forming any hypothesis**. Reading code to form theories first is the failure mode — it anchors on the first plausible idea and makes it easy to miss simpler causes.

Two tests were written, each targeting a different hypothesis:

```typescript
// Test A — consecutive searches
// Hypothesis: setJobs doesn't fire correctly on multiple searches
global.fetch = vi.fn()
  .mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      jobs: searchAJobs,
      successMessage: "Found 2 jobs and saved 2 new jobs.",
    }),
  })
  .mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      jobs: searchBJobs,
      successMessage: "Found 2 jobs and saved 2 new jobs.",
    }),
  });
```

```typescript
// Test B — error path
// Hypothesis: error path silently returns with no banner
global.fetch = vi.fn().mockResolvedValueOnce({
  ok: false,
  status: 500,
  json: () =>
    Promise.resolve({ success: false, error: "Job search failed. Please try again." }),
});
```

**Result:**

```
Tests  1 failed | 7 passed (8)
```

Test A: **GREEN** — consecutive searches already worked correctly.  
Test B: **RED** — no error banner appeared; `waitFor` timed out at 1 second.

The RED test is red-capable because it:
- Drives the actual bug code path (`!res.ok` branch in `handleSearch`)
- Asserts the exact symptom (`screen.getByText(/search failed|please try again/i)`)
- Fails because the symptom is absent — not because something crashed

> **System design — Seam testing:** A seam is a boundary in a system where one component can be replaced with a test double. Here the seam is `global.fetch` — mocking it decouples the React component from the network entirely. The component runs in a real DOM (via jsdom), clicking a real button, calling real state setters. Only the network call is replaced. This makes the test deterministic (no network), fast (1.5 seconds), and focused on the UI/API contract rather than the API implementation.

**Checkpoint:** The `ok: false` test used `waitFor(() => { expect(...).toBeInTheDocument() })`, which times out if the element never appears. Is a timeout the ideal way to confirm a RED test, or is there a more deterministic alternative?

<details>
<summary>Reveal answer</summary>

A timeout is not ideal — it adds 1 second to every test run and makes the test slower. The deterministic alternative is to use `await waitFor(...)` for the loading state to resolve (which happens fast via `finally`), then immediately assert `expect(screen.queryByText(/search failed/i)).not.toBeInTheDocument()` — an immediate synchronous assertion that the error text is absent.

However, `waitFor` was appropriate here as the *discovery* tool: when you don't yet know the expected DOM outcome, `waitFor` gives the component time to settle into whatever state it reaches, and the timeout reveals that the element never appeared. After the bug was confirmed, a tighter assertion could be written for the regression test.

</details>

---

## Part 3 — How the GREEN test eliminates three hypotheses

Before the tests ran, there were four live hypotheses for why users saw old results:

| Hypothesis | What it predicts |
|---|---|
| H1: Error path silently returns | `setSearchStatus` never called on `!res.ok` |
| H2: `setJobs` doesn't update on multiple searches | Second call to `handleSearch` doesn't replace jobs state |
| H3: URL filter state masks new results | `match=high` or `q=text` in URL filters out new jobs |
| H4: `mergeJobsById` keeps old rows | Job deduplication logic doesn't clear previous results |

The consecutive-search test (Test A) was designed to target H2, H3, and H4 simultaneously:

```typescript
// Search A fires → searchAJobs appear in DOM
await clickFindJobs();
await waitFor(() =>
  expect(screen.getByText("Sales Coordinator HK")).toBeInTheDocument(),
);

// Search B fires → searchBJobs must replace searchAJobs
await clickFindJobs();
await waitFor(() =>
  expect(screen.getByText("Software Engineer Frontend")).toBeInTheDocument(),
);

// Search A jobs must be gone
expect(screen.queryByText("Sales Coordinator HK")).not.toBeInTheDocument();
```

Test A being GREEN means:
- `setJobs(data.jobs)` does replace the table on a second search (H2 falsified)
- URL filter state does not prevent the new results from appearing (H3 falsified)
- No deduplication logic is keeping old rows (H4 falsified)

One GREEN test eliminated three branches of the hypothesis tree. The only remaining hypothesis was H1. Test B (the RED test) then confirmed it.

> **Algorithms — Binary search on hypotheses:** A well-chosen test acts like a binary search on the hypothesis space. Each test either eliminates a set of hypotheses (GREEN) or confirms one (RED). The strategy is to pick the test that maximises hypotheses eliminated on a GREEN result. Here, one test eliminated three — the same information that would have required three separate tests if chosen naively. This is exactly the binary-search principle: each probe cuts the remaining search space as aggressively as possible.

**Checkpoint:** If Test A (consecutive searches) had gone RED instead of GREEN, what would that have implied, and how would the investigation have changed?

<details>
<summary>Reveal answer</summary>

A RED consecutive-search test would have meant that `setJobs(data.jobs)` was NOT correctly replacing jobs on a second search — H2 confirmed. The investigation would have shifted to the `handleSearch` success path: why does `setJobs` appear to run but the table doesn't update? Possible causes: `data.jobs` is undefined on the second call, React's state batching prevents a re-render, or the `filtered` useMemo is not re-evaluating. This would have been a component state bug, not an error-path bug. The fix would have been entirely different — and the error-path test might never have been written.

</details>

---

## Part 4 — The fix: `setSearchStatus` with `isError: true`

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) at lines 22–25 and 99–106 (after fix):

```typescript
type SearchStatus = {
  message: string;
  isError?: boolean;
};
```

```typescript
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  setSearchStatus({
    message: (data?.error as string) ?? "Search failed. Please try again.",
    isError: true,
  });
  return;
}
```

Three alternatives were considered and rejected:

**Option B — separate `errorMessage` state:**
```typescript
const [errorMessage, setErrorMessage] = useState<string | null>(null);
```
This creates a second state slot. Both `searchStatus` and `errorMessage` would need to be cleared at the start of each search. On success, you'd call `setSearchStatus(...)` — but if you forget `setErrorMessage(null)`, the error banner stays visible alongside the success banner. More surface area, more edge cases.

**Option C — throw and let a React Error Boundary catch:**
```typescript
throw new Error(data?.error);
```
Error Boundaries are for unexpected rendering crashes, not expected API failures. A 500 from `/api/agent/find` is expected — the actor can timeout, the session can expire. Using an Error Boundary here would show a full-page error state for something the user should be able to retry by clicking "Find Jobs" again.

**Option A (chosen):** uses the existing `searchStatus` state slot, which `SearchControls` already renders when non-null. Adding `isError?: boolean` makes the existing mechanism serve both outcomes. Atomically replacing `searchStatus` with a new value means there's no risk of success and error states coexisting.

**Checkpoint:** The error path calls `setSearchStatus(...)` but does NOT call `setJobs(...)`. What would happen to the table if `setJobs([])` were added to the error path?

<details>
<summary>Reveal answer</summary>

`setJobs([])` would clear the table — the user would see an empty table after a failed search, with no explanation other than the error banner. The previous table contents (the user's saved history) would be gone. This is worse than leaving the old rows visible: old data is still useful context; an empty table with an error message suggests the data was lost. The correct behavior on error is to leave `jobs` untouched — the error banner explains what happened, and the table remains a faithful representation of what's saved in the DB.

</details>

---

## Part 5 — The `SearchStatus` type: optional flag vs. discriminated union

The type after the fix:

```typescript
type SearchStatus = {
  message: string;
  isError?: boolean;
};
```

The alternative — a discriminated union:

```typescript
type SearchStatus =
  | { type: "success"; message: string }
  | { type: "error"; message: string };
```

The discriminated union is more type-safe. TypeScript's exhaustiveness checking will warn if you add a third variant (`type: "warning"`) and forget to handle it in a switch statement. The optional flag is silently `undefined` for any state not setting it explicitly.

However, `isError?: boolean` is correct here for two reasons:

1. **Two states, no ambiguity:** There are exactly two outcomes (success and error). `undefined | false` both mean "not an error." There is no third variant to add without changing the component's design.

2. **Minimal change:** The existing success path was `setSearchStatus({ message: data.successMessage })` — it did not need to change. A discriminated union would require adding `type: "success"` to the success-path call and updating the JSX to switch on `type` instead of checking `isError`. The optional flag is the smaller diff, and a smaller diff is a smaller risk.

**Checkpoint:** If the design were extended with a "warning" state (e.g., "Found jobs but some were filtered as low quality"), would `isError?: boolean` still be appropriate? What would you change?

<details>
<summary>Reveal answer</summary>

No. Once there are three distinct visual states (success, error, warning), the optional flag pattern breaks down: you'd need `isError?: boolean` and `isWarning?: boolean`, which allows the invalid combination `{ isError: true, isWarning: true }`. The correct pattern at three variants is a discriminated union: `{ type: "success" | "error" | "warning"; message: string }`. TypeScript will then require all variants to be handled everywhere `type` is read — enforced by exhaustiveness checking.

</details>

---

## Part 6 — Banner styling within the design system

Open [`components/find-jobs/SearchControls.tsx`](../../../components/find-jobs/SearchControls.tsx) at lines 89–100:

```tsx
{searchStatus && (
  <div
    className={`mt-4 flex items-center gap-2 text-sm rounded-md px-4 py-2 ${
      searchStatus.isError
        ? "bg-error/10 text-error"
        : "bg-success-lightest text-success-foreground"
    }`}
  >
    {searchStatus.isError ? <AlertCircle size={14} /> : <Sparkles size={14} />}
    {searchStatus.message}
  </div>
)}
```

The success path uses `bg-success-lightest text-success-foreground`. Both are named tokens defined in `app/globals.css`:

```css
--color-success-lightest: #ecfdf5;
--color-success-foreground: #007a55;
```

The error path uses `bg-error/10 text-error`. There is no `--color-error-lightest` token — only `--color-error: #ef4444`. The `/10` Tailwind opacity modifier applies 10% opacity to the error colour, creating a light-red tint without requiring a new token to be added to the design system.

The project rule: "Never use raw Tailwind colour classes (`bg-red-100`) or hex values — only project token classes." `bg-error/10` uses the `error` token with an opacity modifier — within the token system. `bg-red-100` would work visually but would not update if `--color-error` ever changed, breaking the design system's single source of truth.

> **System design — Design token opacity modifiers:** A design token is a named variable for a visual constant. Opacity modifiers (`/10`, `/20`) on tokens produce tints without requiring a separate token for every shade variant. This is the Tailwind v4 approach to what would otherwise be a proliferation of named tokens (`--color-error-light`, `--color-error-lightest`, etc.).

**Checkpoint:** If a designer decided to change the project's error colour from `#ef4444` to `#dc2626`, how many files need to change to update all error-coloured UI elements? How many would need to change if the code used `bg-red-500` directly?

<details>
<summary>Reveal answer</summary>

With the token system: one file — `app/globals.css`, changing `--color-error: #ef4444` to `--color-error: #dc2626`. Every use of `bg-error`, `text-error`, `bg-error/10` across all components updates automatically.

With `bg-red-500` directly: every component file that uses `bg-red-500` must be found and updated. This requires a global search-and-replace, which risks missing instances or incorrectly replacing non-error uses of `bg-red-500` (e.g., a decorative element that happens to use the same shade). The change is not atomic.

</details>

---

## Part 7 — `finally` and guaranteed cleanup

Open [`components/find-jobs/FindJobsClient.tsx`](../../../components/find-jobs/FindJobsClient.tsx) at lines 89–116:

```typescript
async function handleSearch() {
  setIsLoading(true);
  try {
    const res = await fetch("/api/agent/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobTitle, location }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      console.error("[FindJobsClient] search failed:", data?.error);
      setSearchStatus({
        message: (data?.error as string) ?? "Search failed. Please try again.",
        isError: true,
      });
      return;     // ← jumps to finally
    }

    setJobs(data.jobs as Job[]);
    setSearchStatus({ message: data.successMessage as string });
    replaceViewState({ page: 1 });
  } catch (error) {
    console.error("[FindJobsClient] search error:", error);
    // ← implicit jump to finally
  } finally {
    setIsLoading(false);   // ← always runs
  }
}
```

`setIsLoading(false)` is in `finally`. This means it runs:
- After the normal success path exits `try`
- After the `return` in the error branch (early return jumps to `finally`)
- After `catch` handles a thrown error (network failure, `res.json()` throws)

Placing `setIsLoading(false)` here instead of in each branch means the button can never be left stuck in the loading state. There is no code path that sets `isLoading(true)` and fails to set it back to `false`.

> **Design patterns — RAII / guaranteed cleanup:** RAII (Resource Acquisition Is Initialization) is a C++ pattern where resource release is tied to scope exit rather than specific code paths. JavaScript's `try/finally` implements the same principle: place any cleanup in `finally` and it becomes impossible to write a code path that skips it. In UI components, `isLoading` is a "resource" — it represents the user's attention being blocked. `finally` ensures this resource is always released, regardless of what the `try` block does.

The second new test confirmed this behaviour was already correct before the fix:

```typescript
it("clears the loading state after an API error so the button is re-enabled", async () => {
  // mock returns ok: false
  await clickFindJobs();
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: /find jobs/i });
    expect(btn).not.toBeDisabled();
  });
});
```

This test went GREEN immediately — documenting the existing behaviour and preventing a future refactor from accidentally moving `setIsLoading(false)` out of `finally`.

**Checkpoint:** The `catch` block currently only calls `console.error` — it does NOT call `setSearchStatus`. This means network errors (fetch throws because the connection is offline) are also silent failures. How would you extend the code to fix this, and why was it not fixed in the same session?

<details>
<summary>Reveal answer</summary>

The fix would add `setSearchStatus({ message: "Network error. Check your connection and try again.", isError: true })` at the end of the `catch` block — identical pattern to the `!res.ok` branch.

It was deferred because: (1) the `catch` path requires a different mock — `global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"))` instead of `mockResolvedValueOnce({ ok: false })` — which is slightly more complex to write; (2) network errors on a 60-second search are less common than server errors; (3) the minimum-scope discipline of the session was "fix what the test proves broken, defer what has no red test yet." A follow-up test and fix would cover this case independently.

</details>

---

## Full data flow: Actor fails → error banner appears

This trace follows a search where the Apify actor times out, producing a 500 response.

**1. User clicks "Find Jobs"** (`SearchControls.tsx:75`)
The button calls `onSearch` → `handleSearch()` in `FindJobsClient.tsx:89`.

**2. `setIsLoading(true)`** (`FindJobsClient.tsx:90`)
The button label changes to "Finding jobs…", `disabled={isLoading}` takes effect.

**3. `fetch("/api/agent/find", ...)` fires** (`FindJobsClient.tsx:92`)
30–60 seconds pass while the actor runs on Apify's infrastructure.

**4. Actor times out; route catches and returns 500** (`app/api/agent/find/route.ts:85–96`)
```typescript
} catch (error) {
  console.error("[api/agent/find] jobsdb error:", error);
  await insforge.database
    .from("agent_runs")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", runId).eq("user_id", userId);
  return NextResponse.json(
    { success: false, error: "Job search failed. Please try again." },
    { status: 500 },
  );
}
```

**5. `res.ok` is `false` (status 500)** (`FindJobsClient.tsx:99`)
The `if (!res.ok || !data.success)` branch is entered.

**6. `setSearchStatus({ message: "Job search failed...", isError: true })` fires** (`FindJobsClient.tsx:101–104`)
`searchStatus` React state is set to `{ message: "Job search failed. Please try again.", isError: true }`.

**7. `return` jumps to `finally`** (`FindJobsClient.tsx:105`)
`setIsLoading(false)` runs, button re-enables.

**8. `SearchControls` re-renders** (`SearchControls.tsx:89–100`)
`searchStatus` is non-null → banner `div` renders with `bg-error/10 text-error` class and `AlertCircle` icon. Message: "Job search failed. Please try again."

**9. `jobs` state is unchanged**
`setJobs` was never called. The table continues to show whatever was visible before the search.

---

## Extend it (challenges)

### Challenge 1 — Trace the `catch` path (15–20 min)

The `catch` block in `handleSearch` handles cases where `fetch` itself throws (not resolves with a bad status). Read `handleSearch` in full and answer:

- What causes `fetch` to throw (as opposed to resolving with `ok: false`)?
- Does `setSearchStatus` get called in the `catch` path?
- Does `setIsLoading(false)` get called in the `catch` path?
- Write out the step-by-step user experience when the browser is offline and the user clicks "Find Jobs."

<details>
<summary>Hint</summary>

`fetch` throws on network-level failures: no internet connection, DNS failure, request aborted by the browser, CORS error. It does NOT throw for 4xx or 5xx HTTP responses — those resolve normally with `ok: false`. The `catch` block runs only for the network-level failures, not for server errors.

</details>

---

### Challenge 2 — Add network error feedback (20–30 min)

Extend the fix to cover the `catch` path as well. Add `setSearchStatus` to the `catch` block so network errors also show a banner. Then write a test that goes RED without the fix:

```typescript
// The mock you need:
global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network request failed"));
```

Your test should assert that:
1. An error banner appears after the fetch rejects
2. The button is re-enabled after the error
3. The table is unchanged (still shows `initialJobs`)

<details>
<summary>Hint</summary>

`mockRejectedValueOnce` makes `fetch` throw, which the `try` block does not catch — execution jumps to `catch`. Add `setSearchStatus({ message: "Network error. Please check your connection.", isError: true })` before the end of the `catch` block.

</details>

---

### Challenge 3 — Design a typed API response contract (30–45 min)

`data` from `res.json()` is typed as `any`. TypeScript cannot verify that `data.error` is a string, that `data.success` is a boolean, or that `data.jobs` is a `Job[]`. Design a typed response schema that covers all paths the route can return.

Consider:
- How do you type a response that is either `{ success: true; jobs: Job[]; successMessage: string }` or `{ success: false; error: string }`?
- Where would this type live (`types/`, `app/api/agent/find/route.ts`, or a shared location)?
- How would you parse/validate the response at the boundary so TypeScript narrows the type correctly after the `if (!res.ok)` check?
- What happens if the route is updated to add a new field — does your design catch the omission?

<details>
<summary>Hint</summary>

A discriminated union works well here: `type FindApiResponse = { success: true; jobs: Job[]; jobsFound: number; newJobs: number; successMessage: string } | { success: false; error: string }`. After `const data = await res.json() as FindApiResponse`, the check `if (!data.success)` narrows to the error variant, making `data.error` a `string` inside the block. The type would live in `types/index.ts` or alongside the route.

</details>

---

For deeper exploration, `docs/diagnosing-bugs/find-jobs-silent-error/ai-discussion-topics.md` has 20 prompts covering silent failure categories, test coverage gaps, state machine design, component/API contracts, and debugging discipline. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
