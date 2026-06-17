# Implementation Plan — Complete Feature 02 Auth

Date: 2026-06-17

Blueprint ready.

## What We Are Building

This is a completion pass for Feature 02 Auth, not a new feature. The goal is to make the existing InsForge Google/GitHub OAuth flow genuinely work end to end: OAuth starts from the login page, the callback exchanges the code and writes session cookies to the browser, protected routes respect refreshed sessions, sign-out clears cookies, login failures show a friendly message, and the docs/context match the corrected implementation.

## Language We Are Using

- OAuth start: the Server Action that asks InsForge for a provider URL and PKCE verifier, then redirects the browser to Google or GitHub.
- OAuth callback: the Route Handler at `/api/auth/callback` that receives `insforge_code`, reads the PKCE verifier cookie, exchanges them for a session, and redirects to `/dashboard`.
- Request cookies: cookies the browser sent into the server. These are for reading current state.
- Response cookies: cookies the server sends back to the browser. These are required when login/logout changes session state.
- Session refresh: `proxy.ts` calling `updateSession()` so an expired access token can be renewed from a valid refresh token before protected pages render.
- Protected routes: `/dashboard`, `/profile`, `/find-jobs`, and every nested `/find-jobs/*` route.

## Decisions Made

- Keep the current server-driven PKCE flow.
  - Reason: it matches the project architecture and keeps refresh-token handling server-owned/httpOnly.

- Fix the Route Handler cookie writer bug directly.
  - Reason: `createAuthActions()` persists or clears auth cookies through its `responseCookies` writer. In Route Handlers, that must be the outgoing `NextResponse.cookies`, not `request.cookies`.

- Use the `updateSession()` return value in `proxy.ts`.
  - Reason: checking only the original request cookie misses the refreshed access token returned by the SDK.

- Preserve cookie mutations when redirecting from `proxy.ts`.
  - Reason: if `updateSession()` clears stale cookies or refreshes tokens, the final returned response must carry those `Set-Cookie` headers.

- Keep login UI as a Server Component.
  - Reason: the current `<form action={signInWithGoogle}>` pattern is simple, progressively enhanced, and avoids unnecessary client-side JavaScript.

- Add only a small token-based login error message.
  - Reason: `/login?error=oauth` currently has no visible state, but this does not justify a larger login-page redesign.

- Do not install a test framework as part of this fix unless explicitly approved.
  - Reason: the current project has no test framework dependency. Verification can be done with lint, TypeScript, build, route smoke tests, and manual OAuth.

## Assumptions

- The InsForge backend is configured with Google and GitHub providers.
- `NEXT_PUBLIC_APP_URL` matches the local or deployed origin used during OAuth.
- The provider callback allowlist includes `${NEXT_PUBLIC_APP_URL}/api/auth/callback`.
- The current Tailwind v3 versus v4 instruction conflict is outside the auth completion pass unless the user separately asks to resolve it.
- A real provider click-through still requires manual browser testing with a human Google/GitHub account.

## How To Build It

1. Verify current docs and APIs before editing.
   - Recheck the installed `@insforge/sdk` SSR types and implementation.
   - Recheck the Next.js 16 `proxy.ts` documentation.
   - If InsForge MCP tools are available in a future session, fetch the latest SSR/auth docs before changing auth code.

2. Fix `/api/auth/callback`.
   - Create the redirect response before constructing `createAuthActions()`.
   - Pass `requestCookies: request.cookies` for reading existing cookies.
   - Pass `responseCookies: response.cookies` from the outgoing redirect response for writing session cookies.
   - On missing code/verifier, redirect to `/login?error=oauth`.
   - On exchange failure, log with `[api/auth/callback]` and redirect to `/login?error=oauth`.
   - Delete the `insforge_code_verifier` cookie from the same successful redirect response that carries the new auth cookies.

