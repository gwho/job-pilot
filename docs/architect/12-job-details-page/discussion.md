# Feature 12 — Architect Session: Deep Discussion

This file records the reasoning behind each decision in full — not just what was chosen, but why the alternatives fail and what the session revealed about building detail pages in Next.js App Router.

---

## The Next.js 16 params trap

The session began by checking `node_modules/next/dist/docs/` before writing any code — as required by AGENTS.md. This was not a procedural formality. It caught a breaking change that would have produced a silent runtime bug.

In Next.js up to version 14, the `params` object in a dynamic route page was a plain synchronous object:

```ts
export default function Page({ params }: { params: { id: string } }) {
  const id = params.id; // string
}
```

Every tutorial, every blog post, every AI training example uses this shape. It is deeply embedded in how developers think about dynamic routes.

Next.js 16 changed params to be asynchronous:

```ts
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // must await
}
```

If you write `params.id` without awaiting, TypeScript does not complain. You're reading the `.id` property of a Promise object — a valid operation that simply returns `undefined`. The code compiles. The build passes. Every request to `/find-jobs/[id]` calls `.eq("id", undefined)` which returns no rows, triggering `notFound()`. Every job detail URL is a 404. The bug is invisible until you open a browser.

**The lesson:** "Read the installed docs first" is not just about being thorough. It specifically protects against the category of breaking changes where the old shape still compiles but behaves differently at runtime. TypeScript type errors are caught early. Silent `undefined` return values are not.

---

## Why stretched link beats onClick for table row navigation

The requirement is: clicking anywhere on a table row should navigate to the job detail page. There are two approaches. The `onClick` approach appears simpler and is what most developers reach for first. It is the wrong choice.

**The onClick approach:**

```tsx
"use client"; // required
import { useRouter } from "next/navigation";

const router = useRouter();

<tr onClick={() => router.push(`/find-jobs/${job.id}`)} className="cursor-pointer">
```

This works for left-click. Nothing else works. Right-clicking the row opens the browser's context menu, but not the link context menu — there's no option to "Open in new tab." Middle-clicking does nothing. The user cannot copy the URL. Screen readers see a clickable element with no role and no accessible name — they cannot identify it as a link or navigate to it via the links list.

**The stretched link:**

```tsx
<tr className="relative ...">
  <td>
    <Link
      href={`/find-jobs/${job.id}`}
      className="after:absolute after:inset-0 after:content-[''] after:z-1"
      aria-label={`View ${job.title ?? "job"} at ${job.company ?? "company"}`}
    >
      {job.company}
    </Link>
  </td>
</tr>
```

The `<Link>` renders as an `<a>` element with a real `href`. Its `::after` pseudo-element — an invisible zero-content absolutely-positioned box — stretches to fill the entire `<tr>`. Every click anywhere on the row hits the pseudo-element, which belongs to the `<a>`. The browser treats it identically to clicking the `<a>` directly. Right-click works. Middle-click works. Screen readers announce it as a link.

**The z-index detail:** Without `after:z-1`, the pseudo-element has `z-index: auto`. In a table, other cell content may render above a pseudo-element with auto z-index. Adding `z-index: 1` on the `::after` ensures it sits at the top of the local stacking context, regardless of what other cells contain. This was caught in the project review and fixed before completing the feature.

---

## The security boundary in the DB query

The DB query for a job detail page could be written two ways:

```ts
// Version A — filters only by ID
insforge.database.from("jobs").select("*").eq("id", id).single();

// Version B — filters by both ID and user_id (chosen)
insforge.database.from("jobs").select("*").eq("id", id).eq("user_id", authData.user.id).single();
```

Version A works correctly for the happy path (user views their own jobs). It fails the security requirement.

Job IDs are UUIDs. UUIDs are 128-bit values — a random UUID will not be guessed by chance. But UUIDs are not secret. They appear in browser URLs, server logs, analytics tools, and anywhere else the URL is recorded. A job seeker at company X might share a link with a colleague. A malicious actor might inspect network logs. In any of these scenarios, someone could construct a URL for a job that belongs to a different user.

Version A would return that job's data — including match reasons, skill gaps, and salary estimates — to an unauthorized viewer. Version B returns a 404, because `.eq("user_id", user.id)` eliminates the row if the ownership doesn't match.

**The 404 vs 403 choice:** A 403 Forbidden response would be accurate — the resource exists but access is denied. But 403 reveals that the resource exists. An attacker scanning UUIDs would know which ones correspond to real records. A 404 response is uniformly ambiguous: the record might not exist, or the user might not be allowed to see it. No information about the DB state is leaked.

