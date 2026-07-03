# Explanation — Feature 14: Dashboard Page — Full UI

---

## 1. The mock data boundary — why everything lives in `page.tsx`

The most consequential structural decision in Feature 14 is where mock data lives.

Every piece of data rendered on the dashboard — stat numbers, activity rows, chart arrays — is defined at module level in `app/dashboard/page.tsx` and passed to child components as props. Not a single child component defines its own data.

This is not an accident. It is the seam design for Features 15–17.

Feature 15 will wire real stat numbers from the database. Feature 16 will wire real activity rows from `agent_runs`. Feature 17 will wire real chart arrays from PostHog. In every case, the implementation pattern is the same: change what `page.tsx` passes as props. The component files themselves — `StatsBar.tsx`, `RecentActivity.tsx`, the three chart files — never need to be opened.

If mock data lived inside the components, every future feature would require opening, editing, and re-testing the component. More importantly, the component's props API would change (from no props to accepting props), which is a breaking change to the caller. Defining data props from the start, even when the values are mock, means the component API is stable.

This pattern is the same principle as the `SearchControls` → `FindJobsClient` seam in Feature 10 and 11: design the interface for what it will need to accept, even if today's data is fake.

---

## 2. The profile banner — why one real query in an otherwise-mock page

Feature 14 deliberately ships with mock data for almost everything. The one exception is the profile banner, which makes a real database query to `profiles.is_complete`.

The reason: the banner is not informational UI — it is a call to action with a binary outcome. Showing it to users who have already completed their profile would be misleading and annoying. Hiding it from users who genuinely haven't would remove a useful prompt. Neither is acceptable for a feature the user will see on every dashboard visit.

The stats, charts, and activity list are decorative in Feature 14. A user doesn't act on "284 jobs found (mock)". But they might click "Complete Profile" — and they should only see that button when it applies to them.

The profile query uses `.maybeSingle()` rather than `.single()`. The difference is what happens when no row exists:
- `.single()` returns an error when there are no rows. A new user who has never saved a profile has no `profiles` row, so `.single()` would throw, and the page would crash.
- `.maybeSingle()` returns `{ data: null, error: null }` when there are no rows. It treats "no row" as a valid outcome, not an error.

The code handles this with:
```typescript
const isComplete = !!profileData?.is_complete;
```

The `?.` operator short-circuits when `profileData` is `null` (new user, no row). `!!null?.is_complete` evaluates to `false`. The banner appears. Correct behaviour for a new user.

---

## 3. Why `AnalyticsCharts.tsx` was retired

The original `context/architecture.md` planned a single `AnalyticsCharts.tsx` component to contain all three charts. This was retired during the architect session before any code was written.

The reason is the visual layout in `dashboard.png`. The design places charts in two separate rows:

```
Row 2: [RecentActivity]      [CompanyResearchChart]
Row 3: [JobsFoundChart]      [MatchScoreChart]
```

`RecentActivity` occupies the left column of Row 2. `CompanyResearchChart` occupies the right column of the same row. These two components are siblings in a `grid grid-cols-2` layout.

A single `AnalyticsCharts.tsx` component that contained all three charts could not be placed in the right column of Row 2 while also occupying both columns of Row 3 — not without owning layout. If `AnalyticsCharts.tsx` owned the two-row layout internally, it would need to know about `RecentActivity`, which lives outside it, to match column widths. That creates coupling between components that should be independent.

The resolution was to retire `AnalyticsCharts.tsx` and create three separate files, one chart per file. This follows the `code-standards.md` one-component-per-file rule and gives `page.tsx` full control over where each chart is placed. The layout belongs to the page, not to any child component.

---

## 4. How CSS custom properties work inside recharts SVG

Recharts renders its output as SVG elements. SVG uses attributes like `fill="..."` and `stroke="..."` for colors — not CSS class names. This creates a challenge for the design system: how do you use `var(--color-accent)` in a SVG attribute?

