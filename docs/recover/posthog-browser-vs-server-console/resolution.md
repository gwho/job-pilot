# Resolution — PostHog: No Activity Updates Appearing

## Root cause

The PostHog integration was working correctly throughout. No code was broken.

The user was checking the **terminal** (the Node.js server process output from `npm run dev`) for PostHog logs. `instrumentation-client.ts` is browser-side code — its `console.log` output appears exclusively in the **browser developer tools console** (F12 → Console tab in Chrome/Edge/Firefox). The two runtimes have separate consoles, and diagnostic output from client-side code is invisible in the server terminal.

## What changed during the session

Two temporary diagnostic changes were made to `instrumentation-client.ts`, then reverted:

**Added (then removed):**
```typescript
console.log("[PostHog init]", {
  keySet: !!posthogKey,
  hostSet: !!posthogHost,
  host: posthogHost,
});
```

**Changed temporarily, then reverted:**
```typescript
// Temporarily: debug: true
// Restored to: debug: false
```

The file was returned to its exact original state. No permanent code changes were made.

## What was discarded

Two initial hypotheses were ruled out during diagnosis:

1. **`.env.local` corruption** — the user confirmed the file was unchanged. `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` were intact.
2. **Dev server stale env** — restarting the server was the correct first step and was performed, but it was not the root cause.

## What the session confirmed about the codebase

**The PostHog wiring is correct.** Reading all five PostHog files during diagnosis confirmed:

- `instrumentation-client.ts` initialises PostHog in the browser with the correct guard, host routing, and disabled-by-default features (autocapture, session recording, page leave events)
- `lib/posthog-server.ts` creates one-shot PostHog Node clients with `flushAt: 1` and `flushInterval: 0`, ensuring server events are flushed immediately via `shutdown()` before the route handler returns
- `app/layout.tsx` passes `userId` and `email` from the server auth call to `PostHogIdentity`, which runs `posthog.identify()` on the client
- The `/ingest` reverse proxy in `next.config.ts` is correctly configured for production deployments
- In development, `api_host` is set to `posthogHost` directly (bypassing the proxy) — this is intentional

## The core lesson: two runtimes, two consoles

This project's Next.js architecture runs code in two distinct environments. The distinction is fundamental and applies to every debugging session, not just PostHog:

| Code | Runtime | Where logs appear |
|---|---|---|
| Server Components, API routes, Server Actions, `instrumentation.ts` | Node.js (server) | Terminal (`npm run dev` output) |
| Client Components (`"use client"`), `instrumentation-client.ts`, browser libs | Browser | Browser developer tools console (F12) |

When a symptom appears — missing log, missing event, silent failure — the first question is: **which runtime does this code run in?** The answer tells you which console to open.

## The `debug: false` silent failure pattern

PostHog's `debug: false` is the correct production setting. It means PostHog fails silently when something is wrong — no console noise in production. But during a diagnostic session, this becomes an obstacle: you cannot tell from the terminal or browser console whether PostHog initialised at all.

The diagnostic playbook for any analytics SDK with a quiet failure mode:

1. Enable debug mode (`debug: true`) to activate verbose logging
2. Add a guard-level `console.log` to confirm the initialisation path was even reached
3. Open the **browser** console (not the terminal) — client SDKs log there
4. Once confirmed working, remove the diagnostic log and restore `debug: false`

## When to re-run a PostHog diagnostic

If PostHog events stop appearing in the dashboard again:

1. Check the browser console first — is `[PostHog.js]` output visible? If yes, PostHog is initialised and the issue is upstream of the SDK (event not being fired, wrong `distinctId`, wrong project key)
2. If nothing appears in the browser console, temporarily add the guard log to `instrumentation-client.ts` to check `keySet` and `hostSet`
3. Restart the dev server after any `.env.local` change — Next.js does not hot-reload env files
4. Verify `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` are present in `.env.local` with no extra spaces, no broken quotes, no accidental line breaks
