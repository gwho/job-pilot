# Explanation — JobsDB Apify Search Fix

## Why the original actor looked healthy

The actor was doing many things correctly:

- It started successfully.
- It loaded a JobsDB page.
- It found 30 job cards.
- It deduped canonical job URLs.
- It visited 10 detail pages.
- It pushed 10 dataset items.

Those signals were not enough. They proved scraping worked, not that searching worked.

## The URL contract mattered

The old URL form was:

```text
https://hk.jobsdb.com/jobs?q=sales+coordinator&l=Hong+Kong
```

JobsDB accepted the URL and rendered job cards, but the results were generic. This is a dangerous scraper failure mode because the output is non-empty and looks valid.

The working URL form is:

```text
https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
```

This path encodes the query and location in the route. A live deployed actor run proved it produced relevant sales coordinator rows.

## Why local browser inspection was not enough

Local curl and Playwright probes hit a Cloudflare "Just a moment..." challenge. That made local HTML/page inspection unreliable.

The deployed Apify actor was the right diagnostic environment because it was the same runtime used by JobPilot and it could reach rendered JobsDB cards.

## Why the deploy was required

JobPilot does not run `apify/jobsdb-hk-actor/src/main.ts` locally. It calls the deployed Apify actor through `apify-client`.

Changing local actor code without deploying would not affect the app's search behavior. The actor had to be pushed and rebuilt on Apify.

## Testing layers

The new unit test covers URL construction:

```text
__tests__/find-jobs/jobsdb-urls.test.ts
```

The live actor run covers JobsDB's current behavior:

```text
sales coordinator / Hong Kong → 9 relevant rows out of 10
```

Both are needed. The unit test prevents accidental reversion to the wrong URL format. The live run proves the external site currently honors the URL.
