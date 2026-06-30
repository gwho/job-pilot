# Record — JobsDB Apify Search Fix

## Scope

This session used the Apify actor boundary to diagnose why JobPilot search results did not match the text entered in the Find Jobs search box.

The active actor is:

```text
APIFY_JOBSDB_ACTOR_ID=XzcBowQgpzN8TVhse
```

## Initial live run

Input:

```json
{
  "query": "sales coordinator",
  "location": "Hong Kong",
  "maxItems": 10,
  "maxPages": 1
}
```

The deployed actor navigated to:

```text
https://hk.jobsdb.com/jobs?q=sales+coordinator&l=Hong+Kong
```

It returned unrelated titles including:

- Property Manager
- Technician (Electronics)
- Senior Officer, Counter Service
- Settlement Manager
- Assistant Claims Manager
- Citigold customer manager
- Quantity Surveyor
- Senior Product Management Manager

This proved the actor was returning valid-looking JobsDB rows that did not reflect the typed query.

## Fix

The actor search URL contract was changed to JobsDB's SEO path format:

```text
https://hk.jobsdb.com/{query-slug}-jobs
https://hk.jobsdb.com/{query-slug}-jobs/in-{location-slug}
```

For the user example:

```text
https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
```

The helper was extracted to:

```text
apify/jobsdb-hk-actor/src/urls.ts
```

## Deploy

The actor was deployed with:

```bash
apify push -w 120
```

The Apify CLI installed locally did not support the newer `--json` and `--user-agent` flags for `push`, so the documented project deploy command was used.

Successful build:

```text
Actor build detail: https://console.apify.com/actors/XzcBowQgpzN8TVhse#/builds/0.1.7
```

## Final live run

The same input returned 10 rows, 9 relevant by title:

- Sales Coordinator
- Sales Coordinator
- Sales Coordinator
- Trade Fair Coordinator
- Sales Coordinator/Administrator
- Sales Administrator
- Sales Coordinator
- Sales Services Co-ordinator (Contract)
- Sales coordinator/ Shipping Coordinator
- Commercial Officer (Order Processing & Project Support)

The single less-obvious result was still plausibly related to commercial/order-processing work, but it did not match the simple title relevance regex used in the live assertion.
