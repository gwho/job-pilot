# Plan: Feature 12 — Job Details Page

## Context

The Find Jobs table (Feature 11) is complete and shows all saved jobs with filter/sort/pagination. Rows have `cursor-pointer` but no navigation yet. Feature 12 adds the destination: a per-job detail page at `/find-jobs/[id]` that shows the full job record, AI match reasoning, skill gap analysis, and a company research placeholder. All data is already in the `jobs` table from Features 10/10b. No agent calls, no mutations — this is a read-only display feature. The Company Research "Research Company" button appears in the UI but is wired up in Feature 13.

Design reference: `context/designs/job-details.png` — implement pixel-faithfully.

---

## Files

### New
- `app/find-jobs/[id]/page.tsx` — dynamic Server Component route; auth + data fetch; renders the 5 components and "Back to Jobs" link
- `components/job-details/JobInfo.tsx` — header card (logo placeholder, title, company, match badge, View Job Post) + info cards row (Salary, Location, Job Type, Date Found)
- `components/job-details/MatchScore.tsx` — AI Match Reasoning card + Required Skills vs Your Profile card
- `components/job-details/JobDescription.tsx` — Job Description card
- `components/job-details/CompanyResearch.tsx` — Company Research card (empty state + disabled button)
- `components/job-details/JobActions.tsx` — Apply Now full-width button

**Why `components/job-details/` and not `components/find-jobs/job-details/`:** `context/architecture.md` defines `components/job-details/` as the canonical path with exactly this 5-file decomposition. The feature lives under `find-jobs/` in the route tree, but the components folder follows the architecture doc's planned structure.

### Modified
- `components/find-jobs/JobsTable.tsx` — add row navigation to `/find-jobs/[id]`

---

## Source-specific data contract

The current codebase only has one active source: **JobsDB HK** (`source_provider = 'jobsdb_hk'`). Adzuna is preserved in code but bypassed in v1. Every job in the DB right now comes from the Apify actor. This shapes which fields are reliably populated and which are always null.

### Fields always populated for JobsDB jobs
| Field | Shape | Notes |
|---|---|---|
| `title` | string | scraped from `[data-automation="job-detail-title"]` |
| `company` | string | scraped from `[data-automation="advertiser-name"]` |
| `location` | string | HK-specific — e.g. "Kwun Tong", "Central, Hong Kong" |
| `about_role` | string | **full scraped job description** — may be 300–1000 words, not a snippet |
| `source_url` | string | canonical `https://hk.jobsdb.com/job/[id]` — the **listing page** |
| `external_apply_url` | string | apply button URL from detail page, falls back to `source_url` — route sets `job.externalApplyUrl ?? job.sourceUrl`, never null |
| `match_score` | number | from Nemotron |
| `match_reason` | string | from Nemotron |
| `matched_skills` | string[] | from Nemotron |
| `missing_skills` | string[] | from Nemotron |

### Fields that may be null for JobsDB jobs
| Field | Null when | UI |
|---|---|---|
| `salary` | not listed on page (common in HK) | show "—" |
| `job_type` | job type not explicitly listed or not matched | show "—" — **do not invent "Full-time" for null** |

> **Note on `job_type`:** The find route converts known strings ("part time" → `'parttime'`, "contract" → `'contract'`, everything else → `'fulltime'`). In practice many JobsDB jobs will have `'fulltime'` from the default, but the DB field is typed `JobType | null` and the formatter must handle null correctly: return "—", not a guessed value.

### Fields always null for ALL current jobs
`responsibilities`, `requirements`, `nice_to_have`, `benefits`, `about_company`, `company_research`

Not shown in Feature 12 UI — no need to handle them.

### Apply Now vs View Job Post — the distinction matters
- **"View Job Post"** → `source_url` — the JobsDB listing page
- **"Apply Now"** → `external_apply_url ?? source_url` — for JobsDB this is the company's direct apply link (careers portal) scraped from the apply button; for future Adzuna jobs where `external_apply_url` may be null, fall back to `source_url`

### `about_role` is full text, not a snippet
JobsDB returns the complete description from the detail page — may be several paragraphs. Show full text with no truncation; use `whitespace-pre-line` to preserve line breaks from the raw `innerText` scrape.

### "Date Found" shows agent discovery time, not job post date
The actor captures `postedAt` from the page but does **not** save it to the DB (no column in the `Job` type). The info card shows `formatRelativeDate(job.found_at)` — when our agent discovered the job.

---

## Step 1 — Make JobsTable rows navigable

