# AI Discussion Topics — Feature 10b-jobsdb-hk-discovery: JobsDB HK Job Discovery

---

## Group 1: Apify runtime vs. tooling boundary

1. `lib/apify.ts` uses `apify-client` SDK while the `apify` CLI is used only for development. What specific problems would occur if you tried to use the CLI inside a Next.js route handler instead of the SDK?

2. `client.actor(id).call(input, { timeoutSecs: 270 })` is a blocking call. The Next.js route has `maxDuration = 300`. Walk through exactly what happens if the actor takes 280 seconds — which timeout fires first, and what does the route return?

3. `apify-client` is installed as a production dependency in the root `package.json`. The actor's own `package.json` in `apify/jobsdb-hk-actor/` is separate. Why are they separate, and what would break if you tried to share one `package.json` for both?

4. The Apify actor is deployed separately from the Next.js app with `apify push`. What is the deployment dependency order — can you deploy the Next.js app before the actor exists, and what happens at runtime if `APIFY_JOBSDB_ACTOR_ID` points to a non-existent actor?

---

## Group 2: `ScoringInput` and the type refactor

5. The original `scoreJobs(jobs: AdzunaJob[])` worked for all of Feature 10 without the `ScoringInput` type. What specifically triggered the need for the refactor in Feature 10b, and at which line did TypeScript first surface the problem?

6. `AdzunaJob.company` is `{ display_name: string }` but `ScoringInput.company` is a flat `string`. Where is the flattening done, and why is it done in the adapter (`agent/jobsdb.ts`) rather than inside `buildJobsList`?

7. `ScoringInput` is exported from `agent/job-matcher.ts`. Why is it exported from the scorer file rather than from `types/index.ts`? What would be the consequence of moving it to `types/index.ts`?

8. If a future LinkedIn source adapter is added, what is the exact sequence of steps needed to wire it into the scoring pipeline without modifying `agent/job-matcher.ts`?

---

## Group 3: Authenticated session and actor security

9. Playwright `storageState` is loaded from Apify KV store via `Actor.getValue('JOBSDB_SESSION')`. Walk through exactly how a developer creates and uploads this value — what commands or UI steps are involved?

10. The actor applies cookies via `preNavigationHooks` rather than passing `storageState` directly to the browser context constructor. Why can't `PlaywrightCrawler` use the `storageState` option directly?

11. The session expiry check in `extractSearchResults` looks at `page.url()` after navigation. What are the failure modes of this approach — what if JobsDB shows a "please verify you're human" page instead of a redirect to `/login`?

12. `Actor.getValue` returns `object | null`. The code handles both a JSON string and an already-parsed object. Why does Apify KV store sometimes return one format vs. the other?

---

## Group 4: Deduplication and the two-pass design

13. Why does deduplication run against the DB before insert rather than using an `INSERT ... ON CONFLICT DO NOTHING` SQL pattern? What schema change would be required to use the SQL approach, and why was it deferred?

14. The batch dedup uses a `Set<string>` built incrementally as each job is evaluated. Why not just dedupe the array first with `new Set()` and then check against the DB? Is there a meaningful difference?

15. `totalFound` is the count from the actor (before dedup); `newCount` is the count after dedup and insert. The success message says `Found ${totalFound} jobs and saved ${newCount} new jobs.` Why is it important to show both numbers rather than just `newCount`?

16. Jobs with an empty or missing `sourceUrl` are silently filtered out by the dedup logic (`!job.sourceUrl` returns false). What happens to a genuine job listing where the actor failed to extract the URL? Should it be logged?

---

## Group 5: Route lifecycle and `maxDuration`

17. `export const maxDuration = 300` is a static export at the top of `route.ts`. Why can't this be an environment variable — what is it that requires it to be a compile-time literal?

18. If the actor run takes 130s and the Next.js route times out at 60s (Vercel Hobby), the route is killed before it can mark the `agent_runs` row as `failed`. What state is the row left in, and how would you detect and clean up orphaned `'running'` runs?

19. The route has two different early-return paths for "all jobs already seen": one for `records.length === 0` (returns immediately with empty jobs) and one for `insertedJobs.length === 0` after insert (would be a DB error). Why are these handled differently?

20. `job_found` PostHog events now include `sourceProvider: 'jobsdb_hk'` as a property. The event name itself is still `job_found`. What would a PostHog query look like to compare Adzuna vs. JobsDB strong match rates over time using this property?
