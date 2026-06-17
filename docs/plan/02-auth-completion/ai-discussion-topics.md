# Feature 02 Auth Completion — AI Discussion Topics

Use these prompts to learn the fixed flow.

1. Explain request cookies versus response cookies using the fixed callback route.
2. Why does OAuth callback success need to write cookies onto the same response that redirects to `/dashboard`?
3. Walk through how `createAuthActions()` uses `requestCookies` and `responseCookies` differently.
4. Explain why `proxy.ts` should trust `updateSession()`'s returned `accessToken`.
5. How can cookie changes be lost if a proxy creates one response, mutates it, and returns another?
6. Why is `/login?error=oauth` handled in a Server Component instead of a Client Component?
7. What should be manually checked in browser devtools after Google OAuth succeeds?
8. What would an automated test for the callback route need to mock?
9. How would you review this feature with the `project-review` skill after implementation?
10. If the real provider click-through still fails after this fix, how should the `recover` skill classify possible causes?
