# Diff Audit — 02 Auth

Date: 2026-06-17

## Verdict

Feature 02 Auth is structurally implemented, but it is not fully correct yet.

Most expected files and flows exist: InsForge SDK clients, OAuth Server Actions, Google/GitHub login buttons, callback route, refresh route, sign-out paths, `proxy.ts` route protection, placeholder protected pages, and docs/progress updates.

The main problem is that two Route Handlers pass the wrong cookie writer into `createAuthActions()`. That can make OAuth callback and API sign-out appear to run while failing to write the auth-cookie changes onto the actual HTTP response.

## Checklist From The Screenshot

| Claimed change | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Added InsForge SDK auth setup with `@insforge/sdk` and `@insforge/sdk/ssr` | Implemented | `package.json`, `lib/insforge-client.ts`, `lib/insforge-server.ts` | `@insforge/sdk/ssr` is a subpath of `@insforge/sdk`, not a separate dependency. |
| Added OAuth start routes for Google/GitHub | Implemented | `app/actions/auth.ts` | These are Server Actions, not API routes. That matches this repo's documented SSR pattern. |
| Added server-side OAuth callback exchange | Partially implemented | `app/api/auth/callback/route.ts` | The exchange code exists, but response cookies are wired incorrectly. |
| Added refresh/logout routes and SSR clients | Partially implemented | `app/api/auth/refresh/route.ts`, `app/api/auth/sign-out/route.ts`, `lib/insforge-server.ts`, `lib/insforge-client.ts` | Refresh route and clients exist. API sign-out has the same response-cookie wiring bug. Server Action sign-out exists and is probably the actually used path. |
| Added Next 16 route protection via `proxy.ts` | Partially implemented | `proxy.ts` | Protected matchers exist, but auth check ignores the `updateSession()` result. Expired access token + valid refresh token may still redirect. |
| Added login UI | Implemented | `app/(auth)/login/page.tsx` | Google and GitHub buttons exist and use Server Actions. |
| Added minimal protected placeholders for `/dashboard`, `/profile`, `/find-jobs` | Implemented | `app/dashboard/page.tsx`, `app/profile/page.tsx`, `app/find-jobs/page.tsx` | All three placeholders render a shared coming-soon card. |
| Updated `progress-tracker.md` and `ui-registry.md` | Implemented | `context/progress-tracker.md`, `context/ui-registry.md` | Both contain 02 Auth updates. |

## Project Review

### Layer 1 — Plan Alignment

Status: issues found.

Planned scope from `context/build-plan.md`:

- Login page with Google OAuth button and GitHub OAuth button.
- Google OAuth via InsForge.
- GitHub OAuth via InsForge.
- OAuth callback handler.
- Session management.
- Middleware/proxy protecting `/dashboard`, `/profile`, `/find-jobs`, `/find-jobs/[id]`.
- After login, redirect to `/dashboard`.

What matches:

- The login page has one Google form and one GitHub form.
- Both forms call Server Actions: `signInWithGoogle()` and `signInWithGithub()`.
- The OAuth callback route redirects to `/dashboard` after the exchange path.
- `proxy.ts` protects `/dashboard`, `/profile`, and `/find-jobs`; because `/find-jobs/[id]` starts with `/find-jobs`, it is included by the matcher.
- Minimal placeholder pages exist for the three top-level protected pages.

Gaps:

- The OAuth callback is present but likely does not persist session cookies correctly because it passes `request.cookies` as `responseCookies`.
- The API sign-out route has the same issue.
- There is no visible handling on the login page for `/login?error=oauth`; users can be redirected back with an error query and see the same page with no explanation.
- The feature plan says "Session management"; the code has refresh logic, but route protection checks the old request cookie instead of the refreshed result.

### Layer 2 — System Integrity

Status: issues found.

What respects the system:

- InsForge clients are split correctly by context:
  - Browser client in `lib/insforge-client.ts`.
  - Server client in `lib/insforge-server.ts`.
  - Auth mutations through `createAuthActions()`.
- Login UI is a Server Component with native forms, so it avoids unnecessary client-side JavaScript.
- Styling mostly uses design tokens like `bg-surface`, `border-border`, `text-text-primary`, and `bg-overlay`.
- Protected placeholders use the shared `ComingSoonCard` pattern that is registered in `context/ui-registry.md`.

System issues:

- `app/api/auth/callback/route.ts` violates the SDK's route-handler pattern by using `responseCookies: response.cookies` incorrectly as `responseCookies: request.cookies`.
- `app/api/auth/sign-out/route.ts` repeats the same route-handler cookie writer issue.
- `app/actions/auth.ts` throws raw errors from a Server Action on OAuth init failure. The code standard says Server Actions should catch errors and return `{ success: boolean, error?: string }`. OAuth actions are a special redirecting case, but the current failure path would still surface as an unhandled action error rather than a controlled user-facing error.
- `app/api/auth/sign-out/route.ts` returns `error.message` from InsForge directly. The code standard says API routes should not expose raw internal errors.
- The AGENTS prompt says Tailwind CSS 3.4 should be locked, but project context files and `package.json` currently use Tailwind v4. This is not caused by Auth, but it is a repo-level instruction conflict that future UI work needs to resolve.

