# Find Jobs Current Search Results

## What was built

Fixed the Find Jobs search boundary so the table reflects the latest JobsDB search after the user clicks Find Jobs.

Before the fix, `/api/agent/find` returned only newly inserted jobs. If the JobsDB actor found jobs that were already saved, the route returned `jobs: []`, and `FindJobsClient` merged that empty response into the old table state. The UI looked like it had searched again but kept showing stale results.

Now the route separates persistence from display:

- New JobsDB URLs are inserted into `jobs`.
- Already-saved JobsDB URLs are looked up and included in the response.
- The response `jobs` array represents the latest actor run.
- The client replaces the table rows with that response after each search.

## Files changed

- `app/api/agent/find/route.ts`
- `components/find-jobs/FindJobsClient.tsx`
- `components/find-jobs/SearchControls.tsx`
- `apify/jobsdb-hk-actor/src/urls.ts`
- `apify/jobsdb-hk-actor/src/main.ts`
- `__tests__/find-jobs/seam.test.tsx`
- `__tests__/find-jobs/jobsdb-urls.test.ts`
- `context/library-docs.md`
- `context/ui-registry.md`
- `context/progress-tracker.md`

## Verification

- `npm run test:run -- __tests__/find-jobs/seam.test.tsx`
- `npm run test:run -- __tests__/find-jobs/jobsdb-urls.test.ts`
- `npm run test:run`
- `npm run lint`
- `npm run build`
- Live Apify actor run: `sales coordinator` / `Hong Kong` returned 9 relevant rows out of 10 after deploy.
