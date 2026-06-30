# Feedback Loop — Find Jobs Search Fixes

## Bug 1: stale rows after search

The first red/green loop was:

```bash
npm run test:run -- __tests__/find-jobs/seam.test.tsx
```

The test was updated to assert that after a successful search response, previous table rows disappear and the API response rows appear.

Before the fix, this failed because `FindJobsClient` merged incoming rows into existing rows. When the API returned an empty `jobs` array for already-saved current results, stale rows stayed visible.

After the fix, the same test passed because `FindJobsClient` replaces the table with the latest search response.

## Bug 2: current rows did not match the typed query

The second red/green loop was a live Apify actor run:

```text
Actor input:
query: "sales coordinator"
location: "Hong Kong"
maxItems: 10
maxPages: 1
```

Before the fix, the actor returned unrelated jobs such as:

- Property Manager
- Technician (Electronics)
- Settlement Manager
- Assistant Claims Manager
- Senior Product Management Manager

The actor was navigating to:

```text
https://hk.jobsdb.com/jobs?q=sales+coordinator&l=Hong+Kong
```

After the fix and deploy, the same live input returned mostly relevant results:

- Sales Coordinator
- Sales Coordinator
- Sales Coordinator
- Trade Fair Coordinator
- Sales Coordinator/Administrator
- Sales Administrator
- Sales Services Co-ordinator
- Sales coordinator/ Shipping Coordinator

The final live check returned 10 rows, 9 relevant by title.

## Why two loops were needed

The stale-table loop tested the app contract. It could not prove that JobsDB itself was searching correctly.

The live actor loop tested the source-data contract. It could not prove that the UI replaced stale rows correctly.

Together, they covered both sides of the bug report:

- "The same jobs keep showing" → API/UI state seam.
- "The current search result does not match the search box" → actor search URL seam.
