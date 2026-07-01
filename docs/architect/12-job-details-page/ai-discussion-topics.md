# Feature 12 — Architect Session: AI Discussion Topics

20 questions across 6 groups. Each asks WHY or HOW, probes failure modes, and targets durable understanding over Feature 12 specifics.

---

## Group 1 — Next.js 16 Breaking Changes and the Docs-First Rule

1. The `params` change from synchronous object to Promise is a breaking change that TypeScript does not catch. Why does TypeScript allow `params.id` on a `Promise<{ id: string }>` without an error? What property of TypeScript's type system allows this?

2. If a developer writes `params.id` without awaiting (the pre-16 pattern), every job detail page returns 404. Trace exactly what value `id` contains, what `.eq("id", id)` sends to the database, and what the database returns.

3. AGENTS.md says "Read `node_modules/next/dist/docs/` before writing any code." What category of bugs does this rule specifically protect against — bugs caught by TypeScript, bugs caught by tests, or bugs only caught by running the app?

4. If the Next.js 16 docs weren't available in `node_modules/`, what other sources could you check to verify the params shape before writing code?

---

## Group 2 — Security Boundaries and Row-Level Access

5. The query uses `.eq("id", id).eq("user_id", authData.user.id)`. Without the `user_id` filter, which of the following scenarios would fail: (a) user views their own job, (b) user navigates directly to another user's job URL, (c) unauthenticated user navigates to any job URL?

6. UUIDs are sometimes described as "effectively unguessable." Given this, is omitting the `user_id` filter acceptable? What specific scenarios still allow UUID exposure beyond random guessing?

7. The code returns 404 (via `notFound()`) when a job exists but belongs to a different user. An alternative is 403 Forbidden. What decision factor determines which is more appropriate for a private per-user resource?

8. The project has Row-Level Security (RLS) policies on the `jobs` table (Feature 04). If RLS is correctly configured to only allow users to read their own rows, is the `user_id` filter in the application query still necessary? Defend your answer.

---

## Group 3 — Stretched Link Pattern

9. The stretched link pattern requires `position: relative` on the `<tr>`. Look up whether `position: relative` on a `<tr>` element is valid CSS. In which browsers does it work, and are there any known rendering issues?

10. The `after:z-1` class gives the `::after` pseudo-element `z-index: 1`. Without this, which type of content in other `<td>` cells could render above the pseudo-element, and why? Name a specific element from `JobsTable.tsx` that would be affected.

11. The `aria-label` on the `<Link>` describes the full action: "View [title] at [company]." Why is the visible text in the link (`{job.company}`) not sufficient for screen readers when the link covers the entire row?

12. Bootstrap's stretched-link utility also uses a `::after` pseudo-element. Look up its CSS. What z-index does Bootstrap use, and does it match this implementation?

---

## Group 4 — Null Semantics and UI Conventions

13. Feature 12 uses three null-handling strategies: hide entirely, show "—", show empty state message. Apply this framework to a hypothetical `benefits` field (a string array of benefits the job offers, nullable). Which strategy would you use and why?

14. `formatJobType(null)` returns "—". The find route (`app/api/agent/find/route.ts`) sometimes converts unknown job types to `'fulltime'` as a default. So `job_type` being null means the scraper explicitly found nothing — it's not a default. How does this distinction affect whether showing "—" vs "Full-time" is correct?

15. The match badge is hidden when `match_score` is null. The salary info card is shown with "—" when `salary` is null. Both represent missing data. What is the structural difference in how the UI is laid out that explains why one hides and the other shows a fallback?

---

## Group 5 — URL Hierarchy and Apply Semantics

16. A job aggregator site could simplify its data model by storing only one URL per job. What would be lost if `external_apply_url` and `source_url` were merged into a single `url` field? Name two specific user-facing features that would degrade.

17. For Adzuna jobs, `external_apply_url` is null and Apply Now falls back to `source_url`. This means clicking Apply Now on an Adzuna job navigates to the Adzuna listing, not an employer's application form. Is this a design limitation or acceptable behaviour? What would a better solution require?

18. The `"View Job Post"` button is conditionally hidden when `source_url` is null. Could this ever happen for a real JobsDB job? If the actor scrapes jobs from JobsDB, why might `source_url` be null in some cases?

---

## Group 6 — Server Component Architecture

19. `CompanyResearch.tsx` has a disabled `<button>`. This button will need an `onClick` handler in Feature 13. Does making a Server Component have a disabled `<button>` create any migration problems for Feature 13, or is it a clean starting point?

20. All 5 job detail components are Server Components. If a future design added a "Save to Shortlist" toggle button on the header card (in `JobInfo.tsx`), what is the minimum change required — and does it affect only `JobInfo.tsx` or the other components?
