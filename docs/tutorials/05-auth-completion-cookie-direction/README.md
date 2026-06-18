# Tutorial 05 - Auth Completion: Cookie Direction, Proxy Refresh, and Friendly Failures

**After completing this tutorial you will understand:** why the first auth
implementation was structurally right but not fully correct, how request cookies differ
from response cookies, why an OAuth callback must write session cookies onto the same
response that redirects to `/dashboard`, how `proxy.ts` should trust refreshed session
state, and how JobPilot keeps login failures friendly while preserving a mostly
server-rendered auth UI.

This tutorial is based on the real completion docs in
[`docs/plan/02-auth-completion`](../../plan/02-auth-completion) and the current working
code in this repo. Open these files as you go:

- [`app/actions/auth.ts`](../../../app/actions/auth.ts)
- [`app/api/auth/callback/route.ts`](../../../app/api/auth/callback/route.ts)
- [`app/api/auth/sign-out/route.ts`](../../../app/api/auth/sign-out/route.ts)
- [`proxy.ts`](../../../proxy.ts)
- [`app/(auth)/login/page.tsx`](../../../app/(auth)/login/page.tsx)
- [`components/layout/SignOutButton.tsx`](../../../components/layout/SignOutButton.tsx)
- [`components/layout/SignOutPostHogResetButton.tsx`](../../../components/layout/SignOutPostHogResetButton.tsx)
- [`lib/posthog-server.ts`](../../../lib/posthog-server.ts)

> [!NOTE]
> Prerequisite: read [`docs/tutorials/02-auth/README.md`](../02-auth/README.md) first.
> That tutorial explains the initial OAuth + PKCE shape. This one teaches the corrective
> completion pass that made the flow production-ready.

---

## The Completion Pass In One Diagram

The first auth build had the right major pieces: login buttons, OAuth Server Actions,
callback route, protected route proxy, refresh endpoint, and sign-out paths. The problem
was lower-level: two places handed the SDK the wrong cookie writer, and the proxy checked
old request state after asking the SDK to refresh it.

```
Browser request
  |
  | request cookies: "Here is what I already have"
  v
Next.js server
  |
  | response cookies: "Here is what you should store next"
  v
Browser response

Login success:
  must SET new auth cookies on the response

Logout success:
  must CLEAR auth cookies on the response

Session refresh:
  may SET/CLEAR cookies during proxy handling
```

The central rule:

> Reading request cookies tells you what the browser sent. Mutating response cookies
> tells the browser what to store next.

That one distinction explains most of `02-auth-completion`.

**Checkpoint:** Before going further, answer this in your own words: if OAuth login
creates a new session, should the SDK write to request cookies or response cookies?

<details>
<summary>Reveal answer</summary>

Response cookies. The browser does not already have the new session when it sends the
callback request. The server must attach `Set-Cookie` headers to the response so the
browser stores the new session.

</details>

---

## 1. What Was Wrong Before The Completion Pass

Open [`docs/diff/02-auth/README.md`](../../diff/02-auth/README.md) and read the verdict.
The audit said Feature 02 was close in shape but not actually complete.

The most important findings were:

- The OAuth callback route exchanged the provider code but did not wire the outgoing
  response cookie writer correctly.
- The API sign-out route had the same response-cookie writer problem.
- `proxy.ts` called `updateSession()` but then checked the original request cookie,
  which can reject a valid refreshed session.
- `/login?error=oauth` existed as a redirect destination, but the login page did not
  show a friendly error message.

This is a useful engineering lesson: an auth system can have all the expected files and
still be wrong at the HTTP boundary.

```
Correct high-level shape:
  Login page -> OAuth provider -> callback -> dashboard

Incorrect low-level behavior:
  Callback did not attach session cookie changes to the redirect response
```

**Try it yourself:** In the diff audit, find the phrase "Request cookies are what the
browser sent to the server." Then write the matching definition for response cookies
without looking.

<details>
<summary>Reveal answer</summary>

Response cookies are what the server sends back to the browser, usually through
`Set-Cookie` response headers.

</details>

---

## 2. The Three Cookie Surfaces In JobPilot

The completion pass depends on keeping three InsForge surfaces separate.

| Surface | Used in | Purpose |
|---|---|---|
| `createBrowserClient()` | Client Components | Browser-side reads and realtime. No auth mutations. |
| `createServerClient()` | Server Components and Route Handlers | Read current user/session from cookies. |
| `createAuthActions()` | Server Actions and Route Handlers | Mutate auth state: OAuth start, callback exchange, sign-out. |

