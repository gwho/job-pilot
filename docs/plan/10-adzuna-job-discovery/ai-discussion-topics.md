# AI Discussion Topics — Feature 10-adzuna-job-discovery: Adzuna Job Discovery

## Group A — The search data flow

1. Walk through exactly what happens between the "Find Jobs" click and the table updating. At which step is the data the table renders actually produced, and why is no second fetch needed?
2. The route returns the inserted jobs *and* the page has its own DB query. Trace a user who searches, navigates to `/dashboard`, then returns to `/find-jobs` — which mechanism populates the table on each of those three renders?
3. Why does the route insert the `agent_runs` row *before* calling Adzuna rather than after? What would be lost if it were created at the end?
4. The jobs are inserted in a single `.insert(records).select()` rather than one insert per job. What does `.select()` give us here that we depend on, and what would break if we used a plain insert without it?

## Group B — Batch scoring and its failure modes

5. Batching collapsed ten Nemotron calls into one. Name every new failure mode this introduced that did not exist in the sequential design.
6. `scoreJobs` rebuilds its result by mapping over the *input* jobs, not the model's returned array. Why is that the safer iteration target? What silent bug does it prevent?
7. Why is returning `matchScore: 0` on a malformed entry better than throwing? Under what product circumstance would throwing actually be the right call instead?
8. The length guard catches a too-short array. It does *not* catch silent reordering (right length, wrong order). How would you detect or defend against reordering?
9. If OpenRouter started rate-limiting even the single batch call, what is the next move — and does it push you back toward sequential, or somewhere else entirely?

## Group C — Caching, freshness, and client state

10. Explain a concrete user journey where `setJobs` is sufficient and `force-dynamic` is irrelevant — and the exact journey where the reverse is true.
11. Why is calling `router.refresh()` after the search strictly wasteful here? Walk through every operation it would trigger.
12. If `force-dynamic` were removed but `setJobs` kept, what specific bug appears, and on which user action does it surface?
13. `force-dynamic` disables caching for the whole route. If this page later became expensive to render, what more surgical primitive could keep the jobs fresh without disabling all caching?

## Group D — Types, profiles, and Adzuna mapping

14. Why does the `JobInsert` mapping explicitly set `responsibilities: null`, `company_research: null`, etc., instead of omitting them? What does the `JobInsert` type actually allow to be omitted, and why only those?
15. The route uses `.maybeSingle()` for the profile where the resume route uses `.single()`. Why the difference here, and what would the user experience be if this route used `.single()` and the profile row didn't exist?
16. `job_type` is mapped from Adzuna's `contract_type` with a fallback to `"fulltime"`. Why can't we pass Adzuna's value straight through, and what type guarantee is the mapping protecting?
17. Why is `salary` stored as a formatted string rather than the raw `salary_min`/`salary_max` numbers? What does that cost us later, and was it the right trade?

## Group E — Naming traps and safe deletion

18. The scorer imports `OpenAI` but uses Nemotron. Explain to a skeptical reviewer why that is correct and not a bug. What two configuration values make it true?
19. `library-docs.md` says "GPT-4o" over code that calls Nemotron. Beyond this feature, what is the systemic risk of label/code drift, and how would you prevent it recurring?
20. Removing the Connected Accounts card produced a `Cannot find name 'linkedinConnected'` error mid-edit. Walk through why, and explain what a careless deletion (stopping at the error, or "fixing" it by deleting the `handleSave` line) would have done to the stored `linkedin_connected` value.
21. The planned `Job.source` type fix turned out to be unnecessary. Why is it correct to record "no change made" rather than apply a cosmetic edit anyway? What does inventing the edit cost a future reader?
22. Hong Kong was requested as a supported country but Adzuna has no `hk` endpoint. Why was surfacing that constraint the right move rather than silently adding `hk`, and what would the runtime symptom have been if we had?
