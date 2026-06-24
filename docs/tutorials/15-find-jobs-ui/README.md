# Tutorial 15 — Find Jobs Page Full UI: Sibling Architecture, Dynamic Styles, and Pagination Math

**After completing this tutorial you will understand:** why sibling client components coordinate through a server re-render instead of shared state, why Tailwind's build-time scanning makes computed class names impossible and how CSS custom properties solve it, how React identifies component types by reference and why sub-components must live at module scope, the `safePage` clamping pattern that prevents filter-induced page drift, and why `pointer-events-none` is not optional on absolutely-positioned inset icons.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 14 (`../14-resume-pdf-generation/README.md`) — the directly prior tutorial; picks up the series here.
> - Tutorial 06 (`../06-profile-page/README.md`) — the Server Component + Client Component split and the module-level component rule (`TagInput`) introduced there reappear here with `MatchScoreBar`. This tutorial extends those patterns to a new page.
>
> Open [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx),
> [`components/find-jobs/SearchControls.tsx`](../../../components/find-jobs/SearchControls.tsx),
> [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx), and
> [`lib/utils.ts`](../../../lib/utils.ts) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Single source of truth | `MATCH_THRESHOLD` exported from `lib/utils.ts` only | System design |
| Static vs. runtime analysis | Tailwind scanner vs. `getMatchBarColor` inline style | System design |
| CSS custom properties (`var()`) | `"var(--color-success)"` strings in `getMatchBarColor` | Web fundamentals |
| Object reference identity | `MatchScoreBar` at module scope to preserve `===` type equality | Design patterns |
| Bound clamping | `safePage = Math.min(page, totalPages)` | Algorithms |
| DOM event hit testing | `pointer-events-none` on inset icons | OS fundamentals |

---

## How to use an LLM before this tutorial

Run these prompts before reading any code. Budget 25–35 minutes.

### Concept 1 — Tailwind's static scanner

> "Explain how Tailwind generates CSS. Does it analyze my code at runtime or build time? What does it do if I write a computed class name like `` `bg-${color}` `` where `color` is a runtime variable? Walk me through what happens at build time vs. what the browser receives vs. what I see on screen. Quiz me with a scenario."

*What to listen for:* Tailwind scans source files at build time for string literals that look like class names. It generates CSS only for the classes it finds. A computed string like `` `bg-${color}` `` is never a literal that Tailwind's scanner sees — so no CSS is generated for it — even though the string `"bg-success"` would be produced at runtime. The browser receives HTML with class `"bg-success"` and a stylesheet that has no rule for it. The element has no background color.

*Practice question:* A developer writes `const cls = condition ? 'bg-success' : 'bg-warning'`. Will Tailwind include both classes in the production CSS? Why?

---

### Concept 2 — CSS custom properties and `var()`

> "Explain CSS custom properties (often called CSS variables). How do you define one? How do you reference it with `var()`? Can you change a custom property's value from JavaScript without adding or removing a class? What happens in the browser if the property name is misspelled? Quiz me."

*What to listen for:* Custom properties are defined on an element (often `:root`) as `--name: value`. They are referenced with `var(--name)`. They cascade and inherit like normal CSS properties. You can change them from JavaScript with `el.style.setProperty('--name', value)`. If the name is misspelled, `var()` resolves to its fallback or the initial value of the property — no error is thrown. This is why CSS variables are safe to use in inline styles without worrying about misspelled class names silently producing no output.

*Practice question:* A designer changes `--color-success` from `#10b981` to `#00bc7d` in `globals.css`. Without touching any component file, which bar colors in the jobs table update? Which ones don't?

---

### Concept 3 — JavaScript reference equality and function identity

> "In JavaScript, two functions that do the same thing are not equal to each other if they are different objects. Demonstrate this with a short example. Why does this matter for React? What does React do when it sees that a component's type has changed between renders? Quiz me."

*What to listen for:* `(() => {}) === (() => {})` is `false` — two function literals create two distinct objects. React tracks the type of a component by reference — if `type` changes between renders, React treats it as a completely different component: it unmounts the old one, mounts the new one, and any internal state is lost. If a component function is defined inside another component's render body, a new function object is created on every render, so the type reference changes every time. React sees a different type each render and remounts.

*Practice question:* A developer moves `MatchScoreBar` inside `JobsTable`'s function body. The scores look correct on screen. Why is this still wrong? What would you need to do to observe the bug?

---

### Concept 4 — Derived state and clamping

> "I'm building a paginated list. The user can switch between pages with Previous/Next. They can also apply a filter that reduces the total number of pages. If the user is on page 5 and applies a filter that leaves only 2 pages, what do I need to do to prevent showing an empty page? Explain the concept of 'clamping' a value and give me a one-line JavaScript expression that clamps `page` to at most `totalPages`. Quiz me."