For this tutorial, focus on `createAuthActions()`. It can be created in two shapes.

### Server Action shape

In a Server Action, Next gives you a cookie store that can read and write for that
action response:

```ts
const cookieStore = await cookies();
const auth = createAuthActions({ cookies: cookieStore });
```

You see this in [`app/actions/auth.ts`](../../../app/actions/auth.ts).

### Route Handler shape

In a Route Handler, you must explicitly pass a reader and a writer:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
const auth = createAuthActions({
  requestCookies: request.cookies,
  responseCookies: response.cookies,
});
```

The important part is that `responseCookies` comes from the outgoing
`NextResponse`, not from `request.cookies`.

**Checkpoint:** Why does the Route Handler need both `requestCookies` and
`responseCookies`?

<details>
<summary>Reveal answer</summary>

The SDK may need to read existing state from the incoming request and write new state to
the outgoing response. Those are different directions in HTTP, so they need different
objects.

</details>

---

## 3. OAuth Start: Failure Is Redirected, Not Thrown Raw

Open [`app/actions/auth.ts`](../../../app/actions/auth.ts). The OAuth flow starts with
this real code:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";
import { createInsforgeServer } from "@/lib/insforge-server";
import { captureServerEvent } from "@/lib/posthog-server";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";
type OAuthResult = Awaited<ReturnType<ReturnType<typeof createAuthActions>["signInWithOAuth"]>>;

async function startOAuth(provider: "google" | "github"): Promise<never> {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  let result: OAuthResult;

  try {
    result = await auth.signInWithOAuth(provider, {
      redirectTo: new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL).toString(),
      skipBrowserRedirect: true,
    });
  } catch (error) {
    console.error("[actions/auth]", error);
    redirect("/login?error=oauth");
  }

  const { data, error } = result;

  if (error || !data.url || !data.codeVerifier) {
    console.error("[actions/auth]", error ?? "OAuth init failed");
    redirect("/login?error=oauth");
  }

  cookieStore.set(CODE_VERIFIER_COOKIE, data.codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(data.url);
}
```

The completion pass changed the failure behavior. Instead of throwing a raw action
error, the action now:

1. Logs internally with `[actions/auth]`.
2. Redirects the user to `/login?error=oauth`.
3. Lets the login page render a human-readable message.

The return type `Promise<never>` is intentional. `redirect()` throws a special Next.js
control-flow error internally, so a successful `startOAuth()` never returns a normal
value.

The exported provider functions stay tiny:

```ts
export async function signInWithGoogle(): Promise<void> {
  await startOAuth("google");
}

export async function signInWithGithub(): Promise<void> {
  await startOAuth("github");
}
```

**Checkpoint:** Why is this allowed to break the normal project rule that Server
Actions should return `{ success: boolean }`?

<details>
<summary>Reveal answer</summary>

These are navigation actions. Their job is to redirect the browser to a provider or back
to login. `redirect()` cannot coexist with a normal return value, so auth redirect
actions are documented as the approved exception in `context/code-standards.md`.

</details>

**Try it yourself:** Temporarily imagine `auth.signInWithOAuth()` throws. Trace the user
experience. Which route renders next, and what message should appear?

<details>
<summary>Reveal answer</summary>

The user is redirected to `/login?error=oauth`, and the login page shows "We could not
complete sign in. Please try again."

</details>

---

## 4. The Callback Route: Create The Response First

This is the core fix. Open
[`app/api/auth/callback/route.ts`](../../../app/api/auth/callback/route.ts):

```ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";
import { captureServerEvent, identifyServerUser } from "@/lib/posthog-server";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const code = request.nextUrl.searchParams.get("insforge_code");
    const verifier = (await cookies()).get(CODE_VERIFIER_COOKIE)?.value;

    if (!code || !verifier) {
      return NextResponse.redirect(new URL("/login?error=oauth", request.url));
    }

    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    const auth = createAuthActions({
      requestCookies: request.cookies,
      responseCookies: response.cookies,
    });

    const { data, error } = await auth.exchangeOAuthCode(code, verifier);
    if (error) {
      console.error("[api/auth/callback]", error);
      return NextResponse.redirect(new URL("/login?error=oauth", request.url));
    }

    if (data?.user) {
      await identifyServerUser({
        distinctId: data.user.id,
        properties: { email: data.user.email },
      });
      await captureServerEvent({
        distinctId: data.user.id,
        event: "user_signed_in",
        properties: { userId: data.user.id, email: data.user.email },
      });
    }

    response.cookies.delete(CODE_VERIFIER_COOKIE);
    return response;
  } catch (error) {
    console.error("[api/auth/callback]", error);
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
```

