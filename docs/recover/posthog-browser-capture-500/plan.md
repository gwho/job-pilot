# Recovery Plan — PostHog Browser Capture 500

## Problem

PostHog browser requests were failing in development with:

```text
[PostHog.js] "Bad HTTP status: 500 Internal Server Error"
```

The browser SDK was configured to send to `/ingest`, which depends on Next.js rewrites proxying requests from the local Next dev server to PostHog.

## Diagnosis

This is a targeted recovery, not a full rebuild. The failure is isolated to browser-side PostHog transport.

The Next.js rewrite proxy is appropriate for deployed environments, but in local development it adds an extra server-side network hop. In this environment, that hop fails before events reach PostHog, so the SDK receives a local 500 response and logs a capture failure.

## Fix

Update `instrumentation-client.ts` so:

- Development sends directly to `NEXT_PUBLIC_POSTHOG_HOST`.
- Production continues using `/ingest`.
- PostHog does not initialize if required env vars are missing.
- Browser automatic capture is disabled so only approved JobPilot events are sent.
- Dev debug logging is disabled to avoid noisy console output.

## Verification

- `npm run lint`
- `npx tsc --noEmit`

## Follow-up

When testing production deployment, verify `/ingest` responses in the browser Network tab. If deployed rewrites return 400, 500, or 503, replace the rewrite proxy with a dedicated route-handler proxy or PostHog managed reverse proxy.
