# Deeper Review Inputs — 02 Auth

This audit was based on local source code, project context docs, installed SDK types/implementation, and local verification commands.

For a deeper review, collect the following.

## Runtime Evidence

- A successful Google OAuth login attempt in a real browser.
- A successful GitHub OAuth login attempt in a real browser.
- Browser cookie screenshots before login, after callback, after refresh, and after sign-out.
- The exact redirect URL returned by InsForge for each provider, with secrets redacted.
- Network traces for:
  - POST Server Action request from the login form.
  - Redirect to provider.
  - Redirect back to `/api/auth/callback`.
  - Request to `/dashboard`.
  - Sign-out request.

## Backend Configuration

- InsForge project backend URL.
- Enabled OAuth providers.
- Provider callback URL allowlist.
- Cookie domain and secure/sameSite settings.
- Whether local development uses HTTP or HTTPS.
- Whether refresh token rotation is enabled by InsForge.

## Acceptance Criteria

Recommended examples:

- Logged-out user visiting `/dashboard` receives a redirect to `/login`.
- Logged-out user visiting `/profile` receives a redirect to `/login`.
- Logged-out user visiting `/find-jobs` receives a redirect to `/login`.
- Logged-out user visiting `/find-jobs/example-id` receives a redirect to `/login`.
- Successful Google login redirects to `/dashboard`.
- Successful GitHub login redirects to `/dashboard`.
- After successful login, `getCurrentUser()` returns a user in a Server Component.
- Expired access token plus valid refresh token stays logged in.
- Missing refresh token redirects to `/login`.
- Sign-out clears auth cookies and redirects to `/`.
- OAuth failure redirects to `/login?error=oauth` and displays a friendly message.

## Suggested Test Coverage

- Route Handler unit/integration test for `/api/auth/callback` that verifies `Set-Cookie` headers are written on success.
- Route Handler unit/integration test for `/api/auth/sign-out` that verifies auth cookies are cleared.
- Proxy test for expired access token with valid refresh token.
- Browser smoke test for the two provider buttons rendering and submitting.
- Manual OAuth smoke test for Google and GitHub.

## Skills To Use

- Use `project-review` for the audit itself.
- Use `architect` before implementing auth fixes, because the right change touches shared auth flow.
- Use `recover` if the first attempted auth fix still fails in the same way.
- Use `remember save` if the auth fix spans sessions.