This is a standard pattern in web security: for private resources, respond 404 to unauthorized requests. Never confirm that a resource exists to a caller who cannot see it.

---

## Why the component decomposition follows architecture.md over the route tree

The first plan draft put the job detail components at `components/find-jobs/job-details/`. The route is at `app/find-jobs/[id]/page.tsx`, so nesting under `find-jobs/` seems natural.

`context/architecture.md` defines `components/job-details/` as the canonical path with exactly the 5-file decomposition used here. This was a planned structure, not a coincidence.

Why does the architecture doc separate `components/job-details/` from `components/find-jobs/`? Two reasons:

1. **The detail page is conceptually separate from the list page.** `components/find-jobs/` contains table, filter, and pagination components — list-view concerns. `components/job-details/` contains header, match, description, research, and action components — detail-view concerns. They are not the same feature even though they share a URL prefix.

2. **The route path is not the component path.** Routes can be restructured (move to `/jobs/[id]`, add a route group, etc.) without changing the components. If components were nested under the route path, a route refactor would require moving components. Separating them means each can evolve independently.

---

## `source_url` and `external_apply_url`: why two URLs exist

Most job sites have one URL per job. JobsDB has two because it's an aggregator platform rather than an employer. When a company posts a job on JobsDB, the listing exists at a JobsDB URL — but the actual application process lives on the company's own careers system.

The actor scrapes both:
- `source_url`: the canonical JobsDB listing URL — where the job was found
- `external_apply_url`: the URL the apply button links to — where applications are submitted

For many jobs, these go to completely different domains. The "View Job Post" and "Apply Now" buttons serve different user needs:

- View Job Post: "I want to see how this job is presented, maybe share the link, see the original posted date."
- Apply Now: "I'm ready to start the application process."

Sending Apply Now to the JobsDB listing URL (`source_url`) would add friction — the user lands on the listing and must find the apply button again. Sending it to `external_apply_url` goes directly to the employer's application form.

The `?? sourceUrl` fallback accounts for future data sources (Adzuna) that may not distinguish between "where we found it" and "where to apply." For Adzuna, `source_url` is the Adzuna listing page which has a direct apply action. The fallback means Apply Now never renders as disabled due to a null `external_apply_url` — it always has a destination.

---

## Conditional rendering at the card level vs the field level

Feature 12's conditional rendering operates at two granularities:

**Field level** — `{job.salary ?? "—"}`: The card always renders; only the field value changes. Used for info cards where the visual grid structure matters more than the presence of data. The 4-column grid looks wrong if one card is missing.

**Card level** — `{job.match_reason && <MatchReasoningCard />}`: The entire card disappears. Used for cards that have no meaningful empty state. A card titled "AI Match Reasoning" with no content and no explanation would confuse users about what the feature does. Hiding it entirely is cleaner than showing an empty state.

**Subsection level** — `{hasMatchedSkills && <YouHaveSection />}`: Within an always-rendered card, subsections appear conditionally. The Required Skills card is always shown (it's an important feature), but its "You have" and "Gap skills" subsections only appear when there's data to show. When both are absent, the card shows "No skill data available." — telling the user the feature ran but found nothing.

The decision point: ask whether an empty state for this element communicates something useful to the user. "No salary listed" (info card with "—") is useful — the user knows we checked. "No AI reasoning" (card removed) is not useful — the card's purpose is to show reasoning, not to report its absence.

---

## `whitespace-pre-line` and the nature of scraped content

Web scraping with `innerText` produces a specific kind of text. `innerText` (as opposed to `textContent`) is what the user would see if they selected all text on the page and copied it. It:

- Strips all HTML tags
- Normalizes excess whitespace (multiple spaces → one space, leading/trailing → trimmed)
- Preserves meaningful line breaks where the HTML had block-level elements (paragraphs, list items, headings, `<br>` tags)

A job description scraped this way might look like:

```
About the Role
We are looking for a Software Engineer to join our team.

Responsibilities
- Design and implement features
- Write tests
- Collaborate with product team

Requirements
3+ years of experience
```

Browser CSS has `white-space: normal` by default, which collapses all whitespace including newlines into a single space. The entire description above would render as one run-on paragraph.

The `whitespace-pre-line` value changes this: it preserves `\n` characters as visual line breaks while still collapsing multiple spaces. The scraped text renders with paragraph structure intact — not as perfectly formatted HTML (for that you'd need to parse and re-render), but as readable content with visible sections.

`whitespace-pre` would also work but preserves every space character, which causes problems if the scraped text has indentation or inconsistent spacing. `whitespace-pre-line` is the right balance for single-pass scraped `innerText`.
