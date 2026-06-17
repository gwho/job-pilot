# AI Discussion Topics — 02 Auth

Use these prompts to learn the related concepts more deeply.

## OAuth And PKCE

1. Explain OAuth PKCE as if I understand normal login forms but have never implemented OAuth.
2. In this app, why is the `codeVerifier` stored in an httpOnly cookie before redirecting to Google/GitHub?
3. What could go wrong if the callback route exchanged an OAuth code without checking a verifier?
4. Compare client-side OAuth callback handling versus server-side callback handling in a Next.js app.

## Cookies

1. Explain the difference between request cookies and response cookies using this auth feature as the example.
2. Why does `responseCookies: request.cookies` compile but still create a production bug?
3. What does an httpOnly refresh token protect against, and what does it not protect against?
4. How should I inspect browser cookies after a successful OAuth login to verify the session really exists?

## Next.js 16 Auth Protection

1. Explain what `proxy.ts` does in Next.js 16 and how it differs from a normal page or route handler.
2. Why can checking the original request cookie after `updateSession()` be wrong?
3. How should protected routes behave for logged-out users, expired access tokens, and valid refresh tokens?
4. What manual smoke tests should I run for route protection after changing auth code?

## Server Actions And Route Handlers

1. When should this app use a Server Action versus an API Route Handler?
2. Why is the login page implemented with `<form action={signInWithGoogle}>` instead of a client-side `onClick`?
3. What does "progressive enhancement" mean for a login form?
4. How should redirecting Server Actions handle errors in a user-friendly way?

## Review Skills

1. Use the `project-review` structure to review another feature: plan alignment, system integrity, and production readiness.
2. What evidence should a reviewer collect before saying an auth feature is production ready?
3. Turn the findings in `docs/diff/02-auth/README.md` into acceptance tests.
4. Explain the difference between "the files exist" and "the feature works end to end."