*What to listen for:* Clamping constrains a value to a valid range. `Math.min(page, totalPages)` ensures the display page never exceeds the highest valid page for the current dataset. An alternative is to reset the page state to 1 whenever the filter changes — but `safePage` is a complementary safety net for any path that changes the dataset without resetting state.

*Practice question:* `page = 3`, `totalPages = 1`, `PAGE_SIZE = 6`. What is `safePage`? What is `startIdx`? What does `filtered.slice(startIdx, startIdx + PAGE_SIZE)` return?

---

### Concept 5 — DOM event hit testing and `pointer-events`

> "Explain the browser's event hit testing model. When a user clicks at a pixel, how does the browser decide which element to fire the event on? What is the CSS `pointer-events: none` property and what does it do to that process? Give me a concrete example of when you'd need it. Quiz me."

*What to listen for:* The browser picks the topmost element at the click coordinates — the one with the highest z-order and the last painted in document order. If an SVG icon is absolutely positioned over an input and the user clicks in that zone, the SVG receives the event, not the input. `pointer-events: none` removes an element from hit testing entirely; clicks at its coordinates pass through to whatever is behind it. This is distinct from `visibility: hidden` or `opacity: 0` — those hide the element visually but still intercept mouse events.

*Practice question:* A developer removes `pointer-events-none` from the `<Search>` icon inside the JOB TITLE input. The user clicks the magnifying glass icon. Walk through what the browser does and what the user experiences.

---

## Architecture: what Feature 09 builds

Feature 09 replaces the placeholder at `/find-jobs` with a full two-card layout using mock data. No DB reads, no API calls — just the UI shell that Features 10 and 11 will wire to real data.

```
REQUEST: GET /find-jobs
        │
        ▼
┌───────────────────────────────────────────┐
│ proxy.ts (middleware)                     │
│  updateSession() → no accessToken?        │
│  → redirect /login                        │
│  → has token? NextResponse.next()         │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ app/find-jobs/page.tsx  [SERVER]          │
│  getCurrentUser() → auth guard            │
│  Date.now() → compute MOCK_JOBS found_at  │
│  return <Navbar /> + <SearchControls />   │
│              + <JobsTable jobs={...} />   │
└──────────┬──────────────┬─────────────────┘
           │              │
           ▼              ▼
┌──────────────┐  ┌──────────────────────────┐
│SearchControls│  │ JobsTable   [CLIENT]      │
│ [CLIENT]     │  │  useMemo(filtered)        │
│  jobTitle    │  │  safePage clamp           │
│  location    │  │  MatchScoreBar (module)   │
│  searchStatus│  │  filter/sort/pagination   │
└──────────────┘  └──────────────────────────┘
```

**Key invariants for this feature:**
1. `SearchControls` has no props — it is a self-contained shell; state flows out via `router.refresh()` in Feature 10, not props.
2. `MATCH_THRESHOLD` is imported from `lib/utils.ts` — never hardcoded.
3. `MatchScoreBar` lives at module scope — never inside `JobsTable`'s function body.

---

## Part 1 — The page contract: auth guard and typed mock data

Open [`app/find-jobs/page.tsx`](../../../app/find-jobs/page.tsx):

```tsx
export default async function FindJobsPage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } =
    await insforge.auth.getCurrentUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const now = Date.now();

  const MOCK_JOBS: Job[] = [
    {
      id: "mock-1",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      // ... 17 more null fields ...
      match_score: 94,
      found_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    // 5 more entries
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
          <SearchControls />
          <JobsTable jobs={MOCK_JOBS} />
        </div>
      </main>
    </>
  );
}
```

This is the same async Server Component pattern established for the profile page in Tutorial 06. `createInsforgeServer()` and `getCurrentUser()` run on the server before any HTML renders — their network calls and credentials never reach the browser. The double auth guard (middleware in `proxy.ts` AND page-level `redirect`) is intentional: `proxy.ts` blocks at the edge before routing, but a direct API call or a request from a context that bypasses the middleware would skip the first guard. The page guard is the authoritative enforcement point.

The mock data is typed as `Job[]` — the exact same interface from `types/index.ts` that real DB queries will return. Most fields are `null` because the DB schema allows them to be null, and the real jobs from Adzuna may not populate every field. Typing mock data as `Job[]` instead of `{ id: string, match_score: number, ... }[]` means any structural mismatch between the mock and the real schema surfaces as a TypeScript error now, not in production. If the `Job` interface gains or loses a required field, the mock data breaks at compile time — the same signal you want.

**Checkpoint:** Why is `MOCK_JOBS` defined inside `FindJobsPage()` rather than at module level as a constant?

