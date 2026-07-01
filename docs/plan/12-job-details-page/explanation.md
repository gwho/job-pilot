# Feature 12 — Deep Technical Explanation

---

## Why `params` is a Promise in Next.js 16

In every Next.js version before 16, the `params` object in a dynamic route page was a plain synchronous object:

```ts
// Next.js 14/15 (training-data shape — NOT what this repo uses)
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params; // synchronous
}
```

Next.js 16 changed this. Route segment parameters (`params`) and search parameters (`searchParams`) are now Promises. The page must `await` them:

```ts
// Next.js 16 — verified against node_modules/next/dist/docs/
export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
}
```

**Why the change?** Asynchronous params allows the framework to defer segment resolution until the data is needed. In practice this enables better streaming and parallel data fetching — the page function can begin executing before all route parameters are resolved.

**Why this matters for AI agents:** Any AI assistant working from training data will write the synchronous form. The TypeScript compiler won't catch the mistake — `params.id` on a Promise object compiles fine, but returns `undefined` at runtime (you'd be reading the `id` property of a Promise object, not the resolved value). The AGENTS.md instruction to "read `node_modules/next/dist/docs/` before writing any code" exists specifically to catch this kind of breaking change.

---

## Why `force-dynamic` is required

```ts
export const dynamic = "force-dynamic";
```

Next.js App Router pre-renders routes at build time when it can. The default behaviour for a Server Component that doesn't read cookies, headers, or dynamic data is to generate a static HTML file during `npm run build`.

This page cannot be statically generated because:
1. The page content depends on the `id` param (different for every job)
2. The job data is private to the current user (different for every user)
3. Jobs are added dynamically — a job added after build time would 404

`force-dynamic` instructs Next.js to skip static generation and always render this page server-side at request time. Without it, Next.js may attempt static generation during build and fail (because `createInsforgeServer()` requires a real request context to read auth cookies).

---

## The two-filter security pattern

```ts
const { data: job, error } = await insforge.database
  .from("jobs")
  .select("*")
  .eq("id", id)
  .eq("user_id", authData.user.id)  // ← the security boundary
  .single();

if (error || !job) notFound();
```

The query has two filters: the job ID from the URL and the authenticated user's ID from the session.

**Why both are needed:** The `id` filter finds the specific job. The `user_id` filter ensures the job belongs to the current user. Without the `user_id` filter, any authenticated user who knew (or guessed) a job's UUID could view another user's job data.

**Why `notFound()` for both cases:** When the `user_id` filter eliminates a match, InsForge/Supabase `.single()` returns `error: { code: 'PGRST116', message: '...no rows returned' }` and `data: null`. The same error appears when the ID simply doesn't exist. The code `if (error || !job) notFound()` handles both uniformly — a 404 response. This is intentional: revealing "this job exists but belongs to someone else" via a 403 response would be an information leak. A 404 is the security-correct answer.

---

## Why the stretched link pattern, not `useRouter` onClick

Table rows are not semantically links — the `<tr>` element has no href equivalent. There are two approaches for making them navigable:

**Option A — `onClick` with `useRouter.push()`:**
```tsx
// requires "use client", adds JS overhead for a purely navigational action
<tr onClick={() => router.push(`/find-jobs/${job.id}`)}>
```

**Option B — Stretched link (chosen):**
```tsx
<tr className="relative ...">
  <td>
    <Link
      href={`/find-jobs/${job.id}`}
      className="after:absolute after:inset-0 after:content-[''] after:z-1"
    >
      {job.company}
    </Link>
  </td>
</tr>
```

The stretched link wins on three axes:
1. **Native browser behaviour** — it's a real `<a>` element. Users can right-click → "Open in new tab", middle-click, copy link address. The `onClick` handler doesn't support any of these.
2. **Accessibility** — screen readers announce it as a link. The `aria-label` on the Link provides the full context: "View [Job Title] at [Company]". An `onClick` on a `<tr>` is invisible to screen readers.
3. **No extra JavaScript** — `useRouter` requires `"use client"`. The stretched link is pure CSS — no client component needed.

**How the `::after` covers the row:** The `<Link>` renders as an `<a>` tag inside the first `<td>`. The `after:absolute after:inset-0` puts a zero-height, zero-content pseudo-element absolutely positioned with `inset: 0` — which stretches it to the edges of its nearest positioned ancestor. The `<tr>` has `relative` positioning, so the pseudo-element fills the entire row. The `after:z-1` ensures it sits above the other cell content in the stacking order.

---

## `job as Job` — when a type assertion is safe

```ts
// InsForge returns untyped query data — shape matches the jobs table Job type
const typedJob = job as Job;
```

InsForge's SDK returns query results as a generic type, not as a typed entity. The TypeScript compiler treats `job` as `any` or a broad record type. To use the result with the `Job` interface from `types/index.ts`, a type assertion is required.

This assertion is safe because:
- The query is `.from("jobs").select("*")` — it reads the entire `jobs` table row
- The `Job` interface was written from the database schema (Feature 04) — the fields match exactly
- The DB schema is controlled by us — no external shape variation

