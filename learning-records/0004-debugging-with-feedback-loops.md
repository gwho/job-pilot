# 0004 — Debugging with Feedback Loops

**Date:** 2026-06-29
**Session:** /diagnosing-bugs — Find Jobs silent error path

## Key insight

Debugging is a scientific method, not intuition. The skill forces one rule above all: **build a red-capable test before forming any hypothesis**. Reading code to build a theory first is the failure mode — it anchors on the first plausible idea and makes it easy to miss simpler causes.

A "red-capable" test is one that:
1. Drives the actual bug code path
2. Asserts the user's exact symptom
3. Is capable of going RED on this specific bug — not just "any failure"

## Non-obvious nuance

A GREEN test in a debugging session is not wasted. The consecutive-search test was designed to confirm or falsify H2/H3/H4 all at once — it went GREEN, eliminating three hypotheses with a single run. The only remaining hypothesis (H1: silent error path) was then confirmed by the RED test.

This is binary search applied to code: pick the test that eliminates the most hypotheses per run.

## Common mistake to avoid

Forming a hypothesis before building the feedback loop. In this session, the obvious first hypothesis was H2 ("setJobs doesn't update on multiple searches"). If that had been tested first without the paired error-path test, the investigation would have gone in the wrong direction — H2 was wrong.

## What this session demonstrates

`handleSearch` in `FindJobsClient.tsx` had a silent error path:
```
if (!res.ok || !data.success) {
  console.error(...);
  return;  ← no setSearchStatus call
}
```
The user saw old results because the search FAILED silently — not because the search succeeded incorrectly. The test that proved this was the simplest possible mock: `{ ok: false, status: 500 }`.

## Fix principle

The minimal change: add `setSearchStatus({ message: ..., isError: true })` to the existing error path. The banner mechanism already existed; the error path simply wasn't using it. No new components, no new state slots, no Error Boundary.
