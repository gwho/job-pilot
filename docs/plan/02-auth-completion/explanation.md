# Feature 02 Auth Completion — Explanation

## Request cookies and response cookies

The most important concept in this completion pass is cookie direction.

Request cookies are what the browser sends to the server. They answer: "What state does the browser already have?"

Response cookies are what the server sends back to the browser. They answer: "What state should the browser store next?"

Login and logout change state, so they must write response cookies.

## Why the callback route changed

`app/api/auth/callback/route.ts` exchanges the OAuth code and PKCE verifier for an InsForge session.

The SDK stores that session by writing cookies through the `responseCookies` object passed to `createAuthActions()`. The route now creates the redirect response first:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
```

Then it passes that response's cookie writer:

```ts
responseCookies: response.cookies
```

That means the same response that redirects to `/dashboard` also carries the new auth cookies.

## Why the API sign-out route changed

Sign-out is the reverse of login. The SDK clears cookies through the response writer.

The route now creates the JSON response first, gives `response.cookies` to `createAuthActions()`, and returns that same response after `auth.signOut()` clears the cookies.

The error path also now logs internally and returns a generic message. This follows the project rule: do not expose raw third-party error messages to users.

## Why proxy changed

`proxy.ts` runs before protected pages render. It calls `updateSession()` so the SDK can refresh an expired access token if a valid refresh token exists.

The old code asked the SDK to refresh but then checked only the original request cookie. That misses the newly refreshed token.

The corrected code uses:

```ts
session.accessToken
```

from the `updateSession()` result.

## Why proxy copies cookies on redirect

`updateSession()` may set or clear cookies. If `proxy.ts` then returns a brand-new redirect response, those cookie changes could be lost.

The redirect path now copies cookies from the response that `updateSession()` mutated onto the redirect response. This preserves cleanup or refresh cookie headers even when the request is blocked.

## Why the login page stayed server-rendered

The login page already works well as a Server Component. The OAuth buttons use native forms wired to Server Actions:

```tsx
<form action={signInWithGoogle}>
```

The error message only depends on URL search params, so it can also be rendered on the server. No `useState`, `useEffect`, browser APIs, or client-side event handlers are needed.

## Why docs were updated

This repo uses context docs as implementation memory. If the docs kept showing the ambiguous route-handler pattern, future auth changes could reintroduce the same bug.

The completion pass therefore updated both code and project memory:

- `context/library-docs.md`
- `context/progress-tracker.md`
- `context/ui-registry.md`
- `docs/plan/02-auth/`

## What still requires manual verification

Static checks can prove the code compiles and routes exist. They cannot prove a third-party provider consent screen works with the configured backend.

Google and GitHub OAuth still need one real browser smoke test each:

- Click provider button.
- Complete consent.
- Land on `/dashboard`.
- Confirm auth cookies exist.
- Sign out.
- Confirm auth cookies are cleared.
