# Fix Plan — CTA Auth Request Memoization

## Problem

`lib/auth.ts:getCtaHref()` calls `createInsforgeServer()` and `getCurrentUser()` on every invocation. The homepage renders three components that each call `getCtaHref()` — `Navbar`, `Hero`, and `BottomCTA` — meaning up to three redundant round trips to InsForge per homepage request.

## Fix

Wrap the internal auth lookup with React's `cache()` so all calls within the same server render share one `getCurrentUser()` result.

The exported `getCtaHref()` API is unchanged — callers require no modification.

## Why this fix

React's `cache()` is the standard mechanism for request-scoped memoization in the Next.js App Router. It deduplicated network calls automatically within a single render pass without caching across requests.

## Verification

- Re-read `lib/auth.ts` after editing.
- Ran `git diff --check`.
- Ran `npm run lint`.
