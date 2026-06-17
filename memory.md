# Memory — Feature 02 Auth (Full Completion + Hardening)

Last updated: 2026-06-17

## What was built

### Session: Auth Completion (prior session)

- `app/actions/auth.ts` — OAuth start actions catch thrown SDK failures, log with `[actions/auth]`, and redirect to `/login?error=oauth`. Sign-out logs failures and redirects home.
- `app/api/auth/callback/route.ts` — creates outgoing redirect response first, passes `response.cookies` to `createAuthActions()` as the response cookie writer.
- `app/api/auth/sign-out/route.ts` — creates outgoing JSON response first, passes `response.cookies` as response cookie writer, returns generic errors, preserves cookie-clearing headers on SDK error responses.
- `proxy.ts` — route protection uses `updateSession()`'s returned `accessToken` instead of original request cookie. Redirect responses preserve cookie mutations from refresh attempt.
- `app/(auth)/login/page.tsx` — Server Component renders friendly inline error for `/login?error=oauth`.
- `components/layout/ComingSoonCard.tsx` — empty-state card with title, muted description, and `SignOutButton`. Used by all three placeholder pages.
- `components/layout/SignOutButton.tsx` — form wrapping `signOut` Server Action, secondary-style button.
- Placeholder pages (`/dashboard`, `/profile`, `/find-jobs`) — each renders `<Navbar />` + `<ComingSoonCard />`. Full replacement when Features 05/09/14 are built.
- `context/library-docs.md` — corrected Route Handler cookie-writer guidance.
- `context/ui-registry.md` — registered `ComingSoonCard`, `SignOutButton`, and Login OAuth error message.
- `docs/plan/02-auth-completion/` with `plan.md`, `explanation.md`, `ai-discussion-topics.md`, `project-review.md`.

### Session: Auth Hardening (this session — /project-review findings)

- `lib/auth.ts` — `getCtaHref()` now wrapped in try/catch; returns `"/login"` on any error. Explicit `Promise<string>` return type added.
- `proxy.ts` — `updateSession()` now wrapped in try/catch; `session` initialised to `{}` before the call so the existing `!session.accessToken` redirect branch handles thrown errors safely (fail-secure). Type: `{ accessToken?: string | null }` to match real `UpdateSessionResult`.
- `context/code-standards.md` — added exception note under Server Actions documenting that redirect-based auth actions (`signInWithGoogle`, `signInWithGithub`, `signOut`) use `redirect()` instead of returning `{ success: boolean }`, and why.
- `docs/project-review/02-auth-hardening/` with `plan.md`, `explanation.md`, `ai-discussion-topics.md`.
- `context/progress-tracker.md` — Feature 02 Auth marked complete. Next: 03 PostHog Initialization.

## Decisions made

- Server-driven InsForge PKCE OAuth flow — no changes.
- Login buttons remain native forms wired to Server Actions; no Client Component.
- In Route Handlers, always create the outgoing `NextResponse` before `createAuthActions()` and pass `response.cookies` as `responseCookies`.
- Trust `updateSession()`'s returned `accessToken`, not the original request cookie, for proxy auth decisions.
- Error defaults: `getCtaHref()` returns `"/login"` on failure (conservative, preserves page render). `proxy.ts` treats thrown `updateSession()` as no session and redirects to `/login` for protected routes (fail-secure).
- Navbar CTA text ("Start for free") stays hardcoded regardless of login state — deferred. Nav links cover in-app navigation.
- No test framework added; lint + TypeScript + build + route smoke tests are the current verification approach.

## Problems solved

- Cookie-direction bug: callback and API sign-out now write session cookies to outgoing response, not request.
- Proxy auth gap: expired original access token no longer triggers redirect when `updateSession()` refreshes a valid token.
- Silent OAuth failure UX: `/login?error=oauth` shows "We could not complete sign in. Please try again."
- Crash-on-outage: `getCtaHref()` and `proxy.ts` no longer throw if InsForge is unreachable — both degrade gracefully.
- TypeScript strict mismatch: `UpdateSessionResult.accessToken` is `string | null`, not `string | undefined` — fallback type corrected to `{ accessToken?: string | null }`.
- Doc trap: `code-standards.md` Server Actions pattern had no carve-out for redirect auth actions — added to prevent future agents from generating broken return-based auth actions.

## Current state

