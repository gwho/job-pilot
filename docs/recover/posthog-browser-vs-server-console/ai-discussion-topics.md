# Discussion Topics — PostHog Browser vs Server Console

## Group 1: Two runtimes, two consoles

1. This project runs code in two separate environments: the Node.js server and the browser. What is the defining rule that determines which environment a given file runs in? Given `instrumentation-client.ts`, `actions/profile.ts`, `components/analytics/PostHogIdentity.tsx`, and `app/api/auth/callback/route.ts` — which runtime does each one run in, and how do you know?

2. When a `console.log` doesn't appear where you expect it, what is the first diagnostic question to ask? Walk through how you would apply that question to a missing log in a Server Action vs. a missing log in a Client Component.

3. `instrumentation-client.ts` and `instrumentation.ts` are two separate Next.js conventions. What is the difference between them? If you put PostHog browser initialisation code in `instrumentation.ts` (the server variant) instead of `instrumentation-client.ts`, what would happen? Would it error, silently do nothing, or partially work?

---

## Group 2: Silent failure modes

4. `instrumentation-client.ts` uses `debug: false` in production. This means PostHog fails silently when its guard evaluates false — no error, no warning. Name two other examples in this codebase where a function or condition fails silently by design. Why is silent failure sometimes the correct choice for an analytics integration?

5. The `if (posthogKey && posthogHost)` guard means PostHog simply does not initialise if either env var is missing. What is the alternative design — throwing an error or logging a warning? What are the tradeoffs of each approach for an analytics SDK specifically?

6. The `posthog-server.ts` server client wraps every event capture in a try/catch that swallows errors:
   ```typescript
   } catch {
     // Best effort — never block save on analytics
   }
   ```
   Why is "best effort" the right contract for analytics, while it would be wrong for database writes or auth operations? Where is the line between acceptable silent failure and dangerous silent failure?

---

## Group 3: The diagnostic process

7. The diagnostic added two temporary changes: `debug: true` and a `console.log` before the guard. Why were both needed rather than just one? What specific question did each one answer?

8. The session initially proposed two candidate root causes (env var corruption, stale dev server) before identifying the actual root cause (wrong console). What evidence ruled out each initial hypothesis? What was the signal that pointed to the correct diagnosis?

9. The diagnostic log was placed *before* the guard (`if (posthogKey && posthogHost)`), not inside it. Why does placement matter here? What different information would you get if the log were inside the guard vs. before it?

---

## Group 4: Env vars and the dev server

10. Next.js does not hot-reload `.env.local` changes — the dev server must be restarted for new values to take effect. Why is this different from how Next.js handles changes to component files (which hot-reload instantly)? What is different about env vars that requires a full restart?

11. `NEXT_PUBLIC_POSTHOG_KEY` uses the `NEXT_PUBLIC_` prefix. What does this prefix do in Next.js? What would happen to PostHog if the prefix were removed (making it just `POSTHOG_KEY`)? Would `instrumentation-client.ts` still be able to read it?

12. The PostHog server client in `lib/posthog-server.ts` also reads `NEXT_PUBLIC_POSTHOG_KEY` — a `NEXT_PUBLIC_` prefixed variable used server-side. Is this a problem? What does `NEXT_PUBLIC_` actually mean for server-side code specifically?
