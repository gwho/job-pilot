# Fix Plan — Sign-Out Route Status Code Default

## Problem

`app/api/auth/sign-out/route.ts` passed `error.statusCode` directly as the HTTP status for SDK sign-out failures:

```ts
{ status: error.statusCode }
```

`statusCode` may be `undefined` depending on the shape of the InsForge SDK error. Passing `undefined` as `status` to `NextResponse.json()` can cause a runtime issue.

## Fix

Default to `500` when `statusCode` is absent:

```ts
{ status: error.statusCode ?? 500 }
```

## Why this fix

`500` is the correct fallback for an unexpected server-side error. The outer `catch` block already uses `500` for the same reason; this aligns the SDK error branch with the same safe default.

## Verification

- Re-read the route after editing.
- Ran `git diff --check`.
- Ran `npm run lint`.
