# Explanation — Feature 09-find-jobs-ui: Find Jobs Page Full UI

## 1. The data flow: how mock jobs travel from Server Component to table

The page at `app/find-jobs/page.tsx` is an async Server Component. It runs on the server for every request, which means it can call `createInsforgeServer()` and `getCurrentUser()` securely before any HTML is sent to the client. This is the same pattern as `app/profile/page.tsx` — fetch on the server, pass typed data down to the client component as props.

In Feature 09 there is no real DB query yet — `MOCK_JOBS` is an array of six `Job`-typed objects defined directly inside the server function. The page then passes it as `jobs={MOCK_JOBS}` to `<JobsTable />`. When Feature 11 wires real DB data, the only thing that changes is what `MOCK_JOBS` is replaced with — a real `insforge.database.from("jobs").select(...)` query. The shape of the prop doesn't change because mock data is already typed as `Job[]`, the same type the real query will return. This is why it matters that mock data is typed at declaration rather than inferred from literals: it forces a structural match with the real schema from day one.

`SearchControls` receives no props because it owns no data. It renders the search form and manages its own local state (`jobTitle`, `location`, `searchStatus`). The handshake between "search was triggered" and "the jobs list updated" happens through Next.js's server-rendered page model: in Feature 10, after the API call completes, the client will call `router.refresh()` which re-triggers the Server Component to re-fetch jobs from the DB. That is why `SearchControls` and `JobsTable` are siblings rather than `SearchControls` wrapping `JobsTable` — they share no state; the server re-render is the glue.

## 2. Why `MATCH_THRESHOLD` needed its own file

`CLAUDE.md` states explicitly: "`MATCH_THRESHOLD = 70` lives in `lib/utils.ts` — import it, never hardcode." This file did not exist yet. Feature 09 is the first feature that consumes this threshold at the UI layer, so `lib/utils.ts` was created here with that single export. The reason for isolating it is the same reason any magic constant gets extracted: Features 10, 11, and beyond will all need to agree on this number — the Gemini matcher scores against it in Feature 10, the DB filter query in Feature 11 will use `gte(MATCH_THRESHOLD)` for "High Match," and Feature 14's dashboard stats will compute "Average match" relative to it. If each feature hardcoded `70`, changing the threshold later would require a grep-and-replace across agent code, server actions, and UI components. With a single `lib/utils.ts` import, it's one line to change and one file to verify.

## 3. Why match score bar fill cannot use a Tailwind class

The match score bar in `MatchScoreBar` renders a `<div>` whose background color depends on the job's match score at runtime. The fill color is not a fixed property of the component — it varies per row. This rules out a Tailwind class for the fill, because Tailwind generates a static set of CSS classes at build time; a class like `bg-success` or `bg-warning` must appear as a literal string somewhere in the source for Tailwind's scanner to include it. A computed string like `` `bg-${getColorForScore(score)}` `` will produce a class name Tailwind never saw at build time and therefore never generated.

The correct pattern is an inline `style` prop: `style={{ backgroundColor: getMatchBarColor(score) }}`. The `getMatchBarColor` function returns a CSS variable reference as a string — `"var(--color-success)"`, `"var(--color-info-medium)"`, `"var(--color-warning)"`, or `"var(--color-text-muted)"`. This keeps the implementation within the project's token system without hardcoding hex values. The CSS variables are defined in `app/globals.css`'s `@theme` block and are always available in the browser; any future token rename in `globals.css` will automatically cascade to the bar fill. Note that the track (background of the unfilled bar) uses `bg-border-light` as a static Tailwind class because it never changes — only the fill is dynamic.

## 4. The three-tier color system and why it diverges from ui-tokens.md

`context/ui-tokens.md` documents match score bar colors as a two-tier green system: 70–89% green, 90–100% green. But the design at `context/designs/find-jobs.png` shows three visually distinct bar colors: green for 96%/94%/91% (scores ≥ 90), blue for 88%/85% (scores 80–89), and orange for 72% (below 80). The user's instruction was to build "exactly as shown in find-jobs.png" — this takes precedence over ui-tokens.md.

The three-tier implementation in `getMatchBarColor` maps: ≥ 90 → `var(--color-success)` (green), ≥ 80 → `var(--color-info-medium)` (blue, `#2b7fff`), ≥ 50 → `var(--color-warning)` (orange), else → `var(--color-text-muted)` (gray). The boundary between green and blue is 80, not 70 — this is a deliberate departure from the token doc to match the design. The decision is documented here because it is the most likely source of confusion for a future developer who reads `ui-tokens.md`, sees "70-89% = green," and wonders why the code uses blue for 88%. The design is ground truth; the token doc is a starting-point reference that can lag behind design decisions.

