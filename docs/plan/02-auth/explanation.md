# Explanation — Feature 02 (Auth)

## 1. Why the context docs were wrong, and how that was discovered

Before writing any auth code, AGENTS.md requires checking for an InsForge MCP server and using it for the latest API docs. At the start of this session, `.mcp.json` had a correctly configured InsForge MCP server, but its tools were not yet registered in the running session (MCP tool registries load at session start; this server had connected after the session began). There was no in-session way to force a reconnect — that needed a session restart, which the user did partway through.

**Before the restart**, to avoid blocking, the real API was verified two other ways:
1. Fetched `https://registry.npmjs.org/@insforge%2Fsdk` directly — proved the real package is `@insforge/sdk`, not `@insforge/ssr` (which doesn't exist on npm at all — a direct registry lookup for it returned `404`).
2. Fetched the package's actual shipped files from unpkg — `README.md` and `dist/ssr.d.ts` / `dist/ssr/middleware.d.ts` — which gave the literal, current function signatures (`createBrowserClient`, `createServerClient`, `createAuthActions`, `updateSession`, etc.) straight from the code that runs, not a paraphrase of it.
3. Checked the installed Next.js 16.2.9 docs in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, which states outright: *"the `middleware` file convention is deprecated and has been renamed to `proxy`."*

**After the restart**, the InsForge MCP's `fetch-docs`/`fetch-sdk-docs` tools were used as AGENTS.md requires, and they corroborated the npm-sourced findings: same method names (`getCurrentUser()`, not `getUser()`), same error shape, and — importantly — the MCP doc's generic `auth-sdk` reference explicitly states that the basic client auto-exchanges OAuth callbacks, while the SSR-specific subpath's own docs say the opposite (manual exchange required for SSR). That distinction matched what was already implemented, so no rework was needed — the two sources were consistent once their different scopes (generic SPA client vs. Next.js SSR subpath) were accounted for.

This means the original `context/architecture.md` and `context/library-docs.md` pattern (`@insforge/ssr`, `createServerClient(url, key, { cookies: { getAll, setAll } })`, `middleware.ts`) was never real — it looks like a hand-written guess at what a Supabase-style SSR package *would* look like, written before the actual InsForge SDK's SSR subpath existed or was checked. Trusting it without verification would have produced code that fails at `import` time (module not found) and used the wrong file name for route protection (`middleware.ts` is silently ignored by Next.js 16 — `proxy.ts` is the only file Next 16 will actually run).

## 2. What changed in each context file, and why

### `context/architecture.md`
- **Folder structure**: removed `(auth)/callback/page.tsx` (the callback is a Route Handler, not a page — it has no UI, it just exchanges a code and redirects) and added `proxy.ts` at the root, `app/actions/auth.ts`, and the three `app/api/auth/*` routes. *Trigger*: the real SSR flow requires the callback to run on the server with access to request/response cookies, which a page component (`page.tsx`) can read but not cleanly write before redirecting — a Route Handler is the correct primitive.
- **Authentication section**: `middleware.ts` → `proxy.ts`. *Trigger*: Next.js 16's own docs confirm the rename; the old name is simply never invoked by the framework.
- **InsForge Client Pattern**: replaced the single `createServerClient(url, key, {cookies: getAll/setAll})` two-client setup with three surfaces (browser client, server client, `createAuthActions`) and added the real PKCE OAuth sequence. *Trigger*: the real SDK splits "read session" (server client) from "mutate session" (`createAuthActions`) — the browser client's TypeScript surface doesn't even expose `signOut()`/`signInWithPassword()`, by design, so auth cookies stay server-owned. The old pattern assumed one server client could do both.

### `context/library-docs.md`
- Same `@insforge/ssr` → `@insforge/sdk/ssr` correction, plus `getUser()` → `getCurrentUser()` (the old method name doesn't exist on the real client at all).
- Added the full PKCE code sample (Server Action + Route Handler) because the previous file had no OAuth example beyond a hypothetical `getUser()` call — there was nothing to correct, just a gap to fill, since Feature 02 is the first time auth code actually gets written.

### `context/code-standards.md`
- Updated the approved-dependencies list (`@insforge/ssr` → `@insforge/sdk`).
- Added `NEXT_PUBLIC_APP_URL` to the env var table — this wasn't needed by the old (incorrect) pattern, but the real OAuth flow needs an absolute `redirectTo` URL to hand to the provider.
- Updated "InsForge Client Usage" to show all three surfaces (browser/server/auth-actions) instead of two, matching the corrected architecture.md.

**How the actual implementation drove these doc changes**: in each case, the trigger was the same — write the real code first (or attempt to), have it fail to type-check or import against the real package, then trace the failure back to the specific stale claim in the context file, fix the doc to match the verified reality, and only then continue building. This is why the docs are corrected *in place* rather than left to drift further: the next person (or agent) reading `architecture.md` should get a pattern that actually compiles, not a second copy of the same mistake.

## 3. Why PKCE-on-the-server instead of client-side token parsing

A naive approach would let the browser handle the whole OAuth round trip: redirect to Google, get redirected back with a token in the URL, store it in `localStorage` or a non-httpOnly cookie. That's exactly what the *generic* (non-SSR) InsForge client does, and it's fine for a pure SPA with no server-rendered pages.

This project has Server Components that need to know "is this user logged in" *before* they render (e.g., the dashboard, the homepage CTA). That requires the access token to live in a cookie the server can read — and for security, the *refresh* token (the long-lived credential) should never be readable by JavaScript at all, hence `httpOnly`. PKCE (Proof Key for Code Exchange) is the mechanism that lets the server, not the browser, complete the handshake with the OAuth provider: the server generates a secret (`codeVerifier`), gives the provider only a hashed version of it, and later proves it holds the original secret when exchanging the authorization code. Storing that `codeVerifier` in an httpOnly cookie (rather than passing it through the URL or letting the browser hold it) means an attacker who intercepts the redirect URL alone can't complete the exchange.

## 4. Why `proxy.ts` replaced `middleware.ts` — is it just a rename?

Functionally, in this codebase, yes — same execution model (runs before rendering, can read/write cookies, can redirect). The rename is part of a broader Next.js 16 change where the convention is meant to more accurately describe what the file does (it behaves like a reverse-proxy hook, not "middleware" in the Express sense). For this project, the practical impact is narrow but absolute: a file named `middleware.ts` is simply never executed by Next 16, so any session-refresh or route-protection logic written there would silently do nothing — no error, no warning, just an unprotected app.

## 5. Why the browser client can't sign in/out directly

`createBrowserClient()`'s TypeScript type (`BrowserInsForgeClient`) only exposes `getCurrentUser`, `getProfile`, and `getPublicAuthConfig` on `.auth` — mutation methods aren't on the type at all. This is enforced by the SDK itself, not a convention this project chose. The reason: any code path that can set the refresh-token cookie needs to set it `httpOnly`, which only a server response can do. If the browser client could call `signOut()`, where would it write the "logged out" state? It can't touch an httpOnly cookie. So every mutation is funneled through Server Actions or Route Handlers, which control the actual HTTP response headers.

## 6. Cookie-by-cookie walkthrough: click to dashboard

1. User clicks "Continue with Google" → submits a `<form action={signInWithGoogle}>` (a Server Action, no client JS needed for the request itself).
2. Server Action calls `createAuthActions().signInWithOAuth("google", { redirectTo: ".../api/auth/callback", skipBrowserRedirect: true })`. InsForge's backend returns `{ url, codeVerifier }` — `url` points at Google, `codeVerifier` is the PKCE secret.
3. The Server Action sets `insforge_code_verifier` as an httpOnly cookie (10-minute expiry) and calls `redirect(url)` — the response is a redirect to Google.
4. User authenticates with Google, which redirects back to `/api/auth/callback?insforge_code=...`.
5. The Route Handler reads `insforge_code` from the query string and `insforge_code_verifier` from the request cookie, then calls `exchangeOAuthCode(code, verifier)`. InsForge's backend validates the pair and returns a session.
6. The Route Handler's *response* (not the request) gets `insforge_access_token` (readable) and `insforge_refresh_token` (httpOnly) set via `responseCookies`, the verifier cookie is deleted, and the response redirects to `/dashboard`.
7. On the next request, `proxy.ts` runs `updateSession()` first (refreshing the access token from the refresh token if it's expired), then checks for the access-token cookie before letting the request through to the protected route.

## 7. How `updateSession` avoids a stale-token race in Server Components

`proxy.ts` runs *before* the route's Server Components render, on every matched request. It calls `updateSession()` synchronously in that request's lifecycle and writes any refreshed token onto the *response* cookies before passing the request through with `NextResponse.next()`. Because this happens ahead of rendering, by the time a Server Component calls `createInsforgeServer()` and reads `getCurrentUser()`, the cookie it reads has already been refreshed for this request — there's no window where rendering starts against a token that `proxy.ts` already knew was stale. The race this avoids is the opposite ordering: if a Server Component rendered first and only refreshed afterward, the user could see a logged-out flash or a failed query against an expired token even though a valid refresh token existed.
