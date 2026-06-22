# Fix Explanation — CTA Auth Request Memoization

## Context

`getCtaHref()` resolves to `/dashboard` for authenticated users and `/login` for unauthenticated ones. It's called by three async Server Components on the homepage — `Navbar`, `Hero`, and `BottomCTA`.

Because Server Components don't share state by default, each call previously created its own InsForge server client and issued its own `getCurrentUser()` network request.

## The gap

Three independent `getCurrentUser()` calls per homepage request is avoidable overhead. Each call costs a network round trip to InsForge even though all three components need the same boolean answer.

## The fix

React's `cache()` wraps the async auth lookup into a per-request memoized function:

```ts
import { cache } from "react";

const getCachedCtaHref = cache(async (): Promise<string> => {
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();
    return data.user ? "/dashboard" : "/login";
  } catch {
    return "/login";
  }
});

export async function getCtaHref(): Promise<string> {
  return getCachedCtaHref();
}
```

`cache()` is scoped to a single server request. The first call within a render executes the async function; subsequent calls within the same render return the memoized result.

## Why the public API is unchanged

`getCtaHref()` remains the exported function so no callers need updating. The memoization detail is an internal implementation choice in `lib/auth.ts`.

## Behavior after the fix

On a homepage request, `getCurrentUser()` runs once. All three components (`Navbar`, `Hero`, `BottomCTA`) receive the same resolved href from that single call.
