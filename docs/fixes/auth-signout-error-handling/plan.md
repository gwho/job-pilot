# Fix Plan — Auth Sign-Out Error Handling

## Problem

`app/actions/auth.ts` called `auth.signOut()` and logged SDK errors, but still continued to analytics capture and redirected to `/`.

That meant the UI could appear signed out even when InsForge reported a sign-out failure.

## Fix

Refactor `signOut()` to follow the same result-checking shape used by OAuth:

- store the SDK result;
- destructure `{ data, error }`;
- check `error` before proceeding;
- redirect to `/login?error=signout` on sign-out failure;
- only capture `user_signed_out` and redirect to `/` after a successful SDK sign-out.

## Why this fix

Sign-out is an auth mutation. The app should not proceed with success-side effects when the auth provider reports failure.

## Verification

- Re-read `app/actions/auth.ts` after editing.
- Ran `git diff --check`.
- Ran `npm run lint`.
