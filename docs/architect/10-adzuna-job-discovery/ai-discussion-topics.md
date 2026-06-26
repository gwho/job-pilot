# Architect Session — Feature 10: AI Discussion Topics

Use these to go deeper with an AI on the reasoning behind Feature 10. Each probes *why* or *what breaks if* — not *what was built*.

---

## Group A — State ownership & component structure

1. Why can't `page.tsx` hold the shared `jobs` state itself, given that it's the common ancestor of `SearchControls` and the table? What property of Server Components forbids it?
2. We promoted `FindJobsClient` to own search state rather than adding a `FindJobsPageClient` wrapper. What concrete future bug does the wrapper approach invite that the chosen approach avoids?
3. State should live at "the lowest common ancestor of everything that reads or writes it." Apply that rule from scratch to this page — does it independently produce `FindJobsClient` as the owner? Show the derivation.
4. If a *third* feature later needed the jobs array on a different page entirely, at what point would lifting state into React Context or a store become justified? What's the threshold?
5. `SearchControls` went from self-contained (own state) to fully presentational (all props). What are the testing and reuse consequences of that change — both gains and losses?

## Group B — Batch vs sequential scoring

6. Batching collapsed 10 failure domains into 1. Name every new failure mode batching introduced that didn't exist in the sequential design.
7. Why is "return `matchScore: 0` on a length mismatch" a better default than throwing? Under what product circumstances would throwing actually be the right call instead?
8. How would you detect *silent reordering* (right length, wrong order) in a batch response? The length guard doesn't catch it — what would?
9. If OpenRouter's free tier started rate-limiting even the single batch call, what's the next move — and does it push you back toward sequential, or somewhere else?
10. The batch prompt asks for an array "same length and order as input." How much should you trust a free-tier model to honour ordering, and how does that trust level change your validation strategy?

## Group C — Data freshness: client state vs render cache

11. Explain the exact user journey where `setJobs` is sufficient and `force-dynamic` is irrelevant — and the exact journey where the reverse is true.
12. Why is calling `router.refresh()` after the API already returned the jobs strictly wasteful? Walk through every operation it triggers.
13. If we removed `force-dynamic` but kept `setJobs`, what specific bug appears, and on which user action does it surface?
14. `force-dynamic` disables caching for the whole route. What would it cost us if this page were expensive to render? Is there a more surgical caching primitive that would still keep the jobs fresh?
15. How does Next.js decide a route is "dynamic" without `force-dynamic`? Why be explicit rather than relying on the InsForge call to trigger inference?

## Group D — Designing for the empty/degraded state

16. Best-effort scoring treats a null profile as a first-class path. Where else in this feature does the same "bend, don't break" instinct appear? List each instance.
17. What is genuinely lost by scoring against an empty profile, and why is that loss acceptable for a top-of-funnel feature but maybe not for, say, a paid "tailored match" feature?
18. `maybeSingle()` vs `single()` — what's the behavioural difference, and why does the choice matter precisely here?

## Group E — Documentation drift & safe deletion

19. The repo's own `library-docs.md` says "GPT-4o" over code that calls Nemotron. Beyond this feature, what's the systemic risk of label/code drift, and how would you prevent it recurring?
20. Removing the Connected Accounts card required protecting the `linkedin_connected` column in `handleSave`. Walk through what would have gone wrong with a careless deletion, step by step.
21. Why keep the `linkedin_connected` *column* at all if its only UI is being deleted? When is it right to leave an orphaned column vs. drop it in a migration?
22. "Removing UI is a data operation too." Generalise this into a checklist you'd run before deleting any form control that participated in a save path.
