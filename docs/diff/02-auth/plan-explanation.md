# Explanation — 02 Auth Completion Plan

This document explains why the implementation plan is shaped the way it is. It is written for learning, so it focuses on the reasoning behind the plan rather than only listing tasks.

## 1. Why This Is A Completion Pass, Not A Rewrite

The audit found that most of Feature 02 already exists in the right shape:

- The login page exists.
- Google and GitHub buttons exist.
- OAuth is started from Server Actions.
- The callback route exists.
- InsForge SSR clients exist.
- `proxy.ts` protects the right route families.
- Placeholder protected pages exist.

That means the correct move is not to rebuild auth from scratch. The correct move is to repair the few places where the existing flow does not actually complete the contract.

The plan therefore avoids redesigning login, moving files around, or adding new abstractions. It focuses on the three places where behavior can break:

- Writing cookies during callback.
- Clearing cookies during sign-out.
- Deciding route access after session refresh.

## 2. The Core Bug: Reading Cookies Versus Writing Cookies

Auth bugs often come down to direction.

When a browser sends a request, it includes cookies in the request headers. The server can read those cookies to understand who the user is.

When the server wants to log a user in or out, reading is not enough. The server must send new `Set-Cookie` headers back in the response.

So there are two cookie roles:

- Request cookies answer: "What did the browser send me?"
- Response cookies answer: "What am I sending back to the browser?"

The current callback route creates an outgoing redirect response, but gives the SDK the incoming request cookies as the response writer. That is the wrong direction. It is like writing a note on the envelope you received instead of putting the note in the envelope you are about to send back.

The fix is conceptually simple: create the outgoing response, then pass that response's cookie writer to the SDK.

## 3. Why The Callback Route Matters More Than The Login Button

Clicking "Continue with Google" only starts OAuth. It does not log the user into JobPilot yet.

The real login happens after the provider redirects back to `/api/auth/callback`. At that point, the app must:

1. Read the OAuth code from the URL.
2. Read the PKCE verifier from the cookie.
3. Ask InsForge to exchange the pair for a session.
4. Attach session cookies to the response.
5. Redirect to `/dashboard`.

If step 4 fails, the user may be sent to `/dashboard` without actually being logged in. Then `proxy.ts` sees no valid session and sends them back to `/login`.

That can feel like a redirect loop, but the real problem is that the session never reached the browser.

## 4. Why The API Sign-Out Route Still Matters

The visible placeholder sign-out button currently uses a Server Action. That path may work because Server Actions receive a writable cookie store from `cookies()`.

However, the feature also claims an API sign-out route exists. If that route exists, it should be correct. Otherwise, a future component or client-side flow might call it and assume it clears the session.

The API route has the same directional bug as the callback route. It creates a JSON response but passes `request.cookies` as the writer. The plan fixes it the same way: write cookie changes to the outgoing response.

The plan also changes error behavior. Returning raw `error.message` from InsForge leaks internal details to the client. The project standard says user-facing/API errors should be generic and human-readable.

## 5. Why `proxy.ts` Should Trust `updateSession()`

`proxy.ts` has two jobs:

- Refresh the session if possible.
- Block protected pages if no session exists.

The current code asks `updateSession()` to refresh, but then checks the original request cookie. That misses the important result: `updateSession()` returns the refreshed access token.

The right mental model:

1. A user arrives with an expired access token.
2. The user still has a valid refresh token.
3. `updateSession()` exchanges the refresh token for a new access token.
4. The proxy should allow the request because the result now has an access token.

Checking the old request cookie after step 3 ignores the successful refresh.

The plan therefore says to use `session.accessToken` from the `updateSession()` result.

## 6. Why Cookie Mutations Must Survive Proxy Redirects

There is a second proxy detail that is easy to miss.

`updateSession()` can mutate cookies. It may:

- Set a new access token.
- Rotate a refresh token.
- Clear stale auth cookies.

If `proxy.ts` creates one response, lets `updateSession()` write cookies to it, and then returns a totally different redirect response, those cookie changes can be lost.

That is why the plan explicitly says the final returned response must preserve any `Set-Cookie` changes made during session update.

The implementation can do that in more than one way. The important principle is that the response returned to the browser must be the response carrying the cookie changes.

## 7. Why Login Error UI Is In Scope

The callback route already redirects failures to `/login?error=oauth`.

That is a contract: the login page receives an error state. Right now, the page ignores it.

This is not a large UI feature. It is a small feedback state so the user is not silently dropped back onto the same login form.

The plan keeps the page as a Server Component and uses `searchParams`. That matches the current no-client-JS pattern.

## 8. Why The Plan Does Not Add A New Test Framework

The project currently has no test framework dependency.

Adding one would be a larger tooling decision, not just an auth fix. The plan instead recommends:

- Static checks.
- Production build.
- Route smoke tests.
- Manual provider tests.
- Optional future automated tests if the project chooses a test stack.

This keeps the completion pass small and avoids turning an auth repair into a testing infrastructure project.

## 9. Why Documentation Updates Are Part Of The Plan

The audit found that code and docs can drift in a dangerous way. If `context/library-docs.md` shows an ambiguous or wrong callback pattern, a future agent may copy the same bug.

For this project, context files are part of the system. They guide future implementation. Fixing the code but leaving misleading docs would leave the same problem waiting to return.

That is why the plan includes updating:

- `context/library-docs.md`
- `context/progress-tracker.md`
- Auth plan/explanation docs if they claim the broken behavior is verified

## 10. Why `project-review` Comes After Implementation

The `project-review` skill is deliberately review-only. It should not fix the code while reviewing.

The right sequence is:

1. Use `architect` to plan the fix.
2. Implement the fix.
3. Use `project-review` to verify the fix.
4. If the same bug remains after one correction, use `recover`.

This sequence keeps planning, building, reviewing, and recovery as separate modes of thinking.

## 11. What You Should Understand Before Implementing

Before changing code, make sure these ideas are clear:

- OAuth start is not the same as OAuth completion.
- The callback route is where the JobPilot session is created.
- Request cookies are read-only evidence of the current browser state.
- Response cookies are how the server changes browser state.
- A redirect response can carry cookies.
- `proxy.ts` runs before protected pages render.
- `updateSession()` can turn an expired access token into a valid session.
- A passing TypeScript check does not prove cookies are written to the correct response.

Once those ideas are clear, the implementation is small and mechanical.