`JobsTable.tsx` is already `"use client"`. Add row navigation using the **stretched link pattern** — semantically correct `<a>` / `<Link>` that covers the whole row via a CSS pseudo-element. This gives native browser behavior: open-in-new-tab, keyboard support, visible link target.

Add `relative` to the `<tr>` so the `::after` pseudo-element is positioned relative to it. In the company-name cell (first significant cell), wrap the company name text in a `<Link>` with `after:absolute after:inset-0 after:content-['']` — the pseudo-element covers the entire row.

```tsx
import Link from "next/link";

// <tr> gets relative positioning
<tr
  key={job.id}
  className="relative border-t border-border hover:bg-surface-secondary transition-colors cursor-pointer"
>
  <td className="px-6 py-4">
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0">
        <Building2 size={16} className="text-text-muted" />
      </div>
      {/* stretched link — ::after covers the whole row */}
      <Link
        href={`/find-jobs/${job.id}`}
        className="text-sm font-semibold text-text-primary after:absolute after:inset-0 after:content-['']"
        aria-label={`View ${job.title ?? "job"} at ${job.company ?? "company"}`}
      >
        {job.company ?? "—"}
      </Link>
    </div>
  </td>
  {/* remaining <td> cells unchanged — they're covered by the stretched link */}
  ...
</tr>
```

No new imports needed beyond `Link` from `next/link`. `useRouter` is not needed.

---

## Step 2 — Create the page route

**`app/find-jobs/[id]/page.tsx`**

```tsx
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { createInsforgeServer } from "@/lib/insforge-server";
import { Navbar } from "@/components/layout/Navbar";
import { JobInfo } from "@/components/job-details/JobInfo";
import { MatchScore } from "@/components/job-details/MatchScore";
import { JobDescription } from "@/components/job-details/JobDescription";
import { CompanyResearch } from "@/components/job-details/CompanyResearch";
import { JobActions } from "@/components/job-details/JobActions";
import type { Job } from "@/types/index";

export const dynamic = "force-dynamic";

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;  // Next.js 16: params is a Promise — verify in node_modules/next/dist/docs/
}) {
  const { id } = await params;
  const insforge = await createInsforgeServer();

  const { data: authData, error: authError } = await insforge.auth.getCurrentUser();
  if (authError || !authData.user) redirect("/login");

  const { data: job, error } = await insforge.database
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", authData.user.id)
    .single();

  if (error || !job) notFound();

  const typedJob = job as Job;

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
          <Link
            href="/find-jobs"
            className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={16} />
            Back to Jobs
          </Link>
          <JobInfo job={typedJob} />
          <MatchScore job={typedJob} />
          <JobDescription aboutRole={typedJob.about_role} />
          <CompanyResearch company={typedJob.company} />
          <JobActions
            company={typedJob.company}
            externalApplyUrl={typedJob.external_apply_url}
            sourceUrl={typedJob.source_url}
          />
        </div>
      </main>
    </>
  );
}
```

> **Verify params shape:** Check `node_modules/next/dist/docs/` for Next.js 16's exact `params` type before writing code — the Promise wrapping may differ from this plan.

---

## Step 3 — Create the 5 components

All Server Components (no `"use client"`). All in `components/job-details/`.

---

### 3a — `JobInfo.tsx`

Props: `{ job: Job }`

Renders two visual blocks:

**Block 1 — Header card** (`bg-surface border border-border rounded-2xl p-6 shadow-sm`)

Layout: `flex items-start justify-between gap-4`

Left: `flex items-start gap-4`
- Logo placeholder: `w-10 h-10 bg-surface-tertiary border border-border rounded-lg flex items-center justify-center shrink-0` + `<Building2 size={20} className="text-text-muted" />`
- Text block:
  - Title: `text-xl font-semibold text-text-primary`
  - Second line: `flex items-center gap-2 mt-1`
    - Company: `text-sm text-text-secondary`
    - Separator dot: `·` `text-text-muted`
    - Match badge (only if `job.match_score != null`):
      - ≥ 70: `bg-success-lightest text-success-dark`
      - 50–69: `bg-warning-light text-warning`
      - < 50: `bg-surface-tertiary text-text-muted`
      - Base classes: `text-xs font-medium px-2.5 py-1 rounded-full`
      - Text: `${job.match_score}% Match Score`

Right (only if `job.source_url`):
```tsx
<a
  href={job.source_url}
  target="_blank"
  rel="noopener noreferrer"
  className="inline-flex items-center gap-2 bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors shrink-0"
>
  <ExternalLink size={14} />
  View Job Post
</a>
```

