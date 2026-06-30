# Resolution — Find Jobs Search Fixes

## Root cause 1: current search rows were not returned

The route correctly deduped JobsDB rows before insertion, but it incorrectly used the newly inserted rows as the only display rows.

On a repeat search where all discovered jobs already existed in the database, the route returned:

```ts
{
  success: true,
  jobs: [],
  jobsFound: 10,
  newJobs: 0,
  successMessage: "Found 10 jobs — all already saved."
}
```

The UI then kept displaying the old rows.

## Fix 1: separate persistence rows from display rows

`app/api/agent/find/route.ts` now separates:

- `newJobs`: actor results that should be inserted.
- `displayJobs`: rows that should be shown for the current actor run.

Already-saved jobs found by the current actor run are looked up from the database and included in the response. They are not inserted again.

`FindJobsClient` now treats `initialJobs` as saved history before any search. After the user clicks Find Jobs, it replaces the table with the API response rows.

## Root cause 2: the actor used a URL that returned generic listings

The actor was using:

```text
https://hk.jobsdb.com/jobs?q=sales+coordinator&l=Hong+Kong
```

Live Apify runs showed that this could return unrelated generic JobsDB listings. This explained why the table updated but still did not match the search box.

## Fix 2: use JobsDB SEO search paths

The actor now builds search URLs like:

```text
https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
```

The URL helper lives in:

```text
apify/jobsdb-hk-actor/src/urls.ts
```

The actor was deployed to Apify build `0.1.7` after the fix.

## What was discarded

The previous assumption that the query-parameter URL was reliable was discarded.

The prior test assumption that the table should always behave as saved history was also revised. The current behavior is:

- Before search: show saved history.
- After search: show the latest search result.

## What the session learned

The Find Jobs flow has two important contracts:

1. The API response `jobs` array is a display contract, not just an insert-result contract.
2. The actor search URL must be verified with live canary queries, because a URL can render valid-looking JobsDB cards while ignoring the typed search intent.

## Verification

Commands run:

```bash
npm run test:run -- __tests__/find-jobs/seam.test.tsx
npm run test:run -- __tests__/find-jobs/jobsdb-urls.test.ts
npm run test:run
npm run lint
npm run build
```

`npm run build` required network access because Next.js fetched Google Fonts.

Live actor verification after deployment:

```text
query: sales coordinator
location: Hong Kong
result: 10 rows, 9 title-relevant
```