The ordering matters:

```
1. Read code from URL and verifier from cookie.
2. Create the redirect response to /dashboard.
3. Pass response.cookies to createAuthActions().
4. Exchange OAuth code.
5. SDK writes session cookies onto that redirect response.
6. Delete the temporary PKCE verifier cookie from that same response.
7. Return the response.
```

If step 2 happened later, or if `responseCookies` used `request.cookies`, the SDK would
not attach the new session to the actual browser response.

Think of it as writing a letter:

```
request.cookies   = the envelope the browser sent you
response.cookies  = the envelope you are sending back
```

You cannot put the new session cookies into the envelope that already arrived.

**Checkpoint:** Why must the same response both redirect to `/dashboard` and carry the
new auth cookies?

<details>
<summary>Reveal answer</summary>

The browser stores cookies from the response it receives. If the redirect response does
not include the session `Set-Cookie` headers, the browser can navigate to `/dashboard`
without actually having the logged-in session stored.

</details>

**Try it yourself:** In the callback route, identify every path that returns
`/login?error=oauth`. What kind of failure does each one represent?

<details>
<summary>Reveal answer</summary>

Missing `insforge_code` or verifier means the callback request is incomplete. An
exchange error means InsForge rejected the code/verifier exchange. The catch block
handles unexpected route errors. All three produce the same friendly login destination.

</details>

---

## 5. PostHog Is Attached After The Session Exchange

The current code has moved beyond plain auth. After a successful exchange, the callback
identifies the user and captures a `user_signed_in` event:

```ts
if (data?.user) {
  await identifyServerUser({
    distinctId: data.user.id,
    properties: { email: data.user.email },
  });
  await captureServerEvent({
    distinctId: data.user.id,
    event: "user_signed_in",
    properties: { userId: data.user.id, email: data.user.email },
  });
}
```

This happens only after `auth.exchangeOAuthCode()` succeeds and returns a user. That
keeps analytics aligned with reality: no successful session exchange, no signed-in
event.

Open [`lib/posthog-server.ts`](../../../lib/posthog-server.ts):

```ts
export async function captureServerEvent({
  distinctId,
  event,
  properties = {},
}: CaptureServerEventInput): Promise<void> {
  const posthog = createPostHogServer();

  if (!posthog) {
    return;
  }

  try {
    posthog.capture({
      distinctId,
      event,
      properties,
    });
  } finally {
    await posthog.shutdown();
  }
}
```

The server helper creates a one-shot PostHog client, captures or identifies, then calls
`shutdown()` before returning. This matters in Route Handlers because the response may
finish quickly. `shutdown()` gives the event a chance to flush.

**Checkpoint:** Why should `user_signed_in` be captured after `exchangeOAuthCode()`, not
when the user first clicks "Continue with Google"?

<details>
<summary>Reveal answer</summary>

Clicking the provider button only starts OAuth. The user might cancel, the provider
might fail, or the callback might be invalid. A sign-in event should mean the app
actually exchanged the code and received a user/session.

</details>

---

## 6. API Sign-Out: JSON Response First, Cookie Clearing Second

The visible placeholder sign-out button uses a Server Action, but JobPilot also keeps a
fetchable API route at
[`app/api/auth/sign-out/route.ts`](../../../app/api/auth/sign-out/route.ts).

Here is the current route:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions, createServerClient } from "@insforge/sdk/ssr";
import { captureServerEvent } from "@/lib/posthog-server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let userId: string | undefined;
    try {
      const serverClient = createServerClient({ cookies: request.cookies });
      const { data } = await serverClient.auth.getCurrentUser();
      userId = data.user?.id ?? undefined;
    } catch {
      // Best effort - don't block sign-out
    }

    const response = NextResponse.json({ success: true });
    const auth = createAuthActions({
      requestCookies: request.cookies,
      responseCookies: response.cookies,
    });

    const { error } = await auth.signOut();
    if (error) {
      console.error("[api/auth/sign-out]", error);
      const errorResponse = NextResponse.json(
        { success: false, error: "Failed to sign out" },
        { status: error.statusCode },
      );
      response.cookies.getAll().forEach((cookie) => {
        errorResponse.cookies.set(cookie);
      });
      return errorResponse;
    }

    if (userId) {
      try {
        await captureServerEvent({
          distinctId: userId,
          event: "user_signed_out",
          properties: { userId },
        });
      } catch {
        // Best effort
      }
    }

    return response;
  } catch (error) {
    console.error("[api/auth/sign-out]", error);
    return NextResponse.json(
      { success: false, error: "Failed to sign out" },
      { status: 500 },
    );
  }
}
```

The pattern matches the callback:

```
Create outgoing response
  |
  v
