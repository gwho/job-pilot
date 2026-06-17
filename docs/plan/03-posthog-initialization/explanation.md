# Feature 03 — Technical Explanation

## Browser initialization

PostHog remains initialized in `instrumentation-client.ts`, which is the Next.js client instrumentation entrypoint already present in this project. The existing `/ingest` reverse proxy stays in place through `next.config.ts`, so browser events continue routing through the application origin.

Automatic pageview capture is disabled with `capture_pageview: false`. The project standards define a closed set of product events, so this keeps analytics focused on intentional event capture rather than collecting unrelated pageview events.

## Server event helper

`lib/posthog-server.ts` now exposes `createPostHogServer`, `captureServerEvent`, and `identifyServerUser`.

Each server helper creates a fresh PostHog client with:

- `flushAt: 1`
- `flushInterval: 0`
- `host` from `NEXT_PUBLIC_POSTHOG_HOST`

The important behavior is that every helper calls `await posthog.shutdown()` in a `finally` block. Route handlers and Server Actions can end quickly, especially around redirects, and queued analytics can be lost if the client is not flushed before the function returns.

The helper also constrains event names to the approved project event union. That gives TypeScript a small guardrail against accidental event-name drift.

## Sign-in tracking

The OAuth callback identifies the user server-side and captures `user_signed_in` after `exchangeOAuthCode` succeeds. It includes:

- `distinctId`: InsForge user ID
- `properties.email`
- `properties.userId`

The server event is best placed here because the callback is the first point where the OAuth result is known to be successful and the canonical user ID is available.

## Returning user identity

The root layout reads the current InsForge session with the server client and passes the user ID/email into `PostHogIdentity`.

`PostHogIdentity` is a tiny client component because `posthog.identify()` is browser-only. It renders nothing. On authenticated renders it calls `identifyPostHogUser`; on unauthenticated renders it calls `resetPostHogUser`.

This covers the returning-user path where no OAuth callback runs during the current browser session but PostHog still needs the app user ID attached to future client-side captures.

## Sign-out tracking and reset

Server-side sign-out captures `user_signed_out` before redirecting or returning. Browser-side sign-out also needs a reset, because otherwise the browser PostHog SDK can keep the previous distinct ID after the app session has been cleared.

`SignOutButton` remains a server component with the existing Server Action form. Its submit button moved into `SignOutPostHogResetButton`, a client component with the same classes and a small `onClick` handler that calls `posthog.reset()`.

## Future event insertion points

The remaining approved events should be added when their owning features are implemented:

- `profile_completed` in the profile save Server Action, only on the first transition from incomplete to complete.
- `job_search_started` in the job discovery route before calling the agent.
- `job_found` after each discovered job is successfully saved.
- `company_researched` after a company dossier is successfully saved.
