# Feature 12 — Job Details Page: Architectural Decisions

Architect session on 2026-06-30. All decisions locked before implementation began.

---

## Decision 1 — `params: Promise<{ id: string }>` — async params in Next.js 16

**What:** The page component's `params` prop is typed as `Promise<{ id: string }>` and awaited with `const { id } = await params;`.

**How it works:** Next.js 16 changed route segment params from synchronous objects to Promises. The page is declared `async` so that `await params` resolves before the DB query uses `id`.

**Why not synchronous `{ id: string }` (training-data shape):** The synchronous form compiles without TypeScript errors but `params.id` at runtime returns `undefined` — you're reading `.id` on a Promise object, not the resolved string. The app would call `notFound()` on every request (because `.eq("id", undefined)` returns no rows). AGENTS.md exists for exactly this: "Read `node_modules/next/dist/docs/` before writing any code." The installed docs confirm the Promise shape.

**Alternative cost:** Synchronous params produces a silent runtime bug with no TypeScript error and no build error. The only symptom is every job detail URL returning 404.

---

## Decision 2 — `force-dynamic` export

**What:** `export const dynamic = "force-dynamic";` at the top of `app/find-jobs/[id]/page.tsx`.

**How it works:** Instructs Next.js to skip static generation and always render this page server-side at request time.

**Why required:** The page reads auth cookies (via `createInsforgeServer()` → `getCurrentUser()`) and per-user database rows. Static generation during `npm run build` would fail because there's no request context. Without `force-dynamic`, Next.js may attempt to statically generate the page at build time and throw.

**Alternative cost:** Omitting `force-dynamic` can cause build failures, or — if Next.js infers dynamic rendering from the cookie read — no issue at all. Adding it is explicit and defensive. The cost is zero: the page is inherently dynamic.

---

## Decision 3 — Two-filter query: `.eq("id", id).eq("user_id", ...)`

**What:** The DB query filters by both the URL `id` and the authenticated user's ID.

**How it works:** InsForge/PostgREST applies both conditions as AND. A row must match both filters to be returned. If the job exists but belongs to a different user, zero rows are returned and `.single()` returns an error. The code calls `notFound()`.

**Why the user_id filter is required:** Without it, any authenticated user who discovers (or guesses) a job's UUID can view another user's job data. UUIDs are not secret — they appear in URLs and may be logged. The `user_id` filter is the application-level access control that enforces row ownership.

**Why 404 for both "not found" and "wrong user":** A 403 Forbidden response would reveal that the job exists but belongs to someone else. A 404 is the security-correct response for both cases — it leaks no information about whether the record exists.

---

## Decision 4 — Stretched link pattern over `useRouter` onClick

**What:** Row navigation uses a `<Link>` inside the first `<td>` with `after:absolute after:inset-0 after:content-[''] after:z-1`. The `<tr>` has `relative` positioning.

**How it works:** The `<Link>` renders as an `<a>` element. Its `::after` pseudo-element is positioned absolutely and stretched via `inset: 0` to fill the nearest positioned ancestor — the `<tr>`. The `z-index: 1` on the pseudo-element places it above other cell content.

**Why not `onClick` with `useRouter.push()`:** The `onClick` approach requires `"use client"` on the component, sending the component's JavaScript to the browser. More importantly, it replaces a real `<a>` element with a div-like click handler, which:
- Breaks right-click → "Open in new tab"
- Breaks middle-click to open in new tab
- Breaks copy link address
- Hides the link from screen readers (no `href`, no role=link semantics)

The stretched link preserves all native browser link behaviour because the `<a>` element and its href are real.

**Alternative cost:** `useRouter` onClick produces a functional click experience on desktop but a degraded experience for power users, keyboard users, and assistive technology users.

---

## Decision 5 — Component folder: `components/job-details/` not `components/find-jobs/job-details/`

**What:** The five display components live in `components/job-details/` — a top-level sibling to `components/find-jobs/`, not nested inside it.

**How it works:** `context/architecture.md` pre-defines `components/job-details/` as the canonical location with this exact 5-file decomposition. The decision was already made at the architecture level.

