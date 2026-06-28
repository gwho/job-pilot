# Feature 11 — Architect Session: AI Discussion Topics

20 questions across 6 groups. Each asks WHY or HOW, probes failure modes, and targets durable understanding over Feature 11 specifics.

---

## Group 1 — URL State Patterns

1. The architect session initially recommended client `useState` for filter state, then reversed. What specific piece of context changed the answer? What does this reveal about how to evaluate "do it now vs later" decisions?

2. `useSearchParams()` in Next.js App Router is described as "reactive." What does that mean precisely — what happens when the URL changes, and how does the component know to re-render?

3. Why does `useSearchParams()` require a `<Suspense>` boundary in Next.js App Router? What problem is the framework preventing, and why is `fallback={null}` sufficient here?

4. If filter state lived in `useState`, browser back/forward would break. Explain exactly why — what happens to React component state when the URL changes via the browser history stack?

5. When should a developer choose client `useState` for filter/sort/page state, and when should they choose URL params? What is the decision factor?

---

## Group 2 — Browser History Stack

6. What is the browser history stack? Trace exactly what it looks like after a user loads the Find Jobs page, sets a filter, changes sort, then clicks a job row — using `router.push()` vs `router.replace()` for filter changes.

7. The session derived a rule: `replace` for refinements, `push` for navigation. Give three examples from this codebase of each — what qualifies as a refinement vs a navigation?

8. If a "clear all filters" button resets `q`, `match`, `sort`, and `page` to defaults, should it use `router.push()` or `router.replace()`? Explain the reasoning.

9. The back-navigation sync `useEffect([q])` resets `filterTextDraft` when the URL's `q` changes. But the debounce effect fires after every `filterTextDraft` change. Why doesn't this create an infinite replace loop? Trace through the guard logic.

---

## Group 3 — Two-State Text Input

10. The text search input uses two separate pieces of state: `filterTextDraft` (display) and URL `q` (filter). Why can't both be the same state? What specifically breaks if the input is controlled directly by the URL param?

11. Why does the debounce live in `FindJobsClient` rather than inside `JobFilters`? Under what circumstances would the opposite choice be better?

12. The two `useEffect`s have a dependency relationship: the sync effect feeds `filterTextDraft`, and the debounce effect reads `filterTextDraft`. Without the `filterTextDraft === q` guard, what exact sequence of events causes a replace loop? Trace it step by step.

13. After back-navigation restores `?q=react` in the URL, the sync effect sets `filterTextDraft = "react"`. The debounce effect fires. The guard exits early. No replace happens. Why is this the correct outcome — what would go wrong if the guard wasn't there?

---

## Group 4 — Merge vs `router.refresh()`

14. `router.refresh()` re-runs the Server Component and passes fresh `initialJobs` to `FindJobsClient`. Why doesn't this update the `jobs` state? What would need to change in `FindJobsClient` to make `router.refresh()` work?

15. The session said the `useEffect(() => setJobs(initialJobs), [initialJobs])` pattern is the "effect as sync anti-pattern." What makes it an anti-pattern here? When is using an effect to sync external state to local state legitimate?

16. The functional form `setJobs(current => ...)` was chosen over the closure form `setJobs(merged)`. Describe a concrete scenario — two overlapping search requests — where the closure form produces incorrect output and the functional form does not.

---

## Group 5 — Constants and Prop Threading

17. `FindJobsClient` owns `PAGE_SIZE = 20` and passes `pageSize={PAGE_SIZE}` to `JobsPagination`. Describe the silent bug that existed before this change, and explain why TypeScript did not catch it.

18. The rule derived was: "the component that performs a computation owns the constants that govern it." Apply this rule to three other examples in the codebase — what owns `MATCH_THRESHOLD`, and where should a hypothetical `MAX_SEARCH_RESULTS` constant live?

---

## Group 6 — Null Semantics

19. `!= null` catches both `null` and `undefined`, while `!== null` catches only `null`. In what runtime scenario specific to this codebase could `match_score` be `undefined` rather than `null`, even if the TypeScript type says `number | null`?

20. The CONTEXT.md definition says an unscored job "should only appear in complete views such as All Matches." If a future feature adds a "Not yet scored" filter tab, what invariant must hold across All Matches, High Match, Low Match, and Not Yet Scored simultaneously? What breaks if that invariant is violated?