### Layer 3 — Production Readiness

Status: issues found.

Critical:

- `app/api/auth/callback/route.ts` probably does not set auth cookies on the redirect response.
  - Why: the SDK's `createAuthActions()` implementation persists session cookies through its `responseCookies` writer.
  - Current code creates `const response = NextResponse.redirect(...)`, but passes `responseCookies: request.cookies`.
  - Beginner version: the server creates a "go to dashboard" response, but gives the SDK the incoming request's cookie jar instead of the outgoing response's cookie jar. Cookies that need to be sent back to the browser must be attached to the outgoing response.

- `app/api/auth/sign-out/route.ts` probably does not clear auth cookies on its JSON response.
  - Same root cause: `responseCookies` points at `request.cookies`, not `response.cookies`.
  - The UI currently uses the Server Action `signOut()` from `components/layout/SignOutButton.tsx`, so the bug may not affect the visible placeholder sign-out button. It still affects the API route that the feature claims to provide.

Important:

- `proxy.ts` calls `updateSession()`, but then checks `request.cookies.get(getAccessTokenCookieName())`.
  - The SDK returns `{ refreshed, accessToken, error }`.
  - If the access token is expired but the refresh token is valid, `updateSession()` can produce a new access token. The current check still looks at the original request cookie, so it can redirect a valid refreshed session to `/login`.
  - Beginner version: the code asks the SDK to renew the user's badge, but then checks the old badge instead of the renewed one.

- Login error states are not displayed.
  - The callback route redirects to `/login?error=oauth`, but `app/(auth)/login/page.tsx` does not read `searchParams` or show a friendly message.

Minor:

- No automated test covers the cookie-setting behavior of the callback or sign-out route.
- Full provider consent was documented as manually deferred, which is reasonable, but it means the true end-to-end OAuth path has not been proven inside this audit.

## Beginner-Friendly Flow Explanation

OAuth in this app has four main steps:

1. The user clicks "Continue with Google" or "Continue with GitHub".
2. A Server Action asks InsForge for an OAuth URL and a PKCE `codeVerifier`.
3. The app stores that verifier in an httpOnly cookie, then redirects the browser to Google or GitHub.
4. Google or GitHub redirects back to `/api/auth/callback`; the callback route exchanges the code plus verifier for real session cookies, then redirects to `/dashboard`.

The key thing to understand is that cookies move in two directions:

- Request cookies are what the browser sent to the server.
- Response cookies are what the server sends back to the browser.

When logging in or out, the app must change browser cookies. That means it must write to response cookies. Reading request cookies is not enough.

That is why the callback and API sign-out issue matters: they currently hand the SDK the wrong place to write.

## Verification Run

Passed:

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build` after network access was allowed for `next/font` to fetch Inter from Google Fonts

Build output confirmed these relevant routes:

- `/api/auth/callback`
- `/api/auth/refresh`
- `/api/auth/sign-out`
- `/dashboard`
- `/find-jobs`
- `/login`
- `/profile`
- `Proxy (Middleware)`

Not verified:

- Real Google/GitHub consent click-through with a human account.
- Browser-level cookie inspection after successful OAuth callback.
- Expired-access-token refresh behavior through `proxy.ts`.

## Useful Skills For This Type Of Task

Available project skills that fit audit/review work:

- `project-review`: Best fit for this exact task. It checks plan alignment, system integrity, and production readiness without fixing the code.
- `architect`: Useful before a feature is built, or before a complex fix, to define the intended design and avoid patching symptoms.
- `recover`: Use if a fix fails once and the same problem persists. It helps diagnose whether the issue is local, architectural, dependency-related, or needs a reset.
- `remember`: Useful at the end of multi-session feature work so the next session can restore the important context.
- `imprint`: Useful after building UI components. For this audit, it was not needed because no UI component was built.

## What Extra Info Would Enable A Deeper Review

To go deeper than this static/code-level audit, provide or allow:

- Real OAuth provider test access: a test Google/GitHub account and confirmation that OAuth apps are configured in InsForge.
- Expected InsForge backend metadata: backend URL, enabled providers, callback URL allowlist, and cookie/domain settings.
- Browser screenshots or HAR/cookie traces from a real login attempt.
- A test plan from the original auth implementation session, including manual results.
- Access to InsForge MCP tools in-session, especially latest auth and SSR docs.
- Acceptance criteria written as examples: "logged-out user visiting `/dashboard` redirects to `/login`", "successful Google login lands on `/dashboard` with cookies X/Y set", and so on.
- A decision on the Tailwind version conflict: AGENTS says 3.4, repo context/package currently says v4.

## Final Assessment

The 02 Auth feature is close in shape but not ready to treat as fully implemented.

Resolve the cookie writer bugs and proxy refresh check before moving to the next feature. Then manually smoke-test Google and GitHub OAuth once with browser cookie inspection.
