# Explanation

## Root cause

The JobsDB actor was no longer the failing layer. The stale UI came from the app seam between `/api/agent/find` and `FindJobsClient`.

The route used URL-based dedupe correctly for storage, but it treated deduped jobs as if they did not exist for display. On a repeat search, every discovered `sourceUrl` could already be in the database, so the route returned:

```ts
{
  success: true,
  jobs: [],
  jobsFound: 10,
  newJobs: 0
}
```

The client then merged `[]` into the existing table state, leaving old rows visible. That made it look like the search button was not searching or that the same results were being reused.

## API decision

The route now has two outputs with different meanings:

- `newJobs`: how many rows were newly inserted after dedupe.
- `jobs`: the rows to show for the current search result.

This means already-saved jobs found by the latest actor run are still returned to the UI. They are not inserted again.

## Client decision

`FindJobsClient` now uses `initialJobs` as saved history only before a search runs. Once the user clicks Find Jobs, the table becomes the latest search result and replaces the previous list.

This matches the user expectation: the visible table after a search should reflect the query that was just submitted.

## Test decision

The seam test was changed to catch the actual stale-table bug. It now asserts that old rows disappear after a new search response arrives, and that the banner uses the API `successMessage` rather than reconstructing copy from partial response fields.

## Follow-up: typed query relevance

After the current-search table fix, the table updated correctly but still showed jobs unrelated to the typed query.

The red-capable live repro was:

```text
Run deployed JobsDB actor with:
query: "sales coordinator"
location: "Hong Kong"
maxItems: 10
maxPages: 1
```

Before the fix, the actor navigated to:

```text
https://hk.jobsdb.com/jobs?q=sales+coordinator&l=Hong+Kong
```

That URL returned generic listings such as Property Manager, Technician, and banking roles. The issue was not the JobPilot UI or DB dedupe; the actor was using a JobsDB URL form that did not reliably apply the keyword search.

The actor now builds JobsDB SEO search URLs:

```text
https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
```

The helper lives in `apify/jobsdb-hk-actor/src/urls.ts` and is covered by `__tests__/find-jobs/jobsdb-urls.test.ts`.

The updated actor was deployed to Apify build `0.1.7`. A live verification run for `sales coordinator` returned 10 jobs, 9 of which matched the query by title, including multiple exact `Sales Coordinator` rows.
