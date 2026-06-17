# PostHog Ingest 500 — Technical Explanation

## Failure mode

This was a targeted runtime bug, not an architecture failure. The rest of the app could render, but PostHog browser requests were failing with a 500.

The local dev log confirmed that the SDK was initialized with:

```text
api_host: "/ingest"
```

and that it was sending browser events such as `$set` and `$autocapture`.

## Root cause

`/ingest` is a reverse-proxy path handled by Next.js rewrites in `next.config.ts`. That is useful in deployed environments because analytics traffic appears to come from the app origin.

In local development, that same path adds an extra failure point:

```text
posthog-js -> localhost /ingest -> Next.js rewrite -> us.i.posthog.com
```

If the local rewrite cannot proxy the request correctly, PostHog sees a 500 from the app origin and logs:

```text
Bad HTTP status: 500 Internal Server Error
```

The SDK was also using default `autocapture: true`, so routine clicks, including clicks inside the Next.js dev overlay, caused extra browser events and made the failure appear repeatedly.

## Fix

The browser SDK now chooses the API host by environment:

```typescript
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const apiHost = process.env.NODE_ENV === "development" ? posthogHost : "/ingest";
```

Development uses the real PostHog host directly. Production keeps `/ingest` so the existing reverse proxy remains available where it matters.

The browser config also disables automatic PostHog products that emit unapproved events:

- `autocapture: false`
- `capture_exceptions: false`
- `disable_session_recording: true`
- `disable_surveys: true`
- `disable_product_tours: true`
- `disable_web_experiments: true`

This matches `context/code-standards.md`, which only permits the six named JobPilot events.

## Why this is the right boundary

The production proxy rules stay in `next.config.ts`; they are not removed. The fix only avoids depending on those rewrites during local development, where the user is seeing the 500.

Server-side PostHog events are unaffected. They use `posthog-node` directly from `lib/posthog-server.ts` and still flush with `shutdown()`.

## What to watch later

When real client-side product events are added, they should go through a typed helper in `lib/posthog-client.ts` rather than direct `posthog.capture()` calls in components. That keeps event names constrained to the approved list.
