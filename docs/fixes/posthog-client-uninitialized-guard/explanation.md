# Fix Explanation — PostHog Client Uninitialized Guard

## Context

PostHog browser initialization now checks for required environment variables before calling `posthog.init()`.

```ts
if (posthogKey && posthogHost) {
  posthog.init(posthogKey, ...)
}
```

That is intentional. Missing analytics configuration should not break the app shell.

## The gap

The browser helpers in `lib/posthog-client.ts` were still unconditional:

```ts
posthog.identify(...)
posthog.reset()
```

If PostHog was not initialized, these helpers could produce SDK warnings or no-op behavior that depends on internal SDK defaults. The code was not aligned with the new optional initialization contract.

## The fix

The installed `posthog-js` type definitions expose `posthog.__loaded`. That value indicates whether the SDK singleton has been initialized.

The helper now centralizes the check:

```ts
function isPostHogReady(): boolean {
  return posthog.__loaded;
}
```

Both browser helper functions return early if the SDK is not ready.

## Why the guard lives in `lib/posthog-client.ts`

`PostHogIdentity` and `SignOutPostHogResetButton` should not need to understand PostHog initialization details. They express app intent:

- identify this authenticated user;
- reset analytics identity on sign-out.

The library wrapper owns SDK readiness. That keeps component code simple and prevents repeated checks throughout the UI.

## Behavior after the fix

When PostHog env vars are present:

- `instrumentation-client.ts` initializes the SDK.
- `posthog.__loaded` is true.
- identify/reset calls run normally.

When PostHog env vars are missing:

- initialization is skipped.
- `posthog.__loaded` stays false.
- identify/reset helpers return without side effects.

## Verification

The fix is type-safe and does not change component APIs.

Validation:

```bash
npm run lint
npx tsc --noEmit
```