Pass response.cookies to createAuthActions()
  |
  v
auth.signOut() clears cookies on that response
  |
  v
Return the same response
```

There are three production-minded details here:

1. It reads the current user first so it can capture `user_signed_out`.
2. That user read is best-effort and must not block sign-out.
3. It returns a generic "Failed to sign out" message instead of exposing raw SDK errors.

The error path copies any cookies already written onto the failed response:

```ts
response.cookies.getAll().forEach((cookie) => {
  errorResponse.cookies.set(cookie);
});
```

That matters because auth operations can mutate cookies even when something else fails.
The response that actually returns to the browser should preserve those mutations.

**Checkpoint:** Why does the route create `NextResponse.json({ success: true })` before
calling `auth.signOut()`?

<details>
<summary>Reveal answer</summary>

Because `auth.signOut()` needs an outgoing response cookie writer. Creating the response
first gives the SDK the exact `response.cookies` object that will be returned to the
browser.

</details>

---

## 7. Server Action Sign-Out Still Drives The UI

The app's visible sign-out control does not call the API route. It uses a form action.

Open [`components/layout/SignOutButton.tsx`](../../../components/layout/SignOutButton.tsx):

```tsx
import { signOut } from "@/app/actions/auth";
import { SignOutPostHogResetButton } from "@/components/layout/SignOutPostHogResetButton";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SignOutPostHogResetButton />
    </form>
  );
}
```

The server mutation lives in [`app/actions/auth.ts`](../../../app/actions/auth.ts):

```ts
export async function signOut(): Promise<never> {
  let userId: string | undefined;
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();
    userId = data.user?.id ?? undefined;
  } catch {
    // Best effort - don't block sign-out
  }

  try {
    const cookieStore = await cookies();
    const auth = createAuthActions({ cookies: cookieStore });
    const { error } = await auth.signOut();

    if (error) {
      console.error("[actions/auth]", error);
    }
  } catch (error) {
    console.error("[actions/auth]", error);
  }

  if (userId) {
    try {
      await captureServerEvent({
        distinctId: userId,
        event: "user_signed_out",
        properties: { userId },
      });
    } catch {
      // Best effort - don't block redirect
    }
  }

  redirect("/");
}
```

This action redirects home no matter what. Sign-out should be resilient: analytics
failure should not trap the user, and even an SDK failure is logged rather than rendered
as a raw internal error.

The current button has a small client component:

```tsx
"use client";

import { resetPostHogUser } from "@/lib/posthog-client";

export function SignOutPostHogResetButton() {
  return (
    <button
      type="submit"
      onClick={resetPostHogUser}
      className="bg-surface border border-border text-text-primary text-sm font-medium px-4 py-2 rounded-md hover:bg-surface-secondary transition-colors"
    >
      Sign out
    </button>
  );
}
```

This is a precise client boundary. The form and server action stay server-side. The
button becomes client-side only because PostHog browser identity reset requires a click
handler.

**Checkpoint:** Why not make the whole `SignOutButton` a Client Component and call
`fetch("/api/auth/sign-out")`?

<details>
<summary>Reveal answer</summary>

The existing form action already gives the app server-side cookie mutation and redirect
with less code. Only the PostHog browser reset needs client JavaScript, so the client
boundary is kept as small as possible.

</details>

---

## 8. Proxy Refresh: Trust The Fresh Result

Open [`proxy.ts`](../../../proxy.ts):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@insforge/sdk/ssr/middleware";

const PROTECTED_PATHS = ["/dashboard", "/profile", "/find-jobs"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request });

  let session: { accessToken?: string | null } = {};
  try {
    session = await updateSession({
      requestCookies: { get: (name: string) => request.cookies.get(name) },
      responseCookies: response.cookies,
    });
  } catch (error) {
    console.error("[proxy] updateSession failed", error);
  }

  const isProtected = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (isProtected && !session.accessToken) {
    const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/find-jobs/:path*"],
};
```

