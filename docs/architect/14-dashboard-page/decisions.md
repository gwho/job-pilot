# Architect Decisions — Feature 14 Dashboard Page: Full UI

---

## Decision 1 — Profile banner uses a real DB query; everything else uses mock data

### What it is
The dashboard's profile banner is the only component in Feature 14 that reads real data from the database. All other content — stat cards, activity rows, chart data — ships with hardcoded mock values.

### How it works
`DashboardPage` queries `profiles.is_complete` using `.maybeSingle()` and passes the result as a boolean to `ProfileBanner`:

```typescript
const { data: profileData } = await insforge.database
  .from("profiles")
  .select("is_complete")
  .eq("id", authData.user.id)
  .maybeSingle();

const isComplete = !!profileData?.is_complete;
```

`ProfileBanner` renders a call-to-action card when `isComplete` is `false`, and returns `null` when `true`.

### Why the banner can't be mock
The banner is a call to action, not decorative UI. Showing it to users who have already completed their profile would confuse and annoy them. Hiding it from users who genuinely haven't would remove a real signal. The banner must reflect the user's actual state.

### Why everything else can be mock
Stat numbers, activity rows, and chart data are decorative in Feature 14. They illustrate the layout and demonstrate the visual design, but no user action depends on their accuracy. A user seeing "284 jobs found (mock)" cannot be harmed or misled in a way that matters before Features 15–17 wire the real data.

### What the alternative costs
Making the banner mock would require adding logic to show/hide it based on some arbitrary rule, or always showing it, or never showing it — all of which produce wrong behaviour for some users. Querying the database is cheap (one small row, one indexed lookup) and gives correct behaviour for all users.

---

## Decision 2 — `.maybeSingle()` for the profile query (not `.single()`)

### What it is
The profile query uses `.maybeSingle()` rather than `.single()` to handle the case where a new user has no profile row yet.

### How it works
`.single()` treats zero rows as an error: it returns `{ data: null, error: { message: "The result contains 0 rows" } }`. `.maybeSingle()` treats zero rows as a valid outcome: it returns `{ data: null, error: null }`.

The code handles both null-and-no-row and null-and-false uniformly:
```typescript
const isComplete = !!profileData?.is_complete;
```
`!!null?.is_complete` → `!!undefined` → `false`. A new user with no row sees the banner. Correct.

### Why not `.single()`
A user who has never saved their profile has no row in `profiles`. `.single()` would return an error for this case — the most common case for a new user. The page would need explicit error handling, or would crash, or would silently show incorrect UI.

### What the alternative costs
Using `.single()` and adding error handling (e.g., treating the error as "incomplete") would work but is unnecessarily defensive. `.maybeSingle()` expresses the correct intent directly: "there may or may not be a row here, and either is valid."

---

## Decision 3 — Recharts installed in Feature 14 with mock data; real PostHog data in Feature 17

### What it is
`recharts` is installed as a dependency and documented in `context/library-docs.md` during Feature 14, even though the chart data is entirely mock until Feature 17.

### How it works
Three chart components are built with `data` props shaped like the PostHog query results Feature 17 will produce:
- `{ day: string; count: number }[]` for time-series charts (Company Research Activity, Jobs Found)
- `{ range: string; count: number }[]` for the match score histogram

All mock arrays are defined in `page.tsx` and passed as props. Feature 17 replaces those arrays with real PostHog data — the component files never change.

### Why install recharts now
Installing recharts in Feature 14 forces the data shape decision to be made now, before real data sources exist. If recharts were deferred to Feature 17, the architect session for Feature 17 would need to design the prop API, the gradient pattern, and the CSS variable integration from scratch, against a deadline. Doing it now — when the dashboard UI is being built — lets the prop shapes be designed thoughtfully.

### What the alternative costs
Deferring recharts to Feature 17 would mean Feature 14 ships with static SVG placeholders that don't match the final chart appearance. The chart components would need to be built twice: once as placeholders and once as real charts. Building them once with mock data is less work.

---

## Decision 4 — `AnalyticsCharts.tsx` retired; three separate chart files instead

### What it is
The original `context/architecture.md` planned a single `AnalyticsCharts.tsx` component containing all three charts. This was retired during the architect session before any code was written.

### How it works
Three separate component files are created instead: `CompanyResearchChart.tsx`, `JobsFoundChart.tsx`, `MatchScoreChart.tsx`. Each is independently placed in `page.tsx`'s grid layout:

