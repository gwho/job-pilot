# UI Registry

Living document. Updated after every component is built. Read this before building any new component — match existing patterns exactly before inventing new ones.

---

## How to Use

Before building any component:

1. Check if a similar component already exists here
2. If yes — match its exact classes
3. If no — build it following ui-rules.md and ui-tokens.md, then add it here

After building any component — run `/imprint` to capture patterns in this file.

---

## Components

---

### Navbar

File: `components/layout/Navbar.tsx`
Last updated: 2026-06-15

| Property         | Class                                              |
| ---------------- | -------------------------------------------------- |
| Background       | `bg-surface`                                       |
| Border           | `border-b border-border`                           |
| Border radius    | `rounded-md` (CTA button only)                     |
| Text — primary   | `text-text-darkest` (logo), `text-text-dark` (nav) |
| Text — secondary | n/a                                                |
| Spacing          | `h-16` height, `px-6` inner padding                |
| Hover state      | `hover:text-accent transition-colors` (nav links), `hover:bg-overlay-dark transition-colors` (CTA) |
| Shadow           | none                                               |
| Accent usage     | `hover:text-accent` (nav hover), `bg-overlay text-white` (CTA — uses dark overlay, not accent purple) |

**Pattern notes:**
The navbar CTA uses `bg-overlay` (near-black), not `bg-accent` (purple). This is intentional — the primary accent is reserved for in-page CTAs. Nav CTA should always be dark. Active nav state is handled by `NavLinks.tsx` (see below) — Navbar stays a Server Component; NavLinks is the thin client component that calls `usePathname()`.

---

### NavLinks

File: `components/layout/NavLinks.tsx`
Last updated: 2026-06-18

| Property         | Class                                               |
| ---------------- | --------------------------------------------------- |
| Active link      | `text-accent`                                       |
| Inactive link    | `text-text-dark hover:text-accent transition-colors` |
| Spacing          | `flex items-center gap-8`                           |
| Font             | `text-sm font-medium`                               |

**Pattern notes:**
Client-only component that renders the three nav links using `usePathname()` for active state detection. Kept separate from `Navbar` so the Navbar can remain an async Server Component. Active detection: `pathname === href || pathname.startsWith(href + '/')` — the `startsWith` catches sub-routes (e.g. `/find-jobs/123` activates "Find Jobs"). No underline on active state — color change only.

---

### Footer

File: `components/layout/Footer.tsx`
Last updated: 2026-06-15

| Property         | Class                            |
| ---------------- | -------------------------------- |
| Background       | `bg-surface`                     |
| Border           | `border-t border-border`         |
| Border radius    | none                             |
| Text — primary   | `text-text-darkest` (logo)       |
| Text — secondary | n/a                              |
| Text — muted     | `text-text-muted` (copyright)    |
| Spacing          | `py-8`, `px-6` inner             |
| Hover state      | none                             |
| Shadow           | none                             |
| Accent usage     | none                             |

**Pattern notes:**
Logo markup is identical to Navbar (Image 36×36 + `text-[19px] font-bold text-text-darkest`). Copy exactly from Navbar when building. The logo block is a candidate for extraction into a shared `<Logo />` component once reuse exceeds two locations.

---

### Hero

File: `components/homepage/Hero.tsx`
Last updated: 2026-06-15

| Property         | Class                                                           |
| ---------------- | --------------------------------------------------------------- |
| Background       | `bg-background` (section)                                       |
| Border           | `border-border` (image wrapper, secondary button)               |
| Border radius    | `rounded-full` (pill badge), `rounded-2xl` (image), `rounded-md` (buttons) |
| Text — primary   | `text-text-primary` (h1), `text-accent-foreground` (primary button) |
| Text — secondary | `text-text-secondary` (subheadline), `text-accent` (badge)      |
| Spacing          | `pt-20 pb-0` (section), `px-8` (inner), `px-6 py-3` (buttons), `px-3 py-1` (badge) |
| Hover state      | `hover:bg-accent-dark transition-colors` (primary button), `hover:bg-surface-secondary transition-colors` (secondary button) |
| Shadow           | `shadow-lg` (image wrapper)                                     |
| Accent usage     | `bg-accent text-accent-foreground` (primary button), `bg-accent-muted text-accent` (badge) |

**Pattern notes:**
Pill badge pattern: `bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full`. Use this pattern for any "category" or "label" badge on a light background. Hero image always gets `priority` — it is the LCP element. Secondary button uses `bg-surface` not `bg-transparent` to ensure it is visible on the `bg-background` page background.