The previous mistake was conceptual:

```
Old shape:
  updateSession() may refresh token
  then code checks original request cookie

Correct shape:
  updateSession() may refresh token
  then code checks session.accessToken returned by updateSession()
```

If the browser sends an expired access token but a valid refresh token, `updateSession()`
can produce a new access token. Checking only the original request means you might
redirect a valid user to `/login` even though refresh succeeded.

The corrected code asks the freshest source:

```ts
if (isProtected && !session.accessToken) {
  // redirect to login
}
```

**Checkpoint:** Explain the bug using a badge analogy.

<details>
<summary>Reveal answer</summary>

The old code asked security to renew the user's badge, then inspected the expired badge
the user arrived with instead of the renewed badge security just issued.

</details>

---

## 9. Proxy Redirects Must Preserve Cookie Mutations

One subtle fix in `proxy.ts` is this block:

```ts
const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
response.cookies.getAll().forEach((cookie) => {
  redirectResponse.cookies.set(cookie);
});
return redirectResponse;
```

Why copy cookies?

`updateSession()` received `response.cookies` and may have mutated it. For example, it
might clear invalid cookies or refresh session cookies. But if the proxy later creates a
brand-new redirect response and returns that instead, any cookie mutations on the
original `response` would be lost.

The copy step preserves the response headers that matter:

```
response = NextResponse.next()
  updateSession() writes Set-Cookie headers here

redirectResponse = NextResponse.redirect("/login")
  if returned directly, loses those Set-Cookie headers

copy cookies from response -> redirectResponse
  final redirect carries cleanup/refresh cookie changes
```

**Checkpoint:** Why does this matter even for unauthenticated redirects?

<details>
<summary>Reveal answer</summary>

Unauthenticated requests can still include stale or invalid auth cookies. If
`updateSession()` clears them, the redirect response should carry those clearing headers
so the browser state is cleaned up.

</details>

---

## 10. Login Error State Without Client JavaScript

Open [`app/(auth)/login/page.tsx`](../../../app/(auth)/login/page.tsx):

```tsx
import Image from "next/image";
import Link from "next/link";
import { signInWithGithub, signInWithGoogle } from "@/app/actions/auth";

type Props = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const hasOauthError = params.error === "oauth";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8 shadow-lg">
        <Link href="/" className="flex items-center gap-2 justify-center mb-6">
          <Image src="/logo.png" alt="JobPilot logo" width={36} height={36} />
          <span className="text-[19px] font-bold leading-7 text-text-darkest">
            JobPilot
          </span>
        </Link>

        <h1 className="text-xl font-semibold text-text-primary text-center mb-1">
          Welcome back
        </h1>
        <p className="text-sm text-text-secondary text-center mb-6">
          Sign in to continue to your dashboard
        </p>

        {hasOauthError ? (
          <p className="mb-4 rounded-md border border-error bg-surface px-3 py-2 text-sm font-medium text-error">
            We could not complete sign in. Please try again.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="w-full bg-surface border border-border text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors"
            >
              Continue with Google
            </button>
          </form>

          <form action={signInWithGithub}>
            <button
              type="submit"
              className="w-full bg-overlay text-white text-sm font-medium px-6 py-3 rounded-md hover:bg-overlay-dark transition-colors"
            >
              Continue with GitHub
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
```

The key is this type:

```ts
type Props = {
  searchParams: Promise<{
    error?: string;
  }>;
};
```

In this Next.js 16 codebase, `searchParams` is awaited in the async Server Component.
No client state is needed because the error is already in the URL.

The message is intentionally small and token-based:

```tsx
<p className="mb-4 rounded-md border border-error bg-surface px-3 py-2 text-sm font-medium text-error">
  We could not complete sign in. Please try again.
</p>
```

It follows the UI rules:

- White/surface card stays white.
- Error color appears inside the card via border and text.
- The message is human-readable.
- No raw provider or SDK error is exposed.

**Checkpoint:** Why would adding `useState` for this error message be unnecessary?

<details>
<summary>Reveal answer</summary>

The error state is fully determined by the URL query parameter. The server can read
`searchParams` and render the correct HTML before any browser JavaScript runs.

</details>

---

## 11. Route Protection Mental Trace

Use this trace to connect the pieces:

