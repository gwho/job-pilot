# Reasoning — Find Jobs Search Fixes

## The first hypothesis was about stale UI state

The user first reported that searches seemed to keep showing the same jobs. The app code supported that hypothesis:

```ts
setJobs((currentJobs) => mergeJobsById(currentJobs, data.jobs as Job[]));
```

This meant the table acted like accumulated history. That was especially confusing when `/api/agent/find` returned `jobs: []` for an all-deduped repeat search.

The precise diagnosis was that the API response mixed up two meanings:

- "Rows inserted into the database"
- "Rows the user should see for this search"

Those are not the same thing after dedupe.

## The second hypothesis moved down to the actor

After the UI updated correctly, the user still saw irrelevant jobs. That shifted the investigation down the pipeline.

The important question became:

```text
Does the actor return jobs matching the typed query before the app ever sees them?
```

The live actor run answered no.

## Why local probing was limited

Local Playwright and curl probes hit JobsDB's "Just a moment..." challenge. That made them poor feedback loops for the actual scraper behavior.

The deployed Apify actor was the correct probe because:

- It is the exact runtime JobPilot calls.
- It had the stored JobsDB session and Apify browser environment.
- It got past the challenge and produced real dataset rows.

## Why the URL helper was extracted

The actor's `main.ts` has top-level `Actor.init()` and is not suitable for direct unit import. To test the URL contract without starting the actor, the URL logic was moved to:

```text
apify/jobsdb-hk-actor/src/urls.ts
```

This allowed a deterministic unit test:

```ts
expect(jobsDbSearchUrl("sales coordinator", "Hong Kong")).toBe(
  "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong",
);
```

The live actor run still remains necessary for full confidence, because unit tests cannot prove JobsDB currently honors the URL.

## The deeper principle

For scrapers, "valid page loaded" and "correct search intent applied" are different success criteria.

The actor was successfully loading a JobsDB page, finding cards, visiting details, and pushing dataset rows. All of that was operationally green. The semantic bug was that the page did not represent the user's search.

Future scraper tests should include semantic assertions, not only structural assertions.
