# JobPilot Learning Resources

## Next.js App Router

- [Next.js `useSearchParams` docs](https://nextjs.org/docs/app/api-reference/functions/use-search-params)
  Use for: Client Component URL query state, Suspense requirements, and App Router search param behavior.
- [Next.js `useRouter` docs](https://nextjs.org/docs/app/api-reference/functions/use-router)
  Use for: `router.push`, `router.replace`, `router.refresh`, and browser history behavior in App Router.
- [Next.js Linking and Navigating](https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating)
  Use for: the full picture of how history entries work with `push` vs `replace` in App Router.
- [MDN `URLSearchParams`](https://developer.mozilla.org/docs/Web/API/URLSearchParams)
  Use for: building, reading, copying, and serializing query strings.
- [MDN History API](https://developer.mozilla.org/docs/Web/API/History_API)
  Use for: the browser history stack model behind `push` versus `replace`.

## React Hooks

- [React `useEffect` reference](https://react.dev/reference/react/useEffect)
  Use for: understanding what effects are for, when they fire, and their cleanup function.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
  Use for: understanding when NOT to use `useEffect` — and therefore why the `filterTextDraft` sync effect is a legitimate exception.
- [React `useState` — functional updates](https://react.dev/reference/react/useState#updating-state-based-on-the-previous-state)
  Use for: the `setState(prev => ...)` pattern used in `mergeJobsById`. Essential for understanding why the closure form causes bugs.
- [React `useMemo` reference](https://react.dev/reference/react/useMemo)
  Use for: the filter pipeline and windowed page numbers in Feature 11.

## JavaScript

- [MDN `Map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
  Use for: the `new Map(array.map(item => [item.id, item]))` deduplication pattern in `mergeJobsById`.
- [MDN `Set`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set)
  Use for: collecting unique page numbers in `buildPageNumbers` without writing deduplication manually.
- [MDN `setTimeout` / `clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)
  Use for: the debounce pattern — schedule work, cancel it if something changes before it fires.
- [MDN Equality comparisons (`==` vs `===`)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness)
  Use for: why `!= null` catches both `null` and `undefined`, while `!== null` catches only `null`.

## Testing

- [Vitest Getting Started](https://vitest.dev/guide/)
  Use for: `describe`, `it`, `expect` basics. Start here.
- [Testing Library docs](https://testing-library.com/docs/)
  Use for: testing React components (beyond pure utility functions).

## Project internals

- [`docs/tutorials/20-filter-sort-pagination-deep-dive/README.md`](docs/tutorials/20-filter-sort-pagination-deep-dive/README.md)
  Use for: the full Feature 11 implementation tutorial grounded in JobPilot's actual files.
- [`docs/plan/11-filter-sort-pagination/explanation.md`](docs/plan/11-filter-sort-pagination/explanation.md)
  Use for: the decision rationale behind each architectural choice in Feature 11.
- [`docs/architect/11-filter-sort-pagination/discussion.md`](docs/architect/11-filter-sort-pagination/discussion.md)
  Use for: the deep reasoning session that preceded implementation — including why the initial recommendation of `useState` was reversed.

## Wisdom (Communities)

- [Next.js GitHub Discussions](https://github.com/vercel/next.js/discussions)
  High signal, official. Best for questions about specific App Router behaviour.
- [r/reactjs](https://www.reddit.com/r/reactjs/)
  Active community for React hook patterns and state management questions.
- Project session docs in `docs/architect/`, `docs/grilling/`, `docs/project-review/`, and `docs/recover/`
  Use for: seeing how decisions were challenged, corrected, and stabilized over time in this codebase.