<details>
<summary>Reveal answer</summary>

`found_at` is computed with `Date.now()`:

```ts
found_at: new Date(now - 2 * 60 * 60 * 1000).toISOString()
```

If `MOCK_JOBS` were at module level, `Date.now()` would be called once when the Node.js module loaded — on dev server start or the first request in production. The timestamps would then be frozen at that moment. When `formatRelativeDate` computes the diff against the current time on each render, the first row might show "2 hours ago" at startup but "47 hours ago" two days later even though the page claims it was "just searched." By computing `now` inside the async function, every request gets fresh timestamps matched to its own render moment. This is the general rule: any server-side value that depends on "now" must live inside the request handler, not at module initialization.

</details>

**Checkpoint:** Walk me through exactly what happens when a logged-out user navigates to `/find-jobs`. Name the specific function in `proxy.ts`, the specific check in the page, and the final HTTP response the browser receives.

<details>
<summary>Reveal answer</summary>

As covered in Tutorial 02, `proxy.ts` runs before the route renders on every matched request. `updateSession()` is called; it finds no valid access token in the request cookies. `isProtected` is `true` because `/find-jobs` is in `PROTECTED_PATHS`. The middleware returns a `NextResponse.redirect` with `location: /login` — the browser receives a 307 response before Next.js routing even considers `app/find-jobs/page.tsx`. The page's own `redirect("/login")` guard is never reached in this case. If the user somehow arrived at the page component with a valid but expired token (a theoretical edge), the page guard would still fire — it is a second, independent check.

</details>

---

## Part 2 — Sibling architecture: why `SearchControls` has no props

Open [`components/find-jobs/SearchControls.tsx`](../../../components/find-jobs/SearchControls.tsx):

```tsx
export function SearchControls() {
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  function handleSearch() {
    // Placeholder — wired to Adzuna API in Feature 10
    setSearchStatus({ jobsFound: 8, strongMatches: 4 });
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      {/* ... inputs and button ... */}
      {searchStatus && (
        <div className="mt-4 flex items-center gap-2 bg-success-lightest text-success-foreground text-sm rounded-md px-4 py-2">
          <Sparkles size={14} />
          Found {searchStatus.jobsFound} jobs and saved {searchStatus.strongMatches} strong matches.
        </div>
      )}
    </div>
  );
}
```

`SearchControls` takes no props. This is intentional — not an oversight. The component owns its own input state and will own its own search execution. The question is: if `SearchControls` triggers a search that writes new jobs to the DB, how does `JobsTable` (a sibling with no shared state) display the new rows?

The answer is `router.refresh()` — a Next.js App Router primitive that re-triggers the Server Component tree without a full navigation. In Feature 10, after the `POST /api/agent/find` call completes, `SearchControls` will call `router.refresh()`. This tells Next.js to re-run `FindJobsPage` on the server, re-fetch jobs from the DB, and re-render `JobsTable` with the updated `jobs` prop. The two components never need to share state directly — the server re-render is the synchronization mechanism.

This is why `SearchControls` and `JobsTable` are siblings rather than `SearchControls` wrapping `JobsTable`. If `SearchControls` wrapped `JobsTable`, it would need to manage job data as state — turning it into both a form controller and a data container. That coupling would make both harder to test and harder to replace with real data in Feature 11. The sibling pattern keeps each component responsible for exactly one thing.

**Checkpoint:** `SearchControls` and `JobsTable` are siblings on the page — neither wraps the other. In Feature 10, clicking "Find Jobs" in `SearchControls` must cause `JobsTable` to show new jobs. Given that the two components share no state and no parent client component, what is the one-line call that makes this work?

<details>
<summary>Reveal answer</summary>

`router.refresh()` — called inside `SearchControls` after the API call completes. `useRouter()` from `next/navigation` provides the `router` object; `router.refresh()` re-runs the Server Component for the current URL, which re-fetches jobs from the DB and passes the new `jobs` prop to `JobsTable`. Neither component needs to know the other exists. The server is the shared state.

</details>

**Checkpoint:** `MOCK_JOBS` is typed as `Job[]` even though almost every field is `null`. Why does this typing matter for Feature 11?

<details>
<summary>Reveal answer</summary>

`Job[]` is the exact type the real InsForge query will return. If `Job` ever changes — a field becomes non-nullable, a field is removed, a new required field is added — the mock data breaks at compile time with a TypeScript error. This surfaces schema mismatches immediately rather than at runtime in Feature 11. If the mock were typed as `Partial<Job>[]` or `any[]`, TypeScript would accept it regardless of what the real query returns, and the type mismatch between the mock and real data would not surface until the component receives real DB data and crashes on a missing required field.

</details>

---

