# Diagnosis — PostHog: No Activity Updates Appearing

## What was reported

PostHog was no longer showing app activity updates. Events that had previously appeared in the PostHog dashboard were no longer visible.

## Failure mode

**Failure Mode 1 — A specific thing is broken.**

The report was isolated to a single integration (PostHog), the rest of the project appeared functional, and this was the first diagnostic attempt. The behaviour was specific: analytics events not appearing in the dashboard.

## Signs that pointed to Failure Mode 1

- The problem was scoped: "PostHog no longer showing activity" — not "the whole app is broken"
- No previous fix attempts had been made (first report)
- The symptom was clear: events not appearing
- The timing was suspicious: the report came immediately after a session where `.env.local` was manually edited (switching `GOOGLE_API_KEY` → `OPENROUTER_API_KEY`)

## Diagnostic process

### Step 1 — Read all PostHog-related files

Five files were read to establish the complete wiring:
- `instrumentation-client.ts` — client-side PostHog init (browser)
- `lib/posthog-server.ts` — server-side PostHog client (Node)
- `lib/posthog-client.ts` — browser identify/reset helpers
- `components/analytics/PostHogIdentity.tsx` — user identification on mount
- `app/layout.tsx` — where PostHogIdentity is rendered

### Step 2 — Identify the silent failure point

`instrumentation-client.ts` line 6 contains a guard:

```typescript
if (posthogKey && posthogHost) {
  posthog.init(posthogKey, { ... debug: false });
}
```

With `debug: false`, PostHog fails completely silently if either env var is missing — no error, no warning, no event. This was identified as the critical failure point: if `NEXT_PUBLIC_POSTHOG_KEY` or `NEXT_PUBLIC_POSTHOG_HOST` was absent, the entire integration would silently do nothing.

### Step 3 — Identify two candidate root causes

**Root cause A:** `.env.local` editing had accidentally affected the PostHog env vars. The `if (posthogKey && posthogHost)` guard would evaluate false, PostHog would never initialise.

**Root cause B:** Dev server not restarted after editing `.env.local`. Next.js does not hot-reload env file changes — a restart is required for new values to take effect.

### Step 4 — Deploy diagnostics

Two temporary changes were made to `instrumentation-client.ts`:
1. `debug: false` → `debug: true` — PostHog logs every event to the browser console when debug mode is on
2. Added a `console.log` before the guard to show whether env vars were being read:

```typescript
console.log("[PostHog init]", {
  keySet: !!posthogKey,
  hostSet: !!posthogHost,
  host: posthogHost,
});
```

The dev server was restarted. The user reported: "still nothing PostHog related message can be found."

### Step 5 — Identify the actual problem

The diagnostic log should have appeared regardless of whether the env vars were set — it runs before the guard. If it wasn't appearing at all, `instrumentation-client.ts` was executing but its output was invisible in the place the user was looking.

**The actual root cause:** `instrumentation-client.ts` is client-side browser code. Its `console.log` output appears in the **browser developer tools console** (F12 → Console tab), not in the terminal where `npm run dev` is running.

The user was looking at the terminal (server console). The logs were in the browser console all along.

## What was NOT the root cause

- The PostHog code itself was unchanged — not touched in any prior session
- `.env.local` was confirmed unchanged by the user
- The env var guard was not evaluating false
- No code bug existed

The integration was working correctly throughout. The diagnostic was a runtime environment confusion, not a PostHog configuration failure.
