# Explanation — Auth Hardening (Project Review Follow-Up)

## 1. Why error handling in `getCtaHref()` matters even though auth "works"

When Feature 02 was built and tested, InsForge was reachable and `getCurrentUser()` always returned a result. The tests passed. But a function that works when everything is fine is not the same as a function that's production-safe.

`getCtaHref()` is called in three async Server Components that run on every page render — `Navbar`, `Hero`, and `BottomCTA`. When these throw unhandled exceptions, Next.js bubbles the error up and serves a 500 page instead of the page the user requested. Critically, the homepage (`/`) is a **public page** — it should be accessible to anyone, regardless of whether InsForge is up. But with the original `getCtaHref()`, a 30-second InsForge network timeout would cause the public homepage to return 500 for 30 seconds for every visitor. That's unacceptable even during a backend outage.

The fix is a single-responsibility catch: if `getCurrentUser()` throws for any reason, we don't know whether the user is logged in, so we default to `/login`. This is a conservative safe default — it degrades the "smart CTA" feature (logged-in users see "Start for free → /dashboard" instead of a different label) but preserves the page. A degraded page is always better than a crashed page.

**The general rule this illustrates:** Any external call (database, auth service, third-party API) in a hot rendering path (Server Components that run on every request) must have a defensive catch. The error handling isn't there for the happy path — it's there for the 1% of requests that hit a timeout, network blip, or backend restart.

## 2. Why `proxy.ts` is the most dangerous uncaught throw in the codebase

`proxy.ts` runs *before* any page renders, on every matched request. It's not a page — it's infrastructure. When it throws, the entire request pipeline fails with a 500 before Next.js even starts rendering a page.

The reason this wasn't caught initially: the completion pass correctly improved `proxy.ts` to use `updateSession()`'s returned `accessToken` (rather than the raw cookie) for its auth decision. That was the right architectural fix. But the natural next step — defending the `updateSession()` call itself — wasn't taken at the same time.

The fix shape is important. The naive fix would be:

```typescript
try {
  const session = await updateSession(...);
  if (isProtected && !session.accessToken) { ... }
} catch {
  // do nothing? or redirect?
}
```

But "do nothing" on error means protected routes pass through with no session — a security gap. "Redirect to `/login`" is the safe default: treat `updateSession()` failures the same as "no valid session." The implementation achieves this without duplicating the redirect logic by initialising `session = {}` before the try block — an empty object has no `accessToken`, so `!session.accessToken` is true and the existing redirect branch handles the error case automatically. This is "fail secure" — when in doubt, require authentication.

## 3. Why `redirect()` cannot coexist with a return value in Server Actions

`redirect()` in Next.js is not a regular function — it's a special escape hatch that throws a custom error object (`NEXT_REDIRECT`). Next.js catches this object at the top level and converts it into an HTTP redirect response. This means calling `redirect()` exits the current function stack the same way `throw` does — nothing after it executes.

This makes the standard Server Action return pattern (`return { success: boolean }`) incompatible with redirect-based auth actions. You can't `redirect()` and then `return { success: true }` — the return is never reached. You also can't `try { await startOAuth(...) } catch { return { success: false } }` — the `NEXT_REDIRECT` error would be caught by your catch block, preventing the redirect from happening.

The correct mental model: `redirect()` Server Actions are **navigation actions**, not data mutation actions. They don't need to report success or failure to the UI because they immediately send the user somewhere else. The concept of "returning a result to the caller" doesn't apply.

The documentation gap in `code-standards.md` was a real trap: any AI agent reading the standards in a future session, then asked to add a new auth Server Action, would see the return pattern and follow it — producing broken code that never redirects because the redirect is replaced with a return.

## 4. TypeScript revealed the real `UpdateSessionResult` type

During the fix, the first attempt typed the session fallback as:
```typescript
let session: { accessToken?: string } = {};
```

TypeScript rejected this with:
```
Type 'string | null' is not assignable to type 'string | undefined'
```

This revealed that `updateSession()` returns `{ accessToken: string | null }` — the property is always present, but can be `null` (no session) or a string (valid token). `undefined` and `null` are different in TypeScript strict mode. The correct fallback type is:
```typescript
let session: { accessToken?: string | null } = {};
```

This is a small but instructive example of how TypeScript strict mode surfaces real API contracts. The `null` vs `undefined` distinction matters: the SDK deliberately returns `null` (explicit "no value") rather than leaving the property absent (`undefined`). If you code against `undefined` and the SDK gives you `null`, your truthiness check (`!session.accessToken`) happens to work (both are falsy), but the types misalign — and in other contexts, that misalignment could cause a bug. TypeScript catching it here is the type system doing its job.

## 5. Why this review pattern matters even when features pass manual tests

The project-review skill runs against three layers: plan alignment, system integrity, and production readiness. Feature 02 passed Layer 1 (everything built) and mostly passed Layer 2 (design system and architecture are correct). The issues were in Layer 3 — and they were invisible to manual testing.

Manual testing of the auth flow (click sign in → land on dashboard → sign out) never hits the error paths caught in this review. To find them manually, you'd need to either:
- Take InsForge offline (hard to do in development) while testing
- Read the code systematically looking for uncaught awaits in rendering paths

The project-review skill forces that systematic read even when the feature "works." This is why AGENTS.md requires running `/project-review` after every feature — not to verify functionality (you can already see it working), but to verify correctness under conditions that don't exist in the happy-path test.