## Part 3 — `MATCH_THRESHOLD` and the single source of truth

Open [`lib/utils.ts`](../../../lib/utils.ts):

```ts
export const MATCH_THRESHOLD = 70;
```

And the import in [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx):

```tsx
import { MATCH_THRESHOLD } from "@/lib/utils";

// Inside filtered useMemo:
if (matchFilter === "high") {
  result = result.filter((j) => (j.match_score ?? 0) >= MATCH_THRESHOLD);
} else if (matchFilter === "low") {
  result = result.filter((j) => (j.match_score ?? 0) < MATCH_THRESHOLD);
}
```

`lib/utils.ts` did not exist before Feature 09. It was created here because `CLAUDE.md` designates it as the canonical home for `MATCH_THRESHOLD` — but the deeper reason is that this threshold will be referenced in at least four separate contexts across the project: `JobsTable` filters by it in the UI (Feature 09), the Gemini matcher in `agent/` scores jobs against it (Feature 10), the InsForge DB query filters by it (Feature 11), and the dashboard stats aggregate by it (Feature 14). If any one of those contexts hardcodes `70`, and the product team decides the threshold should be `75`, a developer must grep every file that uses the number and update each instance independently. With a single export, the change is one line and one file.

> **System design — Single source of truth:** A value that governs behavior in multiple independent locations should be defined in exactly one place and imported everywhere else. The failure mode of duplicating it is a "split-brain" bug: some callers use the updated value and others still use the stale value, producing inconsistent behavior depending on which code path runs. `MATCH_THRESHOLD` in `lib/utils.ts` is the canonical example in this codebase.

**Checkpoint:** In Feature 11, filtering moves from `JobsTable`'s client-side `useMemo` to a server-side InsForge DB query. What specifically will need to change in `JobsTable`? Think about where `matchFilter` and `sort` state currently live, how they currently drive the data, and what they would need to drive instead.

<details>
<summary>Reveal answer</summary>

Currently, `matchFilter`, `filterText`, and `sort` are React state inside `JobsTable`, and they drive the `filtered` `useMemo` that recomputes the display array from the `jobs` prop. In Feature 11, filtering and sorting move to the DB: the component's state values need to become URL search parameters (e.g., `?match=high&sort=score&page=2`) rather than in-memory state. The Server Component reads those params, passes them to the InsForge query, and returns the pre-filtered, pre-sorted page of results as the `jobs` prop. `JobsTable` stops doing its own `useMemo` filtering and just renders whatever it receives. The transition: `useState` state → URL params → Server Component reads params → DB query → prop.

</details>

---

## Part 4 — Dynamic bar fill: why Tailwind can't help and CSS variables can

Open the `getMatchBarColor` function and `MatchScoreBar` in [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx):

```tsx
function getMatchBarColor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 80) return "var(--color-info-medium)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-text-muted)";
}

function MatchScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1 bg-border-light rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: getMatchBarColor(score) }}
        />
      </div>
      <span className="text-sm font-medium text-text-primary">{score}%</span>
    </div>
  );
}
```

The bar fill's background color varies per row depending on the job's `match_score`. This rules out a Tailwind class for the fill. Tailwind works by scanning source files at build time for class-name strings. It finds literal strings like `"bg-success"` and generates `.bg-success { background-color: var(--color-success) }` in the output CSS. A computed string like `` `bg-${getColorForScore(score)}` `` is never a literal that the scanner sees — so no CSS rule is generated for it. At runtime, the browser receives HTML with a class name the stylesheet doesn't recognize and shows no color.

The correct approach is an inline `style` prop with a CSS variable reference. `getMatchBarColor` returns strings like `"var(--color-success)"`. These are not raw hex values — they are references to the tokens defined in `app/globals.css`'s `@theme` block. The browser resolves `var(--color-success)` at paint time by looking up the property on the element's ancestors. If the token ever changes in `globals.css`, the bar fill updates automatically — no component file needs to change.

Note that the track (`bg-border-light`) uses a normal Tailwind class because it never changes between rows. Static properties belong in Tailwind classes. Dynamic properties belong in inline styles.

> **System design — Static vs. runtime analysis:** Tailwind's scanner is a static analysis tool: it reads source code as text and cannot evaluate JavaScript expressions. Any styling that depends on a runtime value must live in a `style` prop, not a Tailwind class. This is not a Tailwind limitation to work around — it is the intended design. Runtime-dynamic styles stay in `style`; static, pre-known styles stay in `className`.

> **Web fundamentals — CSS custom properties (`var()`):** CSS custom properties (defined as `--name: value`) are resolved by the browser at paint time, not by the bundler at build time. Referencing them with `var(--name)` in an inline style is equivalent to using them in a stylesheet rule — the cascade and inheritance rules apply normally. This makes them the correct bridge between a design token system (which lives in CSS) and runtime-dynamic styling (which lives in a `style` prop).

