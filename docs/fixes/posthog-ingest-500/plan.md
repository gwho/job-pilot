# Fix — PostHog Ingest 500

## What was fixed

PostHog browser initialization was adjusted so local development sends directly to `NEXT_PUBLIC_POSTHOG_HOST` instead of the `/ingest` reverse proxy. Production keeps the `/ingest` path for the existing reverse proxy.

The browser SDK was also narrowed to the project-approved analytics surface by disabling automatic capture, exception capture, session recording, surveys, product tours, and web experiments.

## Why

The runtime error was:

```text
[PostHog.js] "Bad HTTP status: 500 Internal Server Error"
```

The dev log showed PostHog emitting browser events through `api_host: "/ingest"`. In local development, that means every event depends on Next.js external rewrites before it reaches PostHog. When that rewrite path fails, the browser sees an app-origin 500 and PostHog reports it as a failed capture.

Using the configured PostHog host directly in development removes the local rewrite from the capture path while keeping the production proxy behavior.

## Files changed

- `instrumentation-client.ts`
- `context/library-docs.md`

## Verification

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
