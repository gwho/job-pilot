# Feature 12 — Discussion Topics

15 questions across 5 topic areas.

---

## Dynamic Routes and Server Rendering

1. Next.js 16 changed `params` to be a Promise. What would happen at runtime (not compile time) if you forgot to `await params` and read `params.id` directly? Why doesn't TypeScript catch this mistake?

2. The page uses `force-dynamic`. What would Next.js try to do without it, and why would that fail for a page that reads auth cookies and per-user database rows?

3. Why is this page a Server Component instead of a Client Component? Name three things the page does that would be impossible or worse in a Client Component.

---

## Security Boundaries

4. The DB query has two `.eq()` filters: `.eq("id", id).eq("user_id", authData.user.id)`. What specific attack does the `user_id` filter prevent? Describe it step by step.

5. When the `user_id` filter eliminates a match, the page calls `notFound()` — not a 403 Forbidden. Why is 404 the security-correct response? What information would a 403 reveal?

6. The auth check and DB query are both in the page component, not in a middleware or Server Action. Is this correct for a read-only page? When would you move auth checks to middleware?

---

## Stretched Link Pattern

7. A developer replaces the stretched link with `<tr onClick={() => router.push('/find-jobs/' + job.id)}>`. What three things stop working that worked with the stretched link?

8. The stretched link pseudo-element needs `z-index: 1` (`after:z-1`) to reliably cover other cell content. Why doesn't `position: absolute` alone guarantee the pseudo-element appears on top?

9. The `aria-label` on the Link says `View ${job.title ?? "job"} at ${job.company ?? "company"}`. If the aria-label were omitted, what would a screen reader announce when focusing the link in the company name cell? Why is that insufficient?

---

## Conditional Rendering and Null Data

10. Feature 12 uses three different null-handling strategies: hide the element, show "—", show an empty-state message. Give a concrete example of each from the codebase. What is the decision factor that determines which strategy to use?

11. The AI Match Reasoning card (`job.match_reason`) is hidden entirely when null. The Required Skills card is always rendered (even when skills are null, it shows "No skill data available."). Why the asymmetry?

12. `formatJobType(null)` returns "—", not "Full-time". The find route converts scraped text to JobType enum values before saving. What does a null `job_type` in the DB actually mean — and why would showing "Full-time" be wrong?

---

## URL Hierarchy and Apply Semantics

13. `source_url` and `external_apply_url` both exist on a JobsDB job. Describe a concrete scenario where they differ. What goes wrong if Apply Now uses `source_url` instead of `external_apply_url`?

14. The actor scrapes `external_apply_url` from the job listing's apply button. For future Adzuna jobs, this field may be null. The code uses `externalApplyUrl ?? sourceUrl`. What assumption about Adzuna's `source_url` does this fallback depend on?

---

## Text Rendering

15. `whitespace-pre-line` is applied to the job description. If it were not set, how would a description with paragraph breaks (`\n\n`) and list items (preceded by `\n`) render in the browser? What would the user see?
