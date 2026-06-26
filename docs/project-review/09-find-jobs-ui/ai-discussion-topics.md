# AI Discussion Topics — Project Review 09: Find Jobs Page Full UI

## Group 1: Component responsibility and the single-responsibility principle

1. `JobsTable.tsx` as built owns state management, derived data computation, filter bar UI, table UI, and pagination UI. Explain the single-responsibility principle in plain terms. Which of those five concerns violates it — and which could share a component without violating it?

2. The review recommended extracting `FindJobsClient` as a "container" component. Explain what the container/presentational component pattern is. What does a container know? What does a presentational component know? Why are they not allowed to know each other's internals?

3. `JobFilters`, `JobsTable`, and `JobsPagination` in the screenshot design are purely presentational — they take props and return JSX, no state. What does "purely presentational" buy you? Name two concrete scenarios where a purely presentational component is easier to work with than a stateful one.

4. Walk me through what changes in Feature 11 under the current `JobsTable` monolith vs. under the `FindJobsClient` wrapper design. Be specific about which lines of code in each approach need to change when filtering moves to the DB.

---

## Group 2: State ownership and lifting state up

5. "Lifting state up" is a React pattern. What problem does it solve? Give me a concrete example of two sibling components that need to share state — walk me through the wrong approach (each holds its own copy) and the right approach (lifted to the common ancestor).

6. In the screenshot design, `FindJobsClient` holds `filterText`, `matchFilter`, `sort`, and `page`. It passes handlers like `onFilterChange` and `onSortChange` down to `JobFilters`. What is the data flow direction? Trace one user interaction — typing in the filter box — through this architecture from keypress to re-render.

7. `SearchControls` also holds state (`jobTitle`, `location`, `searchStatus`). Why is it correct for `SearchControls` to hold its own state rather than lifting it to `FindJobsPage` or a wrapper? What is the rule for when to lift state vs. keep it local?

---

## Group 3: Library/utility boundaries

8. `getMatchBarColor` and `formatRelativeDate` are pure functions — they take a value and return a value, with no side effects. Why should pure functions live in `lib/` rather than in the component file that first uses them? What breaks if they stay in `components/find-jobs/JobsTable.tsx`?

9. Draw the boundary between `lib/` and `components/` in one sentence. What property of a function determines which side of the boundary it belongs on? Apply your rule to: `getMatchBarColor`, `MatchScoreBar`, `formatRelativeDate`, `inputCls` (the shared CSS class string constant).

10. `inputCls` is defined identically in both `SearchControls.tsx` and `JobsTable.tsx`. This is a minor issue, but it violates DRY. What is the risk of letting this duplication persist? Where should it live — `lib/utils.ts`, `lib/styles.ts`, a new `lib/class-names.ts`? What criteria would you use to decide?

---

## Group 4: The planning gap — when to run /architect

11. The Feature 09 plan specified state variable names, CSS classes, mock data shapes, and column names — but never specified who owns state or what interfaces exist between components. What category of decisions did the plan capture, and what category did it miss?

12. `/architect` asks "what does this component need to NOT know about?" Explain why designing for ignorance produces more maintainable code. Give an example from this project where a component knowing less made a subsequent change easier.

13. The rule proposed is: "Run `/architect` before writing the plan for any feature involving more than one connected client component." What does "connected" mean in this context? Give an example of two client components that are NOT connected, and two that are.

14. If you had run `/architect` before Feature 09, what question would the architect session have asked that the plan missed? Write the specific question you think an architect session would surface about this feature's component structure.

---

## Group 5: Design patterns in component architecture

15. The container/leaf pattern is an instance of the "separation of concerns" principle. Name two other places in this project where the same principle appears (different implementation, same idea). Explain how they are alike structurally.

16. `FindJobsClient` in the screenshot design has no JSX of its own — it just computes data and passes props down. This is sometimes called a "headless component" or "logic wrapper." Why would you choose to make a component have no JSX? What does that enforce about its responsibilities?

17. Imagine it is Feature 14 (Dashboard) and you need to show a paginated list of recent jobs. With the current `JobsTable` monolith, what would you need to do to reuse the pagination UI? With `JobsPagination` extracted, what does reuse look like? Calculate the difference in lines of code changed.
