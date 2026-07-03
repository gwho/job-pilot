# Implementation Plan — Feature 14: Dashboard Page — Full UI

## Context

Feature 14 is the first Phase 5 feature. It builds the complete dashboard visual shell at `/dashboard`, replacing the `ComingSoonCard` placeholder. The page is a Server Component that makes one real DB query (profile banner via `.maybeSingle()`) while all analytics content ships with mock data. Three recharts chart components are built with data props shaped like Feature 17's real PostHog arrays — so Features 15–17 are data-swap passes, not rebuilds.

Before implementation, `context/build-plan.md` listed two stale stat card labels — "Cover Letters Generated" and "Resume Tailoring Activity" — that have no corresponding features in the project. The dashboard design image (`context/designs/dashboard.png`) was used as the source of truth and both were replaced: "Jobs This Week" and "Company Research Activity".

---

## Language agreed on

- **stat card** — label + number + either a trend badge or a subtitle. Two distinct visual variants handled by one `StatCard` sub-component via optional props.
- **trend badge** — `+X%` label with "vs last week" context string. Appears on Total Jobs Found and Avg. Match Rate only. Rectangular (`rounded-sm`), not pill.
- **mock data** — hardcoded static values passed from `page.tsx`. Replaced by Features 15–17 without restructuring components.
- **Recent Activity** — time-ordered list. Exactly two event types in JobPilot: job search completed and company researched.
- **incomplete profile banner** — conditional top-of-page warning when `profile.is_complete = false` or no profile row exists. Links to `/profile`.

---

## Decisions made

| Decision | Resolution |
|---|---|
| Profile banner | Real DB query — `.maybeSingle()`. No row = incomplete. |
| Recharts | Install now. Mock data arrays in Feature 14, real PostHog arrays in Feature 17. |
| Chart data shape | `{ day: string; count: number }[]` for Company Research + Jobs Found. `{ range: string; count: number }[]` for Match Score. |
| StatCard API | `{ label, value, trend?: { value, label }, subtitle? }` — one component handles both rendering variants. |
| Trend badges | Cards 1–2 only (Total Jobs Found +12%, Avg. Match Rate +3%). Cards 3–4 render plain subtitles. |
| Stat card 4 | "Jobs This Week" — replaces stale "Cover Letters Generated" from build-plan.md. |
| Chart 1 | "Company Research Activity" — replaces stale "Resume Tailoring Activity" from build-plan.md. |
| Activity dot colors | Job search → green (`success-light` ring / `success-alt` dot). Company research → blue (`info-light` ring / `info` dot). |
| `AnalyticsCharts.tsx` | Retired. The 2×2 layout requires independently placed chart components. Replaced by 3 separate files per `code-standards.md` one-component-per-file rule. |
| PostHog | Feature 14 is PostHog-free. Chart data wiring deferred to Feature 17. |
| Chart axis color | New `--color-chart-axis: #9CA3AF` token added to `globals.css`. Used via `var(--color-chart-axis)` in all axis tick fills. |

---

## Assumptions

- `recharts` is not yet installed — `npm install recharts` is step 1.
- Recharts SVG elements accept `var(--color-accent)` as stroke/fill string values — works in all modern browsers since SVG attributes resolve CSS custom properties.
- The `<AreaChart>` gradient uses recharts `<defs><linearGradient>` with `stopColor="var(--color-accent)"` and opacity falloff.
- Dashboard page max-width and padding match `ui-rules.md`: `max-w-[1440px] mx-auto px-8 py-8`.

---

## How to build it

### Step 1 — Dependency and docs

- `npm install recharts`
- Add `recharts` to approved dependency list in `context/code-standards.md`
- Add a recharts section to `context/library-docs.md`: `ResponsiveContainer` pattern, CSS variable colors only, mock-to-real data swap shape

### Step 2 — `components/dashboard/ProfileBanner.tsx`

