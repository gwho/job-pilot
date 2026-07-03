# Tutorial 27 — Dashboard Page: Server/Client Boundaries, the Mock Data Seam, and CSS Custom Properties in SVG

**After completing this tutorial you will understand:** why all mock data in Feature 14 lives in `page.tsx` and how that seam design makes Features 15–17 data-swap passes rather than rebuilds; how `.maybeSingle()` differs from `.single()` and why the profile banner is the one exception to the all-mock rule; how React's Server/Client Component boundary determines which components need `"use client"` and which don't; how CSS custom properties resolve inside SVG attributes so recharts charts stay inside the design token system; and how SVG `<defs><linearGradient>` works and what breaks if two area charts share the same gradient `id`.

---

> [!NOTE]
> **Prerequisites:** Tutorial 23 (`../23-job-details-page/README.md`) — covers the most recent full-UI Server Component page and the DB query + auth guard patterns reused here. Tutorial 02 (`../02-auth/README.md`) — covers the session cookie, `getCurrentUser()`, and the redirect guard that protects every authenticated page. Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx), [`components/dashboard/ProfileBanner.tsx`](../../../components/dashboard/ProfileBanner.tsx), [`components/dashboard/StatsBar.tsx`](../../../components/dashboard/StatsBar.tsx), [`components/dashboard/RecentActivity.tsx`](../../../components/dashboard/RecentActivity.tsx), [`components/dashboard/JobsFoundChart.tsx`](../../../components/dashboard/JobsFoundChart.tsx), and [`app/globals.css`](../../../app/globals.css) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Null-safe optional chaining | `!!profileData?.is_complete` | Type theory |
| CSS custom properties (cascade + SVG) | `var(--color-accent)` in recharts fill/stroke props | System design |
| SVG paint servers (gradient `<defs>`) | `<defs><linearGradient id="jobsGradient">` in JobsFoundChart | System design |
| Conditional rendering (single component, two paths) | `{trend ? <badge> : <subtitle>}` in StatCard | Design patterns |
| Seam / interface-before-implementation | Mock data in `page.tsx` shaped like future real PostHog arrays | System design |
| React Server/Client island boundary | `"use client"` on chart components only, Server on the rest | System design |

---

## How to use an LLM before this tutorial

Budget 25–30 minutes across these five concepts.

### Concept 1 — CSS custom properties and how the cascade resolves them

> "Explain how CSS custom properties (CSS variables) work. How do you declare one with `--my-color: red` and reference it with `var(--my-color)`? Where does the value live — the stylesheet, the DOM, somewhere else? What does 'the cascade resolves them' mean — can a child element override a custom property its parent declared? Give me a concrete example of a component that uses a custom property for its color, and show what happens when the property changes on the root element. Quiz me: if I write `color: var(--color-text)` in a CSS rule, and `--color-text` is defined in a `:root` block, what is the resolution chain?"

*What to listen for:* CSS custom properties are computed at runtime by the browser's style engine, not at stylesheet parse time. They live on DOM elements and cascade like any other inherited CSS property — child elements inherit them from parents unless they override them locally. The value of `var(--color-text)` is resolved per-element, which is why changing `--color-text` on `:root` updates every element that references it instantly. This is entirely different from Sass variables, which are expanded at compile time.

*Practice question:* `--color-accent` is declared in `:root` with value `#9B5CF6`. A recharts `<Bar fill="var(--color-accent)">` references it. If you change `--color-accent` in the browser DevTools, does the bar re-paint without a page reload?

---

### Concept 2 — React Server Components vs Client Components — where code runs

> "Explain the difference between React Server Components and Client Components. Where does each type execute — on the server, in the browser, or both? What can a Server Component do that a Client Component cannot (and vice versa)? What does the `'use client'` directive actually mark — the component, the file, or all files that import it? If a Server Component renders a Client Component as a child, does the child's 'use client' contaminate the parent? Quiz me: a file has no 'use client' directive and uses `useState`. Is that valid?"

*What to listen for:* Server Components run only on the server — their code is never sent to the browser. Client Components run in the browser (and also on the server during SSR/pre-rendering). The key distinction is what each can access: Server Components can `await` database calls, read file system, access server-only secrets. Client Components can use `useState`, `useEffect`, event handlers, and browser APIs. `'use client'` marks a boundary at the file level — the file and everything it imports becomes part of the client bundle. A Server Component can render a Client Component child; the inverse is where restrictions apply.

*Practice question:* `StatsBar.tsx` has no `'use client'` directive and no `useState`. `CompanyResearchChart.tsx` has `'use client'` and uses recharts. Can `DashboardPage` (Server Component) render both as children? Does the chart component's `'use client'` affect the Server Component parent?

---

### Concept 3 — The seam design: define the interface before the implementation

> "In software design, a 'seam' is a place where you can alter behavior without editing the code itself. Explain what a 'seam' is and give an example of using one to separate mock data from real data. Why is it a design advantage to define the interface (the props API) before the data source is ready? What breaks if you wire data directly inside a component rather than receiving it as a prop? Give a concrete example of a component that accepts a `data` prop vs. one that fetches its own data — what changes when you need to switch from mock to real data in each case? Quiz me."

*What to listen for:* A seam is a controlled substitution point. When `CompanyResearchChart` accepts `data: { day: string; count: number }[]` as a prop, `page.tsx` is the seam — it controls what data flows in. Today it passes a mock array; Feature 17 passes a PostHog-fetched array. The component never changes. If the component fetched its own data, switching from mock to real would require opening and editing the component file, changing the data fetching, and potentially the component's internal API. The seam makes future work additive, not surgical.

*Practice question:* `RecentActivity` accepts `items: ActivityItem[]`. Feature 16 will wire real `agent_runs` rows. Which file changes in Feature 16 — `RecentActivity.tsx` or `page.tsx`?

