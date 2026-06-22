# AI Discussion Topics — Feature 02 (Auth)

Prompts to explore with an AI to deepen understanding of what was built:

1. "Why does PKCE need a code verifier stored server-side instead of just trusting the OAuth callback's authorization code on its own?"
2. "What's the actual security difference between Next.js `proxy.ts` and the old `middleware.ts` — is it purely a rename, or does the execution model change too?"
3. "Why can't the InsForge browser client call `signOut()` or `signInWithPassword()` directly — walk through what would break if it could?"
4. "Walk through what happens, cookie by cookie, from clicking 'Sign in with Google' to landing on `/dashboard`."
5. "How does `updateSession` in `proxy.ts` avoid a race where a Server Component renders against a stale access token?"
6. "This project's own `context/architecture.md` had a plausible-looking but entirely fictional API (`@insforge/ssr` with `createServerClient(url, key, {cookies})`). What's a general strategy for catching this kind of error *before* writing code against it, rather than after a build fails?"
7. "The InsForge MCP server was correctly configured but its tools weren't available until the session restarted — why does an MCP server's tool list get fixed at session start rather than updating live?"
8. "Why is the refresh token httpOnly but the access token isn't? What would go wrong if both were httpOnly, or if neither were?"
9. "The `allowedRedirectUrls` backend setting is empty, yet OAuth still worked. Where does that setting actually apply (hint: check `sendResetPasswordEmail`/`resendVerificationEmail` vs. `signInWithOAuth` in the docs) — and why might OAuth be exempt?"
