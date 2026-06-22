# Fix Plan — OAuth Callback Verifier Cookie on Error

## Problem

`app/api/auth/callback/route.ts` returned a brand-new `NextResponse.redirect` on OAuth exchange failure, leaving two problems:

1. The `insforge_code_verifier` cookie was never deleted on error — it sat in the browser until its `maxAge` expiry (10 minutes).
2. Any cookie mutations already written to `response.cookies` by `createAuthActions` were discarded because a different response object was returned.

## Fix

- Delete the verifier cookie on the shared `response` object before any branch returns.
- On exchange failure, switch the redirect destination by mutating `response.headers.set("Location", ...)` instead of creating a new response.
- Also delete the verifier in the early `!code || !verifier` guard, which previously also returned a fresh response without cleaning up.

## Why this fix

The verifier cookie is a one-use PKCE secret. Once the callback is invoked — regardless of outcome — it should be cleared immediately. Reusing the same response object also ensures `responseCookies` mutations from `createAuthActions` are preserved.

## Verification

- Re-read the route after editing.
- Ran `git diff --check`.
- Ran `npm run lint`.
