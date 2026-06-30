# Feedback Loop — Find Jobs Silent Error Path

Session date: 2026-06-29  
Skill: `/diagnosing-bugs`  
Seam: `/api/agent/find` route ↔ `FindJobsClient` state update

---

## Bug report

"Show new 10 results based on the keyword in the search box whenever 'search' has been selected, rather than only showing previous result currently."

---

## Phase 1 — Build a feedback loop

### What was read first

Before writing any test, the following were read to build a mental model:
- `components/find-jobs/FindJobsClient.tsx` — state machine for the search UI
- `components/find-jobs/SearchControls.tsx` — button + banner rendering
- `app/find-jobs/page.tsx` — server component that loads `initialJobs`
- `__tests__/find-jobs/seam.test.tsx` — existing 7 passing tests (all success paths)

### Key observation before the loop

All 7 existing seam tests mocked `ok: true` responses. Zero tests covered `ok: false`. The error path in `handleSearch` was:

```typescript
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  return;  // ← no setSearchStatus call
}
```

### Feedback loop built

**Command:** `npm run test:run -- __tests__/find-jobs/seam.test.tsx`

Two new tests added to `__tests__/find-jobs/seam.test.tsx`:

**Test A — consecutive searches (hypothesis: component state is wrong):**
```typescript
// Two sequential fetch mocks: search A results, then search B results
// Assert: after second click, only B results in DOM, A results gone
```

**Test B — error path (hypothesis: silent failure):**
```typescript
// Mock: { ok: false, status: 500, json: { success: false, error: "Job search failed..." } }
// Assert: banner contains /search failed|please try again|something went wrong/i
```

### Phase 1 loop result

```
Tests  1 failed | 7 passed (8)
```

- Test A (consecutive searches): **GREEN** — component state was already correct
- Test B (error path): **RED** — no error banner appeared at all

The DOM dump for the RED test showed the `console.error` firing in stderr ("`[FindJobsClient] search failed: Job search failed. Please try again.`") with no corresponding element in the DOM.

### Loop characteristics

- **Red-capable:** yes — targets the exact symptom (old table, no feedback)
- **Deterministic:** yes — mocked fetch, no network
- **Fast:** 1.5 seconds total
- **Agent-runnable:** yes — single `npm run test:run` invocation

---

## Phase 2 — Reproduce + minimise

The minimal repro was already in the test:
- `initialJobs` = one job with title "Old Role"
- Mock returns `{ ok: false, status: 500 }`
- Click "Find Jobs"
- Assert banner contains error text → times out because no banner rendered

Every element is load-bearing: remove the `ok: false` and the test flips GREEN. Remove the assert and there's no signal.

**Exact symptom captured:** user sees the old table, button re-enables, banner stays null. Indistinguishable from "search did nothing."

---

## Phase 3 — Hypotheses (ranked by test evidence)

The RED/GREEN split eliminated most hypotheses before they were even stated:

| Hypothesis | Eliminated by |
|---|---|
| H2: `setJobs` doesn't fire on success | Consecutive-search test GREEN |
| H3: URL filter state masks new results | Table replaces test GREEN |
| H4: `mergeJobsById` keeps old rows | Previous session's fix + tests GREEN |
| **H1: error path silently returns** | **RED test — confirmed** |

**H1 stated fully:** If `handleSearch` returns early on `!res.ok || !data.success` without calling `setSearchStatus`, then a failed API call leaves the table unchanged and shows no feedback. The user cannot distinguish "search found nothing new" from "search failed."

**Prediction:** Adding `setSearchStatus({ message: ..., isError: true })` before the `return` makes the test GREEN.

---

## Phase 4 — No instrumentation needed

The test DOM dump was sufficient. No debug logs were added.

---

## Phase 5 — Fix + regression tests

### Fix applied

**`components/find-jobs/FindJobsClient.tsx`:**
```typescript
// Before:
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  return;
}

// After:
if (!res.ok || !data.success) {
  console.error("[FindJobsClient] search failed:", data?.error);
  setSearchStatus({
    message: (data?.error as string) ?? "Search failed. Please try again.",
    isError: true,
  });
  return;
}
```

**`SearchStatus` type** gained `isError?: boolean` in both `FindJobsClient.tsx` and `SearchControls.tsx`.

**`components/find-jobs/SearchControls.tsx`** — banner now switches style and icon:
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

Tokens used: `bg-error/10 text-error` — both derived from `--color-error` defined in `app/globals.css`. No raw hex or Tailwind colour classes.

### Regression tests added (net new: 3)

1. "shows error feedback when the API returns a failure — must not be silent" — RED → GREEN
2. "clears the loading state after an API error so the button is re-enabled" — GREEN (already worked via `finally`)
3. "second search replaces first search results — keyword B rows replace keyword A rows" — GREEN (confirmed existing behaviour)

---

## Phase 6 — Cleanup

- No `[DEBUG-...]` logs were added
- No throwaway prototypes
- All 37 tests pass (`npm run test:run`)
- Build clean (`npm run build`)

---

## What would have prevented this bug

The error path had zero test coverage from the start. The 5 original seam tests all used `ok: true` mocks. Writing one `ok: false` test when the success tests were first written would have caught this at authorship time.

**Rule for future seam tests:** for every `fetch` mock set, add at least one `ok: false` variant covering the failure path.
