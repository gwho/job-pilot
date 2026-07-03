# AI Discussion Topics — Feature 14 Architect Session

---

## Group 1: The profile query and `.maybeSingle()`

1. What is the behavioral difference between `.single()` and `.maybeSingle()` in InsForge? What exactly does each return when zero rows match the query? When would you choose one over the other?
2. A new user visits `/dashboard` for the first time. Walk through exactly what `!!profileData?.is_complete` evaluates to — trace each operator in order for the case where `profileData` is `null`.
3. The profile query selects only `"is_complete"` rather than `"*"`. What practical cost does over-fetching produce on a page visited on every login? What would you need to add to the `SELECT` list if the banner text needed to include the user's first name?
4. Could the profile query and the auth check run in parallel using `Promise.all()`? What prevents this in the current architecture — and what change would be required to enable it?
5. What is the difference between InsForge returning `{ data: null, error: null }` and `{ data: null, error: { message: "..." } }`? How does the dashboard page handle each case — correctly or not?

---

## Group 2: The mock data seam

6. Every mock array in Feature 14 is declared at module level in `page.tsx`. If `mockStats` were declared inside the `DashboardPage()` function body instead, what would happen on every HTTP request to `/dashboard`? For static data, does this matter?
7. `CompanyResearchChart` accepts `data: { day: string; count: number }[]`. This shape was not chosen arbitrarily — it mirrors what a PostHog time-bucketed event query returns after transformation. Why does designing the prop shape now (before PostHog is wired) save work in Feature 17?
8. If `CompanyResearchChart` defined its own mock data internally (no `data` prop), what is the minimum change required to that file to wire Feature 17's real data? How does this compare to the current design where the prop already exists?
9. The project has a rule: "Agent code in `agent/` never imports from `components/`." What does this imply about where the PostHog-to-chart-data transformation will live when Feature 17 is built? Will it be in a component, an API route, or somewhere else?
10. `StatsBar` has a `StatCardConfig` type. If Feature 15 needs to add a "trend direction" enum (up/down/flat) to the stat card display, how many files need to change — and which ones?

---

## Group 3: Server vs Client Components and `"use client"`

11. `"use client"` marks a file as a client bundle entry point. What does this mean for recharts and everything recharts imports? How does this affect bundle size compared to a Server Component that does the same visual rendering?
12. `StatsBar` imports `TrendingUp` from `lucide-react` inside a Server Component. Why doesn't this cause a build error — even though lucide-react renders SVG, which is usually associated with browsers?
13. `ProfileBanner` returns `null` when `isComplete: true`. In a Server Component, what does returning `null` mean at the HTML level — is there a wrapper element, an empty comment, or literally nothing?
14. If you added `"use client"` to `StatsBar.tsx` by mistake, what would change about how Next.js handles that file? What features would it lose? What features would it gain?
15. The three chart components are `"use client"` but they receive their data as props from a Server Component parent. Can a Server Component pass data as a prop to a Client Component child — and what types can it pass?

---

## Group 4: CSS custom properties and SVG

16. A recharts `<Bar fill="var(--color-info)">` renders as `<rect fill="var(--color-info)">` in the SVG DOM. When does the browser resolve `var(--color-info)` to an actual color — at style calculation, at layout, or at paint?
17. The project added `--color-chart-axis: #9ca3af` to `globals.css`. Why was a new token needed rather than using an existing Tailwind color class or a CSS utility? What Tailwind class is closest to `#9CA3AF` — and why can't you use it in a recharts SVG prop?
18. If you changed `--color-info` in `globals.css` from `#61A8FF` to `#3B82F6`, how many files would you need to update to reflect this change? Which ones?
19. `stopColor="var(--color-accent)"` inside `<linearGradient>` — does this follow the same CSS custom property resolution as `fill="var(--color-accent)"` on a `<rect>`? Or does it behave differently inside SVG `<defs>`?

---

## Group 5: Layout and component structure

20. The original plan had `AnalyticsCharts.tsx` as a single wrapper for all three charts. What specific constraint in the visual design makes this wrapper impossible without coupling it to `RecentActivity`? Draw the grid layout and identify the constraint.
21. `StatsBar.tsx` has one exported component (`StatsBar`) and one unexported sub-component (`StatCard`). `code-standards.md` has a one-component-per-file rule. Is this a violation — and what distinguishes a "component" from a "sub-component" in this context?
22. `page.tsx` uses `space-y-6` to space sections vertically and `grid grid-cols-2 gap-6` for the two-column rows. If the design called for the charts row to have more vertical padding above it than the activity row, where would that change be made — in `page.tsx` or inside a component?
23. The activity dot separator uses `style={{ outline: "1px solid var(--color-surface)" }}`. Why is this an inline style rather than a Tailwind class — and what would need to be true about Tailwind v4's utility classes for this to be expressible without a style attribute?
24. `RecentActivity.tsx` uses `divide-y divide-border` for row separators. What CSS does `divide-y` actually generate — which selector, which property? When would you choose `divide-y` over `border-b` on each child row?
