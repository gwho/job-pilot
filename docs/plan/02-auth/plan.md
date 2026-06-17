# Feature 02 — Auth (InsForge OAuth)

## What was built

- `lib/insforge-client.ts` — browser client (`createBrowserClient()` from `@insforge/sdk/ssr`), read-only, no auth mutations.
- `lib/insforge-server.ts` — server client factory (`createInsforgeServer()`), wraps `createServerClient({ cookies })` for Server Components / Route Handlers.
- `lib/auth.ts` — `getCtaHref()` helper, returns `/dashboard` or `/login` based on current session.
- `app/actions/auth.ts` — `signInWithGoogle()` / `signInWithGithub()` Server Actions. Each starts the PKCE OAuth flow via `createAuthActions().signInWithOAuth()`, stores the code verifier in an httpOnly cookie, and redirects to the provider.
- `app/(auth)/login/page.tsx` — login page with two OAuth buttons, each backed by a Server Action via a plain `<form action={...}>`.
- `app/(auth)/login/page.tsx` — shows a friendly inline error when OAuth returns to `/login?error=oauth`.
- `app/api/auth/callback/route.ts` — exchanges the OAuth code + verifier for a session via `exchangeOAuthCode()`, writes auth cookies to the outgoing redirect response, redirects to `/dashboard` on success or `/login?error=oauth` on failure.
- `app/api/auth/refresh/route.ts` — `createRefreshAuthRouter()`, a prebuilt refresh endpoint.
- `app/api/auth/sign-out/route.ts` — clears auth cookies on the outgoing JSON response via `createAuthActions().signOut()`.
- `proxy.ts` (project root) — refreshes the session via `updateSession()`, uses the refreshed access-token result for auth decisions, and redirects unauthenticated requests away from `/dashboard`, `/profile`, `/find-jobs`.
- Homepage CTAs (`Navbar`, `Hero`, `BottomCTA`) now resolve to `/login` or `/dashboard` based on session state via `getCtaHref()`.
- `.env.local` created with `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY` (fetched live via the InsForge MCP `get-anon-key` tool), and `NEXT_PUBLIC_APP_URL`.

## Why this approach

The project's own `context/architecture.md` and `context/library-docs.md` described an InsForge client pattern that turned out to be inaccurate — see `explanation.md` for the full investigation. The corrected implementation uses the package and API verified directly against the real, published `@insforge/sdk` (v1.4.2) and confirmed a second time through the InsForge MCP's `fetch-docs`/`fetch-sdk-docs` tools once they became available in a fresh session.

## Verification performed

- `npx tsc --noEmit` — clean, no type errors.
- Dev server (already running on `:3000`) serves `/login` with both OAuth buttons rendering as two distinct Server Actions.
- `curl` against `/dashboard`, `/profile`, `/find-jobs` while logged out → all 307-redirect to `/login` (proxy.ts working).
- Homepage CTA hrefs resolve to `/login` while logged out (confirmed via raw HTML).
- A standalone script calling `createAuthActions().signInWithOAuth("google", ...)` directly against the live InsForge backend returned a real `accounts.google.com` URL and a valid PKCE `codeVerifier` — confirms the OAuth init step works end-to-end against the real backend.
- `/api/auth/callback` with no params correctly redirects to `/login?error=oauth`.
- `/api/auth/refresh` with no session correctly returns 401.
- `/api/auth/sign-out` returns 200.
- Full click-through with real Google/GitHub consent screens was not scripted — that requires real account credentials and human interaction with a third-party consent UI, which isn't something to automate. This step should be manually verified once.

## Completion pass

`docs/diff/02-auth/README.md` later found that the Route Handler cookie writers and proxy auth decision needed tightening. The completion pass is documented in `docs/plan/02-auth-completion/` and corrected the callback cookie writer, API sign-out cookie writer, refreshed-session proxy check, and login error display.

## Not done / deferred

- No manual click-through of the full provider consent screen — recommended as a manual smoke test.
- `context/progress-tracker.md` updated separately (see "Decisions Made During Build").
