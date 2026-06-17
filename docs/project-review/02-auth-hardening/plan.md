# Project Review — Auth Hardening (Feature 02 Follow-Up)

## What was reviewed

Feature 02 Auth in its post-completion-pass state. All files planned in `docs/plan/02-auth/plan.md` and `docs/plan/02-auth-completion/plan.md` were confirmed present and correct.

## What was found

### Layer 1 — Plan alignment
**PASS.** Every file from both the initial auth plan and the completion pass was present and matched its description. TypeScript clean.

### Layer 2 — System integrity

**Minor — `context/code-standards.md` Server Actions pattern incomplete:**
The Server Actions section documented a `{ success: boolean, error?: string }` return pattern for all Server Actions, but the auth actions (`signInWithGoogle`, `signInWithGithub`, `signOut`) use `redirect()` instead of returning. This is correct behavior — `redirect()` is a special Next.js mechanism that throws internally and cannot coexist with a return value. The docs had no carve-out documenting this exception, creating a trap for future agents reading the standards blind.

**Minor — Navbar CTA text always "Start for free":**
`getCtaHref()` correctly resolves to `/dashboard` when logged in, but the Navbar link always shows "Start for free" regardless. Functionally correct (nav links cover in-app navigation), semantically misleading for a returning user. Deferred — not fixed in this pass.

### Layer 3 — Production readiness

**Important — `lib/auth.ts:getCtaHref()` had no error handling:**
`getCurrentUser()` was called without try/catch. If InsForge is unreachable, `Navbar`, `Hero`, and `BottomCTA` throw during server render — the public homepage crashes for all users during an InsForge outage. Fixed: added try/catch returning `"/login"` on error.

**Important — `proxy.ts:updateSession()` had no error handling:**
`updateSession()` was awaited without try/catch. If it throws (network timeout), every request to `/dashboard`, `/profile`, `/find-jobs` returns 500. Fixed: wrapped in try/catch, initialised `session` to empty before the call so the existing `!session.accessToken` check safely redirects to `/login` on failure.

## What was fixed

### Fix 1 — `lib/auth.ts`
Added explicit `Promise<string>` return type and try/catch around `getCurrentUser()`:
```typescript
export async function getCtaHref(): Promise<string> {
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();
    return data.user ? "/dashboard" : "/login";
  } catch {
    return "/login";
  }
}
```

### Fix 2 — `proxy.ts`
Initialised `session` before `updateSession()`, wrapped the call in try/catch:
```typescript
let session: { accessToken?: string | null } = {};
try {
  session = await updateSession({ ... });
} catch (error) {
  console.error("[proxy] updateSession failed", error);
}
```
The existing `!session.accessToken` redirect branch handles the error case — when `updateSession()` throws, `session` stays `{}` and protected routes redirect to `/login`.

### Fix 3 — `context/code-standards.md`
Added an exception note below the Server Actions bullet list documenting that auth redirect actions (`signInWithGoogle`, `signInWithGithub`, `signOut`) are the approved exception to the return pattern.

## Verification

`npx tsc --noEmit` — clean after all three fixes.

## Deferred

- Navbar "Start for free" text for logged-in users — cosmetic, deferred.