**Checkpoint:** The `MatchScoreBar` fill uses `style={{ backgroundColor: getMatchBarColor(score) }}`. Walk me through what would happen at build time, at runtime, and in production if we instead wrote `className={\`bg-\${getMatchBarColor(score)}\`}`.

<details>
<summary>Reveal answer</summary>

At build time: Tailwind scans the source and sees `` `bg-${getMatchBarColor(score)}` `` — a template literal. The scanner does not evaluate JavaScript; it only finds literal strings. No class like `bg-var(--color-success)` (which would be the runtime output) is ever a literal string in the file. Tailwind generates no CSS for it.

At runtime: the browser receives HTML with `class="bg-var(--color-success)"`. This is not a valid CSS class name (it contains `(`, `--`, `)` which break class name syntax). Even if it were syntactically valid, no stylesheet rule matches it.

In production: every job row has no fill color on the bar. The track shows as `bg-border-light`, the fill is invisible. The percentage text still appears, but the visual bar is blank. No error is thrown — the browser silently ignores the unmatched class.

</details>

**Checkpoint:** `getMatchBarColor` returns `"var(--color-success)"` rather than `"#10b981"`. A designer changes the success token in `globals.css` from `#10b981` to `#00bc7d`. Which bars update automatically? Which would not if we used hex values instead?

<details>
<summary>Reveal answer</summary>

With `var(--color-success)`, all bars with score ≥ 90 update automatically — the browser re-resolves the CSS variable at paint time, and the new hex value in `globals.css` is used. No component files change. With hardcoded `"#10b981"`, those same bars would still show the old color even after the token change, because the hex string in the component is not connected to the design token system at all. The developer would need to grep for `#10b981` across all component files and update each manually — and would likely miss any files that computed the hex value programmatically.

</details>

---

## Part 5 — Three tiers: when design image overrides ui-tokens.md

The full `getMatchBarColor` function maps scores to three colors:

```tsx
function getMatchBarColor(score: number): string {
  if (score >= 90) return "var(--color-success)";     // green
  if (score >= 80) return "var(--color-info-medium)"; // blue
  if (score >= 50) return "var(--color-warning)";     // orange
  return "var(--color-text-muted)";                   // gray
}
```

`context/ui-tokens.md` documents the Match Score Colors as: 70–89% green, 90–100% green. But `context/designs/find-jobs.png` shows three visually distinct colors: Vercel 94% and OpenAI 91% are green; Stripe 88% and Figma 85% are blue; Notion 72% is orange. The user's explicit instruction was "build exactly as shown in find-jobs.png." The design image is ground truth; `ui-tokens.md` is a reference document that can lag.

The boundary change (green starts at 90, not 70) creates a divergence from the token doc. This is documented here because it is the most likely source of future confusion: a developer who reads `ui-tokens.md` and sees "70–89% = green" will wonder why the code produces blue for 88%. The answer is not a bug — it is a design decision traceable to a specific instruction. If a future session asks to "match ui-tokens.md exactly," the correct response is to change `getMatchBarColor`'s second branch from `>= 80` to remove the blue tier and return `var(--color-success)` for scores from 70 upward.

**Checkpoint:** The design shows green for 90+, blue for 80–89, and orange for 70–79. `ui-tokens.md` says both 70–89 should be green. Explain the decision made here and how a developer should handle the conflict if told to "match ui-tokens.md exactly."

<details>
<summary>Reveal answer</summary>

The design image takes precedence over the token documentation because the user's explicit instruction was "build exactly as shown." Token documentation describes intent; the design image describes what the user actually wants to see. To match ui-tokens.md exactly, a developer would change `getMatchBarColor` to remove the blue tier: the `>= 80` branch would be deleted, and scores in 70–89% would fall through to the `>= 50` branch — but that returns orange, not green. To match the token doc's "70–89 = green" intent, the correct change is: `if (score >= 70) return "var(--color-success)"`. The `>= 80` blue branch and the `>= 50` orange branch would both be removed (or `>= 50` changed to return `var(--color-warning)` only below 70). This is a one-function change with no other files involved.

</details>

---

## Part 6 — Module-level components and the React re-mounting rule

In [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx), `MatchScoreBar` is defined at module scope — above and outside `JobsTable`:

```tsx
function MatchScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1 bg-border-light rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: getMatchBarColor(score) }}
        />
      </div>
      <span className="text-sm font-medium text-text-primary">{score}%</span>
    </div>
  );
}

// ... then below:
export function JobsTable({ jobs }: Props) {
  // JobsTable implementation
}
```

