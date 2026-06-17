# Recovery Explanation — PostHog Browser Capture 500

## What failed

The PostHog browser SDK was initialized with:

```ts
api_host: "/ingest"
```

That means browser events do not go directly to PostHog. They go to the local app first, then Next.js rewrites forward them to PostHog's ingestion API.

The observed error:

```text
[PostHog.js] "Bad HTTP status: 500 Internal Server Error"
```

means the SDK made a request and received an HTTP 500 response. The important detail is that, with `api_host: "/ingest"`, the 500 is produced along the local app proxy path, not necessarily by the PostHog ingestion API itself.

## Why this happened

PostHog's Next.js rewrite proxy pattern routes all browser analytics traffic through the Next server:

```text
browser -> /ingest -> Next.js rewrite -> PostHog
```

That is useful in production because the browser only sees first-party requests, which can improve delivery through ad blockers.

In local development, that proxy path is more fragile:

- the local dev server must be running with current `next.config.ts`;
- the dev server must be able to make outbound requests to PostHog;
- request bodies and trailing slashes must survive the rewrite;
- a proxy failure is reported back to the browser SDK as a local HTTP failure.

The local environment showed this exact shape: the SDK was logging events with `$lib_custom_api_host: "/ingest"`, then surfacing a 500 from the transport path.

## Why the fix uses direct PostHog host in development

Development does not need the ad-blocker-resistant reverse proxy. It needs reliable feedback that events are being sent and correctly attributed.

The fix changes the browser SDK host selection:

```ts
api_host: process.env.NODE_ENV === "development" ? posthogHost : "/ingest"
```

That gives two modes:

- Development: `browser -> NEXT_PUBLIC_POSTHOG_HOST`
- Production: `browser -> /ingest -> Next.js rewrite -> PostHog`

This removes the fragile local server proxy from the development loop while preserving the production proxy setup.

## Why env vars are checked before initialization

The previous implementation used non-null assumptions. If either PostHog env var is missing, the SDK could initialize with an invalid token or host and then fail noisily at runtime.

The new implementation only calls `posthog.init()` when both are present:

```ts
if (posthogKey && posthogHost) {
  posthog.init(posthogKey, ...)
}
```

This is intentionally quiet. Missing analytics configuration should not break the app shell.

## Why autocapture was disabled

JobPilot has a closed list of approved analytics events in `context/code-standards.md`:

- `user_signed_in`
- `user_signed_out`
- `job_search_started`
- `job_found`
- `profile_completed`
- `company_researched`

PostHog autocapture was sending generic click events, including clicks inside the Next.js dev overlay. Those are not part of the product analytics contract and add noise.

Disabling autocapture keeps analytics aligned with the project rule: app code should explicitly emit only the approved events.

## Why session recording, surveys, product tours, and web experiments are disabled

This project currently needs event tracking and later dashboard charts. It does not currently use PostHog session replay, surveys, product tours, or web experiments.

Disabling those browser-side products reduces extra remote-config and asset requests. That narrows the integration to the behavior the app actually uses right now.

## What remains unchanged

Server-side PostHog capture still uses `posthog-node` and should keep flushing events with `shutdown()` before returning from route handlers or Server Actions.

Production still has the `/ingest` rewrite rules in `next.config.ts`. Those should be verified against the deployed environment because rewrite support varies by host and runtime.

## Verification performed

The codebase passes:

```bash
npm run lint
npx tsc --noEmit
```

## How to verify manually

In development:

1. Restart `next dev` so instrumentation changes are reloaded.
2. Open the app.
3. Open browser DevTools Network tab.
4. Trigger a PostHog event, such as signing in or signing out.
5. Confirm browser requests go to the configured PostHog host, not `/ingest`.
6. Confirm the console no longer reports the PostHog 500 transport error.

In production:

1. Open the deployed app.
2. Trigger an approved event.
3. Confirm `/ingest/...` requests return `200`.
4. Confirm the event appears in PostHog activity.