The answer: modern browsers resolve CSS custom properties in SVG attribute values. When recharts renders `<path fill="var(--color-accent)">`, the browser's SVG renderer looks up `--color-accent` in the CSS cascade and substitutes the resolved value. This works in all current browsers.

So in every recharts component in this codebase, color props use CSS variable strings:

```typescript
<Bar fill="var(--color-info)" />
<Area stroke="var(--color-accent)" />
<CartesianGrid stroke="var(--color-border)" />
<XAxis tick={{ fill: "var(--color-chart-axis)" }} />
```

None of these pass hex values directly. If `--color-info` is later changed in `globals.css`, all charts update automatically.

The one exception that needed design: axis tick labels. Recharts axis `tick` props accept a React SVG props object (`{ fill, fontSize }`). The fill is set to `var(--color-chart-axis)`. This token was added to `globals.css` specifically during Feature 14 because `#9CA3AF` had no CSS variable alias in the project's `@theme` block — a gap that would have required hardcoding hex in component code.

---

## 5. The `linearGradient` inside recharts AreaChart

The `JobsFoundChart` uses an area fill that fades from a semi-transparent accent color at the top to fully transparent at the bottom. This is a common chart aesthetic. In recharts, it is implemented with a SVG `<linearGradient>` element defined inside `<defs>`.

The full pattern:

```typescript
<AreaChart data={data}>
  <defs>
    <linearGradient id="jobsGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.2} />
      <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
    </linearGradient>
  </defs>
  <Area
    fill="url(#jobsGradient)"
    stroke="var(--color-accent)"
    strokeWidth={3}
    dot={false}
    type="monotone"
    dataKey="count"
  />
</AreaChart>
```

Several things to understand here:

**`x1/y1/x2/y2` direction:** These define the gradient vector. `x1="0" y1="0" x2="0" y2="1"` means the gradient goes from top (`y=0`) to bottom (`y=1`) — a vertical fade. If you used `x1="0" y1="0" x2="1" y2="0"` it would fade left to right.

**`stopOpacity` as a prop, not an attribute:** In recharts' JSX, SVG attributes like `stop-opacity` become camelCase React props: `stopOpacity`. The value `{0.2}` is a number, not a string.

**`fill="url(#jobsGradient)"`:** This references the gradient by its `id`. The `id` must be unique within the SVG document. Since the dashboard has exactly one area chart, `"jobsGradient"` is safe. If a second area chart were added, their gradients would share this id, and both would use whichever gradient definition appears last in the DOM.

**`dot={false}`:** Recharts renders a dot at each data point by default. Setting `dot={false}` suppresses them. Without this, you'd see 7 purple circles on the line, which looks noisy on a weekly summary chart.

---

## 6. StatCard: one component, two rendering paths

`StatCard` is a module-level function (not exported) inside `StatsBar.tsx`. It handles two distinct visual designs with a single ternary:

```typescript
{trend ? (
  <div className="flex items-center gap-2">
    <span className="inline-flex items-center gap-1 bg-success-lightest text-success-darker text-xs font-medium px-2 py-0.5 rounded-sm">
      <TrendingUp size={11} />
      {trend.value}
    </span>
    <span className="text-xs text-text-muted">{trend.label}</span>
  </div>
) : (
  <p className="text-xs text-text-muted">{subtitle}</p>
)}
```

The `trend` prop is `{ value: string; label: string } | undefined`. When it is defined, the card renders the trend badge row. When it is undefined, the card falls through to the `subtitle` text.

This could have been two separate components (`StatCardWithTrend` and `StatCardWithSubtitle`). It was kept as one for two reasons:

1. The base card structure — container, label, value — is identical. Duplicating it would be a violation of DRY with no compensating benefit.
2. The prop API `{ trend?, subtitle? }` is self-documenting. A reader of `page.tsx` can see at a glance which cards have trend badges and which have subtitles without opening `StatsBar.tsx`.

