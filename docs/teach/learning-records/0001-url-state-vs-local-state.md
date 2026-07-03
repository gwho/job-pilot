# 0001 — URL State vs Local State

**Date:** 2026-06-29
**Feature:** Feature 11 — Filter + Sort + Pagination

## Key insight

React component state is destroyed when you navigate away from a page. URL query params survive navigation. This single fact determines where view state belongs.

The question to ask: "If the user presses back from a different page, should they land here with this value restored?" If yes → URL. If no → `useState`.

## Non-obvious nuance

`filterTextDraft` is the exception that proves the rule. It is `useState`, not a URL param — but only because updating the URL on every keystroke would cause lag. The two-`useEffect` guard pattern keeps them in sync without creating an infinite replace loop.

## Common mistake to avoid

Using `router.push()` for filter/sort/page changes. This adds a new browser history entry for every refinement. After five filter changes, the user needs six back-presses to leave the page. `replace()` overwrites the current entry — one back-press always leaves.

## What the tests prove

The parse helpers in `lib/find-jobs-utils.ts` (and their tests in `__tests__/find-jobs/utils.test.ts`) codify the rule: any invalid or missing URL param defaults silently to a sensible value. No crash. No empty screen.
