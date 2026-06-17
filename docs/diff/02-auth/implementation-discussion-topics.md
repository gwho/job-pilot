# AI Discussion Topics — 02 Auth Implementation Plan

Use these prompts to understand the plan before implementing it.

## Understanding The Plan

1. Walk me through the 02 Auth completion plan step by step and explain why each step exists.
2. Which steps in `implementation-plan.md` are critical for correctness, and which are polish or documentation?
3. Explain why this plan repairs the existing auth system instead of rewriting it.
4. Turn the definition of done into a manual QA checklist I can follow in the browser.

## Cookie Direction

1. Explain request cookies and response cookies using `app/api/auth/callback/route.ts` as the example.
2. Why does passing `request.cookies` as `responseCookies` compile but still fail conceptually?
3. Show me a mental model for how `Set-Cookie` headers travel from a Next.js Route Handler to the browser.
4. Why can a redirect response also set cookies?

## Proxy And Session Refresh

1. Explain why `proxy.ts` should use the return value from `updateSession()` instead of checking the original request cookie.
2. What are the possible outcomes of `updateSession()` and how should `proxy.ts` respond to each one?
3. How can cookie changes made during proxy session refresh be lost when returning a different response?
4. Explain how protected route matching covers `/find-jobs/[id]`.

## Error Handling

1. Why should OAuth init failure redirect to `/login?error=oauth` instead of throwing a raw error?
2. What makes a good user-facing auth error message?
3. Why should API routes log internal errors but return generic client messages?
4. Compare error handling in Server Actions versus Route Handlers.

## Verification

1. Design a smoke test matrix for Google OAuth, GitHub OAuth, protected redirects, refresh, and sign-out.
2. What can `npm run lint`, `npx tsc --noEmit`, and `npm run build` prove, and what can they not prove?
3. How do I inspect cookies in browser devtools after OAuth callback?
4. What would an automated test for the callback route need to mock?

## Skill Workflow

1. Explain when to use `architect`, `project-review`, `recover`, `imprint`, and `remember` during this auth completion pass.
2. Use `project-review` to review the implementation plan before any code is written.
3. If the callback still fails after the first fix, guide me through using `recover` to diagnose it.
4. After the fix is done, help me write a concise `remember save` summary for future sessions.
