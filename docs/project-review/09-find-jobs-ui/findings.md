# Findings — Feature 09: Find Jobs Page Full UI

## Finding 1 — Pure utilities locked inside a component file

### What the problem is

`getMatchBarColor(score: number): string` and `formatRelativeDate(dateStr: string): string`
are defined at module scope inside `components/find-jobs/JobsTable.tsx`. They are pure
functions: they take a primitive value and return a primitive value. They have no
dependency on React state, hooks, JSX, or component lifecycle. They could be called from
a Node.js script, a Server Component, or a unit test with no framework setup.

The project's architecture rule is that `lib/` owns shared utilities and `components/`
owns UI-only code. Placing pure transformers in a component file violates this boundary
in two ways:

1. **Discoverability** — a developer building Feature 14 (Dashboard) who needs to format
   a match score bar color has to either search the codebase for the function name or
   re-implement it. There is no obvious place to look because `lib/` is the documented
   home for utilities.

2. **Reusability** — any code outside `components/find-jobs/JobsTable.tsx` that needs
   `getMatchBarColor` cannot import it without pulling in the entire jobs table module
   (including its React hooks, which will fail in non-React contexts).

### What the correct pattern is

Pure transform functions belong in `lib/utils.ts` or, once `lib/utils.ts` grows large,
in a dedicated `lib/job-utils.ts`. They should be named exports, importable from anywhere
in the project. `MatchScoreBar` (the React component that calls `getMatchBarColor`)
correctly stays in the component file — it renders JSX, it has no place in `lib/`.

The boundary to remember: if a function could be tested with `expect(fn(input)).toBe(output)`
without mounting any React component, it belongs in `lib/`.

### How to recognise this in future code

Scan module-level functions in any `components/` file. Ask: does this function render
JSX, read React state, or call hooks? If the answer to all three is no, it should live
in `lib/`, not in the component file.

---

## Finding 2 — `JobsTable.tsx` owns too many concerns

### What the problem is

After Feature 09 shipped, `JobsTable.tsx` is a ~200-line component responsible for:

1. **State management** — four `useState` calls: `filterText`, `matchFilter`, `sort`, `page`
2. **Derived data pipeline** — a `useMemo` that applies match filter → text filter → sort → slice
3. **Pagination math** — `totalCount`, `totalPages`, `safePage`, `startIdx`, `pageNumbers`
4. **Filter bar UI** — text input + match dropdown + sort dropdown (the card's header section)
5. **Table rows UI** — `<table>`, `<thead>`, `<tbody>`, per-row `<tr>` mapping
6. **Pagination UI** — "Showing X to Y of Z", page number buttons, Previous/Next

This is the "God Component" antipattern: one file that does everything for one UI section.
It works today, but it has two concrete costs:

**Cost 1 — Feature 11 migration is harder than it needs to be.**
Feature 11 moves filtering from client-side `useMemo` to server-side DB queries. When
that happens, the filter state (`matchFilter`, `sort`, `filterText`) needs to become URL
search params instead of in-memory state, and the `useMemo` pipeline disappears entirely.
With the current structure, this requires surgical edits throughout `JobsTable.tsx` —
touching state, derived data, pagination math, and the filter bar JSX all at once. With
`FindJobsClient` owning the state and pipeline separately from `JobFilters`, `JobsTable`,
and `JobsPagination`, the Feature 11 change is isolated to `FindJobsClient` only.

**Cost 2 — Component reuse is impossible.**
`JobsPagination` is a self-contained UI element that appears on any page that paginates
a list. With the current design it cannot be extracted without breaking `JobsTable`. With
the screenshot design, `JobsPagination` is a pure presentational component — it takes
`page`, `totalPages`, `totalCount`, `onPageChange` as props and renders. It can be
dropped into Feature 12 (Job Details), Feature 14 (Dashboard), or any future list page
with no changes.

### What the correct pattern is

The screenshot design uses a "container + leaves" structure:

```
FindJobsClient   (owns: state, useMemo, pagination math)
  ├── JobFilters   (receives: filterText, matchFilter, sort, onChange handlers)
  ├── JobsTable    (receives: pageItems Job[], nothing else)
  └── JobsPagination (receives: page, totalPages, totalCount, onPageChange)
```

`FindJobsClient` is marked `"use client"` and owns all mutable state. It computes the
derived data and passes slices of it down as props. The three leaf components are
stateless presentational components — they receive props and return JSX. They have no
`useState`, no `useMemo`, no side effects.

This pattern is called "lifting state up" combined with "presentational/container
separation." The container (`FindJobsClient`) knows about state and data. The leaves
know about pixels and events. Neither knows about the other's internals.

### Why the plan didn't catch this

The Feature 09 plan went directly from "here is the design image" to "here is the
component structure." It specified `JobsTable` as the owner of filter/sort/pagination
without asking whether that was the right ownership model. The plan answered the question
"what does this component do?" without first answering "what *should* this component own?"

The `/architect` skill is designed to ask the second question before the first is
answered. An architect session would have surfaced:

- "Feature 11 will move filtering server-side — which component will change?"
- "What stays frozen when Feature 11 ships — the UI, or the data logic?"
- "If `JobsPagination` needs to appear on a different page, what does that require today
  vs. with the extracted design?"

These questions drive toward `FindJobsClient` as the natural answer: a wrapper that owns
volatile data logic while leaving UI leaves stable.

### How to recognise this in future code

Any client component that has more than two `useState` calls AND renders JSX for multiple
visually distinct sections (filter bar, table, pagination) is a candidate for
container/leaf decomposition. The question to ask: "if the data source changes, how many
JSX sections have to change?" If the answer is more than one, the state and data logic
should be extracted.

---

## Finding 3 — Plan quality gap: structural decisions were skipped

### What the problem is

This is a meta-finding about process, not code. Both Finding 1 and Finding 2 trace to
the same root: the Feature 09 plan was written without explicitly designing the component
responsibility boundary. The plan specified state names, CSS class names, mock data
shapes, and column names — all implementation details. It did not specify:

- Which component owns which state
- Which functions belong in `lib/` vs. in component files
- How the structure should accommodate Feature 11's known migration

### What the correct pattern is

Any feature involving more than one connected client component should go through
`/architect` before the implementation plan is written. The architect session produces
structural decisions (who owns what, what interfaces exist between components, how the
structure survives the next known change). The implementation plan then encodes those
decisions as a build recipe.

The workflow:
```
/architect → structural decisions → /plan → implementation details → build
```

Without the architect step, the plan encodes the first workable structure that comes to
mind — which is usually the simplest structure that makes the feature work today, not
the structure that accommodates tomorrow's known changes.

The key question `/architect` asks that a direct plan does not: **"What does this
component need to NOT know about?"** A component that doesn't know about data fetching
is safe when data fetching changes. A component that doesn't know about state is
safe when state management changes. Designing for ignorance is how you build components
that survive feature evolution.
