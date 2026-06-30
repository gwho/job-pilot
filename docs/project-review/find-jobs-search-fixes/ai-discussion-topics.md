# AI Discussion Topics — Project Review

## API Contracts

1. Why should `jobs` in `/api/agent/find` represent display rows rather than inserted rows?
2. What are good names for separating inserted rows from display rows in future API responses?
3. Why is idempotency important for repeat job searches?

## UI State

4. Why does `initialJobs` as saved history make sense before a search, but not after a user submits a new search?
5. What UI would make "latest search" vs "saved history" explicit?
6. Why should `SearchControls` render `successMessage` instead of rebuilding copy?

## Scraper Standards

7. What is the difference between structural scraper correctness and semantic scraper correctness?
8. How can review catch a scraper that returns valid-looking but irrelevant data?
9. What should be included in a scraper deploy checklist?

## Production Readiness

10. Why is a live Apify canary part of production readiness for this feature?
11. What remaining risks exist even after the `sales coordinator` canary passed?
12. How should future code reviewers verify changes to `apify/jobsdb-hk-actor/src/urls.ts`?