3. Fix `/api/auth/sign-out`.
   - Create the JSON response before constructing `createAuthActions()`.
   - Pass `requestCookies: request.cookies`.
   - Pass `responseCookies: response.cookies` from the outgoing JSON response.
   - Wrap the handler in `try/catch`.
   - Log failures with `[api/auth/sign-out]`.
   - Return a generic `{ success: false, error: "Failed to sign out" }` message instead of `error.message`.
   - Preserve `{ success: true }` on the successful response after cookies are cleared.

4. Review the Server Action sign-out path.
   - Keep `components/layout/SignOutButton.tsx` using the Server Action unless there is a reason to switch to the API route.
   - Add error handling to `signOut()` if it can fail without redirecting.
   - Do not expose raw InsForge errors to the user.

5. Harden OAuth start actions.
   - Keep `signInWithGoogle()` and `signInWithGithub()` as redirecting Server Actions.
   - Avoid returning raw SDK errors.
   - On OAuth initialization failure, log with `[actions/auth]` and redirect to `/login?error=oauth`.
   - Confirm this still works with Server Action redirect behavior.

6. Fix `proxy.ts` route protection.
   - Keep matchers for `/dashboard/:path*`, `/profile/:path*`, and `/find-jobs/:path*`.
   - Call `updateSession()` before deciding whether a protected request is authenticated.
   - Use `session.accessToken` from the result instead of `request.cookies.get(getAccessTokenCookieName())`.
   - If redirecting to `/login`, preserve any cookies that `updateSession()` cleared or changed.
   - Consider adding a `next` query parameter only if the product wants return-after-login behavior; otherwise keep the current simple `/login` redirect.

7. Add a friendly login error state.
   - Update `app/(auth)/login/page.tsx` to accept `searchParams`.
   - If `error=oauth`, show a concise message such as "We could not complete sign in. Please try again."
   - Use existing tokens only, for example `bg-error` or `text-error` if visually appropriate.
   - Keep the page a Server Component.
   - If this creates a reusable alert pattern, update `context/ui-registry.md` after implementation.

8. Correct project documentation that would cause the same bug again.
   - Update `context/library-docs.md` callback example so it clearly names the outgoing response cookie writer.
   - Update any `docs/plan/02-auth` explanation that implies the current callback route writes cookies correctly.
   - Update `context/progress-tracker.md` after fixes are verified.
   - Add `docs/plan/02-auth-completion/` or similar only if treating this as a formal fix feature under the project's docs rule.

9. Verify locally.
   - Run `npm run lint`.
   - Run `npx tsc --noEmit`.
   - Run `npm run build`; if `next/font` needs Google Fonts network access, approve network for that build.
   - Run logged-out route checks for `/dashboard`, `/profile`, `/find-jobs`, and a nested `/find-jobs/example-id`.
   - Check `/api/auth/callback` with missing params redirects to `/login?error=oauth`.
   - Check `/api/auth/refresh` without a session returns unauthorized behavior as expected.
   - Check sign-out response sets cookie-clearing headers.

10. Verify manually in the browser.
   - Start the dev server.
   - Open `/login`.
   - Click Google and complete the consent flow.
   - Confirm the final URL is `/dashboard`.
   - Inspect cookies and confirm InsForge auth cookies exist.
   - Sign out and confirm auth cookies are cleared.
   - Repeat with GitHub.
   - Test an expired access token with valid refresh token if practical; otherwise document that this remains a targeted manual or automated follow-up.

11. Run `project-review` after implementation.
   - Recheck plan alignment, system integrity, and production readiness.
   - Confirm the previous critical issues are resolved.
   - If a similar bug persists after one fix attempt, stop and use `recover`.

## Definition Of Done

- Google OAuth and GitHub OAuth both complete to `/dashboard`.
- Successful OAuth callback writes session cookies on the redirect response.
- API sign-out clears auth cookies on the response it returns.
- Protected pages redirect logged-out users to `/login`.
- Refreshed sessions are allowed through protected routes.
- OAuth failures show a friendly login error.
- Lint, TypeScript, and production build pass.
- `context/progress-tracker.md` and any affected docs are updated.
- A follow-up review confirms no critical or important auth findings remain.
