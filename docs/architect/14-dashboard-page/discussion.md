# Architect Discussion — Feature 14: Dashboard Page — Full UI

Deep teaching record of every concept explored in this session.

---

## 1. Why `.maybeSingle()` exists — and why it matters more than it looks

InsForge's database client exposes two methods for queries expected to return at most one row: `.single()` and `.maybeSingle()`. The difference is one line in the implementation but a completely different semantic contract.

`.single()` asserts that the query will find exactly one row. If it finds zero, it returns an error. This is the right method when you know a row must exist — for example, querying a user's session when you've already verified they are authenticated.

`.maybeSingle()` expects the query to find zero or one row, and treats zero as a valid, non-error outcome. This is the right method when a row's existence is conditional — when "no row" means something useful rather than something wrong.

For the profile banner query, a new authenticated user is the exact case where zero rows is meaningful: it means "this user has never saved their profile." That is not an error. It is the state we want to detect so we can show the banner.

The coercion pattern `!!profileData?.is_complete` collapses three states into one boolean:
- `profileData === null` (no row, new user) → `false`
- `profileData = { is_complete: false }` → `false`
- `profileData = { is_complete: true }` → `true`

This is a deliberate design choice: from the banner's perspective, "no profile row" and "profile exists but is incomplete" are identical — both should show the banner.

---

## 2. The seam pattern — designing the interface before the data source exists

The dashboard's mock data boundary is an example of what Michael Feathers (in "Working Effectively with Legacy Code") calls a "seam" — a place where you can alter behavior without editing the code at that place.

The core insight: if every component received its data as a prop from `page.tsx`, then `page.tsx` is the only file that ever needs to change when the data source changes. Features 15, 16, and 17 can wire real database queries, activity feeds, and PostHog charts without touching a single component file.

This is only possible because the prop types were designed to match the shape of future real data:
- `{ day: string; count: number }[]` is not arbitrary — it mirrors what a PostHog time-bucketed event query returns after transformation.
- `{ range: string; count: number }[]` mirrors what a histogram of match scores looks like when bucketed from a database query.

The component files don't know they're receiving mock data. They just render whatever they receive. This makes the mock-to-real transition invisible from the component's perspective.

The alternative — components fetching their own data — removes the seam. Feature 17 would then require opening every chart component, adding a PostHog client import, writing the query, removing the internal mock, and testing the new behavior. That's five files touched instead of one.

---

## 3. Why the `AnalyticsCharts.tsx` wrapper fails — layout ownership

The original build plan envisioned a single `AnalyticsCharts.tsx` that would contain all three charts. This pattern is common — grouping related components into a single wrapper file. It fails here because of the visual design.

The dashboard design places `RecentActivity` and `CompanyResearchChart` as siblings in the same grid row. A single `AnalyticsCharts.tsx` could occupy the right column of that row, but then `JobsFoundChart` and `MatchScoreChart` would both be inside it — which means `AnalyticsCharts.tsx` would own a two-row layout internally.

Two-row layout inside a component creates a specific problem: column widths. The left column of row 2 is `RecentActivity`. The left column of row 3 is `JobsFoundChart`. For these to align with each other, they need to be in the same grid — which means they need to be siblings in the same DOM layer, not children of different parent components.

The resolution makes the architectural principle explicit: **layout belongs to the page, not to components**. `page.tsx` owns the two `grid-cols-2` rows. Each component is responsible only for rendering its own content.

This principle extends to every layout decision in the project. The `max-w-[1440px] mx-auto px-8 py-8` container is in `page.tsx`, not in a child component. If it were in a child, changing the container width would require editing that child component. In `page.tsx`, it is one line.

---

## 4. SVG and CSS custom properties — why this integration works

Recharts renders its output as SVG. SVG uses attributes for visual styling — `fill="blue"`, `stroke="red"` — rather than CSS class names. This creates a question: how do you keep a charting library inside a CSS-variable-based design system?

The answer is a browser rendering detail: modern browsers resolve CSS custom properties in SVG presentation attribute values. When the browser encounters `<rect fill="var(--color-info)">`, it looks up `--color-info` in the CSS cascade for that element and substitutes the resolved value at paint time.