---

### HowItWorks (alternating image+text section)

File: `components/homepage/HowItWorks.tsx`
Last updated: 2026-06-15

| Property         | Class                                                |
| ---------------- | ---------------------------------------------------- |
| Background       | `bg-background` (section)                            |
| Border           | `border-border` (image wrapper)                      |
| Border radius    | `rounded-2xl` (image wrapper), `rounded-full` (bullet dot) |
| Text — primary   | `text-text-primary` (heading, bullet title)          |
| Text — secondary | `text-text-secondary` (bullet description)           |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-24` (between rows), `gap-4` (between bullets) |
| Hover state      | none                                                 |
| Shadow           | `shadow-md` (image wrapper)                          |
| Accent usage     | `bg-accent` (bullet dot — 8×8px `rounded-full`)      |

**Pattern notes:**
Image wrapper uses `shadow-md` (one step lighter than Hero's `shadow-lg`). Heading is `text-3xl font-bold` (vs Hero's `text-5xl`) — this is the correct secondary heading size. Bullet dot: `w-2 h-2 rounded-full bg-accent mt-1.5 flex-shrink-0` — the `mt-1.5` aligns the dot to the first line of text. The private `Section` component handles the alternating layout via `imageLeft` boolean prop.

---

### Feature Card

File: `components/homepage/Features.tsx`
Last updated: 2026-06-15

| Property         | Class                              |
| ---------------- | ---------------------------------- |
| Background       | `bg-surface` (card), `bg-surface-secondary` (section) |
| Border           | `border border-border`             |
| Border radius    | `rounded-2xl`                      |
| Text — primary   | `text-text-primary`                |
| Text — secondary | `text-text-secondary leading-relaxed` |
| Spacing          | `p-6` (card padding), `py-16 px-8` (section), `gap-6` (grid) |
| Hover state      | none                               |
| Shadow           | `shadow-sm`                        |
| Accent usage     | none (icons are emoji)             |

**Pattern notes:**
Card uses `rounded-2xl` — this is the standard card radius for all content cards across the project (matches ui-tokens.md `--radius-xl: 16px`). Section background is `bg-surface-secondary` to visually separate from adjacent `bg-background` sections. Card heading is `text-base font-semibold` (not `font-bold`) — one weight lighter than section headings.

---

### Testimonial

File: `components/homepage/Testimonial.tsx`
Last updated: 2026-06-15

| Property         | Class                               |
| ---------------- | ----------------------------------- |
| Background       | `bg-background`                     |
| Border           | none                                |
| Border radius    | `rounded-full` (avatar image)       |
| Text — primary   | `text-text-primary` (quote, name)   |
| Text — secondary | n/a                                 |
| Text — muted     | `text-text-muted` (attribution title) |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-8` (between quote and attribution) |
| Hover state      | none                                |
| Shadow           | none                                |
| Accent usage     | none                                |

**Pattern notes:**
Quote text is `text-2xl font-medium` — larger than body text but not a heading weight. Attribution name is `text-sm font-medium text-text-primary`. Attribution title is `text-sm text-text-muted` (no font-medium). Avatar is 48×48 with `rounded-full`. No card/border wrapping — testimonial sits directly on `bg-background`.

---

### BottomCTA

File: `components/homepage/BottomCTA.tsx`
Last updated: 2026-06-28

