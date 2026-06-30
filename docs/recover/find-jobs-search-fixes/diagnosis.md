# Diagnosis — Find Jobs Search Fixes

## What broke

The Find Jobs flow had already gone through implementation and at least one corrective pass, but the user still saw incorrect behavior:

1. The table did not clearly reflect the latest search after clicking Find Jobs.
2. A later fix made the table update, but the updated results still did not match the typed query.

The concrete example was a JobsDB search for `sales coordinator` in `Hong Kong`. The expected result was a table of sales coordinator jobs. The actual result included unrelated roles such as Property Manager, Technician, banking roles, claims roles, and product management roles.

## Failure mode

This session started as **Failure Mode 1 — a specific thing is broken**.

The first broken behavior was isolated to the Find Jobs API/UI seam:

- `/api/agent/find` returned `jobs: []` when the actor found only already-saved JobsDB rows.
- `FindJobsClient` merged that empty array into existing state.
- The table kept showing stale rows from before the current search.

After that was fixed, the remaining issue became closer to **Failure Mode 3 — the foundation is wrong** for the actor search layer.

The wrong assumption was:

```text
https://hk.jobsdb.com/jobs?q={query}&l={location}
```

was assumed to be a reliable JobsDB keyword search URL.

Live Apify actor runs showed that this URL could render generic JobsDB listings unrelated to the typed query. The app and database were then faithfully displaying bad source data from the actor.

## Evidence used

The first app-seam repro was a Vitest test:

```bash
npm run test:run -- __tests__/find-jobs/seam.test.tsx
```

The test was changed so it went red when stale rows remained after a new search response.

The second actor-level repro was a live Apify run using the same input the user typed:

```json
{
  "query": "sales coordinator",
  "location": "Hong Kong",
  "maxItems": 10,
  "maxPages": 1
}
```

Before the URL fix, the deployed actor returned mostly unrelated titles. After the URL fix and actor deployment, the same input returned 10 rows, 9 of which were title-relevant, including multiple exact `Sales Coordinator` results.

## Why this diagnosis mattered

The stale table and irrelevant results looked like one bug from the UI, but they were two different failures:

- The stale table was an app response/state contract bug.
- The irrelevant jobs were an actor search URL contract bug.

Treating both as a UI state problem would have left the actor returning bad data. Treating both as an actor problem would have left repeat searches unable to show already-saved current results.
