# Fix Plan — PostHog Client Uninitialized Guard

## Problem

`instrumentation-client.ts` intentionally skips `posthog.init()` when `NEXT_PUBLIC_POSTHOG_KEY` or `NEXT_PUBLIC_POSTHOG_HOST` is missing, but `lib/posthog-client.ts` still called `posthog.identify()` and `posthog.reset()` unconditionally.

That created an edge case where the app gracefully avoided initialization but browser identity helpers could still call the uninitialized SDK.

## Fix

Add a small readiness guard in `lib/posthog-client.ts`:

- Check `posthog.__loaded`.
- Return early when the SDK has not initialized.
- Keep the public helper API unchanged.

## Why this fix

The guard matches the optional initialization behavior without spreading env checks across client components. Components can keep calling `identifyPostHogUser()` and `resetPostHogUser()` safely.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