```
Logged-out user visits /dashboard
  |
  v
proxy.ts creates NextResponse.next()
  |
  v
updateSession() checks/cleans cookies
  |
  v
session.accessToken is missing
  |
  v
proxy creates redirect to /login
  |
  v
proxy copies any cookie mutations to redirect response
  |
  v
browser receives /login redirect plus any Set-Cookie cleanup
```

Now compare the refreshed-session case:

```
User visits /dashboard with expired access token + valid refresh token
  |
  v
updateSession() refreshes session and returns new accessToken
  |
  v
proxy checks session.accessToken, not the old request cookie
  |
  v
request is allowed through
  |
  v
browser receives refreshed cookies on the response
```

That second trace is the reason the completion pass changed `proxy.ts`.

**Checkpoint:** What specific value should protected-route logic trust after calling
`updateSession()`?

<details>
<summary>Reveal answer</summary>

It should trust `session.accessToken` returned by `updateSession()`, because that is the
fresh result after any refresh attempt.

</details>

---

## 12. Verification Map

The completion docs record this verification:

```text
npm run lint
npx tsc --noEmit
npm run build
```

And these route-level checks:

```text
/dashboard while logged out -> /login
/profile while logged out -> /login
/find-jobs while logged out -> /login
/find-jobs/example-id while logged out -> /login
/api/auth/callback with missing params -> /login?error=oauth
/api/auth/refresh with no session -> 401 plus cookie-clearing headers
/api/auth/sign-out with no session -> { "success": true } plus cookie-clearing headers
/login?error=oauth -> friendly message in HTML
```

Different checks prove different things:

| Check | Proves | Does not prove |
|---|---|---|
| Lint and TypeScript | Code shape and types are valid. | Provider configuration works. |
| Production build | Next can compile routes and components. | Real OAuth consent succeeds. |
| Logged-out route checks | `proxy.ts` protects target paths. | Refresh-token behavior with real cookies. |
| Missing callback params | Error redirects are friendly. | Successful callback writes real provider session. |
| Sign-out response headers | Cookie clearing is attached to response. | Browser UI sign-out was clicked by a user. |

The docs also record what still needs manual verification:

- Real Google OAuth consent click-through.
- Real GitHub OAuth consent click-through.
- Expired access token plus valid refresh token behavior with real InsForge cookies.

**Checkpoint:** Why can `npm run build` pass while OAuth is still broken?

<details>
<summary>Reveal answer</summary>

Build checks static compilation. OAuth depends on runtime provider configuration,
browser redirects, real cookies, and InsForge backend behavior. Those cannot be proven by
compiling the app.

</details>

---

## 13. The Completion Review Framework

Open
[`docs/plan/02-auth-completion/project-review.md`](../../plan/02-auth-completion/project-review.md).
The review passed with a manual-test caveat.

It used three layers:

| Layer | Result | Why |
|---|---|---|
| Plan alignment | PASS | The planned callback, sign-out, proxy, and login-error fixes were implemented. |
| System integrity | PASS | Auth mutations stayed in Server Actions/Route Handlers, and client boundaries stayed small. |
| Production readiness | PASS with caveat | Static and route checks passed, but real provider click-through still needs a human account. |

That caveat is not hand-waving. It is an honest boundary:

```
Automated local checks can prove:
  route behavior, compile correctness, missing-param errors, cookie-header shape

Manual provider checks prove:
  Google/GitHub app configuration, provider consent, backend allowlist, real cookie storage
```

**Try it yourself:** Write your own acceptance checklist for Google OAuth. Include at
least one browser DevTools cookie inspection step.

<details>
<summary>Example checklist</summary>

1. Start the dev server with the correct `.env.local`.
2. Visit `/login`.
3. Click "Continue with Google".
4. Complete provider consent.
5. Confirm final route is `/dashboard`.
6. In DevTools, confirm InsForge auth cookies exist.
7. Click sign out.
8. Confirm the app redirects to `/`.
9. Confirm auth cookies are cleared or expired.

</details>

---

## 14. Common Mistakes This Tutorial Should Prevent

### Mistake A: Passing `request.cookies` as the response writer

Wrong shape:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
const auth = createAuthActions({
  requestCookies: request.cookies,
  responseCookies: request.cookies,
});
```

Correct shape:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
const auth = createAuthActions({
  requestCookies: request.cookies,
  responseCookies: response.cookies,
});
```

