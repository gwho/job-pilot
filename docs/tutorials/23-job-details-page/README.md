# Tutorial 23 — Job Details Page: Dynamic Routes, Security Boundaries, and Rendering Sparse AI Data

**After completing this tutorial you will understand:** how Next.js 16 changed dynamic route params to Promises and why the old synchronous shape produces a silent runtime bug; how to enforce per-user access control at the query level rather than relying on IDs being unguessable; why the stretched link pattern produces better table row navigation than `onClick` with `useRouter`; how to choose between three distinct null-handling strategies for sparse AI data; and what `whitespace-pre-line` does to raw scraped text and why it is the right tool for `innerText` content.

---

> [!NOTE]
> **Prerequisites:** Tutorial 20 (`../20-filter-sort-pagination/README.md`) — establishes the Find Jobs table and URL state architecture this feature builds on. Tutorial 15 (`../15-find-jobs-ui/README.md`) — covers the original `JobsTable` component this feature modifies.
>
> Open [`app/find-jobs/[id]/page.tsx`](../../../app/find-jobs/%5Bid%5D/page.tsx), [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx), [`components/job-details/JobInfo.tsx`](../../../components/job-details/JobInfo.tsx), and [`components/job-details/MatchScore.tsx`](../../../components/job-details/MatchScore.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| CSS pseudo-elements (`::after`) | Stretched link pattern in `JobsTable.tsx` | Web platform |
| Absolute positioning and stacking context | `after:absolute after:inset-0 after:z-1` | CSS |
| Async/await on non-Promise values | `await params` in Next.js 16 | Language |
| Row-level access control | `.eq("user_id", ...)` in DB query | Security |
| Null coalescing patterns | Three null-handling strategies | System design |
| CSS `white-space` property | `whitespace-pre-line` for scraped text | Web platform |

---

## How to use an LLM before this tutorial

Budget 20–30 minutes on these five concepts before reading code.

### Concept 1 — CSS pseudo-elements and absolute positioning

> "Explain CSS pseudo-elements, specifically `::after`. What does `content: ''` do? What does `position: absolute` on a pseudo-element mean, and what does `inset: 0` do to its size? Show me how a zero-content absolutely-positioned `::after` pseudo-element on a child element can cover a parent element's entire area. What is `z-index` and when does a pseudo-element need one? Quiz me on what `position: relative` on the parent is for."

*What to listen for:* A pseudo-element is generated content inserted by CSS — not a real DOM node. `content: ''` creates a visible-but-empty element. `position: absolute; inset: 0` stretches it to the four edges of its nearest positioned ancestor. Without `position: relative` on the ancestor, the pseudo-element sizes relative to a different ancestor. `z-index` determines stacking order among positioned elements — without it, the order is determined by DOM order and may not be predictable.

*Practice question:* You have a `<div class="card">` with `position: relative`. Inside it is an `<a>` tag. The `<a>` has `::after { position: absolute; inset: 0; content: ''; z-index: 1; }`. What does the `::after` cover — the `<a>` tag, or the entire `.card` div?

---

### Concept 2 — Row-level access control

> "Explain the concept of row-level access control in a web application. Given a database table `jobs` where each row has a `user_id` column, and a URL pattern `/jobs/[id]` — what query should a server-side handler run to ensure a user can only view their own jobs? What specifically happens if the handler queries only by `id` without filtering on `user_id`? Give a concrete attack scenario. Quiz me on why returning a 404 rather than a 403 is often preferred for unauthorized resource access."

*What to listen for:* Without a `user_id` filter, any authenticated user can access any row by knowing the row's ID. UUIDs are not secret — they appear in URLs, logs, and analytics. A 404 response for unauthorized access is preferred over 403 because it leaks no information: the caller cannot distinguish "this record doesn't exist" from "this record exists but you can't see it."

*Practice question:* A user's job is at `/find-jobs/abc-123`. Another logged-in user types this URL. The server queries `.eq("id", "abc-123")` with no user_id filter. What does the second user see?

---

### Concept 3 — Server Components vs Client Components

> "Explain the difference between Server Components and Client Components in Next.js App Router. What can a Server Component do that a Client Component cannot, and vice versa? Give three examples of components that must be Client Components. Give three examples that should be Server Components. Explain what happens to bundle size when you add `'use client'` to a component. Quiz me on what happens to a Server Component's children when the parent adds `'use client'`."

*What to listen for:* Server Components render on the server, send HTML, and are never sent to the browser as JavaScript — zero bundle impact. Client Components need browser APIs, state, or event handlers; their code is sent to the browser for hydration. Adding `'use client'` marks a component boundary — that component and all its imports are sent to the browser. Children can still be Server Components if they're passed as props, not imported.

*Practice question:* `JobsTable.tsx` already has `"use client"` because it uses `useSearchParams()`. It imports `MatchScoreBar`, a local component. Is `MatchScoreBar` a Server Component or Client Component?

---

### Concept 4 — Handling nullable data in UI

> "Explain three strategies for displaying data that might be null in a UI: hiding the element, showing a placeholder value, and showing an empty state message. For each strategy, give a concrete example of when it is the right choice. What question should you ask to decide which strategy to use for a specific piece of data? Quiz me with three scenarios."

*What to listen for:* The key question is: "Would a missing element confuse the user, or is its absence self-explanatory?" A badge that shows a match score disappearing when there's no score is clear. A card titled "AI Match Reasoning" that disappears is less clear — hide it. An info card in a grid layout disappearing breaks the visual structure — show "—" instead. An empty section with no explanation is confusing — show an empty state message.

*Practice question:* A job record has `match_score: null`. Should the match score info card show "—", be hidden entirely, or show an empty state? What if it's `salary: null` instead?

---

### Concept 5 — Web scraping and text normalization

> "Explain the difference between `innerHTML`, `textContent`, and `innerText` in JavaScript DOM. When a web scraper captures job description text using `innerText`, what does the result look like — specifically how are HTML paragraph breaks, list items, and newlines represented? Explain the CSS `white-space` property values: `normal`, `pre`, `pre-line`, and `pre-wrap`. Which is most appropriate for displaying scraped `innerText` content in a web UI? Quiz me on what happens to a description with paragraph breaks if you display it with the default `white-space: normal`."

*What to listen for:* `innerText` returns what the user would see as selected text — HTML stripped, line breaks preserved where block elements existed. The CSS default `white-space: normal` collapses all whitespace including newlines into single spaces, making paragraphs run together. `white-space: pre-line` preserves newlines only (not multiple spaces) — the right balance for `innerText` output.

*Practice question:* A scraped description is `"About the Role\nWe are looking for...\n\nKey Responsibilities\n- Build features"`. With `white-space: normal`, how does this render in a browser?

---

## Architecture overview

```
  Browser: /find-jobs (Feature 11 table)
  ┌─────────────────────────────────────────────┐
  │  JobsTable row                              │
  │  ┌────────────────────────────────────┐     │
  │  │  <tr relative>                     │     │
  │  │    <td>                            │     │
  │  │      <Link href="/find-jobs/[id]"  │     │
  │  │        after:absolute after:inset-0│     │
  │  │        after:z-1 >                 │     │
  │  │          Company Name              │     │
  │  │      </Link>                       │     │
  │  │    </td>  ← ::after covers all tds│     │
  │  └────────────────────────────────────┘     │
  └──────────────┬──────────────────────────────┘
                 │  navigation
                 ▼
  Server: app/find-jobs/[id]/page.tsx  (force-dynamic)
  ┌─────────────────────────────────────────────────┐
  │  1. await params → { id }                       │
  │  2. createInsforgeServer()                      │
  │  3. getCurrentUser()  ─► auth fail → /login     │
  │  4. .from("jobs")                               │
  │     .eq("id", id)                               │
  │     .eq("user_id", user.id)  ─► fail → 404     │
  │     .single()                                   │
  │  5. job as Job                                  │
  └──────────┬──────────────────────────────────────┘
             │  pass typedJob to components (Server)
             ▼
  ┌──────────────────────┐  ┌───────────────────────┐
  │      JobInfo         │  │      MatchScore        │
  │  ┌────────────────┐  │  │  ┌─────────────────┐  │
  │  │ header card    │  │  │  │ match_reason?   │  │
  │  │ title, badge   │  │  │  │ → card or hide  │  │
  │  └────────────────┘  │  │  └─────────────────┘  │
  │  ┌────────────────┐  │  │  ┌─────────────────┐  │
  │  │ 4-col grid     │  │  │  │ skills (always) │  │
  │  │ salary/loc/    │  │  │  └─────────────────┘  │
  │  │ type/date      │  │  └───────────────────────┘
  │  └────────────────┘  │
  └──────────────────────┘
  ┌──────────────────────┐  ┌───────────────────────┐
  │   JobDescription     │  │   CompanyResearch      │
  │ whitespace-pre-line  │  │   (empty state, F13)   │
  └──────────────────────┘  └───────────────────────┘
  ┌──────────────────────────────────────────────────┐
  │  JobActions: externalApplyUrl ?? sourceUrl        │
  └──────────────────────────────────────────────────┘
```

**Key invariants:**
1. The DB query always filters by both `id` AND `user_id` — never one without the other
2. All five job detail components are Server Components — no `"use client"` until Feature 13
3. `params` must be awaited — `await params` is not optional in Next.js 16

---

## Part 1 — The Next.js 16 async params trap

Open [`app/find-jobs/[id]/page.tsx`](../../../app/find-jobs/%5Bid%5D/page.tsx):

```tsx
export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
```

In every version of Next.js before 16, `params` was a plain synchronous object. The page would be written as:

```ts
// Pre-16 shape — compiles fine in this repo but fails at runtime
export default function Page({ params }: { params: { id: string } }) {
  const id = params.id; // ← this is undefined in Next.js 16
}
```

Next.js 16 changed `params` to be a Promise. This is a breaking change with a critical property: **TypeScript does not catch it.**

If you write `params.id` without awaiting, TypeScript is happy. You're reading the `.id` property on a Promise object. A `Promise<{ id: string }>` does not have an `.id` property, so the type system returns `undefined` for that access. The code compiles. The build passes. At runtime, `id` is `undefined`, `.eq("id", undefined)` returns no rows, `.single()` returns an error, and `notFound()` fires. Every URL to `/find-jobs/[id]` returns a 404.

The only way to catch this is to read the installed Next.js docs — which is why AGENTS.md says to check `node_modules/next/dist/docs/` before writing any code. Training data, blog posts, and examples all show the pre-16 shape. The installed version is the authority.

**Checkpoint:** If you removed `await` from `const { id } = await params;` and the TypeScript compiler showed no error, what would a user see when clicking a job row? Trace the exact sequence from `id` being `undefined` to the user's browser.

<details>
<summary>Reveal answer</summary>

`id` would be `undefined`. The DB query `.eq("id", undefined)` sends `id=undefined` (or an empty/invalid filter) to PostgREST. PostgREST returns no rows. `.single()` returns `{ data: null, error: { code: 'PGRST116', ... } }`. The page calls `notFound()`. The user sees Next.js's default 404 page. Every job URL would 404 — the feature would appear completely broken, with no error in the TypeScript compiler or build output to indicate why.

</details>

**Try it yourself:** Open `node_modules/next/dist/docs/` and search for "params" or "dynamic routes." Find the section that describes the params type for dynamic segment page components. Confirm the Promise shape is documented there.

---

## Part 2 — Auth + user-scoped query: the security pattern

Open [`app/find-jobs/[id]/page.tsx`](../../../app/find-jobs/%5Bid%5D/page.tsx) lines 24–35:

```tsx
const { data: authData, error: authError } =
  await insforge.auth.getCurrentUser();
if (authError || !authData.user) redirect("/login");

const { data: job, error } = await insforge.database
  .from("jobs")
  .select("*")
  .eq("id", id)
  .eq("user_id", authData.user.id)
  .single();

if (error || !job) notFound();
```

The query has two filters. The first — `.eq("id", id)` — finds the specific job. The second — `.eq("user_id", authData.user.id)` — ensures the job belongs to the current user.

**Why the second filter is required:** Job IDs are UUIDs — 128-bit random values. UUIDs are not guessable by chance, but they are not secret. They appear in browser history, server logs, analytics dashboards, and shared links. Another authenticated user who discovered a UUID could construct the URL directly. Without the `user_id` filter, the server would return their job data.

**Why `notFound()` for both the "wrong user" and "not found" cases:** When the `user_id` filter eliminates a match, InsForge/Supabase `.single()` returns `{ data: null, error: { code: 'PGRST116' } }`. The same error appears when the `id` simply doesn't exist. `if (error || !job) notFound()` handles both uniformly with a 404 response.

This is intentional. A 403 Forbidden response would reveal that the record exists — the attacker learns that a UUID corresponds to a real job. A 404 is uniformly ambiguous: the record might not exist, or the current user might not have access. No state about the database is leaked to the caller.

**Checkpoint:** This project has Row-Level Security (RLS) policies on the `jobs` table (Feature 04), which restrict each user to reading only their own rows. Given that RLS prevents unauthorized reads at the database level, is the `.eq("user_id", ...)` filter in the application query still necessary?

<details>
<summary>Reveal answer</summary>

Yes. Defence in depth: RLS is one layer, application-level filtering is another. If RLS is misconfigured, disabled, or bypassed (via a service role key, a migration error, or a future admin feature), the application query still enforces ownership. More practically: RLS policies use the authenticated user's session, and there may be edge cases (server-side service role queries, admin tools) where RLS doesn't apply but the application still should restrict access. Relying on a single security layer is fragile. Both filters cost nothing — there's no reason not to have both.

</details>

**Try it yourself:** Read `scripts/schema.sql` and find the RLS policies for the `jobs` table. Find the `SELECT` policy and identify the condition it uses to filter rows. Is it the same condition as the application query's `.eq("user_id", ...)`?

---

## Part 3 — The stretched link: accessible table row navigation

Open [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx) lines 66–84:

```tsx
<tr
  key={job.id}
  className="relative border-t border-border hover:bg-surface-secondary transition-colors"
>
  <td className="px-6 py-4">
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0">
        <Building2 size={16} className="text-text-muted" />
      </div>
      {/* stretched link — ::after pseudo-element covers the entire row */}
      <Link
        href={`/find-jobs/${job.id}`}
        className="text-sm font-semibold text-text-primary after:absolute after:inset-0 after:content-[''] after:z-1"
        aria-label={`View ${job.title ?? "job"} at ${job.company ?? "company"}`}
      >
        {job.company ?? "—"}
      </Link>
    </div>
  </td>
```

The requirement is: clicking anywhere on a table row navigates to the job detail page. The obvious approach — `<tr onClick={() => router.push(...)}>` — appears to satisfy this. It breaks three things.

**What the onClick approach breaks:**
1. **Right-click context menu** — no "Open in new tab" option (no `<a>` element, no href)
2. **Middle-click** — doesn't open a new tab (middle-click on a div does nothing)
3. **Screen readers** — a `<tr>` with an onClick is invisible as a navigable element; assistive technology cannot find or announce it as a link

The stretched link pattern uses a real `<a>` element (via Next.js `<Link>`) and makes it cover the entire row using CSS:

- `<tr className="relative">` — gives the row `position: relative`, making it the positioned ancestor for the `::after`
- `after:absolute` — positions the pseudo-element absolutely within the nearest positioned ancestor (the `<tr>`)
- `after:inset-0` — stretches it to all four edges of the `<tr>`, covering 100% of the row area
- `after:content-['']` — creates the pseudo-element (without `content`, it doesn't render)
- `after:z-1` — gives it `z-index: 1` so it sits above other cell content in the stacking order

The pseudo-element is invisible and zero-height but covers the row. Every click hits it. Because it belongs to the `<Link>` (`<a>`) element, the browser treats the click as a link click — with all native link behaviour intact.

The `aria-label` on the `<Link>` is critical for accessibility. Without it, a screen reader would announce only the visible text: "HSBC" — giving no indication of where the link goes. The label provides full context: "View Software Engineer at HSBC."

**Checkpoint:** The `after:z-1` class was added after the initial implementation. Before it was added, what would happen when a user tried to click on the match score bar (the coloured bar in the Match Score column) to navigate to the job detail?

<details>
<summary>Reveal answer</summary>

Without `z-index: 1` on the `::after`, the pseudo-element has `z-index: auto`. The match score bar's container `<div>` elements, which are normal non-positioned elements, might render above the pseudo-element in certain browser implementations. Clicking directly on the bar area might not trigger the link navigation — the click would land on the bar's DOM element instead of the `::after` pseudo-element. The fix (adding `after:z-1`) ensures the pseudo-element is always on top, so every click on every part of the row triggers the link.

</details>

**Try it yourself:** Open the running dev server (`npm run dev`), navigate to `/find-jobs`, right-click a table row. Confirm you see "Open Link in New Tab" in the context menu. Then try middle-clicking a row. Both should navigate to the job detail page in a new tab.

---

## Part 4 — Conditional rendering: three null-handling strategies

Open [`components/job-details/MatchScore.tsx`](../../../components/job-details/MatchScore.tsx):

```tsx
export function MatchScore({ job }: Props) {
  const hasMatchedSkills = (job.matched_skills?.length ?? 0) > 0;
  const hasMissingSkills = (job.missing_skills?.length ?? 0) > 0;
  const hasNoSkillData = !hasMatchedSkills && !hasMissingSkills;

  return (
    <div className="space-y-4">
      {job.match_reason && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          ...
        </div>
      )}

      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        ...
        {hasNoSkillData ? (
          <p className="text-sm text-text-muted">No skill data available.</p>
        ) : (
          <>
            {hasMatchedSkills && <div>...</div>}
            {hasMissingSkills && <div className={hasMatchedSkills ? "mt-4" : ""}>...</div>}
          </>
        )}
      </div>
    </div>
  );
}
```

Now open [`components/job-details/JobInfo.tsx`](../../../components/job-details/JobInfo.tsx) lines 83–88:

```tsx
<p className="text-sm font-semibold text-text-primary">
  {job.salary ?? "—"}
</p>
```

Feature 12 uses three distinct null-handling strategies:

**Strategy 1 — Hide entirely** (match reasoning card, match badge, View Job Post button)
```tsx
{job.match_reason && <div>...</div>}
{job.match_score != null && <span className="badge">...</span>}
{job.source_url && <a href={job.source_url}>View Job Post</a>}
```
Used when the element has no meaningful null representation. A match reasoning card with no reasoning is confusing — what does "AI Match Reasoning" mean with nothing inside? Hiding it is cleaner. The feature simply doesn't appear if there's no data for it.

**Strategy 2 — Show a dash** (salary, location, job type in info cards)
```tsx
{job.salary ?? "—"}
{job.location ?? "—"}
{formatJobType(job.job_type)}  // returns "—" for null
```
Used when the data cell's position in a grid must be preserved. The `grid-cols-4` info card row looks broken if one of the four cards disappears. Showing "—" communicates "we checked, no data found" rather than "this field was skipped."

**Strategy 3 — Show an empty state** (skills section, description card)
```tsx
{hasNoSkillData ? (
  <p className="text-sm text-text-muted">No skill data available.</p>
) : (...)}
```
Used when users expect content in a named section. The "Required Skills vs Your Profile" card is an important feature — it tells users how well their skills match. An empty card with no explanation would leave users wondering whether the feature ran or failed. The empty state message tells them explicitly.

**The decision rule:** Ask "would the absence of this element confuse the user?" If the element's purpose requires data to make sense → hide it. If the element exists within a layout that must be preserved → show a dash. If the element is a named section where absence would be unexplained → show an empty state.

**Checkpoint:** The `CompanyResearch` component always renders — even though its `company_research` data is always null in Feature 12. Which strategy does it use, and why isn't it hidden like the match reasoning card?

<details>
<summary>Reveal answer</summary>

`CompanyResearch` uses Strategy 3 — it renders with an empty state ("No research yet") and a disabled button. It isn't hidden like the match reasoning card because its purpose is to present a feature that users can actively trigger (in Feature 13). Hiding it would make the "Research Company" capability invisible. The empty state communicates "this feature is available but hasn't been used yet" — which is different from "we don't have data for this field." The match reasoning card is a display of data that may or may not exist; the company research section is a call-to-action for a feature.

</details>

**Try it yourself:** In `components/job-details/MatchScore.tsx`, change `{job.match_reason && (...)}` to always render the card with a fallback: `{job.match_reason ?? "No reasoning available."}`. Build and open a job detail page. Notice that the card always appears. Then revert. Which behaviour better serves a user who sees the "AI Match Reasoning" label but empty content?

---

## Part 5 — `source_url` vs `external_apply_url`: the URL hierarchy

Open [`components/job-details/JobActions.tsx`](../../../components/job-details/JobActions.tsx):

```tsx
const applyHref = externalApplyUrl ?? sourceUrl;
const label = `Apply Now at ${company ?? "Company"}`;

if (applyHref) {
  return (
    <a
      href={applyHref}
      target="_blank"
      rel="noopener noreferrer"
      ...
    >
      {label}
    </a>
  );
}
```

Open [`components/job-details/JobInfo.tsx`](../../../components/job-details/JobInfo.tsx) lines 61–71:

```tsx
{job.source_url && (
  <a
    href={job.source_url}
    target="_blank"
    rel="noopener noreferrer"
    ...
  >
    <ExternalLink size={14} />
    View Job Post
  </a>
)}
```

JobsDB jobs have two distinct URLs:

| Field | What it is | Destination |
|---|---|---|
| `source_url` | Where the agent found the job | `hk.jobsdb.com/job/[id]` — the listing page on JobsDB |
| `external_apply_url` | Where the apply button on the listing links to | Company's own careers portal, often a different domain |

These are different sites for a reason. JobsDB is an aggregator — employers pay to list jobs there. But applications are submitted through the employer's own applicant tracking system (Workday, Taleo, Greenhouse, etc.). The JobsDB listing is a formatted advertisement. The `external_apply_url` is the actual application entry point.

"View Job Post" uses `source_url` because the user wants to see the original listing — with formatting, company branding, and the JobsDB interface.

"Apply Now" uses `external_apply_url ?? sourceUrl` because the user wants to begin an application — and for JobsDB jobs, that means going to the employer's system, not the listing page. Sending Apply Now to `source_url` would make the user click a second apply button.

The `?? sourceUrl` fallback handles future data sources (Adzuna) where `external_apply_url` may not exist. For those jobs, the listing page is also the apply destination. The fallback means Apply Now always works.

**Checkpoint:** A developer simplifies the code by removing `external_apply_url` entirely and using `source_url` for both "View Job Post" and "Apply Now." For a HSBC job on JobsDB, where does "Apply Now" now take the user, and what extra step must they perform?

<details>
<summary>Reveal answer</summary>

Apply Now would navigate to the JobsDB listing page (`hk.jobsdb.com/job/...`). The user would land on the formatted listing — not the HSBC application form. They would need to find and click the apply button on the listing, which then takes them to `hsbc.taleo.net` (or similar). Apply Now becomes a two-step process instead of one. For users who are ready to apply, this adds friction and reduces the utility of the button.

</details>

**Try it yourself:** Open the running app, navigate to a job detail page, and inspect the "Apply Now" and "View Job Post" buttons in browser DevTools. Look at their `href` attributes. Do they point to the same domain, or different domains? This confirms whether the actor successfully scraped separate `external_apply_url` and `source_url` values for that job.

---

## Part 6 — `whitespace-pre-line` and raw scraped text

Open [`components/job-details/JobDescription.tsx`](../../../components/job-details/JobDescription.tsx):

```tsx
export function JobDescription({ aboutRole }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <FileText size={16} className="text-text-secondary" />
        <h2 className="text-base font-semibold text-text-primary">
          Job Description
        </h2>
      </div>
      {/* whitespace-pre-line preserves newlines from raw innerText scrape */}
      <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
        {aboutRole ?? "No description available."}
      </p>
    </div>
  );
}
```

The Apify actor scrapes job descriptions using `innerText` on the job detail page's description element. `innerText` produces a specific kind of text: HTML tags are stripped, meaningful line breaks from block-level elements (`<p>`, `<li>`, `<br>`, headings) become `\n` characters, and excess whitespace is normalized.

A typical scraped description might look like:

```
"About the Role\nWe are seeking a motivated engineer.\n\nKey Responsibilities\n- Build and maintain features\n- Write unit tests\n- Collaborate with product\n\nRequirements\n3+ years of experience"
```

The default CSS value for `white-space` is `normal`, which collapses all whitespace sequences (including `\n`) into a single space. With the default, the entire description above renders as one unbroken run of text:

```
About the Role We are seeking a motivated engineer. Key Responsibilities - Build and maintain features - Write unit tests - Collaborate with product Requirements 3+ years of experience
```

`whitespace-pre-line` changes the behaviour: `\n` characters become visible line breaks, but multiple spaces are still collapsed. The description renders with paragraph structure:

```
About the Role
We are seeking a motivated engineer.

Key Responsibilities
- Build and maintain features
- Write unit tests
- Collaborate with product

Requirements
3+ years of experience
```

The alternative, `whitespace-pre`, would also preserve newlines but would keep every space — including inconsistent indentation from the scraper. `whitespace-pre-line` is the precise tool: newlines preserved, spaces normalized.

**Checkpoint:** The actor uses `innerText` rather than `innerHTML` to scrape the description. What security problem would using `innerHTML` on scraped content create in this component?

<details>
<summary>Reveal answer</summary>

`innerHTML` (or `dangerouslySetInnerHTML` in React) would render raw HTML from the job description. If a job listing contained `<script>` tags, `<img onerror="...">`, or other XSS vectors, they would execute in the user's browser. This is a stored XSS attack vector — the injected content sits in the database and runs for every user who views the job. `innerText` strips all HTML during scraping, so the stored value is plain text. React renders it as text content, not HTML. No injection is possible.

</details>

**Try it yourself:** In your browser DevTools, find a job description element on the detail page. Select the text and paste it into a plain text editor. Count how many line breaks exist in the raw text. Then compare with what you see rendered — the `whitespace-pre-line` property should show the same structure.

---

## Part 7 — `formatJobType` and the null rule

Open [`components/job-details/JobInfo.tsx`](../../../components/job-details/JobInfo.tsx) lines 13–18:

```ts
function formatJobType(t: string | null): string {
  if (t === "fulltime") return "Full-time";
  if (t === "parttime") return "Part-time";
  if (t === "contract") return "Contract";
  return "—";
}
```

The `job_type` column is typed `JobType | null`. A null value means the actor did not find explicit job type information on the listing page.

The find route (`app/api/agent/find/route.ts`) converts scraped strings before saving: "part time" → `'parttime'`, "contract" → `'contract'`, anything else including explicit "full time" → `'fulltime'`. A job that was explicitly marked as full-time will have `job_type = 'fulltime'`. A job where the scraper found no job type information at all will have `job_type = null`.

**Why "—" and not "Full-time" for null:** Null means "unknown," not "default full-time." Showing "Full-time" for a null `job_type` would mislead users — they might filter by job type, or make decisions about whether a role suits them, based on information that was never actually collected. The display value "—" is honest: it communicates that this information was checked and unavailable.

This is a general rule in this codebase: nullable fields display as "—" when no data is available. The UI never invents values for null fields. Displaying honest absence is always better than displaying a fabricated default.

Notice that `formatJobType` never returns `null` — its return type is `string`, not `string | null`. The null case is handled inside the function. The caller never needs to write `formatJobType(job.job_type) ?? "—"` because the function already returns the placeholder. This encapsulates the null-handling rule in one place.

**Checkpoint:** The find route converts "anything not explicitly part-time or contract" to `'fulltime'`. This means most JobsDB jobs have `job_type = 'fulltime'`, not null. What does a null `job_type` specifically indicate about how the actor processed that job?

<details>
<summary>Reveal answer</summary>

A null `job_type` means the actor's job type extraction logic returned null — the listing page did not contain a recognizable job type string, or the extraction step was skipped for that job. The find route's `else → 'fulltime'` default would have converted any scraped string to `'fulltime'`, including an explicit "full time" label. So if `job_type` is null, it means either: the actor returned no job type field at all (the scraper didn't find one), or the value was explicitly `null` in the actor's output and the route preserved it rather than converting. It is not "this job is an unknown type" — it is "we did not collect this information for this job."

</details>

**Try it yourself:** Read `app/api/agent/find/route.ts` and find the `job_type` assignment. Identify the exact condition that produces `'fulltime'` vs `null`. Then look at `types/index.ts` and find the `JobType` type alias. Confirm that `null` is not part of the `JobType` union — it is a separate nullable modifier on the column.

---

## Full data flow: clicking a row to viewing and applying for a job

This trace follows a single user action from clicking a table row to clicking "Apply Now."

**Step 1 — Click on the table row** (`components/find-jobs/JobsTable.tsx`)
The user clicks anywhere on the row. The `::after` pseudo-element of the `<Link>` intercepts the click. The browser follows the `<Link>`'s `href`: `/find-jobs/a3c2b1d0-...`

**Step 2 — Navigation** (Next.js router)
The click is `router.push()` semantics — it adds a new history entry. The user's current URL (`/find-jobs?match=high&page=2`) is preserved in history. Browser back will return them exactly here.

**Step 3 — Server renders the detail page** (`app/find-jobs/[id]/page.tsx`)
`params` arrives as `Promise<{ id: 'a3c2b1d0-...' }>`. The page awaits it. `createInsforgeServer()` reads auth cookies from the request. `getCurrentUser()` verifies the session.

**Step 4 — DB query** (InsForge)
`.from("jobs").select("*").eq("id", id).eq("user_id", user.id).single()` runs against the `jobs` table. Both filters must match. A single row is returned — the user's job. `job as Job` assigns the typed shape.

**Step 5 — Components render** (Server)
`JobInfo` renders the header and info cards. `MatchScore` checks `job.match_reason` — if non-null, the reasoning card renders. It checks `job.matched_skills?.length` and `job.missing_skills?.length` for the skill badges. `JobDescription` renders the full `about_role` text with `whitespace-pre-line`. `CompanyResearch` renders the empty state. `JobActions` computes `applyHref = external_apply_url ?? source_url`.

**Step 6 — HTML sent to browser** (Next.js)
The complete page HTML is streamed to the browser. No client-side data fetching. The user sees the full page as soon as the server response arrives.

**Step 7 — User clicks "Apply Now"** (`components/job-details/JobActions.tsx`)
The `<a href={applyHref} target="_blank">` opens the `external_apply_url` (the company's careers portal) in a new tab. The user is now on the employer's application form. The job detail page remains open in the original tab.

---

## Self-check quiz

<details>
<summary><strong>1. What does `const { id } = params` (without `await`) produce in Next.js 16, and why doesn't TypeScript warn about it?</strong></summary>

`params` is `Promise<{ id: string }>`. Reading `.id` directly on a Promise object is valid TypeScript — TypeScript doesn't error because Promise objects can have any properties you access (they return `undefined` for non-existent ones). At runtime, `id` is `undefined`. The DB query `.eq("id", undefined)` returns no rows, `.single()` returns an error, and `notFound()` fires. Every detail URL returns 404. TypeScript cannot catch this because the type `Promise<{ id: string }>` does technically allow property access — it just doesn't have the expected keys at runtime.

</details>

<details>
<summary><strong>2. A developer removes `.eq("user_id", authData.user.id)` from the query. The app still works for normal use. What specifically breaks, and under what scenario?</strong></summary>

Normal use — a user viewing their own jobs — is unaffected. The `id` filter returns their job. The break happens when any authenticated user constructs a URL with another user's job ID. Without the `user_id` filter, the server returns the full job record: match score, match reasoning, skill gap analysis, salary estimates. This is a data leak — the job seeker's private AI assessment is visible to anyone who discovers the URL. The fix is one line; the exposure is real.

</details>

<details>
<summary><strong>3. The stretched link uses `after:inset-0` to cover the row. What does `inset: 0` mean in CSS, and what element does it size relative to?</strong></summary>

`inset: 0` is shorthand for `top: 0; right: 0; bottom: 0; left: 0`. Combined with `position: absolute`, it stretches the element to the edges of its nearest positioned ancestor. The `<Link>` has its `::after` positioned absolutely. The `<tr>` has `position: relative`. The `<tr>` is therefore the positioned ancestor, and the `::after` stretches to fill the entire row — not just the `<td>` containing the `<Link>`.

</details>

<details>
<summary><strong>4. `MatchScore.tsx` shows a card for matched skills and a card for AI reasoning. Both are conditional. Why does the skills card have an empty state ("No skill data available.") while the reasoning card is hidden entirely?</strong></summary>

The skills card always renders because the "Required Skills vs Your Profile" feature is prominently named and users expect to see it. An absent card would leave users wondering whether the feature exists. The empty state message — "No skill data available." — tells them the feature ran but found nothing to display. The reasoning card is hidden because a card titled "AI Match Reasoning" with no content has no useful null state. Its presence implies content exists. Hiding it when there's no reason is cleaner than showing an empty reasoning section. Different design intent, different strategy.

</details>

<details>
<summary><strong>5. For a JobsDB job, what is the difference between `source_url` and `external_apply_url`? If you used `source_url` for both "View Job Post" and "Apply Now," what would the user experience be?</strong></summary>

`source_url` is the JobsDB listing page URL — where the agent found the job. `external_apply_url` is the URL of the apply button on that listing — typically a company's own careers portal on a different domain. If "Apply Now" used `source_url`, clicking it would take the user to the JobsDB listing page. They'd land on the listing and need to locate and click the apply button again. The distinction matters because "Apply Now" should go directly to the application form, not to an intermediate listing page. The two-click path reduces conversion and adds unnecessary friction.

</details>

---

## Extend it (challenges)

### Challenge 1 — Trace (15–20 min)

**Follow `external_apply_url` from the actor to the Apply Now button.**

Starting from `apify/jobsdb-hk-actor/src/`, trace where `external_apply_url` is scraped. What selector or element does the actor read? What value is it assigned in the actor's output? Where does the find route receive it and assign it before saving to the database? Which column in `types/index.ts` does it map to? Finally, follow it from the DB query result through `app/find-jobs/[id]/page.tsx` to `JobActions.tsx`.

Write out the complete path: file name, approximate line, what the value looks like at each step.

<details>
<summary>Hint</summary>

Start in `apify/jobsdb-hk-actor/src/scraper.ts` (or similar). Look for "apply" in the selectors. The value will be a URL string. In the find route (`app/api/agent/find/route.ts`), look for where actor output maps to the `Job` insert shape. In `types/index.ts`, look for `external_apply_url` in the `Job` interface.

</details>

---

### Challenge 2 — Extend (20–30 min)

**Add a "Posted" info card showing when the job was first posted.**

Currently the 4-column info grid shows Salary, Location, Job Type, Date Found. The actor scrapes a `postedAt` field from the listing page but this date is not saved to the `jobs` table — there's no column for it.

Design two approaches:
1. Add a `posted_at` column to the `jobs` table and save the actor's `postedAt` value
2. Leave the DB unchanged and change the "Date Found" card label to "Discovered" to be more accurate

For approach 1: identify what schema change would be needed, what actor output field maps to it, and how the card component would change.

For approach 2: implement the label change and write a comment explaining why "Discovered" is more accurate than "Date Found."

<details>
<summary>Hint</summary>

For approach 1: the actor output includes `postedAt` (check the actor's return shape). The `jobs` table would need a `posted_at timestamptz` column. The find route (`app/api/agent/find/route.ts`) would need to include it in the insert. The `Job` type in `types/index.ts` would need the new field. For approach 2: edit `components/job-details/JobInfo.tsx`, find the label text for the Calendar info card.

</details>

---

### Challenge 3 — Break and fix (30–45 min)

**Remove the `user_id` query filter and reason about the exposure.**

In `app/find-jobs/[id]/page.tsx`, remove `.eq("user_id", authData.user.id)` from the query. Save and run the dev server.

1. Log in as a user and run a job search. Note one of the job detail URLs.
2. Open a private browsing window, log in as a different user.
3. Navigate directly to the URL from step 1. What happens?

Then restore the filter. Write a comment in the code (then remove it) explaining exactly what the filter prevents. Finally, answer: if the project's RLS policy correctly restricts users to their own rows, would the missing filter still be exploitable? Under what circumstances?

<details>
<summary>Hint</summary>

For step 3, you'll need two different user accounts. If you only have one, you can temporarily comment out the auth check (`if (authError || !authData.user) redirect("/login")`) to simulate an unauthenticated request and see what the DB returns without the user filter. For the RLS question, consider: what if a Supabase service key were used server-side, or if an admin endpoint bypassed RLS?

</details>

---

For deeper exploration, `docs/plan/12-job-details-page/ai-discussion-topics.md` has 15 prompts covering dynamic route security, stretched link accessibility, and null-handling design decisions. `docs/architect/12-job-details-page/ai-discussion-topics.md` has 20 deeper prompts targeting the architectural reasoning behind each decision. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