The trend badge uses `rounded-sm` (4px border radius), not `rounded-full` (pill). This was a deliberate design decision: the design spec shows a rectangular badge, not a pill. `rounded-sm` matches the spec. `rounded-full` would be a design system violation even though both are valid Tailwind utilities.

---

## 7. `"use client"` only on chart components

Of the six new components built in Feature 14, only the three chart components are marked `"use client"`. `ProfileBanner`, `StatsBar`, and `RecentActivity` have no client directive.

This is important because of how Next.js 16 App Router handles Server vs Client Components. By default, all components are Server Components — they render on the server, their code never reaches the browser, and they can access server-only resources. `"use client"` is an explicit opt-in to browser rendering.

Recharts requires `"use client"` because it renders SVG by calling browser DOM APIs. There is no server-side SVG rendering path in recharts. If you try to use a recharts component without `"use client"`, Next.js will throw a build error.

`ProfileBanner`, `StatsBar`, and `RecentActivity` have no reason to be Client Components. They render static HTML from their props. Running them as Server Components means:
- Their code is not sent to the browser (smaller JS bundle)
- They can be cached and streamed by Next.js's server rendering
- They cannot accidentally use browser APIs like `window` or `document`

The practical layout of the component tree on the dashboard page:

```
DashboardPage (Server Component — page.tsx)
├── Navbar (Server Component)
├── ProfileBanner (Server Component)
├── StatsBar (Server Component)
│   └── StatCard × 4 (Server Component, module-level)
├── RecentActivity (Server Component)
│   └── ActivityRow × 5 (Server Component, module-level)
├── CompanyResearchChart (Client Component — "use client")
├── JobsFoundChart (Client Component — "use client")
└── MatchScoreChart (Client Component — "use client")
```

The page is mostly server-rendered. Only the three chart islands are client components.

---

## 8. The build-plan corrections — dashboard.png over stale text

`context/build-plan.md` listed two stat cards that didn't match the dashboard design:
- "Cover Letters Generated" — JobPilot has no cover letter feature
- "Resume Tailoring Activity" — no resume tailoring feature

These were replaced with "Jobs This Week" and "Company Research Activity" respectively, using `context/designs/dashboard.png` as the source of truth.

This is a recurring pattern in the project: context files can go stale. The correct hierarchy when context files disagree with each other or with the design is:

1. The design file (`designs/*.png`) — what the user approved
2. Domain reality — what features actually exist
3. Context text files (`build-plan.md`, `architecture.md`) — guidance, not spec

A context file that contradicts the design and domain reality is stale. Update it, don't follow it.

---

## 9. Why the activity dot uses an inline style

`RecentActivity.tsx` has one `style` prop:

```typescript
style={{ outline: "1px solid var(--color-surface)" }}
```

This sits on the outer ring div that wraps the activity dot. Its purpose is to create a visual gap between the colored outer ring and whatever background is behind it — on the white card, this renders as a thin white separator between the ring and the card background, giving the dot a "floating" appearance.

Inline styles are generally prohibited by `code-standards.md`. The rule is "all styling via Tailwind classes." There are established exceptions: the match score bar uses `style={{ backgroundColor }}` because its color is computed dynamically; the gradient background on BottomCTA uses an inline `style` because Tailwind cannot express arbitrary gradients cleanly.

This case is a Tailwind limitation. Tailwind has `outline-{width}` and `outline-{color}` utilities in v4, but using them together reliably (`outline-1 outline-surface`) requires that the outline color utility generates from the `@theme` token, which is not guaranteed. The inline style with `var(--color-surface)` is the safe, explicit path — it references the design system token correctly.

The value was `white` in the initial implementation and corrected to `var(--color-surface)` during the post-implementation project review. The behavioral difference is zero on a white card — both render as white. The systemic difference matters: if `--color-surface` ever changes (dark mode, theme change), `var(--color-surface)` updates automatically. The keyword `white` is hardcoded and would diverge.