| Property         | Class                                                        |
| ---------------- | ------------------------------------------------------------ |
| Background       | `linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)` via inline `style` — CSS variables only, no hex |
| Border           | `border-on-accent-border` (secondary button)                 |
| Border radius    | `rounded-md` (buttons)                                       |
| Text — primary   | `text-on-accent` (heading, secondary button), `text-text-primary` (primary button — on surface bg) |
| Text — secondary | `text-on-accent-muted` (subheadline)                         |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-6` (vertical), `px-6 py-3` (buttons) |
| Hover state      | `hover:bg-surface-secondary transition-colors` (primary), `hover:bg-on-accent-subtle transition-colors` (secondary) |
| Shadow           | none                                                         |
| Accent usage     | accent is the gradient start color via CSS variable ref      |

**Pattern notes:**
The only component in this project using an inline `style` prop. This is the approved exception for gradients: use `var(--color-name)` CSS variable references, never hex values. On-accent tokens (`text-on-accent`, `text-on-accent-muted`, `border-on-accent-border`, `bg-on-accent-subtle`) are defined in `globals.css` and must be used for any element placed on a dark/gradient accent surface. Button padding `px-6 py-3` matches Hero CTAs exactly. Primary "Get Started" button uses `bg-surface` (not raw `bg-white`) so it participates in the design system.

---

### ComingSoonCard

File: `components/layout/ComingSoonCard.tsx`
Last updated: 2026-06-16

| Property         | Class                               |
| ---------------- | ------------------------------------ |
| Background       | `bg-surface`                        |
| Border           | `border border-border`              |
| Border radius    | `rounded-2xl`                       |
| Text — primary   | `text-text-primary` (title, `font-semibold`) |
| Text — secondary | n/a                                 |
| Text — muted     | `text-text-muted` (description)     |
| Spacing          | `p-6` (card), `mb-1` (title), `mb-6` (description) |
| Hover state      | none                                |
| Shadow           | `shadow-lg`                         |
| Accent usage     | none                                |

**Pattern notes:**
Empty-state card per `ui-rules.md` — title is `text-base font-semibold` (matches Features card heading weight), description is muted per the Empty States rule, and a `SignOutButton` serves as the rule's "CTA button if there's a logical next action." Used identically by `/dashboard`, `/profile`, `/find-jobs` placeholder pages — these are throwaway stubs, fully replaced when Features 05/09/14 build the real pages.

---

### SignOutButton

File: `components/layout/SignOutButton.tsx`
Last updated: 2026-06-17

| Property         | Class                                |
| ---------------- | ------------------------------------- |
| Background       | `bg-surface`                         |
| Border           | `border border-border`               |
| Border radius    | `rounded-md`                         |
| Text — primary   | `text-text-primary`                  |
| Spacing          | `px-4 py-2`                          |
| Hover state      | `hover:bg-surface-secondary transition-colors` |
| Shadow           | none                                  |
| Accent usage     | none — secondary button styling, not a primary action |

**Pattern notes:**
Plain `<form action={signOut}>` wrapping `SignOutPostHogResetButton`, a client-only submit button that calls `posthog.reset()` before the server action clears the session. Visual classes are unchanged from the original button and continue to match the secondary-button token combination (`bg-surface border border-border rounded-md`).

---

### PostHogIdentity

File: `components/analytics/PostHogIdentity.tsx`
Last updated: 2026-06-17

| Property         | Class |
| ---------------- | ----- |
| Background       | n/a   |
| Border           | n/a   |
| Border radius    | n/a   |
| Text — primary   | n/a   |
| Text — secondary | n/a   |
| Spacing          | n/a   |
| Hover state      | n/a   |
| Shadow           | n/a   |
| Accent usage     | n/a   |

**Pattern notes:**
Behavior-only client component mounted in `app/layout.tsx`. It renders `null`, identifies authenticated users with PostHog when `userId` is present, and resets PostHog identity when the app renders without a user.

---

### SignOutPostHogResetButton

File: `components/layout/SignOutPostHogResetButton.tsx`
Last updated: 2026-06-17

| Property         | Class |
| ---------------- | ----- |
| Background       | `bg-surface` |
| Border           | `border border-border` |
| Border radius    | `rounded-md` |
| Text — primary   | `text-text-primary` |
| Text — secondary | n/a |
| Spacing          | `px-4 py-2` |
| Hover state      | `hover:bg-surface-secondary transition-colors` |
| Shadow           | none |
| Accent usage     | none — secondary button styling, not a primary action |

**Pattern notes:**
Same visual contract as `SignOutButton`; split into a client component solely because PostHog browser identity reset requires a click handler.

---

### ProfileForm

File: `components/profile/ProfileForm.tsx`
Last updated: 2026-06-18

| Property                    | Class / Value                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Page wrapper                | `max-w-[800px] mx-auto py-8 px-6 space-y-6`                                          |
| Card                        | `bg-surface border border-border rounded-2xl p-6 shadow-sm`                          |
| Section divider             | `<hr className="border-border" />`                                                   |
| Section heading             | `text-sm font-semibold text-text-dark mb-4`                                          |
| Card heading                | `text-base font-semibold text-text-primary mb-1`                                     |
| Card subtext                | `text-sm text-text-secondary mb-4` or `mb-6`                                        |
| Banner icon (complete)      | `CheckCircle size={18} className="text-success flex-shrink-0"`                       |
| Banner icon (incomplete)    | `AlertCircle size={18} className="text-warning flex-shrink-0"`                       |
| Ring percentage label       | `text-lg font-semibold text-text-primary` (absolute-centered over SVG)               |
| Input (standard)            | `w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent` |
| Input (disabled)            | `w-full bg-surface-secondary border border-border rounded-md px-3 py-2 text-sm text-text-muted cursor-not-allowed` |
| Upload zone                 | `border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-2 bg-surface-secondary` |
| Tag chip                    | `bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1` |
| Missing field pill          | `bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` (no × button) |
| Work entry card             | `border border-border rounded-xl p-4 space-y-4`                                      |
| Save button (primary)       | `w-full bg-accent text-accent-foreground font-medium rounded-md px-4 py-2.5 text-sm hover:bg-accent-dark transition-colors` |
| Secondary button            | `bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors` |

**Pattern notes:**
Single `"use client"` component; all state lives here. Uses `useMemo` for `completionPercentage` and `missingFields` — never store these in `useState`. The completion banner card is **always rendered** — not conditional. When `missingFields.length === 0` it shows a "Profile complete" state (`CheckCircle`, `text-success`); when incomplete it shows "Profile needs attention" (`AlertCircle`, `text-warning`) with orange pills. Dropdown `FormState` fields use `ExperienceLevel | ''` etc. (not `null`) because HTML select value must be a string. The SVG ring uses `r=40` on a `100×100` viewBox with `style={{ stroke: 'var(--color-accent)' }}` (not a Tailwind class). `TagInput` is declared at module scope outside the component function — never define a React component inside another component's render path. Upload zone uses `bg-surface-secondary` (neutral grey) — not `bg-surface-muted` (blue-tinted). Missing field pills use `bg-warning-light text-warning` (orange) — not `bg-accent-light text-accent` (purple). Generate Resume button uses `disabled:opacity-40 disabled:cursor-not-allowed` and is hard-disabled when `!profile?.is_complete || isGenerating`; success/error feedback rendered inline below the button row.

---

### ConnectedAccounts (inert)

File: `components/profile/ProfileForm.tsx` (inline JSX block, not extracted)
Last updated: 2026-06-18

| Property             | Class / Value                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| Card                 | `bg-surface border border-border rounded-2xl p-6 shadow-sm`                  |
| LinkedIn logo badge  | `w-10 h-10 rounded-lg bg-linkedin flex items-center justify-center flex-shrink-0` |
| LinkedIn logo text   | `text-linkedin-foreground text-sm font-bold`                                  |
| Account name         | `text-sm font-medium text-text-primary`                                       |
| Connection status    | `text-xs text-text-muted`                                                     |
| Connect button       | `bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors` |

**Pattern notes:**
Inert UI — "Connect LinkedIn" button does nothing in Feature 05. LinkedIn logo badge uses `bg-linkedin` + `text-linkedin-foreground` brand tokens (never generic blue). The `in` text is a placeholder for the actual LinkedIn SVG icon that will be wired in a future feature. Positioned between the completion banner and Resume card.

---

### TagInput

File: `components/profile/ProfileForm.tsx` (module-level, not exported)
Last updated: 2026-06-18

| Property      | Class                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Label         | `text-sm font-medium text-text-dark mb-1.5`                                 |
| Optional hint | `text-text-muted font-normal ml-1` (inline span inside label)               |
| Chip list     | `flex flex-wrap gap-2 mb-2`                                                 |
| Chip          | `bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1` |
| × button      | `hover:text-accent-dark leading-none` + `aria-label="Remove {item}"`        |
| Input row     | `flex gap-2`                                                                |
| Add button    | `bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors whitespace-nowrap` |

**Pattern notes:**
Defined at module scope (not inside any component) to ensure React treats it as a stable component reference — see explanation.md §8. Accepts all data and handlers as props; no internal state. `onKeyDown` should call `e.preventDefault()` when Enter is pressed to prevent form submission.

---

### Login OAuth Error Message

File: `app/(auth)/login/page.tsx`
Last updated: 2026-06-17

| Property         | Class                                      |
| ---------------- | ------------------------------------------ |
| Background       | `bg-surface`                               |
| Border           | `border border-error`                      |
| Border radius    | `rounded-md`                               |
| Text — primary   | `text-error`                               |
| Text — secondary | n/a                                        |
| Text — muted     | n/a                                        |
| Spacing          | `mb-4`, `px-3 py-2`                        |
| Hover state      | none                                       |
| Shadow           | none                                       |
| Accent usage     | `border-error text-error` for failure only |

**Pattern notes:**
Small inline auth failure message rendered inside the existing login card when `/login?error=oauth` is present. It intentionally keeps the card white (`bg-surface`) and uses error color only for the border/text so it follows the rule that color goes inside cards, not on the card surface. Reuse this compact `rounded-md border border-error bg-surface px-3 py-2 text-sm font-medium text-error` pattern for future form-level auth errors.

---

### SearchControls

File: `components/find-jobs/SearchControls.tsx`
Last updated: 2026-06-25 (Feature 10)

| Property          | Class / Value                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Card              | `bg-surface border border-border rounded-2xl p-6 shadow-sm`                                            |
| Input row         | `flex items-end gap-4`                                                                                  |
| Label             | `block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1`                            |
| Input (with icon) | `w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60` |
| Inset icon        | `absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none`                         |
| Primary button    | `flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed` |
| Success banner    | `mt-4 flex items-center gap-2 bg-success-lightest text-success-foreground text-sm rounded-md px-4 py-2` |

**Pattern notes:**
Presentational `"use client"` leaf (Feature 10 refactor) — **no internal state**. Receives `jobTitle`, `location`, `isLoading`, `searchStatus`, `onJobTitleChange`, `onLocationChange`, `onSearch` as props from `FindJobsClient`. While `isLoading`, the button shows a spinning `Loader2` + "Finding jobs..." and inputs/button are disabled. Success banner renders only when `searchStatus !== null` and displays the API-provided `successMessage` verbatim, so deduped repeat searches can say "all already saved" instead of reconstructing stale "strong matches" copy in the client. Input icon uses `pointer-events-none` so clicks pass through to the input. `whitespace-nowrap` on the button prevents line breaks in the flex row when the viewport is narrow.

---

### FindJobsClient

File: `components/find-jobs/FindJobsClient.tsx`
Last updated: 2026-06-25 (Feature 10)

| Property | Class / Value |
| -------- | ------------- |
| Outer wrapper | `space-y-6` |
| List card | `bg-surface border border-border rounded-2xl shadow-sm` |

**Pattern notes:**
Container component and the **single owner of `jobs` state**. Owns search state (`jobTitle`, `location`, `isLoading`, `searchStatus`, `jobs`) and derives view state from URL via `useSearchParams()` on every render — `q`, `match`, `sort`, `page` are never in `useState`. One `useState` exception: `filterTextDraft` for the text input, debounced into URL `q` after 300ms. Two `useEffect`s manage sync: `[q]` resets draft on back-nav; `[filterTextDraft]` debounces to URL with `filterTextDraft === q` guard to prevent replace loops. Before any search, `initialJobs` shows saved history. After an agent search, `handleSearch()` replaces `jobs` with the API response rows so the table reflects the latest search result, including already-saved jobs returned by `/api/agent/find`. `PAGE_SIZE = 20` defined here; passed as `pageSize={PAGE_SIZE}` to `JobsPagination`. `safePage = Math.min(page, totalPages)` clamps when filters reduce the count. Requires `<Suspense fallback={null}>` in `page.tsx`. Last updated: JobsDB current-search fix.

---

### JobFilters

File: `components/find-jobs/JobFilters.tsx`
Last updated: 2026-06-25

| Property        | Class / Value |
| --------------- | ------------- |
| Filter bar      | `flex items-center gap-3 p-4 border-b border-border` |
| Filter input    | `w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent` |
| Select dropdown | `appearance-none bg-surface border border-border rounded-md pl-3 pr-8 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer` |

**Pattern notes:**
Purely presentational — no state. Receives `filterText`, `matchFilter`, `sort`, `onFilterTextChange`, `onMatchFilterChange`, `onSortChange` as props from `FindJobsClient`. Exports `MatchFilter` and `Sort` types (re-used by `FindJobsClient`). Icons use `pointer-events-none` to pass clicks through to inputs.

---

### JobsTable

File: `components/find-jobs/JobsTable.tsx`
Last updated: 2026-07-01 (Feature 12 — stretched link navigation)

| Property        | Class / Value |
| --------------- | ------------- |
| Table header    | `text-xs font-medium text-text-secondary uppercase tracking-wide` (per `<th>`, `px-6 py-3`) |
| Table row       | `relative border-t border-border hover:bg-surface-secondary transition-colors` |
| Stretched link  | `text-sm font-semibold text-text-primary after:absolute after:inset-0 after:content-['']` |
| Company logo    | `w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0` |
| Match bar track | `w-24 h-1 bg-border-light rounded-full overflow-hidden` |
| Match bar fill  | inline `style={{ width: \`${score}%\`, backgroundColor: getMatchBarColor(score) }}` |

**Pattern notes:**
Purely presentational — receives `jobs: Job[]` (already-filtered page slice) and `hasNoHistory: boolean` from `FindJobsClient`. No state, no filtering logic. Two empty states: `hasNoHistory` true → "Run a search above to find your first jobs."; false (filters active, no matches) → "No jobs match your filters." Score cell: `job.match_score != null ? <MatchScoreBar /> : <span>—</span>` — unscored jobs show `—`, never `0%`. Provider column (`source_provider ?? "—"`) positioned after Match Score. Row navigation via **stretched link pattern**: `<tr>` gets `relative`, the company-name cell wraps text in `<Link>` with `after:absolute after:inset-0 after:content-['']` — the `::after` pseudo-element covers the entire row. This gives native browser link behavior (open-in-new-tab, keyboard navigation) without `useRouter` or `onClick`. `MatchScoreBar` is a module-level sub-component. `getMatchBarColor` and `formatRelativeDate` imported from `lib/utils.ts`. Bar fill uses inline `style` (not Tailwind) because color is dynamic. 6 columns total: Company, Role, Match Score, Salary Est., Provider, Date Found.

---

### JobsPagination

File: `components/find-jobs/JobsPagination.tsx`
Last updated: 2026-06-25

| Property           | Class / Value |
| ------------------ | ------------- |
| Pagination row     | `flex items-center justify-between px-6 py-3 border-t border-border` |
| Active page button | `w-8 h-8 text-sm rounded-md bg-accent text-accent-foreground` |
| Inactive page btn  | `w-8 h-8 text-sm rounded-md text-text-primary hover:bg-surface-secondary` |
| Disabled nav btn   | `text-text-muted cursor-not-allowed` |

**Pattern notes:**
Purely presentational — receives `page`, `totalPages`, `totalCount`, `startIdx`, `pageNumbers`, `pageSize`, `onPageChange` from `FindJobsClient`. `pageSize` is the single source of truth for the "Showing X to Y" upper bound — do not add a local `PAGE_SIZE` constant. Renders ellipsis-compressed page number buttons and Previous/Next. Page numbers use windowed logic (computed in `FindJobsClient`): always shows first, last, current ± 1 neighbour, ellipsis fills gaps — never shows a page list where the current page is absent. Last updated: Feature 11.

---

### JobInfo

File: `components/job-details/JobInfo.tsx`
Last updated: 2026-07-01 (Feature 12)

| Property         | Class / Value |
| ---------------- | ------------- |
| Header card      | `bg-surface border border-border rounded-2xl p-6 shadow-sm` |
| Logo placeholder | `w-10 h-10 bg-surface-tertiary border border-border rounded-lg flex items-center justify-center shrink-0` |
| Job title        | `text-xl font-semibold text-text-primary` |
| Company line     | `flex items-center gap-2 mt-1` |
| Match badge ≥70  | `bg-success-lightest text-success-dark text-xs font-medium px-2.5 py-1 rounded-full` |
| Match badge 50–69 | `bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` |
| Match badge <50  | `bg-surface-tertiary text-text-muted text-xs font-medium px-2.5 py-1 rounded-full` |
| View Job Post    | `inline-flex items-center gap-2 bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors shrink-0` |
| Info cards grid  | `grid grid-cols-4 gap-4` |
| Info card        | `bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3` |
| Info icon wrap   | `w-8 h-8 rounded-lg flex items-center justify-center shrink-0` |
| Info value       | `text-sm font-semibold text-text-primary` |
| Info label       | `text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5` |

**Pattern notes:**
Renders two blocks: the header card (logo + title + company + match badge + View Job Post button) and a 4-column info cards row (Salary, Location, Job Type, Date Found). Match badge only renders when `job.match_score != null`. View Job Post only renders when `job.source_url` is non-null. Info card icon bg tokens: salary `bg-success-lightest` / `text-success`, location `bg-info-lightest` / `text-info`, job type `bg-accent-muted` / `text-accent`, date `bg-info-lightest` / `text-info-medium`. `formatJobType` returns "—" for null — never invents "Full-time" for null. Info cards use `rounded-xl` (not `rounded-2xl`) — they are sub-cards inside the page layout. `formatRelativeDate` from `@/lib/utils`.

---

### MatchScore

File: `components/job-details/MatchScore.tsx`
Last updated: 2026-07-01 (Feature 12)

| Property             | Class / Value |
| -------------------- | ------------- |
| Matched skill badge  | `inline-flex items-center gap-1 bg-success-lightest text-success-dark text-xs font-medium px-2.5 py-1 rounded-full` |
| Gap skill badge      | `inline-flex items-center gap-1 bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` |
| Section header       | `text-xs font-medium text-text-secondary uppercase tracking-wide` |
| Subsection label     | `text-xs font-medium text-text-muted mb-2` |

**Pattern notes:**
Renders two cards: "AI Match Reasoning" (conditional on `job.match_reason` being non-null and non-empty) and "Required Skills vs Your Profile" (always rendered). AI card header uses `<Sparkles size={16} className="text-success" />`. Matched skills have `<Check size={11} strokeWidth={2.5} />` prefix; gap skills have `<X size={11} strokeWidth={2.5} />` prefix. "Gap skills" subsection gets `mt-4` only when both sections render. Both arrays null/empty → shows "No skill data available." instead of empty subsections.

---

### JobDescription

File: `components/job-details/JobDescription.tsx`
Last updated: 2026-07-01 (Feature 12)

| Property | Class / Value |
| -------- | ------------- |
| Card     | `bg-surface border border-border rounded-2xl p-6 shadow-sm` |
| Body     | `text-sm text-text-primary leading-relaxed whitespace-pre-line` |

**Pattern notes:**
`whitespace-pre-line` is required — JobsDB descriptions are raw `innerText` scrapes with `\n` line breaks. Null `about_role` shows "No description available." Header uses `<FileText size={16} className="text-text-secondary" />` + `text-base font-semibold text-text-primary`.

---

### CompanyResearch

File: `components/job-details/CompanyResearch.tsx`
Last updated: 2026-07-02 (Feature 13 — full client component)

| Property           | Class / Value |
| ------------------ | ------------- |
| Card               | `bg-surface border border-border rounded-2xl p-6 shadow-sm` |
| Header row         | `flex items-center justify-between mb-6` |
| Research button    | `inline-flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed` |
| Error banner       | `flex items-start gap-2 bg-error/10 border border-error/20 rounded-lg p-3 mb-4` |
| Tech stack badge   | `bg-info-light text-info-dark text-xs font-medium px-2.5 py-1 rounded-full` |
| Bullet dot (culture) | `text-text-muted shrink-0 mt-0.5` (·) |
| Bullet dot (edge)  | `text-success shrink-0 mt-0.5` (·) |
| Bullet dot (gaps)  | `text-warning shrink-0 mt-0.5` (·) |
| Section header     | `text-xs font-medium text-text-secondary uppercase tracking-wide mb-2` |
| Sources footer     | `pt-4 border-t border-border` |
| Source link        | `text-xs text-text-muted hover:text-text-secondary underline-offset-2 hover:underline transition-colors block truncate` |

**Pattern notes:**
Feature 13 upgrade: `"use client"` component. Props: `{ jobId: string; company: string | null; initialResearch: CompanyResearchDossier | null }`. State: `research` (init from `initialResearch`), `loading`, `error`. Four UI states: empty (Building2 icon + copy), loading (Loader2 spinner + "Researching…" text, shown when `loading && !research`), error (AlertCircle banner), success (dossier sections). Button shows `<RefreshCw />` + "Re-research" when dossier exists, `<Search />` + "Research Company" when not. Dossier sections: companyOverview (paragraph), techStack (badges), culture (dot bullets, `text-text-muted`), whyThisRole (paragraph), yourEdge (dot bullets, `text-success`), gapsToAddress (dot bullets, `text-warning`), smartQuestions (numbered list), interviewPrep (numbered list), sources + researchedAt (footer with `border-t`). Each section is guarded by a truthy/length check so empty arrays never render. Sources rendered as `<a target="_blank" rel="noopener noreferrer">` only when the string starts with `http://` or `https://`; plain `<li>` text otherwise. API call: `POST /api/agent/research { jobId }` → `{ success, data: { companyResearch } }`. On success, `setResearch()` updates immediately — no `router.refresh()`. Error shows from `body.error` or "Something went wrong." Last updated: 2026-07-02 (project-review fixes — clickable sources).

---

### JobActions

File: `components/job-details/JobActions.tsx`
Last updated: 2026-07-01 (Feature 12)

| Property       | Class / Value |
| -------------- | ------------- |
| Apply button   | `flex items-center justify-center w-full bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-3 hover:bg-accent-dark transition-colors` |
| Disabled state | `opacity-50 cursor-not-allowed` (added when both URLs null) |

**Pattern notes:**
Apply href = `externalApplyUrl ?? sourceUrl`. For JobsDB jobs, `externalApplyUrl` is the company's direct apply link (careers portal) scraped from the apply button on the detail page — not the listing URL. This matters: `source_url` is the JobsDB listing; `external_apply_url` is where the candidate actually submits their application. For future Adzuna jobs where `external_apply_url` may be null, falls back to `source_url`. Full-width `py-3` is one step taller than standard `py-2` buttons — reserved for final-action CTAs.

---

## Patterns

---

### Server Action with useTransition

First established: Feature 06 — Profile Save Logic
Files: `actions/profile.ts`, `components/profile/ProfileForm.tsx`
Last updated: 2026-06-22

**Client side (in any `"use client"` component):**
```tsx
const [isPending, startTransition] = useTransition()

function handleSave() {
  startTransition(async () => {
    const result = await myServerAction(payload)
    // update local feedback state from result
  })
}

<button disabled={isPending} onClick={handleSave}>
  {isPending ? "Saving..." : "Save"}
</button>
```

**Server Action (in `actions/*.ts`):**
```ts
"use server"
export async function myServerAction(payload: MyPayload) {
  const insforge = await createInsforgeServer()
  const { data: authData, error } = await insforge.auth.getCurrentUser()
  if (error || !authData.user) return { success: false, error: "Not authenticated" }
  // ... DB write
  revalidatePath("/target-path")
  return { success: true }
}
```

**Rules:**
- Server Actions live in `actions/` — never inline in a page or component
- Always auth-check at the top of every Server Action
- Email and other auth-owned fields come from the session, never from the payload
- Use a separate `useTransition` per logical operation (save ≠ upload)
- Return `{ success: boolean; error?: string }` — not thrown errors
- Call `revalidatePath()` before returning so the page reflects the write immediately

---

## Baseline — Established 2026-06-28

_Established via `/imprint audit` — full codebase scan across 18 components._

| Property | Correct class |
| --- | --- |
| Card background | `bg-surface` |
| Card border | `border border-border` |
| Card radius | `rounded-2xl` |
| Card padding | `p-6` |
| Card shadow (inline panel) | `shadow-sm` |
| Card shadow (standalone auth/empty-state) | `shadow-lg` |
| Button — primary | `bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors` |
| Button — secondary | `bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors` |
| Button — overlay (dark) | `bg-overlay text-on-accent text-sm font-medium rounded-md px-4 py-2 hover:bg-overlay-dark transition-colors` |
| Button — on-accent surface | `bg-surface text-text-primary text-sm font-medium rounded-md px-6 py-3 hover:bg-surface-secondary transition-colors` |
| Text input | `w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent` |
| Text input (icon-prefixed) | same as above but `pl-9` instead of `px-3` |
| Text input (disabled) | `bg-surface-secondary border border-border rounded-md px-3 py-2 text-sm text-text-muted cursor-not-allowed` |
| Select dropdown | `appearance-none bg-surface border border-border rounded-md pl-3 pr-8 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer` |
| Form label | `block text-sm font-medium text-text-dark mb-1.5` |
| Column / filter header label | `text-xs font-medium text-text-secondary uppercase tracking-wide` |
| Text — primary | `text-text-primary` |
| Text — secondary | `text-text-secondary` |
| Text — muted | `text-text-muted` |
| Text — on accent surface (primary) | `text-on-accent` |
| Text — on accent surface (secondary) | `text-on-accent-muted` |
| Tag pill (skill/category) | `bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full` |
| Missing-field pill | `bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` |
| Table row hover | `hover:bg-surface-secondary transition-colors` |
| Divider / separator | `border-border` |
| Nested sub-card (inside a card) | `border border-border rounded-xl p-4` (`rounded-xl`, not `rounded-2xl`) |
