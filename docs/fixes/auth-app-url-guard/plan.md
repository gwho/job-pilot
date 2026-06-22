# Fix Plan — Auth App URL Guard

## Problem

`app/actions/auth.ts` constructed the OAuth callback URL with:

```ts
new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL)
```

If `NEXT_PUBLIC_APP_URL` was missing or empty, `new URL()` would throw a generic runtime `TypeError`.

## Fix

Add a small guard in `startOAuth()`:

- read `process.env.NEXT_PUBLIC_APP_URL`;
- trim it;
- throw a descriptive setup error when it is missing;
- pass the validated value to `new URL()`.

## Why this fix

OAuth cannot start correctly without a known app origin. Failing with an explicit configuration message is clearer than letting `new URL()` throw an implementation-level error.

## Verification

- Re-read `app/actions/auth.ts` after editing.
- Ran `git diff --check`.
- Ran `npm run lint`.