**Block 2 — Info cards row** (`grid grid-cols-4 gap-4`)

Each card: `bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3`

Icon wrapper: `w-8 h-8 rounded-lg flex items-center justify-center shrink-0`

| Field | Icon | Icon wrapper bg + color | Value | Label |
|---|---|---|---|---|
| `salary` | `DollarSign` | `bg-success-lightest` / `text-success` | `job.salary ?? "—"` | `SALARY EST.` |
| `location` | `MapPin` | `bg-info-lightest` / `text-info` | `job.location ?? "—"` | `LOCATION` |
| `job_type` | `Briefcase` | `bg-accent-muted` / `text-accent` | `formatJobType(job.job_type)` | `JOB TYPE` |
| `found_at` | `Calendar` | `bg-info-lightest` / `text-info-medium` | `formatRelativeDate(job.found_at)` | `DATE FOUND` |

```ts
// module-level helper
function formatJobType(t: string | null): string {
  if (t === "fulltime") return "Full-time";
  if (t === "parttime") return "Part-time";
  if (t === "contract") return "Contract";
  return "—";
}
```

Value: `text-sm font-semibold text-text-primary`
Label: `text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5`

Imports from utils: `formatRelativeDate` from `@/lib/utils`

---

### 3b — `MatchScore.tsx`

Props: `{ job: Job }`

Renders two cards only when there is something to show.

**AI Match Reasoning card** — only render if `job.match_reason` is non-null and non-empty:
- Card: `bg-surface border border-border rounded-2xl p-6 shadow-sm`
- Header: `flex items-center gap-2 mb-3` → `<Sparkles size={16} className="text-success" />` + `text-xs font-medium text-text-secondary uppercase tracking-wide` → `AI MATCH REASONING`
- Body: `text-sm text-text-primary leading-relaxed` → `{job.match_reason}`

**Required Skills vs Your Profile card** — always render this card:
- Card: `bg-surface border border-border rounded-2xl p-6 shadow-sm`
- Header: `text-xs font-medium text-text-secondary uppercase tracking-wide mb-4` → `REQUIRED SKILLS VS YOUR PROFILE`
- "You have" subsection (only if `job.matched_skills?.length`):
  - Label: `text-xs font-medium text-text-muted mb-2` → `You have`
  - Badges: `flex flex-wrap gap-2`
  - Each: `inline-flex items-center gap-1 bg-success-lightest text-success-dark text-xs font-medium px-2.5 py-1 rounded-full` + `<Check size={11} strokeWidth={2.5} />`
- "Gap skills" subsection (only if `job.missing_skills?.length`, add `mt-4` when both sections show):
  - Label: `text-xs font-medium text-text-muted mb-2` → `Gap skills`
  - Each: `inline-flex items-center gap-1 bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` + `<X size={11} strokeWidth={2.5} />`
- If both arrays null/empty: `<p className="text-sm text-text-muted">No skill data available.</p>`

---

### 3c — `JobDescription.tsx`

Props: `{ aboutRole: string | null }`

- Card: `bg-surface border border-border rounded-2xl p-6 shadow-sm`
- Header: `flex items-center gap-2 mb-3` → `<FileText size={16} className="text-text-secondary" />` + `text-base font-semibold text-text-primary` → `Job Description`
- Body: `text-sm text-text-primary leading-relaxed whitespace-pre-line` → `{aboutRole ?? "No description available."}`
- `whitespace-pre-line` is required — JobsDB descriptions are raw `innerText` with newlines

---

### 3d — `CompanyResearch.tsx`

Props: `{ company: string | null }`

Feature 12: always shows the empty state. Feature 13 will upgrade this to a Client Component with the onClick handler.

- Card: `bg-surface border border-border rounded-2xl p-6 shadow-sm`
- Header row: `flex items-center justify-between mb-6`
  - Left: `flex items-center gap-2` → `<Building2 size={16} className="text-text-secondary" />` + `text-base font-semibold text-text-primary` → `Company Research`
  - Right: disabled button:
    ```tsx
    <button
      disabled
      className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 opacity-50 cursor-not-allowed"
    >
      <Search size={14} />
      Research Company
    </button>
    ```