**Why not nesting under `components/find-jobs/`:** The route is under `find-jobs/`, but components live at the feature level, not the route level. These components will be reused if Job Details gets its own route group, shared components, or a sidebar view in a future design. Nesting them inside `find-jobs/` would couple them to a route path that could change.

**Alternative cost:** Nesting produces tighter coupling between route and component directory — if the route moves or splits, the components move too.

---

## Decision 6 — `job as Job` type assertion with inline comment

**What:** `const typedJob = job as Job;` with comment `// InsForge returns untyped query data — shape matches the jobs table Job type`.

**How it works:** InsForge's SDK returns query results as a generic/untyped record. The `Job` interface in `types/index.ts` describes the exact shape of the `jobs` table. The assertion tells TypeScript to treat the query result as a typed `Job`.

**Why the assertion is safe here:** The query selects all columns (`*`) from the same table the `Job` type was derived from. The schema is owned by us — the DB columns and the TypeScript interface are kept in sync (Feature 04 created both together).

**When the assertion would be unsafe:** Partial selects (`.select("id, title")`), fields added to the DB without updating `types/index.ts`, or InsForge returning joins that expand the shape.

**Why add the comment:** Code standards discourage bare type assertions. The comment documents the invariant that makes the assertion correct — the query returns `*`, the type covers `*`, the schema is ours.

---

## Decision 7 — `source_url` vs `external_apply_url` for Apply Now

**What:** "View Job Post" uses `job.source_url`. "Apply Now" uses `externalApplyUrl ?? sourceUrl`.

**How it works:** Both fields are scraped by the Apify actor. `source_url` is the JobsDB canonical listing URL. `external_apply_url` is the URL of the apply button on the listing page — typically a company's own careers portal on a different domain.

**Why the distinction:** "View Job Post" is "go see the listing." "Apply Now" is "go apply." These are different destinations. For JobsDB jobs, the apply button sends the user off-platform to the employer's system. Sending Apply Now to the listing page (source_url) would require the user to click the apply button a second time.

**Why the fallback (`?? sourceUrl`):** Future Adzuna jobs may not have a separate external apply URL. For those, `source_url` is the apply destination. The `??` operator ensures Apply Now always has a URL, regardless of source.

---

## Decision 8 — All 5 components are Server Components

**What:** No component in `components/job-details/` has `"use client"`.

**How it works:** Server Components render on the server, sending HTML to the browser. No component JavaScript is added to the client bundle for these components.

**Why Server Components are correct:** Feature 12 is read-only display — no user interactions, no local state, no event handlers. Every component receives props from the page and renders HTML. There is no need for browser APIs. Adding `"use client"` to any of these would send unnecessary JavaScript to the browser.

**When to add `"use client"` to `CompanyResearch`:** Feature 13. The "Research Company" button needs an `onClick` handler to trigger the research API. That interaction requires client-side JavaScript. Feature 12 renders the button as `disabled` — a Server Component `<button disabled>` is valid and sufficient for now.

---

## Decision 9 — Three null-handling strategies

**What:** Feature 12 uses three distinct patterns for nullable fields:

1. **Hide entirely** — `{job.match_score != null && <Badge />}`: match badge, View Job Post, AI reasoning card
2. **Show dash** — `{job.salary ?? "—"}`: info card values (salary, location, job type)
3. **Show empty state** — "No skill data available." / "No description available.": section cards

**How to choose:**
- Hide entirely: when the element has no null representation (a badge for null makes no sense)
- Show dash: when the data cell's position in a grid must be preserved (removing an info card breaks the 4-column layout)
- Empty state: when users expect content in a section and a blank section is confusing

**Why "—" for info cards:** The 4-column grid (`grid-cols-4`) would become visually uneven if cards disappeared. "—" communicates "checked, not available" — different from "not checked."

**Why hide the AI card entirely:** An AI reasoning section showing "No reason available" provides no value and would confuse users about what AI Match Reasoning means. If there's no reason, the feature simply doesn't appear.
