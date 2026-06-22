# Fix Explanation — Auth App URL Guard

## Context

The OAuth Server Action builds a callback URL for InsForge:

```ts
redirectTo: new URL("/api/auth/callback", appUrl).toString()
```

The base URL comes from `NEXT_PUBLIC_APP_URL` because the OAuth provider needs an absolute redirect target.

## The gap

Before the fix, the environment variable was passed directly into `new URL()`.

If the variable was missing, the user would see a generic `TypeError` from URL construction. That error points at the symptom, not the real setup problem.

## The fix

`startOAuth()` now validates the environment variable before the URL constructor:

```ts
const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

if (!appUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_APP_URL. Set it to your app origin, for example http://localhost:3000.",
  );
}
```

The validated `appUrl` is then reused for the callback URL.

## Why this happens before the OAuth try/catch

The missing env var is a local configuration error, not an OAuth provider failure. Keeping it outside the SDK call makes the failure message direct during development.

## Verification

`npm run lint` passed after the change.
