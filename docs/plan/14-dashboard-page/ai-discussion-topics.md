# AI Discussion Topics — Feature 14: Dashboard Page — Full UI

---

## Group 1: Server Components vs Client Components

1. There are six new components in Feature 14. Three are Server Components; three are `"use client"` Client Components. What determines which is which — and why can't recharts work in a Server Component?
2. `ProfileBanner` returns `null` when `isComplete: true`. In a Server Component, this means the component renders nothing and sends no HTML to the client. What would happen if `ProfileBanner` were a Client Component instead — would returning `null` still work, or would the behavior differ?
3. `StatsBar` and `RecentActivity` are Server Components even though they render interactive-looking UI. What does it mean for a component to be "interactive-looking" without being interactive — and what would have to change to make them truly interactive?
4. The `page.tsx` file passes mock data arrays as props down to both Server and Client Components. Does a Server Component prop behave the same as a Client Component prop from the perspective of TypeScript? From the perspective of the browser?

## Group 2: The mock data boundary and the seam design

5. All mock data is defined at module level in `page.tsx` as constants. Why is "module level" the right place, rather than inside the `DashboardPage` function body? What is the practical difference in when these values are evaluated?
6. Feature 15 will wire real stat numbers. Feature 16 will wire real activity rows. Feature 17 will wire real chart arrays. In each case, only `page.tsx` changes. Walk through exactly which line in `page.tsx` changes for each feature, and which component files (if any) would need to open.
7. If `CompanyResearchChart` had defined its own mock data internally (no props), what would Feature 17 look like? What is the minimum change required to that file to accept real data? Is it a breaking change?
8. The chart data types are `{ day: string; count: number }[]` and `{ range: string; count: number }[]`. PostHog doesn't return data in this shape — it returns its own query result structure. Where in the codebase will the PostHog-to-chart-data transformation live when Feature 17 is built, and why should it NOT live inside the chart components?

## Group 3: `.maybeSingle()` and the auth + profile query chain

9. The dashboard page makes two async calls before rendering: `getCurrentUser()` then the profile query. These run sequentially (one `await` after another). Could they run in parallel? What would have to change, and why isn't it done here?
10. Walk through what `!!profileData?.is_complete` evaluates to in these three cases: (a) new user, no profile row ever saved; (b) user who saved profile with `is_complete = false`; (c) user with `is_complete = true`. Which case is the dangerous one if `.single()` were used instead of `.maybeSingle()`?
11. The profile query selects only `is_complete`, not the full profile. Why not select `*` to future-proof it in case the dashboard needs more profile fields later?
12. The auth check redirects to `/login` if `authData.user` is falsy. The error from `getCurrentUser()` is ignored (destructured away). What would happen if the InsForge auth service returned an error response rather than `{ data: { user: null } }`? Is the page safe?

## Group 4: The `linearGradient` and SVG rendering in recharts

13. The `<defs>` block with `<linearGradient>` is a standard SVG element placed inside a recharts JSX tree. How does recharts pass this through to the actual SVG DOM output — does it treat `<defs>` as a special case, or does it render children it doesn't recognize?
14. The gradient `id="jobsGradient"` must be unique within the SVG document. If the dashboard later adds a second area chart (e.g., a "Profile Views Over Time" chart), what breaks — a runtime error, a visual bug, or nothing visible? How would you fix it?
15. `dot={false}` suppresses the per-point dots on the area chart. If you removed this prop, recharts would render dots at each of the 7 data points. Try to predict: would the dots use the `stroke` color or the `fill` color of the Area? Why?
16. `type="monotone"` on the `<Area>` controls how recharts draws the line between data points. What would "linear" look like differently — and in what scenario would "monotone" give a misleading representation of the data?

## Group 5: Design system and token discipline

17. A new CSS custom property `--color-chart-axis` was added to `globals.css` specifically for this feature. The existing `ui-tokens.md` had no token for `#9CA3AF`. Walk through the reasoning: why add a new token rather than just using the hex value directly in the components?
18. The activity dot uses `style={{ outline: "1px solid var(--color-surface)" }}`. This is an inline style — which `code-standards.md` generally prohibits. What would need to be true for Tailwind to handle this instead, and why isn't it possible here?
19. The trend badge uses `rounded-sm` (4px radius), not `rounded-full` (pill). If you changed it to `rounded-full`, the TypeScript would still compile and the linter would still pass. What is the mechanism that would catch this as a violation — and what wouldn't catch it?
20. Chart fill colors use CSS variable strings: `fill="var(--color-info)"`. These are passed as string props to recharts SVG elements, not as Tailwind classes. If you switched from `--color-info` to `--color-brand-blue` (a hypothetical alias), what files would you need to update — and would TypeScript help you find them all?

## Group 6: AnalyticsCharts.tsx and layout ownership

21. The original plan had a single `AnalyticsCharts.tsx` that contained all three charts. It was retired because the layout requires charts to be placed independently across two grid rows. What specific line in `page.tsx` proves that a single wrapper couldn't work — trace the exact layout structure.
22. The `code-standards.md` rule is "one component per file." `StatsBar.tsx` contains both `StatCard` (unexported) and `StatsBar` (exported). Does this violate the rule? What distinguishes a "sub-component" from a "component" in this codebase's conventions?
23. `RecentActivity.tsx` uses `divide-y divide-border` for row separators instead of rendering `<hr>` elements or adding `border-b` to each row. What is the practical difference between these three approaches, and when would you choose one over the others?
24. The dashboard's outer container is `max-w-[1440px] mx-auto px-8 py-8`. This is repeated across multiple pages in the codebase. What would it take to extract this into a shared `PageContainer` component — and what are the reasons not to do that yet?
