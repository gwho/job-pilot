# Plan — Feature 14: Dashboard Page — Full UI

## What was built

- **`app/globals.css`** (modified) — Added `--color-chart-axis: #9CA3AF` as a new CSS custom property in the `@theme` block under a "Charts" heading. All recharts axis tick fills reference this token; no hardcoded hex in component code.

- **`components/dashboard/ProfileBanner.tsx`** (new) — Server Component. Props: `{ isComplete: boolean }`. Returns `null` when `isComplete: true`. When incomplete: `bg-surface border border-border rounded-2xl p-4 shadow-sm` card with `AlertCircle` icon in `text-warning`, a message, and a `<Link href="/profile">` styled as a primary button (`bg-accent text-accent-foreground`).

- **`components/dashboard/StatsBar.tsx`** (new) — Server Component. Exports `StatCardConfig` type and `StatsBar` component. Module-level unexported `StatCard` sub-component handles both rendering variants (trend badge or subtitle) via optional props. Grid of 4 cards: `grid grid-cols-4 gap-6`. Stat number: `text-[30px] font-semibold leading-9 text-text-primary`. Trend badge: `bg-success-lightest text-success-darker text-xs font-medium px-2 py-0.5 rounded-sm` (4px radius, not pill). Trend badge includes `<TrendingUp size={11} />` icon from lucide-react.

- **`components/dashboard/RecentActivity.tsx`** (new) — Server Component. Exports `ActivityItem` type and `RecentActivity` component. Module-level unexported `ActivityRow` sub-component. Two `type` values: `"search"` and `"research"`. Activity dot pattern: 16px outer ring + 8px inner dot + `style={{ outline: "1px solid var(--color-surface)" }}` separator. Search items use green tokens (`bg-success-light` / `bg-success-alt`); research items use blue tokens (`bg-info-light` / `bg-info`). Row separator via `divide-y divide-border`.

- **`components/dashboard/CompanyResearchChart.tsx`** (new) — `"use client"` recharts BarChart. Props: `{ data: { day: string; count: number }[] }`. Fill `var(--color-info)`, barSize 24, bar radius `[4,4,0,0]`, CartesianGrid stroke `var(--color-border)`, axis fill `var(--color-chart-axis)`.

- **`components/dashboard/JobsFoundChart.tsx`** (new) — `"use client"` recharts AreaChart. Props: `{ data: { day: string; count: number }[] }`. Uses `<defs><linearGradient id="jobsGradient">` with `stopColor="var(--color-accent)"` opacity 0.2→0. Area stroke `var(--color-accent)` strokeWidth 3, `dot={false}`, `type="monotone"`.

- **`components/dashboard/MatchScoreChart.tsx`** (new) — `"use client"` recharts BarChart. Props: `{ data: { range: string; count: number }[] }`. Fill `var(--color-success)`, barSize 36.

- **`app/dashboard/page.tsx`** (full rewrite) — Server Component. Auth guard → `redirect('/login')`. Profile query: `insforge.database.from("profiles").select("is_complete").eq("id", userId).maybeSingle()`. `isComplete = !!profileData?.is_complete`. All mock data defined at module level as constants. Layout: Navbar + `bg-background min-h-[calc(100vh-4rem)]` main + `max-w-[1440px] mx-auto px-8 py-8 space-y-6` container.

- **`context/code-standards.md`** (modified) — Added `recharts` to the approved dependency list with Feature 14 / Feature 17 scope note.

- **`context/library-docs.md`** (modified) — Added full recharts section: `ResponsiveContainer` pattern, CSS variable color table, gradient fill pattern for AreaChart, data prop shapes (`DayCount`, `RangeCount`), mock-to-real boundary.

- **`context/architecture.md`** (modified) — Noted `AnalyticsCharts.tsx` retired, replaced by 3 separate chart component files.

- **`context/progress-tracker.md`** (modified) — Feature 14 marked complete. Next: Feature 15.

- **`context/ui-registry.md`** (modified) — 6 new component entries added: ProfileBanner, StatsBar/StatCard, RecentActivity/ActivityRow, CompanyResearchChart, JobsFoundChart, MatchScoreChart.

## Decisions made

| Decision | Resolution |
|---|---|
| Profile banner | Real DB query — `.maybeSingle()`. No profile row = incomplete. |
| Recharts | Installed in Feature 14. Mock data arrays in 14; real PostHog arrays in 17. |
| Chart data shape | `{ day: string; count: number }[]` for two time-series charts; `{ range: string; count: number }[]` for match score histogram. |
| Mock data location | All arrays and stat configs defined at module level in `page.tsx`, passed as props. Never inside child components. |
| StatCard API | `{ label, value, trend?: { value, label }, subtitle? }` — one component handles both rendering variants. |
| Trend badges | Cards 1–2 only (Total Jobs Found, Avg. Match Rate). Cards 3–4 render plain subtitles. |
| Stat card 4 | "Jobs This Week" — replaces stale "Cover Letters Generated" from build-plan.md. |
| Chart 1 | "Company Research Activity" — replaces stale "Resume Tailoring Activity" from build-plan.md. |
| Activity dot separator | `style={{ outline: "1px solid var(--color-surface)" }}` — inline style justified because Tailwind has no utility for `outline-color` on a dynamic ring; value uses design system token. |
| `AnalyticsCharts.tsx` | Retired. The 2×2 layout requires independently placed chart components; a single wrapper cannot span rows without owning layout. Replaced by 3 separate files per `code-standards.md` one-component-per-file rule. |
| PostHog | Feature 14 is PostHog-free. Chart data wiring deferred to Feature 17. |
| Chart axis color | New `--color-chart-axis: #9CA3AF` token added to `globals.css`. Used via `var(--color-chart-axis)` in all axis tick fills. |

## Key invariants

- `page.tsx` is the single owner of all mock data in Feature 14. Components receive data only as props — they never define their own arrays.
- `maybeSingle()` is mandatory for the profile query. A new user with no profile row must see the banner, not crash the page.
- The three chart components accept props shaped like Feature 17's real PostHog arrays. Swapping real data in Feature 17 requires only changing what `page.tsx` passes — no component files change.
- Recharts SVG props accept CSS custom property strings (`"var(--color-accent)"`) because modern browsers resolve CSS custom properties in SVG attribute values. Never pass hex values to recharts fill/stroke/tick props.
- `AnalyticsCharts.tsx` is retired. Do not resurrect it. The 2×2 layout requires chart components to be independently placed in the page's grid.
- All three chart components are `"use client"` — recharts requires the browser DOM for its SVG rendering. Server Components cannot use recharts.
- The `linearGradient id="jobsGradient"` is unique on the dashboard (only one area chart). If a second area chart is ever added to the same page, the gradient `id` must be unique per chart or they will share the same gradient definition.