All verification passing:
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run build` — clean.
- Logged-out `/dashboard`, `/profile`, `/find-jobs` → redirect to `/login`.
- `/api/auth/callback` with missing params → `/login?error=oauth`.
- `/api/auth/refresh` with no session → 401.
- `/api/auth/sign-out` → 200 with cookie-clearing headers.
- `/login?error=oauth` → friendly error message renders.

Not yet verified (requires human + real accounts):
- Real Google OAuth consent click-through.
- Real GitHub OAuth consent click-through.
- Expired access token + valid refresh token using real InsForge cookies.

Git status: auth/source/docs files modified but not committed.

## Next session starts with

Manual OAuth smoke test:
1. Start local dev server (`npm run dev`).
2. Open `/login` in browser.
3. Complete Google OAuth → confirm land on `/dashboard` with Navbar + ComingSoonCard + Sign out button.
4. Inspect cookies → confirm InsForge auth cookies exist.
5. Click Sign out → confirm redirect to `/`, then `/dashboard` redirects to `/login`.
6. Repeat with GitHub.
7. If both pass → move to **Feature 03: PostHog Initialization**.

## Open questions

- Are Google and GitHub OAuth providers fully configured in the InsForge backend for the current `NEXT_PUBLIC_APP_URL=http://localhost:3000`? Check InsForge dashboard if OAuth click-through fails.
- Should the Tailwind v3 vs v4 conflict (AGENTS.md says v3, project uses v4) be resolved before more UI work begins?
- Should automated route/proxy tests be added once the project picks a test framework?

---

# Memory — Feature 03 PostHog Initialization + Recovery

Last updated: 2026-06-17

## What was built

- `instrumentation-client.ts` — PostHog browser initialization is guarded by env presence. Development sends directly to `NEXT_PUBLIC_POSTHOG_HOST`; production uses `/ingest`. Browser autocapture, pageleave/pageview capture, session recording, surveys, product tours, web experiments, exception capture, and SDK debug logging are disabled for a focused event-only integration.
- `lib/posthog-server.ts` — typed server helpers for approved JobPilot event names. Server events use one-shot `posthog-node` clients and call `shutdown()` before returning.
- `lib/posthog-client.ts` — browser identity helpers now check `posthog.__loaded` before calling `identify()` or `reset()`, so missing analytics env vars do not cause uninitialized SDK calls.
- `components/analytics/PostHogIdentity.tsx` — client bridge mounted from root layout; identifies authenticated users or resets when unauthenticated.
- `components/layout/SignOutPostHogResetButton.tsx` and `components/layout/SignOutButton.tsx` — sign-out resets browser PostHog identity before submitting the server action.
- `app/layout.tsx` — reads current InsForge user server-side and passes user ID/email to `PostHogIdentity`.
- `app/api/auth/callback/route.ts` — captures `user_signed_in` after successful OAuth callback.
- `app/actions/auth.ts` and `app/api/auth/sign-out/route.ts` — capture `user_signed_out`.
- Docs added:
  - `docs/plan/03-posthog-initialization/`
  - `docs/recover/posthog-browser-capture-500/`
  - `docs/fixes/posthog-client-uninitialized-guard/`

## Decisions made

- Browser PostHog traffic uses direct PostHog host in development to avoid local `/ingest` rewrite failures; production keeps `/ingest` for first-party proxy behavior.
- Browser automatic capture remains disabled because `context/code-standards.md` defines a closed list of six approved events.
- PostHog env vars are optional for app rendering. Missing analytics configuration should disable analytics quietly, not break UI.
- Browser SDK readiness is centralized in `lib/posthog-client.ts`, not scattered through components.
- Server-side PostHog events should always use the helper so `shutdown()` is not forgotten.

## Problems solved

- Development PostHog browser requests were failing with `[PostHog.js] "Bad HTTP status: 500 Internal Server Error"` because `/ingest` relied on local Next.js rewrites and server-side outbound proxying. Development now bypasses `/ingest`.
- PostHog browser debug/autocapture was sending noisy events, including Next.js dev overlay clicks. Autocapture/debug logging are disabled.
- Optional browser initialization created an edge case where `identify()`/`reset()` could run against an uninitialized SDK. `posthog.__loaded` guard fixes this.

## Current state

All verification passing:

- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.

Not yet verified:

- Real browser Network tab after restarting `next dev`, confirming dev PostHog requests go to `NEXT_PUBLIC_POSTHOG_HOST` and no longer report `/ingest` 500s.
- Production deployment `/ingest` rewrite path.
- Real PostHog activity feed for `user_signed_in` and `user_signed_out` after OAuth/sign-out smoke tests.

Git status: PostHog source/docs files are modified or untracked but not committed.

## Next session starts with

Manual PostHog smoke test:

1. Restart local dev server so `instrumentation-client.ts` reloads.
2. Open the app and DevTools Network tab.
3. Sign in with a real provider.
4. Confirm browser PostHog traffic in development goes to the configured PostHog host, not `/ingest`.
5. Confirm no PostHog 500 console error appears.
6. Sign out and verify `user_signed_out` appears in PostHog activity.
7. On deployment, verify `/ingest/...` returns success; if not, replace rewrites with a route-handler proxy or managed PostHog reverse proxy.

## Open questions

- Should production keep the Next.js rewrite proxy, or move to a dedicated route-handler proxy/managed PostHog reverse proxy before launch?
- Should `user_signed_out` remain captured in both Server Action and API route paths, or should one sign-out path be retired once the app settles on a single sign-out mechanism?
- Should a typed browser `capturePostHogEvent()` helper be added when the first future client-side event is needed?
