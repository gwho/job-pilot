# Feature 03 — PostHog Initialization

## What was built

PostHog initialization was completed for the current auth foundation. The browser client is initialized through `instrumentation-client.ts`, server-side auth events are captured with flushed one-shot PostHog clients, returning authenticated users are identified from the root layout, and sign-out clears browser-side PostHog identity before the server clears the session.

## Why

The project needs PostHog active before profile, job search, company research, and dashboard analytics are built. Auth is the only complete product flow currently available, so this feature wires the two available events now: `user_signed_in` and `user_signed_out`. The remaining approved events are ready to be captured when their owning features exist.

## Files changed

- `instrumentation-client.ts` — keeps browser initialization and disables automatic pageview capture so project events stay explicit.
- `lib/posthog-server.ts` — adds typed server helpers that always call `shutdown()`.
- `lib/posthog-client.ts` — adds browser identity helpers.
- `components/analytics/PostHogIdentity.tsx` — identifies or resets the current browser identity.
- `components/layout/SignOutPostHogResetButton.tsx` — resets browser identity before sign-out submit.
- `app/layout.tsx` — mounts the identity bridge globally.
- `app/api/auth/callback/route.ts` — captures `user_signed_in`.
- `app/actions/auth.ts` and `app/api/auth/sign-out/route.ts` — capture `user_signed_out`.

## Verification

- `npm run lint`
- `npx tsc --noEmit`