```tsx
<div className="grid grid-cols-2 gap-6 items-start">
  <RecentActivity items={mockActivity} />
  <CompanyResearchChart data={mockCompanyResearchData} />
</div>
<div className="grid grid-cols-2 gap-6 items-start">
  <JobsFoundChart data={mockJobsFoundData} />
  <MatchScoreChart data={mockMatchScoreData} />
</div>
```

### Why a single wrapper doesn't work
The design places `RecentActivity` in the left column of row 2 and `CompanyResearchChart` in the right column of the same row. A single `AnalyticsCharts.tsx` would need to occupy the right column of row 2 AND both columns of row 3 — which is impossible without owning the two-row layout internally. Owning the layout internally would require `AnalyticsCharts.tsx` to also know about `RecentActivity`, creating coupling between components that should be independent.

### What the alternative costs
Forcing `AnalyticsCharts.tsx` to own the multi-row layout would make it a "layout component" — a component whose job is positioning other components rather than rendering its own content. This is an anti-pattern: layout belongs to the page, not to leaf components. Three separate files let the page own layout and each chart own only its rendering.

---

## Decision 5 — All mock data defined at module level in `page.tsx`

### What it is
All mock arrays (`mockStats`, `mockActivity`, `mockCompanyResearchData`, `mockJobsFoundData`, `mockMatchScoreData`) are declared as constants at module level in `app/dashboard/page.tsx`, not inside the component function or inside child components.

### How it works
Module-level constants are evaluated once when the module is loaded, not on every render call. Child components receive data only as props — they never define their own arrays.

### Why module level and not inside the function
- **Module level vs. inside function**: Constants inside `DashboardPage()` are re-allocated on every HTTP request. Module-level constants are shared. For data that never changes between requests, this is the right location.
- **`page.tsx` vs. child components**: The seam is `page.tsx`. Features 15–17 change only `page.tsx` to swap mock data for real queries. If child components owned their own data, each feature would require opening and editing those component files.

### What the alternative costs
If `mockStats` were inside `StatsBar.tsx`, Feature 15 would require: opening `StatsBar.tsx`, adding a `stats` prop, removing the internal mock, and updating the call site in `page.tsx`. Two files touched, component API broken. With the current structure: Feature 15 changes only `page.tsx`.

---

## Decision 6 — CSS variable strings for all recharts colors

### What it is
Every color prop in all three chart components uses a CSS custom property string (`"var(--color-info)"`, `"var(--color-accent)"`, `"var(--color-chart-axis)"`) instead of a hex value.

### How it works
SVG presentation attributes in modern browsers resolve CSS custom properties at paint time. A recharts `<Bar fill="var(--color-info)">` renders as `<rect fill="var(--color-info)">` in the DOM; the browser substitutes `--color-info`'s computed value when painting.

### Why not hex values
The project's design rule is categorical: no hardcoded color values in component files. The reason: if a color changes in `globals.css`, all components that use the CSS variable update automatically. Components that hardcode hex must be found and updated individually.

For `#9CA3AF` (chart axis color), which had no existing CSS variable in `globals.css`, a new token `--color-chart-axis: #9CA3AF` was added to the `@theme` block. One line in `globals.css` is the cost of keeping all three chart files token-compliant.

### What the alternative costs
Hardcoding `#9CA3AF` in three chart files creates three sources of truth for the same value. A future color change requires three find-and-replace operations across component files. CSS variable references require one change in `globals.css` and zero component file edits.

---

## Decision 7 — `"use client"` only on chart components

### What it is
Of the six new components, only the three chart components are marked `"use client"`. `ProfileBanner`, `StatsBar`, and `RecentActivity` are Server Components.

### How it works
Server Components run only on the server. Client Components run in the browser (and also on the server during SSR). `"use client"` marks a file as a client bundle entry point.

Recharts uses browser DOM APIs (`ResizeObserver`, SVG rendering APIs) during chart rendering. These do not exist in Node.js. Without `"use client"`, Next.js would attempt to run recharts on the server and throw a build error.

`ProfileBanner`, `StatsBar`, and `RecentActivity` render static HTML from props. They have no browser API dependencies.

### Why minimal `"use client"` surface
Each `"use client"` file and everything it imports joins the JavaScript bundle sent to the browser. Unnecessary client components increase bundle size and prevent the use of server-only features. The minimum boundary keeps most of the dashboard server-rendered (faster initial paint, no JS needed for the content that doesn't interact).

### What the alternative costs
Making all six components `"use client"` would work but: (1) increases the browser JS bundle, (2) prevents future DB queries inside those components, and (3) creates loading states for content that could arrive pre-rendered. The three Server Components can be extended with server-only logic (direct DB access, server-side secrets) in future features. Client Components cannot.