As covered in Tutorial 06 with `TagInput`, React identifies a component's type by reference. If `MatchScoreBar` were defined inside `JobsTable`'s function body, a new function object would be created on every render of `JobsTable`. Even if both functions have identical code, `newFn === oldFn` is `false` — JavaScript functions are objects, and two distinct object literals are never equal. React sees a different type reference each render and treats it as a completely different component. Instead of diffing and updating the DOM, it unmounts the old `MatchScoreBar` and mounts a brand-new one from scratch. This causes any internal state in the sub-component to reset, and the DOM update is more expensive than a diff would be.

For `MatchScoreBar` specifically, this remount is invisible at runtime because the component has no internal state — it's a pure function of `score`. But the ESLint rule `react-hooks/static-components` will flag it, and the pattern is wrong regardless: a component defined inside a render function depends on the containing closure even when it doesn't need to, and it buries a performance penalty waiting to become visible the moment anyone adds state to the sub-component.

> **Design patterns — Object reference identity:** React's component reconciliation algorithm uses `===` equality to compare component types between renders. This is a general pattern across many frameworks: "is this the same thing I had before?" is answered by identity (same reference), not structural equality (same shape). Two objects with identical contents are not the same object. Any system that tracks "has this changed" by reference rather than value will exhibit this behavior — the solution is always to ensure the reference is stable across the relevant scope.

**Checkpoint:** The `filtered` `useMemo` has `[jobs, matchFilter, filterText, sort]` as its dependency array. What happens if the parent creates a new array literal for `jobs` on every render — for example `<JobsTable jobs={[...MOCK_JOBS]} />`?

<details>
<summary>Reveal answer</summary>

Array literals create new object references on every execution. `[...MOCK_JOBS]` produces a new array each time `FindJobsPage` renders, so `jobs` would have a different reference on every render even though the contents are identical. The `useMemo` would see `jobs` changed (because `===` reference equality fails) and recompute `filtered` on every parent render, even when `matchFilter`, `filterText`, and `sort` haven't changed. In practice, `FindJobsPage` is a Server Component that renders only when the server re-renders the page — it doesn't re-render on client interactions. So this is not a real performance issue for the current architecture. But if `FindJobsPage` were a client component or if the data came from a client-side `useState`, this spread would trigger unnecessary recomputation on every render.

</details>

---

## Part 7 — The `useMemo` pipeline and `safePage` pagination math

Open the state and `useMemo` block in [`components/find-jobs/JobsTable.tsx`](../../../components/find-jobs/JobsTable.tsx):

```tsx
const [filterText, setFilterText] = useState("");
const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
const [sort, setSort] = useState<Sort>("score");
const [page, setPage] = useState(1);

const filtered = useMemo(() => {
  let result = [...jobs];

  if (matchFilter === "high") {
    result = result.filter((j) => (j.match_score ?? 0) >= MATCH_THRESHOLD);
  } else if (matchFilter === "low") {
    result = result.filter((j) => (j.match_score ?? 0) < MATCH_THRESHOLD);
  }

  if (filterText.trim()) {
    const q = filterText.toLowerCase();
    result = result.filter(
      (j) =>
        j.company?.toLowerCase().includes(q) ||
        j.title?.toLowerCase().includes(q),
    );
  }

  if (sort === "score") {
    result.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
  } else if (sort === "newest") {
    result.sort(
      (a, b) =>
        new Date(b.found_at).getTime() - new Date(a.found_at).getTime(),
    );
  } else {
    result.sort(
      (a, b) =>
        new Date(a.found_at).getTime() - new Date(b.found_at).getTime(),
    );
  }

  return result;
}, [jobs, matchFilter, filterText, sort]);

const totalCount = filtered.length;
const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
const safePage = Math.min(page, totalPages);
const startIdx = (safePage - 1) * PAGE_SIZE;
const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
```