The assertion is unsafe if: the query were `.select("id, title")` (partial columns), or if the `Job` type were out of sync with the schema. Neither is true here.

The inline comment explains the assertion to future readers — code standards discourage bare casts without context.

---

## `source_url` vs `external_apply_url` — two different destinations

JobsDB jobs have two URL fields that serve different purposes:

| Field | Source | Destination | Used for |
|---|---|---|---|
| `source_url` | actor scrape | `hk.jobsdb.com/job/123` (the listing page) | "View Job Post" button |
| `external_apply_url` | actor scrape — the apply button URL | company careers portal (different domain) | "Apply Now" button |

For a typical job at HSBC posted on JobsDB:
- `source_url`: `https://hk.jobsdb.com/job/66500000/software-engineer`
- `external_apply_url`: `https://hsbc.taleo.net/careersection/hk/jobdetail.ftl?job=0000...`

**Why the distinction matters:** "View Job Post" and "Apply Now" are different user intents. View Job Post shows the recruiting platform's formatted listing. Apply Now takes the user directly to the company's application form — often at a different website with additional details about the role.

**The fallback:** `const applyHref = externalApplyUrl ?? sourceUrl;` handles future Adzuna jobs where `external_apply_url` may be null. For Adzuna, `source_url` is the apply destination. For JobsDB, `external_apply_url` always has a value (the actor scrapes it or falls back to `source_url` itself). The `??` operator means Apply Now always has a destination.

---

## `whitespace-pre-line` and raw scraped text

```tsx
<p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
  {aboutRole ?? "No description available."}
</p>
```

JobsDB descriptions are scraped from the rendered HTML using `innerText`. `innerText` strips HTML tags and returns the text content as a raw string with newline characters (`\n`) preserved where the original HTML had block-level elements (paragraphs, list items, headings).

By default, CSS collapses all whitespace (including newlines) into a single space. A scraped description like:

```
"About the Role\nWe are looking for...\n\nResponsibilities:\n- Lead the team"
```

would render as a single undifferentiated run of text.

`whitespace-pre-line` changes this: it preserves newlines while still collapsing spaces. The rendered output shows paragraph breaks where the original page had them — without needing to parse and reconstruct HTML structure.

The alternative — `whitespace-pre` — would also preserve spaces, but scraped `innerText` often has inconsistent spacing that would produce misaligned text. `whitespace-pre-line` is the correct choice for single-newline-delimited scraped content.

---

## `formatJobType` and the null rule

```ts
function formatJobType(t: string | null): string {
  if (t === "fulltime") return "Full-time";
  if (t === "parttime") return "Part-time";
  if (t === "contract") return "Contract";
  return "—";
}
```

The `job_type` column is nullable. Null means the actor did not find explicit job type information on the listing page.

**Why "—" and not "Full-time":** Inventing a display value for a null field misleads the user. If the field is null, the job type is unknown — it might be full-time, part-time, contract, or something not represented in the enum. Showing "Full-time" when the value is null would cause users to make decisions based on information that wasn't actually collected.

This is a general rule: null in the DB means "we don't know," not "use a default." The UI should represent ignorance honestly. "—" is the standard signal for "data not available."

Note that the find route (`app/api/agent/find/route.ts`) converts scraped strings to the JobType enum when it saves jobs. Many JobsDB jobs will legitimately have `job_type = 'fulltime'` because they were explicitly marked as such. But jobs where the scraper found no type information are saved with `job_type = null`. Those nulls must display as "—".

---

## Conditional rendering strategy: three types of null handling

Feature 12 handles nullable AI data in three distinct ways, depending on the severity of missing information:

**Type 1 — Hide the element entirely** (match badge, "View Job Post" button, AI reasoning card)
Used when the element has no meaningful null state — the badge either shows a score or doesn't exist. Implemented with `{job.match_score != null && <Badge />}`.

**Type 2 — Show a dash** (salary, location, job type)
Used for data cells where the presence of the cell itself conveys structure. An info card with "—" tells the user "this field was checked and has no value." An absent info card would make the grid uneven. Implemented with `{job.salary ?? "—"}`.

**Type 3 — Show an empty state** (skills card, description card)
Used for content sections where users expect something to be there. An empty section is confusing. A clear message — "No skill data available." / "No description available." — tells the user why the section is empty. Implemented with conditional prose inside an always-rendered card.

The pattern choice depends on user intent: would the user notice or care if the element disappeared? If yes, show an empty state. If no, hide it.

---

## Why all 5 components are Server Components

Feature 12 is a read-only display page. It has:
- No user interactions (no click handlers beyond links)
- No local state (no `useState`)
- No browser APIs
- No event listeners

Every component receives props from the page and renders static HTML. Server Components are the correct default — they reduce JavaScript bundle size (no component code sent to the browser), allow direct DB/network access, and render in parallel on the server.

Adding `"use client"` to any of these components would send their code to the browser for hydration, requiring more JavaScript for identical output. Feature 13 (Company Research) will upgrade `CompanyResearch.tsx` to a Client Component because it needs an `onClick` handler — that's the right time to add `"use client"`, not before.