---

### Concept 4 — SVG attributes vs CSS properties: how SVG colors work

> "HTML elements are styled with CSS properties: `color`, `background-color`, `border`. SVG elements use XML attributes: `fill`, `stroke`. Explain the key difference. Are SVG presentation attributes part of the CSS cascade? If an SVG element has `fill='blue'` as an attribute AND a CSS rule `fill: red`, which wins? Can CSS custom properties (like `var(--my-color)`) be used in SVG attribute values? Show me a concrete example of a recharts bar with a CSS variable as its fill color and explain the resolution chain. Quiz me."

*What to listen for:* SVG presentation attributes (like `fill="blue"`) have very low CSS specificity — they are treated as if they were `fill: blue` in a `[fill]` attribute selector at specificity 0-0-0-1, below any authored CSS rule. However, CSS custom properties DO resolve in SVG attribute values when written as `fill="var(--color-accent)"`. The browser resolves `var(--color-accent)` during rendering, substituting the computed value of the custom property on that element. This is what makes `fill="var(--color-accent)"` work in recharts SVG output.

*Practice question:* A recharts `<Bar fill="var(--color-info)">` renders as `<rect fill="var(--color-info)">` in the DOM. The page has `--color-info: #61A8FF` in `:root`. What color does the browser actually paint the rectangle?

---

### Concept 5 — Null-safe access and boolean coercion in TypeScript

> "Explain TypeScript's optional chaining operator `?.`. How does `obj?.property` differ from `obj.property`? What does it return when `obj` is `null` or `undefined`? Now explain the double-negation operator `!!`. What does `!!someValue` produce for `null`, `undefined`, `false`, `0`, `''`, and truthy values? Put them together: what does `!!obj?.property` produce when `obj` is `null`? When `obj` is `{ property: false }`? When `obj` is `{ property: true }`? Quiz me on two more combinations."

*What to listen for:* `obj?.property` short-circuits to `undefined` when `obj` is `null` or `undefined` — it does not throw. `!!value` converts any value to a boolean by double-negating: `!!null === false`, `!!undefined === false`, `!!false === false`, `!!"" === false`, `!!0 === false`; any truthy value becomes `true`. Combined: `!!null?.is_complete` is `!!undefined` which is `false`. `!!{ is_complete: false }?.is_complete` is `!!false` which is `false`. `!!{ is_complete: true }?.is_complete` is `!!true` which is `true`. The pattern safely coerces nullable DB results to booleans.

*Practice question:* `profileData` is `{ is_complete: null }` (the column exists but is SQL NULL). What does `!!profileData?.is_complete` evaluate to?

---

## Architecture overview

```
                    Browser request: GET /dashboard
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Next.js App Router           │
              │  app/dashboard/page.tsx       │ SERVER
              │                               │
              │  1. createInsforgeServer()    │
              │  2. getCurrentUser()          │
              │     └─ no user → redirect    │
              │  3. profiles.maybeSingle()    │
              │     └─ is_complete → bool     │
              │  4. Render JSX tree           │
              └───────────┬───────────────────┘
                          │  HTML stream
                          ▼
     ┌────────────────────────────────────────────────────┐
     │  Server Components (rendered on server, no JS sent │
     │  to browser)                                       │
     │                                                    │
     │  ├─ ProfileBanner   (isComplete prop)              │
     │  ├─ StatsBar        (stats prop → 4 StatCards)    │
     │  └─ RecentActivity  (items prop → 5 ActivityRows) │
     └──────────────────┬─────────────────────────────────┘
                        │  + 3 "use client" islands
                        ▼
     ┌──────────────────────────────────────────────────────┐
     │  Client Components (hydrated in browser)             │
     │                                                      │
     │  ├─ CompanyResearchChart  (recharts BarChart)        │
     │  │    └─ SVG fill="var(--color-info)"               │
     │  ├─ JobsFoundChart        (recharts AreaChart)       │
     │  │    └─ linearGradient + SVG stroke="var(--color-  │
     │  │       accent)"                                    │
     │  └─ MatchScoreChart       (recharts BarChart)        │
     │       └─ SVG fill="var(--color-success)"            │
     └──────────────────────────────────────────────────────┘
              │  CSS cascade resolves var() in SVG attrs
              ▼
     Browser paints colored SVG charts
```

**Three invariants that govern this feature:**

1. `page.tsx` is the sole owner of all data. Components receive props; they never define their own arrays.
2. `.maybeSingle()` is mandatory for the profile query. A new user with no profile row must see the banner — not a crash.
3. Recharts SVG props always receive CSS variable strings (`"var(--color-accent)"`), never hex values. The token system must reach inside SVG.

---

## Part 1 — The seam design: why all mock data lives in `page.tsx`

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx) lines 12–89:

```typescript
const mockStats: StatCardConfig[] = [
  {
    label: "Total Jobs Found",
    value: "284",
    trend: { value: "+12%", label: "vs last week" },
  },
  {
    label: "Avg. Match Rate",
    value: "82%",
    trend: { value: "+3%", label: "vs last week" },
  },
  {
    label: "Companies Researched",
    value: "35",
    subtitle: "Total researched",
  },
  {
    label: "Jobs This Week",
    value: "28",
    subtitle: "New this week",
  },
];

const mockActivity: ActivityItem[] = [
  {
    type: "search",
    label: "Found 8 jobs for Frontend Engineer",
    timeAgo: "10 mins ago",
  },
  {
    type: "research",
    label: "Researched Stripe",
    timeAgo: "1 hour ago",
  },
  {
    type: "search",
    label: "Found 12 jobs for React Developer",
    timeAgo: "2 hours ago",
  },
  {
    type: "research",
    label: "Researched Vercel",
    timeAgo: "Yesterday",
  },
  {
    type: "search",
    label: "Found 10 jobs for Full Stack Engineer",
    timeAgo: "Yesterday",
  },
];

const mockCompanyResearchData = [
  { day: "Mon", count: 2 },
  { day: "Tue", count: 5 },
  { day: "Wed", count: 3 },
  { day: "Thu", count: 8 },
  { day: "Fri", count: 12 },
  { day: "Sat", count: 4 },
  { day: "Sun", count: 1 },
];

const mockJobsFoundData = [
  { day: "Mon", count: 15 },
  { day: "Tue", count: 32 },
  { day: "Wed", count: 28 },
  { day: "Thu", count: 48 },
  { day: "Fri", count: 85 },
  { day: "Sat", count: 52 },
  { day: "Sun", count: 18 },
];

const mockMatchScoreData = [
  { range: "50-60%", count: 5 },
  { range: "60-70%", count: 12 },
  { range: "70-80%", count: 44 },
  { range: "80-90%", count: 85 },
  { range: "90-100%", count: 32 },
];
```

Every data array on the dashboard is declared here — at module level in `page.tsx` — and passed to child components as props. Not a single child component defines its own data. This is the seam.

The reason is forward compatibility. Features 15, 16, and 17 will wire real data. Feature 15 replaces `mockStats` with a real InsForge query. Feature 16 replaces `mockActivity` with rows from `agent_runs`. Feature 17 replaces the three chart arrays with PostHog-fetched time-series data. In every case, only `page.tsx` changes. The component files (`StatsBar.tsx`, `RecentActivity.tsx`, `CompanyResearchChart.tsx`, etc.) never open.