The pipeline runs in a fixed order for a reason: match filter → text filter → sort. Match filter reduces the set first (it's the coarsest), text filter narrows further (arbitrary substring), sort orders the result. Reversing the order would produce identical results but is harder to reason about — the sort runs over a larger set if text filter goes first, and text filter runs over the wrong set if applied after sort (sort is stable but the filter boundary still matters).

The `safePage` pattern addresses a subtle edge case: the `page` state integer and the actual number of pages can desynchronize when a filter reduces the dataset. If a user navigates to page 3, then applies "Low Match" which leaves zero qualifying jobs, `page` state is still `3`. `totalPages` is `Math.max(1, Math.ceil(0 / 6))` = 1. `safePage = Math.min(3, 1)` = 1. `startIdx = 0`. `filtered.slice(0, 6)` = `[]`. The `pageItems.length === 0` branch renders the empty state correctly.

Without `safePage`, using raw `page = 3` directly: `startIdx = 12`, `filtered.slice(12, 18)` = `[]` for a 0-item array. The empty state branch still renders — but the pagination text would say "Showing 13 to 18 of 0 results," which is nonsensical. `safePage` makes the display coherent.

> **Algorithms — Bound clamping:** `Math.min(value, max)` constrains a value to not exceed a maximum. It is the most common form of clamping — a technique that maps an input value to the nearest value within a defined range. Other forms: `Math.max(value, min)` for a lower bound, `Math.max(min, Math.min(value, max))` for both bounds simultaneously. Clamping appears in pagination (valid page range), slider components (draggable within bounds), animation (frame time within interval), and any system where an integer derived from user interaction must not exceed a computed maximum.

**Checkpoint:** Every filter change calls `setPage(1)` in the same handler. Why is this explicit reset necessary rather than relying on `safePage` alone? Under what specific condition would skipping the explicit reset still produce correct UI?

<details>
<summary>Reveal answer</summary>

`safePage` clamps `page` for display purposes but doesn't reset the `page` state. If `page = 3`, filtering reduces the dataset to 12 items (2 pages), and `safePage` clamps to 2 — the correct page renders. But on the next filter change, `page` is still 3, not 2. `safePage` again clamps it to whatever `totalPages` becomes. The UI remains correct as long as `safePage` is used consistently everywhere.

The reason for the explicit `setPage(1)` reset is convention and defense: if any future code path reads `page` directly without going through `safePage`, it would see a stale value. The explicit reset is the primary mechanism; `safePage` is the safety net. Skipping the explicit reset would produce correct UI in the current code — but only because `safePage` is used everywhere. One future refactor that reads `page` directly breaks the display.

</details>

**Checkpoint:** Select "Low Match" from the dropdown. In the current mock data, every job has a score of 72 or above, so `MATCH_THRESHOLD = 70` means no job qualifies. Trace through `filtered`, `pageItems`, the table render branch, and the pagination row text.

<details>
<summary>Reveal answer</summary>

1. `filtered` useMemo: `matchFilter === "low"`, so `result.filter((j) => (j.match_score ?? 0) < 70)`. All 6 jobs have scores of 72–96, all ≥ 70. `filtered = []`.
2. `totalCount = 0`. `totalPages = Math.max(1, Math.ceil(0 / 6)) = 1`. `safePage = Math.min(1, 1) = 1`. `startIdx = 0`. `pageItems = [].slice(0, 6) = []`.
3. Table render: `pageItems.length === 0` is `true`. The table body renders the single `<tr>` with `colSpan={5}` and "No jobs match your filters." text.
4. Pagination row: `totalCount === 0` is `true`. The left side shows `"No results"` (the string, not the JSX with bold numbers). Previous and Next are both disabled because `safePage === 1` and `safePage === totalPages === 1`.

</details>

**Checkpoint:** A user is on page 3 of a 5-page dataset. They type a filter that reduces the dataset to 8 items. Compute `safePage`, `startIdx`, and `pageItems` for that render, given `page = 3` and `PAGE_SIZE = 6`.

<details>
<summary>Reveal answer</summary>

`totalCount = 8`. `totalPages = Math.max(1, Math.ceil(8 / 6)) = 2`. `safePage = Math.min(3, 2) = 2`. `startIdx = (2 - 1) * 6 = 6`. `pageItems = filtered.slice(6, 12)` — for an 8-item array, this returns items at indices 6 and 7 (the last 2 items). The table shows 2 rows. Pagination text: "Showing **7** to **8** of **8** results."

</details>

---

## Part 8 — `pointer-events-none` and browser event hit testing

Both `SearchControls` and `JobsTable` place icons absolutely inside input wrappers:

```tsx
<div className="relative flex-1">
  <Search
    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
    size={14}
  />
  <input
    type="text"
    placeholder="Filter by company or role..."
    value={filterText}
    onChange={(e) => handleTextChange(e.target.value)}
    className={inputCls}
  />
</div>
```

The icon is painted on top of the input's left edge. Without `pointer-events-none`, the browser's event hit-testing selects the topmost element at click coordinates — the `<svg>` element. The SVG has no `onClick` handler and is not focusable. The browser fires the click on the SVG, nothing handles it, and the text cursor does not appear in the input. The user perceives the left ~20px of the input as "broken" — clicking the icon area doesn't focus the field.

`pointer-events: none` removes the element from hit-testing entirely. Clicks at those coordinates pass through the SVG to whatever is underneath — in this case, the `<input>`. This is distinct from hiding the SVG: `visibility: hidden` or `opacity: 0` hide the element visually but still intercept mouse events (the invisible element still "receives" clicks). `pointer-events-none` specifically removes the element from the hit-testing chain without affecting visual rendering.

> **OS fundamentals — DOM event hit testing:** The browser's rendering engine maintains a z-ordered stack of painted elements. When a mouse event occurs at (x, y), the engine traverses the stack from top to bottom to find the first element whose painted bounds contain the point and whose `pointer-events` is not `none`. This is analogous to a z-buffer test in 3D graphics — the first "hit" wins. The `pointer-events` CSS property is the application-layer mechanism for opting elements in or out of this traversal.

**Try it yourself:** Remove `pointer-events-none` from one of the `<Search>` icons in `SearchControls.tsx`. Run `npm run dev`, navigate to `/find-jobs`, and click directly on the magnifying glass icon in the JOB TITLE field. Observe whether the cursor appears in the input. Then restore the class.

---

## Full data flow: user types "ver" in the filter input

1. User types `"v"` in the "Filter by company or role..." input inside `JobsTable`. The `onChange` handler calls `handleTextChange("v")`.
2. `handleTextChange("v")` calls `setFilterText("v")` and `setPage(1)`. React batches both state updates into a single re-render.
3. `filtered` `useMemo` recomputes. `filterText.trim()` is `"v"` (truthy). `q = "v"`. Each job is tested: `"vercel".includes("v")` → true; `"stripe".includes("v")` → false; etc. Only the Vercel job passes. `filtered = [{ company: "Vercel", ... }]`.
4. `totalCount = 1`. `totalPages = 1`. `safePage = Math.min(1, 1) = 1`. `startIdx = 0`. `pageItems = [vercelJob]`.
5. The table body renders one `<tr>` for Vercel. `MatchScoreBar` receives `score={94}`. `getMatchBarColor(94)` returns `"var(--color-success)"`. The fill div gets `style={{ width: "94%", backgroundColor: "var(--color-success)" }}`.
6. The browser resolves `var(--color-success)` from the `@theme` block in `globals.css` and paints the fill green.
7. Pagination row shows "Showing **1** to **1** of **1** results." Previous and Next are both disabled.

---

## Extend it (challenges)

### Challenge 1 — Trace the empty state path (15–20 min)

The "Low Match" filter produces zero results with the current mock data. Without running the app, trace through every line of `JobsTable` to produce the exact JSX tree that renders when `matchFilter = "low"`. Start from the `filtered` useMemo, go through `totalCount`, `totalPages`, `safePage`, `startIdx`, `pageItems`, the table `tbody` branch, and the pagination row. Write it out before checking against the running app.

<details>
<summary>Hint</summary>

The key branching points are: (1) `pageItems.length === 0` in the tbody, and (2) `totalCount === 0` in the pagination row. These are two separate branches with different output — one controls the table content, the other controls the pagination label text.

</details>

---

### Challenge 2 — Add a "Company has research" badge (20–30 min)

Add a small badge to the COMPANY column that appears only when `job.company_research !== null`. The badge should use `bg-accent-light text-accent text-xs font-medium px-2 py-0.5 rounded-full` and say "Researched". Place it to the right of the company name within the same flex row.

This requires: reading the `Job` type to confirm `company_research` is nullable, touching only `JobsTable.tsx`, and using only existing token classes.

<details>
<summary>Hint</summary>

In the company `<td>`, the flex row currently holds the logo placeholder and `<span>` with company name. Add `{job.company_research && <span className="...">Researched</span>}` after the name span, still inside the flex container. No new component needed.

</details>

---

### Challenge 3 — Break and fix: move `MatchScoreBar` inside `JobsTable` (30–45 min)

Move `MatchScoreBar` from module scope to inside `JobsTable`'s function body — just above the `return` statement. Run `npm run lint`. Record what ESLint reports. Then add a `useState` call inside `MatchScoreBar` (e.g., `const [hover, setHover] = useState(false)`) and observe what happens when `matchFilter` state changes cause `JobsTable` to re-render. Describe in writing: what does React do to the `MatchScoreBar` instances on each re-render, and why? Restore `MatchScoreBar` to module scope when done.

<details>
<summary>Hint</summary>

With `useState` added inside the moved `MatchScoreBar`, any state change in `JobsTable` causes all `MatchScoreBar` instances to lose their `hover` state. Watch the `hover` state in React DevTools while toggling `matchFilter` — you should see all instances reset. Without `useState`, the bug is invisible at runtime but structurally present. ESLint's `react-hooks/static-components` rule fires in both cases.

</details>

---

For deeper exploration, `docs/plan/09-find-jobs-ui/ai-discussion-topics.md` has 14 prompts covering the sibling refresh architecture, Tailwind's static scan limitations, React component identity, pagination clamping, and the Feature 10/11 wiring roadmap. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