This is the same mechanism that makes `color: var(--color-text)` work in an HTML element. The difference is that `color` is a CSS property; `fill` is an SVG attribute. Both paths — CSS properties and SVG attributes — participate in the same CSS custom property resolution mechanism.

The implication: you can use CSS custom properties anywhere a browser parses CSS values, including in SVG attribute strings. `fill="var(--color-accent)"` and `fill: var(--color-accent)` are both valid and both resolve from the same `--color-accent` declaration on `:root`.

For recharts, this means:
- Bar fills use `var(--color-info)` or `var(--color-success)` — the same tokens as Tailwind class `bg-info` or `bg-success`
- Area stroke uses `var(--color-accent)` — the same token as `text-accent`
- Axis tick fills use `var(--color-chart-axis)` — a new token added specifically for this feature

If `--color-info` changes in `globals.css`, the bar charts update without touching any component file.

---

## 5. Why `#9CA3AF` needed a token — the chart axis color gap

Before Feature 14, the project's `@theme` block in `globals.css` had no CSS variable for the axis label color `#9CA3AF` (gray-400 in Tailwind's default palette). This color was common in chart designs for axis ticks — it is light enough to not compete with chart data, but dark enough to be readable.

Without a token, the only option was to hardcode `#9CA3AF` as a string in all three chart components. That would be three violations of the project's no-hardcoded-colors rule.

The solution: add `--color-chart-axis: #9ca3af` to the "Charts" section of `globals.css`. The cost is one line. The benefit is:
1. All three chart files use `var(--color-chart-axis)` — no hardcoded values.
2. The axis color can be changed for dark mode, theme adjustments, or accessibility reasons in one place.
3. Future chart components automatically have access to the token without discovering the raw hex value.

This is the recurring pattern: when you find yourself about to hardcode a value in two or more places, that value probably needs a name in the design token system.

---

## 6. The `linearGradient` in recharts — SVG defs and paint servers

The `JobsFoundChart` uses an area fill that fades from semi-transparent accent at the top to fully transparent at the bottom. In SVG, this requires a gradient — specifically a `<linearGradient>` element declared in `<defs>`.

`<defs>` is a standard SVG section for "reusable definitions" — gradients, patterns, clip paths, filters. Elements declared in `<defs>` don't render directly; they are referenced by other elements via `fill="url(#id)"` or `stroke="url(#id)"`.

Recharts passes unknown JSX children through to the SVG DOM. When `<defs>` appears as a child of `<AreaChart>`, recharts inserts it directly into the SVG output. This is intentional behavior — recharts supports SVG customization through child injection.

The `id="jobsGradient"` is scoped to the SVG element. Because there is only one area chart on the dashboard, there is no id collision risk. If a second area chart were added, both gradients would share the same id — a silent DOM bug where whichever definition appears later in the DOM wins for all references.

The `stopColor="var(--color-accent)"` follows the same SVG + CSS variable integration described in section 4. The `stopOpacity={0.2}` is a number prop — recharts camelCases `stop-opacity` to `stopOpacity` following React's SVG prop conventions.

---

## 7. Build-plan corrections — design image over stale text

During the architect session, `context/build-plan.md` was checked against `context/designs/dashboard.png`. Two stat card labels in the build-plan were stale:
- "Cover Letters Generated" — JobPilot has no cover letter feature
- "Resume Tailoring Activity" — no resume tailoring feature

Both were replaced using the design image as the source of truth:
- "Jobs This Week" — present in the design, corresponds to the `jobs` table records filtered to the current week
- "Company Research Activity" — present in the design, corresponds to company research runs in `agent_runs`

This established a principle for this session: **the design file and domain reality take precedence over stale context text files**. When a context file contradicts what the project actually does, update the context file — don't build to the stale spec.

The same principle applies to `context/architecture.md`'s planned `AnalyticsCharts.tsx`. The plan was stale (the design required independent chart placement). The architecture file was updated to reflect the actual implementation.