If `CompanyResearchChart` defined its own mock data internally, Feature 17 would require opening that file, adding a `data` prop, updating the component's internal logic, and updating the caller. The component's interface would change — a breaking change. By defining the `data` prop from the start (even though today's value is mock), the component's interface is already the one Feature 17 needs.

"Module level" matters here. Constants declared at the module level are evaluated once when the module is loaded, not on every function call. If `mockStats` were declared inside `DashboardPage()`, it would be re-allocated on every render. At module level, it is shared across all invocations. For mock data that never changes, this is also the most efficient location.

> **System design — Seam / interface-before-implementation:** A seam is a place in a system where you can swap behavior without editing the code at that place. Here, `page.tsx` is the seam: it controls what data flows into components. By defining component props shaped like the future real data (e.g., `{ day: string; count: number }[]` mirrors a PostHog time-bucketed query result), the components are ready for real data before that data exists. This pattern — define the interface before the implementation — is how you avoid rewriting components when data sources change.

**Checkpoint:** Feature 17 will fetch real PostHog data for the charts. Where exactly in `page.tsx` does the data hand-off to components happen — and which specific lines will Feature 17 change while leaving the component files untouched?

<details>
<summary>Reveal answer</summary>

The hand-off happens in the JSX tree in `DashboardPage()`, where each component receives its data prop:

```typescript
<CompanyResearchChart data={mockCompanyResearchData} />
<JobsFoundChart data={mockJobsFoundData} />
<MatchScoreChart data={mockMatchScoreData} />
```

Feature 17 will:
1. Add PostHog queries inside `DashboardPage()` to fetch real time-series data.
2. Replace `mockCompanyResearchData`, `mockJobsFoundData`, and `mockMatchScoreData` with the transformed PostHog results.
3. Pass the real arrays as props to the same three components.

The component files never open because their props API (`data: { day: string; count: number }[]`) already matches the shape PostHog data will be transformed into. The seam absorbs the change entirely.
</details>

**Try it yourself:** Open `components/dashboard/CompanyResearchChart.tsx`. Find the `Props` type. Confirm the `data` prop type is `{ day: string; count: number }[]`. Now open `page.tsx` and find where `mockCompanyResearchData` is declared. Verify each element matches that shape. Now imagine Feature 17 — you'd replace `mockCompanyResearchData` with a PostHog API call result, transform it to the same shape, and pass it to `<CompanyResearchChart data={realData} />`. Nothing in `CompanyResearchChart.tsx` changes.

**Checkpoint:** `mockStats` is declared at module level (outside `DashboardPage`). If it were declared inside the function body, what would be the behavioral difference — and for mock data that never changes, does it matter?

<details>
<summary>Reveal answer</summary>

Module-level constants are evaluated once when the module is first imported. Inside the function body, a constant is re-allocated on every call to the function. For a Server Component, each HTTP request to `/dashboard` invokes `DashboardPage()`. If `mockStats` were inside the function, a new array would be created per request — identical content, new allocation.

For mock data that never changes, the behavioral difference is zero. The user sees the same numbers either way. The distinction is performance: module-level avoids repeated allocation. For real dynamic data (data that changes per request based on DB queries), it must live inside the function — because the result depends on the authenticated user. That is why `isComplete` (derived from a DB query) is inside the function while the mock arrays are outside.
</details>

---

## Part 2 — The one real query: `.maybeSingle()` and the banner guard

Open [`app/dashboard/page.tsx`](../../../app/dashboard/page.tsx) lines 91–105:

```typescript
export default async function DashboardPage() {
  const insforge = await createInsforgeServer();
  const { data: authData } = await insforge.auth.getCurrentUser();

  if (!authData.user) {
    redirect("/login");
  }

  const { data: profileData } = await insforge.database
    .from("profiles")
    .select("is_complete")
    .eq("id", authData.user.id)
    .maybeSingle();

  const isComplete = !!profileData?.is_complete;
```

Feature 14 ships with mock data everywhere except one place: the profile banner. The banner exists to tell incomplete users to finish their profile. Showing it to users who have already completed their profile — even in a mock context — would be wrong. Hiding it from users who genuinely haven't would remove a real call to action. The banner cannot be mock.

The profile query uses `.maybeSingle()` rather than `.single()`. The difference is what happens when the database returns no rows:

- `.single()` treats zero rows as an error. It returns `{ data: null, error: { message: "The result contains 0 rows" } }`. A new user who has never saved a profile has no `profiles` row. `.single()` would return an error, and the page would need to handle it or crash.
- `.maybeSingle()` treats zero rows as a valid outcome. It returns `{ data: null, error: null }`. This is the correct semantic for "a row that might not exist yet."

The coercion to boolean:

```typescript
const isComplete = !!profileData?.is_complete;
```

Work through the three cases that matter:

| `profileData` | `profileData?.is_complete` | `!!...` | `isComplete` | Banner shows? |
|---|---|---|---|---|
| `null` (new user, no row) | `undefined` | `false` | `false` | Yes ✅ |
| `{ is_complete: false }` | `false` | `false` | `false` | Yes ✅ |
| `{ is_complete: true }` | `true` | `true` | `true` | No ✅ |

The banner is correct in all three cases without a single explicit null check in the component.

> **Type theory — Null-safe optional chaining:** The `?.` operator is TypeScript's safe navigation operator. `obj?.property` evaluates to `undefined` if `obj` is `null` or `undefined`, rather than throwing `TypeError: Cannot read properties of null`. Combined with `!!`, it implements a pattern common in nullable-DB-value handling: "treat null and false identically as 'not set.'" This is the TypeScript equivalent of the null object pattern — using a falsy sentinel value (`false` or `undefined`) rather than checking null explicitly.

**Checkpoint:** The two awaited calls (`getCurrentUser()` and the profile query) run sequentially. Could they run in parallel with `Promise.all()`? What would have to change, and why isn't it done here?

<details>
<summary>Reveal answer</summary>

They cannot run in parallel as written, because the profile query depends on `authData.user.id` — a value that only exists after `getCurrentUser()` resolves. You cannot start the profile query until you know who the user is.

If you restructured to run them in parallel, you would need to know the user ID before the request arrives — for example, if the middleware extracted the user ID from the session cookie and made it available as a route parameter or header. In the current architecture, `createInsforgeServer()` reads the session cookie and delegates user identification to InsForge. The profile query cannot start until that identification completes.

The sequential structure also allows the `redirect('/login')` guard between the two calls. If they ran in parallel and the user was unauthenticated, the profile query would fire without a valid `user.id`, producing an error or returning no data.
</details>

**Checkpoint:** The query selects only `"is_complete"` rather than `"*"`. Why not select all columns to future-proof the dashboard for when it might need more profile data?

<details>
<summary>Reveal answer</summary>

Selecting only the columns you need is a DB best practice for two reasons. First, bandwidth: `profiles` contains large text fields (work experience, education, skills, goals). Fetching all of them on every dashboard load transfers kilobytes of data the page doesn't display. Second, clarity: a query that selects `"is_complete"` makes the intent visible — any future reader can see exactly what data the dashboard banner needs without reading the component.

If the dashboard later needs more profile fields, the query is a one-field change (add `"name"` or similar). The cost of that change is lower than the ongoing cost of over-fetching large text fields on every authenticated page visit.
</details>

Now open [`components/dashboard/ProfileBanner.tsx`](../../../components/dashboard/ProfileBanner.tsx):

```typescript
export function ProfileBanner({ isComplete }: Props) {
  if (isComplete) return null;

  return (
    <div className="flex items-center justify-between gap-4 bg-surface border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertCircle size={18} className="text-warning flex-shrink-0" />
        <p className="text-sm font-medium text-text-primary">
          Your profile is incomplete. Complete your profile to unlock better job matches.
        </p>
      </div>
      <Link
        href="/profile"
        className="shrink-0 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors"
      >
        Complete Profile
      </Link>
    </div>
  );
}
```

The component is a Server Component with no data fetching of its own. It receives one boolean and produces either null or a card. The real DB query lives in `page.tsx` where it belongs — the component owns only presentation.

`return null` from a Server Component sends no HTML for this subtree. No wrapper div, no empty space, no hidden element. The banner is literally absent from the response, not hidden by CSS.

**Try it yourself:** Run the dev server (`npm run dev`). Log in as a user whose `profiles.is_complete` is `false` (a new account). Navigate to `/dashboard`. Confirm the banner appears. Then update the profile to completion and navigate back — confirm the banner is gone. The only change between the two renders is one boolean crossing the Server Component boundary.

---

## Part 3 — `"use client"` only where the DOM requires it

Compare the first lines of these two files.

[`components/dashboard/StatsBar.tsx`](../../../components/dashboard/StatsBar.tsx) — no directive:

```typescript
import { TrendingUp } from "lucide-react";

export type StatCardConfig = {
  label: string;
  value: string;
  trend?: { value: string; label: string };
  subtitle?: string;
};
```

[`components/dashboard/CompanyResearchChart.tsx`](../../../components/dashboard/CompanyResearchChart.tsx) — with directive:

```typescript
"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
```

Of the six new components built in Feature 14, exactly three have `"use client"`: the three chart components. `ProfileBanner`, `StatsBar`, and `RecentActivity` have no directive. This is not an oversight — it is the minimum viable boundary.

Recharts requires `"use client"` because it renders SVG by calling browser DOM APIs during its lifecycle. There is no server-side SVG rendering path in recharts. If you removed `"use client"` from `CompanyResearchChart.tsx` and tried to build, Next.js would throw a build error: recharts imports browser globals that do not exist in the Node.js environment.

`StatsBar`, `ProfileBanner`, and `RecentActivity` have no such requirement. They render static HTML from props — no event handlers, no `useState`, no `useEffect`, no browser API calls. Running them as Server Components means their code is never sent to the browser (smaller JS bundle) and they can be cached and streamed by Next.js's server rendering pipeline.

> **System design — React Server/Client island boundary:** The Server/Client boundary in Next.js App Router is file-level, not component-level. `"use client"` marks a file as the entry point to the client bundle — everything that file imports also becomes client code. The pattern here is "island architecture": the page is mostly server-rendered HTML, with three isolated client-side interactive islands (the charts). Each island is a self-contained `"use client"` file. The rest of the page never enters the browser's JS engine.

**Checkpoint:** `StatsBar.tsx` renders `<TrendingUp size={11} />` from lucide-react inside a Server Component. Does importing lucide-react in a Server Component cause a build error — and why or why not?

<details>
<summary>Reveal answer</summary>

No build error. `lucide-react` renders SVG icons as React elements — pure JSX that renders to `<svg>` HTML. It has no browser API dependencies; it doesn't reference `window`, `document`, or DOM methods. A component that renders `<TrendingUp>` is structurally identical to a component that renders `<span>` — both produce HTML strings during server rendering.

The build error only occurs when a package calls browser APIs at module load time (recharts accesses `ResizeObserver`, `requestAnimationFrame`, and similar APIs during chart rendering). `lucide-react` does none of this.
</details>

**Checkpoint:** `ProfileBanner` is a Server Component that returns `null` when `isComplete` is `true`. If `ProfileBanner` were refactored to a Client Component (`"use client"`), would returning `null` still work correctly — and what would change?

<details>
<summary>Reveal answer</summary>

Returning `null` from a Client Component is valid React — components can conditionally return null. The banner would still not render when `isComplete` is `true`.

What changes: the component's code now ships to the browser as JavaScript. Even though it renders nothing, the import, the Props type, the conditional check, and the JSX for the card are all included in the client bundle. The `AlertCircle` icon import, the `Link` component, and the full render tree are loaded in the browser even when the banner is invisible to the user.

For a component as simple as `ProfileBanner`, this is not a meaningful performance impact. The reason it is a Server Component is not performance — it is correctness of defaults. Nothing in `ProfileBanner` requires browser APIs, so there is no reason to pay the cost of client-side inclusion.
</details>

---

## Part 4 — CSS custom properties inside SVG attributes

Open [`components/dashboard/CompanyResearchChart.tsx`](../../../components/dashboard/CompanyResearchChart.tsx) lines 16–50:

```typescript
export function CompanyResearchChart({ data }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-6">
        Company Research Activity
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barSize={24}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Bar
            dataKey="count"
            fill="var(--color-info)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Every color in this component uses a CSS variable string: `"var(--color-border)"`, `"var(--color-chart-axis)"`, `"var(--color-info)"`. Not a single hex value.

This works because modern browsers resolve CSS custom properties in SVG attribute values. When recharts renders `<rect fill="var(--color-info)">` into the DOM, the browser's SVG renderer looks up `--color-info` in the CSS cascade on that element and substitutes the resolved value. The result is identical to writing the hex value directly — but now the bar color updates automatically whenever `--color-info` changes in `globals.css`, or if a future dark mode overrides it at the `:root` level.

The `tick` prop on `XAxis` and `YAxis` accepts a React SVG props object (`{ fill, fontSize }`). The fill is a CSS variable string. This is how axis label colors join the design token system — there is no Tailwind class that can color a recharts tick label; the only path is through the SVG prop. The `--color-chart-axis` token was added to `app/globals.css` specifically for this:

```css
/* Charts */
--color-chart-axis: #9ca3af;
```

Without this token, the axis color `#9CA3AF` would be a hardcoded hex in three chart components — a design system violation. Adding the token costs one line in `globals.css` and makes the color changeable from one place.

> **System design — CSS custom properties as a design token layer:** CSS custom properties are the runtime mechanism that makes design token systems work. When Tailwind v4 uses `@theme { --color-accent: #9B5CF6; }`, it is declaring a CSS custom property on `:root`. Tailwind classes like `bg-accent` compile to `background-color: var(--color-accent)`. Recharts SVG props like `fill="var(--color-accent)"` also reference the same custom property. Both paths — Tailwind classes and raw SVG attributes — read from the same source: the CSS cascade. This is why the design token system can reach inside SVG without any special recharts integration.

**Checkpoint:** Why does the `--color-chart-axis` token need to exist as a CSS custom property in `globals.css` when the axis color could just be hardcoded as `#9CA3AF` in the chart components? After all, it is only used in three files.

<details>
<summary>Reveal answer</summary>

Two reasons. First, the project's design rule is categorical: no hardcoded hex values in components. This rule exists so that color is always controlled from one place (`globals.css`) and never scattered across component files. If `#9CA3AF` is hardcoded in three chart components and someone needs to change the axis color, they must find and update all three files. With a token, they update one line.

Second, the token makes the axis color part of the theming system. A future dark mode could override `--color-chart-axis` for a lighter value on dark backgrounds. If the value is hardcoded, the dark mode implementation must also hunt down and override three component files.

The cost of the token is one line in `globals.css`. The cost of the hardcode compounds with every file that uses it.
</details>

**Checkpoint:** If you changed `<Bar fill="var(--color-info)">` to `<Bar fill="#61A8FF">` (the current resolved value of `--color-info`), what would break today? What would break in the future?

<details>
<summary>Reveal answer</summary>

Nothing would break today — `#61A8FF` is the resolved value and the bar would render identically. The breakage is in the future:

1. If `--color-info` is ever changed in `globals.css` (e.g., to adjust the brand blue), `CompanyResearchChart`'s bars would not update. The rest of the UI (buttons, badges, other elements using `text-info` or `bg-info`) would change, but the chart bars would stay at the old value — a visual inconsistency.

2. If a dark mode is implemented that overrides `--color-info` for dark backgrounds, the chart bars would not participate. Every other `--color-info` element would adapt; the hardcoded `#61A8FF` would not.

3. ESLint (if configured with a no-hardcoded-colors rule) or a future audit would flag it as a violation. Technical debt compounds.
</details>

---

## Part 5 — `<defs><linearGradient>` inside recharts AreaChart

Open [`components/dashboard/JobsFoundChart.tsx`](../../../components/dashboard/JobsFoundChart.tsx):

```typescript
"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

type Props = {
  data: { day: string; count: number }[];
};

export function JobsFoundChart({ data }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-6">
        Jobs Found Over Time
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="jobsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-accent)"
                stopOpacity={0.2}
              />
              <stop
                offset="95%"
                stopColor="var(--color-accent)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-chart-axis)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--color-accent)"
            strokeWidth={3}
            fill="url(#jobsGradient)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

The area fill is not a solid color — it fades from semi-transparent accent at the top to fully transparent at the bottom. This requires an SVG gradient, which requires `<defs>`.

`<defs>` is a standard SVG element that defines reusable graphical content (gradients, patterns, filters) without rendering them directly. Recharts passes JSX children it doesn't recognize as SVG elements through to the rendered SVG DOM. When recharts sees `<defs>` as a child of `<AreaChart>`, it inserts it directly into the SVG output.

The gradient definition:
- `x1="0" y1="0" x2="0" y2="1"` — the gradient vector runs from top (`y=0`) to bottom (`y=1`), producing a vertical fade.
- First `<stop>` at `offset="5%"` with `stopOpacity={0.2}` — near the top, the accent color at 20% opacity.
- Second `<stop>` at `offset="95%"` with `stopOpacity={0}` — near the bottom, fully transparent.

`stopColor="var(--color-accent)"` and `stopOpacity={0.2}` are separate SVG attributes. `stopOpacity` is a number prop (not `"0.2"` as a string) — recharts camelCases SVG attributes following React's SVG prop conventions.

The `<Area>` references the gradient with `fill="url(#jobsGradient)"`. This is the SVG paint server syntax — `url(#id)` tells the browser to look up the `<linearGradient>` element with `id="jobsGradient"` in the current SVG document and use it as the fill source.

`dot={false}` suppresses the per-point dots recharts renders by default. Without it, 7 purple circles would appear on the line — one per day of data — making the chart look cluttered for a weekly summary view.

> **System design — SVG paint servers and the `<defs>` pattern:** In SVG, a "paint server" is any element that provides color programmatically: gradients, patterns, and filters. Paint servers must be declared in `<defs>` before they can be referenced by `fill="url(#id)"` or `stroke="url(#id)"`. The `id` is a document-scoped identifier — it must be unique within the SVG element. This is the same concept as CSS class names, but scoped to SVG documents: two elements with the same `id` in the same SVG will cause the second definition to shadow the first, potentially affecting all references.

**Checkpoint:** The gradient `id="jobsGradient"` must be unique within the SVG document. The dashboard currently has one area chart. If a second area chart were added (say, "Profile Views Over Time"), what would break — a runtime error, a visual bug, or nothing visible? How would you fix it?

<details>
<summary>Reveal answer</summary>

A visual bug, not a runtime error. SVG `id` collisions are silent — the browser does not throw. When two `<linearGradient id="jobsGradient">` elements exist in the same SVG document, both `fill="url(#jobsGradient)"` references resolve to whichever definition the browser encounters last in DOM order. The "earlier" area chart would use the gradient definition from the "later" area chart — which might have a different `stopColor` or direction.

The fix: give each area chart a unique gradient `id`. A common pattern is to use a prop-derived or component-specific suffix:

```typescript
// in the component
const gradientId = "jobsFoundGradient";
// or pass as a prop
const gradientId = `areaGradient-${chartId}`;
```

As long as there is only one area chart per page (which is the current reality), `"jobsGradient"` is safe. The invariant to note: if two area charts are ever placed on the same page, both gradient `id` values must be unique.
</details>

**Checkpoint:** `type="monotone"` on `<Area>` controls how recharts draws the line between data points. What does it produce visually, and what would `type="linear"` look like differently?

<details>
<summary>Reveal answer</summary>

`type="monotone"` produces a smooth curve (a cubic Hermite spline) that passes through each data point while preserving monotonicity — it does not overshoot or create artificial peaks between actual data points. The result looks like a natural flowing line chart.

`type="linear"` connects data points with straight line segments — a polyline. The result is sharp corners at each data point instead of curves.

For a weekly job-count chart, `monotone` is the right choice because the data represents a continuous quantity over time, and a smooth curve reads more naturally than sharp angles. `linear` would be appropriate for data where the exact moment of change matters (e.g., stock prices, where straightness implies precision between known points).

The risk of `monotone`: it can make small fluctuations appear smoother than the raw data justifies. In a dashboard context this is acceptable. In a financial or scientific context it could be misleading.
</details>

---

## Part 6 — StatCard: one component, two rendering paths

Open [`components/dashboard/StatsBar.tsx`](../../../components/dashboard/StatsBar.tsx):

```typescript
import { TrendingUp } from "lucide-react";

export type StatCardConfig = {
  label: string;
  value: string;
  trend?: { value: string; label: string };
  subtitle?: string;
};

type StatCardProps = StatCardConfig;

function StatCard({ label, value, trend, subtitle }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <p className="text-sm font-medium text-text-secondary mb-2">{label}</p>
      <p className="text-[30px] font-semibold leading-9 text-text-primary mb-2">{value}</p>
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
    </div>
  );
}

type Props = {
  stats: StatCardConfig[];
};

export function StatsBar({ stats }: Props) {
  return (
    <div className="grid grid-cols-4 gap-6">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
```

`StatCard` is a module-level function, not exported. It is a private implementation detail of `StatsBar.tsx`. The only exported symbols are `StatCardConfig` (the type) and `StatsBar` (the component).

Two distinct visual designs exist on the dashboard: cards 1 and 2 have trend badges ("+12% vs last week"), cards 3 and 4 have plain subtitles ("Total researched"). A naive implementation would create two separate components. `StatCard` handles both with one ternary.

The prop API `{ trend?, subtitle? }` — both optional — expresses the intent clearly: a card has either a trend badge or a subtitle, not both. If `trend` is provided, the badge renders. If `trend` is absent (undefined), the subtitle renders. In `page.tsx`, the caller makes the choice:

```typescript
{ label: "Total Jobs Found", value: "284", trend: { value: "+12%", label: "vs last week" } },
{ label: "Companies Researched", value: "35", subtitle: "Total researched" },
```

The trend badge is `rounded-sm` (4px border radius), not `rounded-full` (pill). This was a deliberate specification from the design file — the badge is rectangular, not pill-shaped. Both are valid Tailwind utilities. TypeScript accepts both. The linter accepts both. Only the design spec distinguishes them.

> **Design patterns — Conditional rendering as a single-component polymorphism:** When two visual variants share most of their structure, a single component with a conditional rendering path is often cleaner than two separate components. The ternary `{trend ? <badge> : <subtitle>}` is the React equivalent of the Strategy pattern: the `trend` prop selects the rendering strategy. The shared structure (container, label, value) avoids duplication. The caller's props make the variant explicit at the usage site, not buried in two separate component names.

**Checkpoint:** `StatCard` is declared at module level, not inside `StatsBar`. What would happen if `StatCard` were declared inside `StatsBar`'s function body — and why does the project's `code-standards.md` (via the ESLint rule `react-hooks/static-components`) forbid this?

<details>
<summary>Reveal answer</summary>

If `StatCard` were declared inside `StatsBar`'s function body, React would treat it as a new component type on every render of `StatsBar`. React identifies components by their function reference. A function declared inside another function is a new function object on every call — so every time `StatsBar` re-renders, React sees a new `StatCard` type and unmounts the old one, remounting fresh. This causes unnecessary unmount/remount cycles, loses DOM state, and can cause visible flickers.

The `react-hooks/static-components` ESLint rule catches this pattern and flags it as an error. The fix — as applied here — is to declare sub-components at module scope, outside any parent component function. They are still logically private (not exported), but they have a stable function reference across renders.
</details>

---

## Part 7 — Retiring `AnalyticsCharts.tsx`: when a planned file can't own its layout

The original `context/architecture.md` planned a single `AnalyticsCharts.tsx` component to contain all three charts. Before writing any code, the architect session identified this would produce the wrong layout.

The dashboard design requires this arrangement:

```
Row 2: [RecentActivity L]   [CompanyResearchChart R]
Row 3: [JobsFoundChart L]   [MatchScoreChart R]
```

`RecentActivity` and `CompanyResearchChart` are siblings in a `grid grid-cols-2` row. `JobsFoundChart` and `MatchScoreChart` are siblings in a separate `grid grid-cols-2` row. The layout in `page.tsx`:

```typescript
<div className="grid grid-cols-2 gap-6 items-start">
  <RecentActivity items={mockActivity} />
  <CompanyResearchChart data={mockCompanyResearchData} />
</div>
<div className="grid grid-cols-2 gap-6 items-start">
  <JobsFoundChart data={mockJobsFoundData} />
  <MatchScoreChart data={mockMatchScoreData} />
</div>
```

A single `AnalyticsCharts.tsx` cannot occupy the right column of Row 2 while also spanning both columns of Row 3, unless it owns the two-row layout internally. If it owned those two rows, it would need to know about `RecentActivity` — a component outside `AnalyticsCharts.tsx` — to match column widths. That is coupling between components that should be independent.

The resolution: retire the planned wrapper and create three separate component files (`CompanyResearchChart.tsx`, `JobsFoundChart.tsx`, `MatchScoreChart.tsx`), each independently placeable in the page's grid. Layout ownership stays in `page.tsx`.

**Checkpoint:** `StatsBar.tsx` has two exported symbols: `StatCardConfig` (type) and `StatsBar` (component), plus one unexported sub-component `StatCard`. Does this violate `code-standards.md`'s one-component-per-file rule? Why or why not?

<details>
<summary>Reveal answer</summary>

No violation. The one-component-per-file rule targets independently usable, exported components. `StatCard` is not independently usable — it is a private sub-component of `StatsBar`, not exported, not referenced outside `StatsBar.tsx`. It is an implementation detail of one exported component, not a separate component with its own lifecycle.

The rule prevents the pattern of putting two unrelated exported components in one file, which makes them hard to find and creates circular dependency risks. A module-level private sub-component is a standard React pattern — it is the correct way to decompose internal rendering logic without creating an extra file for something that has no standalone purpose.
</details>

**Checkpoint:** `RecentActivity.tsx` uses `divide-y divide-border` for row separators. What are the three alternatives — `<hr>`, `border-b` on each row, and `divide-y` — and when would you choose one over the others?

<details>
<summary>Reveal answer</summary>

- **`<hr>`** renders a semantic HTML horizontal rule. It requires explicit styling (`border-0 border-t border-border`) to match the design system, and it adds an extra DOM element per separator. It is semantically meaningful for separating unrelated content sections, but overkill for list items.

- **`border-b` on each row** adds a bottom border to every `ActivityRow`. This produces a border after the last row too, unless you use `last:border-0`. It requires remembering to add the exception class and keeps the separator logic inside the child component.

- **`divide-y divide-border`** adds a top border to every child after the first via a CSS selector (`> * + *`). No border appears after the last item because the selector targets the space between items, not below each one. No exception class needed. The separator logic lives in the parent container, not the child component.

`divide-y` is the idiomatic Tailwind choice for lists of items separated by lines. Use `border-b` when each item's bottom border has different styling. Use `<hr>` when the separator is a meaningful semantic break (section headers, document structure).
</details>

---

## Full data flow: first page load for a new authenticated user

```
1. Browser → GET /dashboard

2. app/dashboard/page.tsx:92
   createInsforgeServer() → InsForge server client
   (reads session cookie, sets up auth context)

3. page.tsx:93
   insforge.auth.getCurrentUser()
   → { data: { user: { id: "uuid-..." } } }
   User is authenticated → no redirect

4. page.tsx:99–103
   insforge.database
     .from("profiles")
     .select("is_complete")
     .eq("id", "uuid-...")
     .maybeSingle()
   → { data: null, error: null }
   (new user, no profile row exists)

5. page.tsx:105
   isComplete = !!null?.is_complete
             = !!undefined
             = false

6. Server renders JSX tree with isComplete=false,
   all mock data constants passed as props.

7. ProfileBanner receives isComplete=false
   → renders the warning card (not null)
   Server Component → pure HTML in response stream

8. StatsBar receives mockStats (4 items)
   → renders 4 StatCard elements
   Cards 1+2: trend badges. Cards 3+4: subtitles.
   Server Component → pure HTML in response stream

9. RecentActivity receives mockActivity (5 items)
   → renders 5 ActivityRow elements
   Green dots for search, blue for research
   Server Component → pure HTML in response stream

10. CompanyResearchChart, JobsFoundChart, MatchScoreChart
    received as Client Component islands
    → included in the JS bundle sent to browser

11. Browser receives HTML (steps 7–9) + JS bundle (step 10)
    → paints server-rendered content immediately

12. Browser hydrates the 3 chart islands
    Recharts renders SVG into DOM:
    <rect fill="var(--color-info)">
    <path stroke="var(--color-accent)">
    etc.

13. CSS cascade resolves custom properties in SVG attrs:
    var(--color-info)    → #61A8FF (blue bars)
    var(--color-accent)  → #9B5CF6 (purple area line)
    var(--color-success) → #10B981 (green bars)

14. Browser paints the colored SVG charts.
    Dashboard is fully interactive.
```

---

## Extend it (challenges)

### Challenge 1 — Trace: follow `var(--color-chart-axis)` from declaration to rendered pixel (15–20 min)

Open `app/globals.css` and find the `--color-chart-axis` declaration. Note the line number and value.

Then open all three chart component files. Find every use of `var(--color-chart-axis)`. Note which recharts prop it appears in and what SVG attribute recharts renders it to.

Open your browser's DevTools while the dashboard is loaded. Use the inspector to find an X-axis tick label element inside one of the charts. Look at its `fill` attribute in the Elements panel. What value do you see — the CSS variable string, or the resolved hex value?

Write out the full chain: declaration line in `globals.css` → prop in the chart component → SVG attribute in the DOM → resolved value in the browser.

<details>
<summary>Hint</summary>

The `fill` SVG attribute on the tick `<text>` element in the DOM will still show `var(--color-chart-axis)` as a string — the browser resolves it at paint time, not by substituting it in the attribute string. Use the Computed styles panel (not the attribute) to see the final rendered color.
</details>

---

### Challenge 2 — Extend: add a fifth stat card (20–30 min)

Add a "Strong Matches" stat card to `StatsBar`. A "strong match" is a job with `match_score >= 70` (the `MATCH_THRESHOLD` from `lib/utils.ts`).

For Feature 14, use a mock value (e.g., `"47"`). The card should have a plain subtitle: "Above 70% match".

Files you need to touch:
1. `app/dashboard/page.tsx` — add the fifth item to `mockStats`.
2. `components/dashboard/StatsBar.tsx` — update the grid from `grid-cols-4` to `grid-cols-5`.

Verify that `StatCard` requires no changes — the fifth card uses `subtitle` (already supported by the existing component).

<details>
<summary>Hint</summary>

Check `lib/utils.ts` for the canonical import of `MATCH_THRESHOLD`. The mock value for the stat card is a string (`"47"`), not a number — `StatCardConfig.value` is typed as `string`. Look at the existing `StatCardConfig` items in `mockStats` to see the pattern.
</details>

---

### Challenge 3 — Break and fix: simulate a gradient id collision (30–45 min)

**Break:** Create a second area chart component, `ProfileViewsChart.tsx`, that uses `<linearGradient id="jobsGradient">` — the same id as `JobsFoundChart`. Place both charts on the dashboard in the same 2-column row (temporarily).

**Observe:** Load the dashboard. Notice that one of the two area charts has the wrong gradient (it uses the other chart's gradient definition). Record which chart is affected and what the visual artifact looks like.

**Fix:** Give each chart its own unique gradient id. `JobsFoundChart` should use `id="jobsFoundGradient"`. Your new chart should use `id="profileViewsGradient"`. Update the corresponding `fill="url(#...)"` references in both.

**Reflect:** Write a one-paragraph explanation of why SVG `id` collisions are silent (no console error, no runtime warning) and what the systematic defense is if a reusable area chart component is ever needed.

<details>
<summary>Hint</summary>

The systematic defense for a reusable area chart is to accept the gradient id as a prop — or to generate a unique id internally using `useId()` from React 18. `useId()` generates a stable, unique id per component instance, which means two instances of the same chart component never share a gradient id.
</details>

---

For deeper exploration, `docs/plan/14-dashboard-page/ai-discussion-topics.md` has 24 prompts covering Server/Client boundaries, the mock data seam, `.maybeSingle()` edge cases, SVG gradient behavior, and layout ownership decisions. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