## 5. Module-level functions and the React re-mounting rule

Three things in `JobsTable.tsx` are intentionally defined at module scope rather than inside the component function: `getMatchBarColor`, `formatRelativeDate`, and `MatchScoreBar`.

For `getMatchBarColor` and `formatRelativeDate`, this is a matter of correctness and clarity: they are pure functions that depend on no component state, so there is no reason to redefine them on every render. Placing them inside the function would technically work but is misleading — it implies a dependency on the closure that doesn't exist.

For `MatchScoreBar`, the reason is more specific. React identifies component types by reference. When a component function is defined inside another component's render function, a new function object is created every time the outer component renders. Because `===` equality fails between the old and new function references, React unmounts and remounts the component on every parent render rather than diffing it. This causes state loss (if the sub-component had state) and flickering (unnecessary DOM removal and re-insertion). The ESLint rule `react-hooks/static-components` catches this pattern explicitly — it was caught in Feature 05 for `TagInput` and the rule applies here the same way. `MatchScoreBar` belongs at module scope permanently.

## 6. Why mock `found_at` is computed inside the server function

`MOCK_JOBS` is defined inside `FindJobsPage()`, not at module level. The reason is that `found_at` values are computed using `Date.now()`:

```ts
found_at: new Date(now - 2 * 60 * 60 * 1000).toISOString()
```

If `MOCK_JOBS` were defined at module level, `Date.now()` would be called once when the Node.js module loaded — typically when the dev server started or the production build was first served. The `found_at` timestamps would then be frozen at that moment. When `formatRelativeDate` ran in `JobsTable`, it would compute the diff against the current time, and the first row might show "2 hours ago" at startup but "47 hours ago" two days later even though the page claims it was just searched. By computing `now = Date.now()` inside the async server function, every request gets fresh timestamps that match the page's "just rendered" moment. When Feature 11 replaces the mock with real DB data, this entire block disappears — but the lesson is general: any server-side value that depends on "now" must be computed inside the request handler, not at module initialization time.

## 7. The `safePage` pattern for filter-induced page drift

`JobsTable` maintains a `page` state integer that starts at 1 and is reset to 1 by every filter, sort, or text change. However, there is a subtle edge case: if a user navigates to page 3, then applies a filter that reduces the dataset to 8 items (fewer than two full pages), the `page` state still holds `3`. Using `page` directly in `(page - 1) * PAGE_SIZE` would produce `startIdx = 12` and `filtered.slice(12, 18)` would return an empty array — no rows and no "No results" message, just a blank table with a "Showing 13 to 18 of 8 results" nonsense count.

The fix is `safePage = Math.min(page, totalPages)`. `totalPages` is computed from the filtered result, so it already reflects the filter's output size. `safePage` clamps `page` to the highest valid page for the current dataset before it is used in any pagination math. `startIdx`, the page slice, and the "Showing X to Y" display all derive from `safePage`, not from `page`. The stale `page` state is not reset (that would cause a re-render and could confuse rapid filter changes) — it is simply clamped at display time.

Note that `page` is still reset to 1 by `handleFilterChange`, `handleSortChange`, and `handleTextChange`. The `safePage` clamp is a safety net for the interval between the filter applying (which changes `filtered.length`) and the page state reset propagating (which is a separate `setState`). In React, both state updates in a single event handler are batched, so in practice `page` resets to 1 before the next render — but `safePage` makes the pagination math robust against any future code path that changes the dataset without also resetting `page`.

## 8. The `pointer-events-none` requirement on inset icons

Both `SearchControls` and `JobsTable` place icons absolutely inside input fields using a pattern like:

```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" size={14} />
  <input className="pl-9 ..." />
</div>
```

The `pointer-events-none` class on the icon is not decorative — it is necessary for correct click behavior. Without it, clicking on the icon region hits the `<svg>` element rather than the `<input>` behind it. The browser fires the click on the SVG, which has no `onClick` handler and is not focusable, so the text cursor does not appear and the user perceives the input as broken in the icon zone. `pointer-events-none` removes the SVG from the event hit-testing entirely, so clicks pass through to the `<input>` underneath. This applies to any absolutely-positioned decorative element overlapping an interactive control.