### Mistake B: Checking old request state after refresh

Wrong mental model:

```text
Call updateSession()
Ignore what it returned
Check the original request cookie
```

Correct mental model:

```text
Call updateSession()
Use session.accessToken from the result
Return the response that carries any cookie mutations
```

### Mistake C: Turning URL-driven error UI into a Client Component

Wrong instinct:

```text
Use useState/useEffect to detect login error
```

Correct approach:

```text
Read searchParams in the Server Component
Render the friendly message in HTML
```

### Mistake D: Letting analytics block auth

Wrong priority:

```text
If PostHog capture fails, stop sign-out
```

Correct priority:

```text
Best-effort analytics
Auth/session UX continues
```

---

## 15. Self-Check Quiz

Answer these before expanding the answers.

**1. What is the difference between request cookies and response cookies?**

<details>
<summary>Reveal answer</summary>

Request cookies are sent by the browser to the server. Response cookies are sent by the
server back to the browser, usually as `Set-Cookie` headers.

</details>

**2. Why does the callback route create `const response =
NextResponse.redirect(...)` before calling `createAuthActions()`?**

<details>
<summary>Reveal answer</summary>

Because the SDK needs the outgoing response's cookie writer so the session cookies are
attached to the actual redirect response returned to the browser.

</details>

**3. Why does `proxy.ts` check `session.accessToken` instead of an access-token cookie
from the original request?**

<details>
<summary>Reveal answer</summary>

Because `updateSession()` may refresh the session. Its returned `session.accessToken` is
the fresh result after that refresh attempt.

</details>

**4. Why does the proxy copy cookies from `response` to `redirectResponse`?**

<details>
<summary>Reveal answer</summary>

Because `updateSession()` may have written cookie changes to the original response. If
the proxy returns a new redirect response, those changes must be copied or they are lost.

</details>

**5. Why does the login page stay a Server Component even with an error message?**

<details>
<summary>Reveal answer</summary>

The error is encoded in the URL as `?error=oauth`. The server can read `searchParams`
and render the message without client state or effects.

</details>

**6. Why is a real Google/GitHub click-through still required after lint, type-check,
and build pass?**

<details>
<summary>Reveal answer</summary>

Provider click-through tests runtime configuration and real browser cookie behavior:
provider app settings, callback allowlists, InsForge backend setup, redirects, and
stored cookies.

</details>

---

## 16. Practice Exercises

### Exercise A - Annotate The Callback

Open `app/api/auth/callback/route.ts`. Add a note in your own words beside these lines
in a scratch file, not in the code:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
```

```ts
responseCookies: response.cookies,
```

```ts
response.cookies.delete(CODE_VERIFIER_COOKIE);
```

Your notes should explain the cookie direction for each line.

### Exercise B - Break The Mental Model

Imagine someone changes `proxy.ts` to this:

```ts
await updateSession(...);
const hasAccessToken = Boolean(request.cookies.get("some_access_token_cookie"));
```

Explain why this can fail for an expired access token plus valid refresh token.

### Exercise C - Design A Route Handler Test

You do not need to implement it. Describe what an automated test for
`/api/auth/callback` would need to mock:

- Incoming URL params.
- The PKCE verifier cookie.
- `createAuthActions().exchangeOAuthCode()`.
- The returned `NextResponse` cookies.
- Redirect location.

### Exercise D - Review A New Auth Route

Suppose you add `/api/auth/delete-account`. Use the same cookie-direction thinking:

- What state does the route need to read from request cookies?
- What state might it need to write to response cookies?
- Should user-facing errors expose raw SDK messages?
- Should analytics block account deletion or be best-effort?

---

## What You Should Take Away

The `02-auth-completion` pass was not a rewrite. It was a precision fix at the boundary
where HTTP, cookies, SDK helpers, and Next.js responses meet.

The durable lessons are:

- Request cookies are for reading what the browser already sent.
- Response cookies are for telling the browser what to store next.
- Route Handlers must pass the outgoing `NextResponse.cookies` writer to auth mutation
  helpers.
- A proxy that refreshes sessions must trust the refresh result, not stale request
  state.
- If a proxy mutates one response but returns another, it must preserve cookie
  mutations.
- URL-driven login errors can stay server-rendered.
- Analytics should enhance auth flows, not block them.

Carry these patterns into every future auth-adjacent route in JobPilot. Most auth bugs
are not in the button. They are in the exact response the browser receives.