- Server Component, no `"use client"`
- Props: `{ isComplete: boolean }`
- Renders nothing when `isComplete: true`
- When incomplete: `bg-surface border border-border rounded-2xl p-4 shadow-sm` card, `AlertCircle` in `text-warning`, message, `<Link href="/profile">` styled as primary button

### Step 3 — `components/dashboard/StatsBar.tsx`

- Server Component
- Module-level unexported `StatCard` sub-component — `{ label, value, trend?, subtitle? }`
- Props: `{ stats: StatCardConfig[] }` — 4 configs from `page.tsx`
- Layout: `grid grid-cols-4 gap-6`
- Trend badge: `bg-success-lightest text-success-darker text-xs font-medium px-2 py-0.5 rounded-sm` — note `rounded-sm` (4px), not pill
- Stat number: `text-[30px] font-semibold leading-9 text-text-primary`

### Step 4 — `components/dashboard/RecentActivity.tsx`

- Server Component
- Props: `{ items: ActivityItem[] }` where `ActivityItem = { type: 'search' | 'research'; label: string; timeAgo: string }`
- Module-level unexported `ActivityRow` sub-component handles dot + label + timestamp
- Dot: 16px outer ring, 8px inner dot, `1px var(--color-surface)` border — green tokens for search, blue tokens for research

### Step 5 — `components/dashboard/CompanyResearchChart.tsx`

- `"use client"`, recharts
- Props: `{ data: { day: string; count: number }[] }`
- `<BarChart>` inside `<ResponsiveContainer width="100%" height={240}>`
- Bar fill: `var(--color-info)` — bar size 24, radius `[4,4,0,0]`
- Grid lines: `strokeDasharray="3 3"` color `var(--color-border)`
- Axis tick fill: `var(--color-chart-axis)` 12px

### Step 6 — `components/dashboard/JobsFoundChart.tsx`

- `"use client"`, recharts
- Props: `{ data: { day: string; count: number }[] }`
- `<AreaChart>` with gradient fill using recharts `<defs><linearGradient>` — `stopColor="var(--color-accent)"` opacity 0.2 → 0
- `<Area>` stroke: `var(--color-accent)`, strokeWidth 3, fill referencing the gradient id, `dot={false}`, `type="monotone"`

### Step 7 — `components/dashboard/MatchScoreChart.tsx`

- `"use client"`, recharts
- Props: `{ data: { range: string; count: number }[] }`
- `<BarChart>`, 5 bars: "50-60%", "60-70%", "70-80%", "80-90%", "90-100%"
- Bar fill: `var(--color-success)` — bar size 36

### Step 8 — `app/dashboard/page.tsx` full rewrite

- Server Component: auth check → `redirect('/login')` if no user → `.maybeSingle()` profile query
- All mock data arrays and stat configs defined at module level and passed down as props
- Layout:

```tsx
<Navbar />
<main className="bg-background min-h-[calc(100vh-4rem)]">
  <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
    <ProfileBanner isComplete={isComplete} />
    <StatsBar stats={mockStats} />
    <div className="grid grid-cols-2 gap-6 items-start">
      <RecentActivity items={mockActivity} />
      <CompanyResearchChart data={mockCompanyResearchData} />
    </div>
    <div className="grid grid-cols-2 gap-6 items-start">
      <JobsFoundChart data={mockJobsFoundData} />
      <MatchScoreChart data={mockMatchScoreData} />
    </div>
  </div>
</main>
```

### Step 9 — Context file updates

- `context/progress-tracker.md` — mark Feature 14 complete
- `context/ui-registry.md` — add entries for all 6 new components
- `context/code-standards.md` — add recharts to approved dependency list
- `context/library-docs.md` — add recharts section
- `context/architecture.md` — note `AnalyticsCharts.tsx` replaced by 3 separate chart files

### Step 10 — Feature documentation

- `docs/plan/14-dashboard-page/plan.md`, `explanation.md`, `ai-discussion-topics.md`
- `docs/architect/14-dashboard-page/` — this session captured as architect docs