- Empty state:
  ```tsx
  <div className="flex flex-col items-center justify-center py-10 gap-3">
    <Building2 size={32} className="text-text-muted" />
    <p className="text-sm font-medium text-text-primary">No research yet</p>
    <p className="text-xs text-text-muted text-center max-w-[200px]">
      Click "Research Company" to let the AI browse{" "}
      {company ?? "the company"}'s public pages and build a dossier.
    </p>
  </div>
  ```

---

### 3e — `JobActions.tsx`

Props: `{ company: string | null, externalApplyUrl: string | null, sourceUrl: string | null }`

Apply href: `externalApplyUrl ?? sourceUrl` — JobsDB always has `externalApplyUrl`; Adzuna fallback uses `sourceUrl`.

```tsx
const applyHref = externalApplyUrl ?? sourceUrl;

{applyHref ? (
  <a
    href={applyHref}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-center w-full bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-3 hover:bg-accent-dark transition-colors"
  >
    Apply Now at {company ?? "Company"}
  </a>
) : (
  <button
    disabled
    className="flex items-center justify-center w-full bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-3 opacity-50 cursor-not-allowed"
  >
    Apply Now at {company ?? "Company"}
  </button>
)}
```

---

## Null / edge-case rules

| Field | Rule |
|---|---|
| `match_score` null | Hide badge entirely from header |
| `match_reason` null/empty | Hide AI Match Reasoning card entirely |
| `matched_skills` null/empty | Hide "You have" subsection |
| `missing_skills` null/empty | Hide "Gap skills" subsection |
| both skill arrays null/empty | Show "No skill data available." in the skills card |
| `about_role` null | Show "No description available." |
| `salary` / `location` null | Show "—" in info card |
| `job_type` null | `formatJobType` returns "—" — do not default to "Full-time" |
| `source_url` null | Hide View Job Post button |
| `external_apply_url` and `source_url` both null | Render disabled Apply Now button |

---

## lucide-react icons used

`Building2`, `ChevronLeft`, `ExternalLink`, `DollarSign`, `MapPin`, `Briefcase`, `Calendar`, `Sparkles`, `Check`, `X`, `FileText`, `Search` — all available via the installed `lucide-react` package.

---

## Post-build steps (per AGENTS.md)

After implementation:
1. `/imprint` — capture `components/job-details/` patterns in `context/ui-registry.md`
2. `/project-review` — verify Find Jobs table navigation and nothing regressed
3. `/session-docs` — document the architect session
4. Plan file is already saved here
5. `/feature-docs` — document Feature 12 (what was built and why)
6. `/tutorial` — generate tutorial from the architect docs + feature docs + codebase

---

## Implementation watchpoints

1. **Verify `params` shape first.** Before writing the page, check `node_modules/next/dist/docs/` for the Next.js 16 dynamic route params API. This repo has explicit "this is not the Next.js you know" rules — do not assume training-data shape.

2. **Test the stretched link in a real browser row.** Table row `position: relative` + `::after` can be unreliable in some browsers. If `after:inset-0` does not cover the full row, fall back to: add `role="link" tabIndex={0}` on `<tr>` and `onKeyDown` (Enter → navigate) alongside the `onClick`, keeping `<Link>` in the company cell for keyboard/screen-reader users.

3. **Type assertion on InsForge query result.** If `job as Job` is unavoidable (InsForge returns untyped query data), add a short inline comment: `// InsForge query selects * from jobs — shape matches Job`. Code standards discourage bare casts.

4. **Test count is a proxy, not a contract.** The plan says "42 tests pass" as a baseline. If the count differs at implementation time, passing tests is what matters — don't hunt for a specific number.

---

## Verification

1. `npm run build` — must be clean (TypeScript + Next.js errors)
2. `npm run test:run` — 42 tests still pass, no regressions
3. Manual smoke test using a real saved job that has `match_reason`, `matched_skills`, and `missing_skills` populated (find one with a complete Nemotron score):
   - Navigate to `/find-jobs`
   - Click a job row → navigates to `/find-jobs/[id]` via stretched link
   - Right-click row → "Open in new tab" works (stretched link provides native `<a>` behavior)
   - "Back to Jobs" link navigates to `/find-jobs`
   - "View Job Post" opens `source_url` in new tab
   - "Apply Now" opens `external_apply_url` in new tab (not `source_url` — verify they may differ for JobsDB jobs)
   - All conditional sections render: header badge, AI reasoning, both skill subsections, description, research empty state
   - Test with a job missing `salary` and `match_reason` — confirm "—" and no AI card
4. Update `context/progress-tracker.md` — mark Feature 12 complete, next is Feature 13
5. Update `context/ui-registry.md` — add `components/job-details/` entry
