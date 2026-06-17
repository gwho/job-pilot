# Tutorial: How Auth Works in JobPilot (InsForge OAuth + PKCE)

This is a hands-on walkthrough of the auth system built in `docs/plan/02-auth/`. Every
code sample below is the **real, working code** already in this repo — not a simplified
stand-in. Open the referenced files alongside this tutorial so you can follow along live.

This is interactive: each section ends with a checkpoint question and a "try it
yourself" exercise. Don't skip them — they're where the understanding actually lands.

---

## Map of the system

Before touching code, hold this picture in your head. Six pieces, three of them you'll
recognize from any OAuth integration, three of them specific to doing OAuth safely in a
server-rendered (SSR) app:

```
Browser                          Server                              Provider
───────                          ──────                              ────────
login/page.tsx  ──form action──▶ app/actions/auth.ts (signInWithGoogle)
                                       │
                                       │ creates codeVerifier, sets it as
                                       │ an httpOnly cookie, redirects
                                       ▼
                                  Google/GitHub consent screen ◀───────────────┘
                                       │
                                       │ redirects back with ?insforge_code=...
                                       ▼
                                  app/api/auth/callback/route.ts
                                       │ reads code + cookie verifier,
                                       │ exchanges them for a session,
                                       │ sets session cookies, redirects
                                       ▼
                                  /dashboard
                                       ▲
                              proxy.ts runs on every request to
                              protected paths, refreshes + checks
                              the session before rendering happens
```

The two ideas worth sitting with before reading code:

1. **The browser never sees a secret.** The thing that proves "this OAuth callback is
   legitimate" (the PKCE `codeVerifier`) lives only in an `httpOnly` cookie — JavaScript
   in the browser can't read it, only the server can.
2. **Mutating the session and reading the session are different operations**, done by
   different objects (`createAuthActions` vs. `createServerClient`), because only a
   server *response* can set an `httpOnly` cookie.

**Checkpoint:** Before moving on, can you say in one sentence why the diagram shows the
codeVerifier cookie getting set on the way *out* to Google, and read again on the way
*back* from Google? (Answer: it's how the callback route proves the request asking to
exchange the code is the same browser session that started the flow — without that
proof, anyone who intercepted the redirect URL could finish the login as you.)

---

## Step 1 — Two clients, not one

Open [`lib/insforge-client.ts`](../../../lib/insforge-client.ts) and
[`lib/insforge-server.ts`](../../../lib/insforge-server.ts):

```ts
// lib/insforge-client.ts
import { createBrowserClient } from "@insforge/sdk/ssr";

export const insforge = createBrowserClient();
```

```ts
// lib/insforge-server.ts
import { cookies } from "next/headers";
import { createServerClient } from "@insforge/sdk/ssr";

export async function createInsforgeServer() {
  return createServerClient({ cookies: await cookies() });
}
```

Two files, two different jobs:

| Client | Where it runs | What it can do |
|---|---|---|
| `insforge` (browser client) | Client Components | Read-only: `getCurrentUser()`, `getProfile()`. No `signOut`, no `signInWithPassword` — those methods literally don't exist on its TypeScript type. |
| `createInsforgeServer()` | Server Components, Route Handlers | Reads the session from request cookies via `next/headers`. Still read-only for auth — it's for *querying* "who is logged in", not changing that. |

Neither of these two clients can start or end a session. That's the third piece,
`createAuthActions`, which you'll meet in Step 2. This split is enforced by the SDK
itself, not a convention this project invented — go check: if you open
`node_modules/@insforge/sdk/dist/ssr.d.ts` and look at the browser client's `.auth`
type, `signOut` isn't on it.

**Try it yourself:** Open a terminal and run
`grep -A5 "BrowserInsForgeClient" node_modules/@insforge/sdk/dist/ssr.d.ts` (path may
need adjusting based on the installed version). Confirm for yourself that `signOut`
and `signInWithPassword` are absent from that type but present elsewhere in the file.

**Checkpoint:** If the browser client *could* call `signOut()` directly, what would
break? (Answer: it would need to clear the refresh-token cookie, but that cookie is
`httpOnly` — only an HTTP *response* can delete or set it. A browser-side JS call has no
response to attach that to. So the SDK simply doesn't expose the method, forcing every
mutation through a Server Action or Route Handler that controls real response headers.)

---

## Step 2 — Starting the OAuth flow: `app/actions/auth.ts`

This is the file that runs the moment a user clicks "Continue with Google." Open
[`app/actions/auth.ts`](../../../app/actions/auth.ts) in full:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

async function startOAuth(provider: "google" | "github") {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });

  const { data, error } = await auth.signInWithOAuth(provider, {
    redirectTo: new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL).toString(),
    skipBrowserRedirect: true,
  });

  if (error || !data.url || !data.codeVerifier) {
    throw new Error(error?.message ?? "OAuth init failed");
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

export async function signInWithGoogle() {
  await startOAuth("google");
}

export async function signInWithGithub() {
  await startOAuth("github");
}
```

Walk through it line by line:

1. `"use server"` at the top — this whole file is Server Actions. They can be called
   directly from a `<form action={...}>` with zero client-side JavaScript, which is why
   the login page (next step) needs no `"use client"` and no `onClick` handler.
2. `auth.signInWithOAuth(provider, { redirectTo, skipBrowserRedirect: true })` doesn't
   redirect anything itself — `skipBrowserRedirect: true` tells the SDK "just give me
   the data, I'll redirect myself." It returns `{ url, codeVerifier }`. `url` is the
   real `accounts.google.com` (or GitHub) consent URL; `codeVerifier` is the PKCE secret
   this server just generated.
3. The cookie write is the security-critical line. `httpOnly: true` means
   `document.cookie` in the browser console can't see it. `maxAge: 600` (10 minutes) — if
   the user abandons the flow, the cookie expires rather than lingering.
4. `redirect(data.url)` — *now* the browser actually navigates to Google.

`signInWithGoogle` and `signInWithGithub` are thin wrappers around the same
`startOAuth` — this is the one place in the file you might call "DRY," and it's done
because the only thing that differs between providers is a string literal.

**Checkpoint:** Why does `redirectTo` point at `/api/auth/callback` and not, say,
`/dashboard` directly? (Answer: Google/GitHub need to redirect back to *this app*, not
directly to the final destination, because the app still has to exchange the
authorization code for a session first. `/dashboard` is the destination *after* that
exchange succeeds — that redirect happens inside the callback route, not here.)

**Try it yourself:** Add a third provider, e.g. `signInWithMicrosoft`. You'd:
1. Widen the `provider` parameter type in `startOAuth` to `"google" | "github" | "microsoft"`.
2. Add `export async function signInWithMicrosoft() { await startOAuth("microsoft"); }`.
3. Add a third `<form action={signInWithMicrosoft}>` button to the login page.

You don't need to actually wire up a Microsoft OAuth app to see this works structurally —
just confirm it type-checks (`npx tsc --noEmit`) and the button renders.

---

## Step 3 — The login page: zero client JS

Open [`app/(auth)/login/page.tsx`](../../../app/(auth)/login/page.tsx):

```tsx
import { signInWithGithub, signInWithGoogle } from "@/app/actions/auth";

export default function LoginPage() {
  return (
    // ...
    <form action={signInWithGoogle}>
      <button type="submit">Continue with Google</button>
    </form>
    <form action={signInWithGithub}>
      <button type="submit">Continue with GitHub</button>
    </form>
    // ...
  );
}
```

Notice what's *not* here: no `useState`, no `onClick`, no `fetch`, no `"use client"`
directive anywhere in this file. `<form action={signInWithGoogle}>` is React 19 +
Next.js wiring a Server Action directly to a native form submission. The browser submits
the form like it's 1999; the Action runs on the server; the response is the redirect to
Google from Step 2.

**Checkpoint:** What would you lose by rewriting this with `onClick={() =>
signInWithGoogle()}` instead of `<form action={signInWithGoogle}>`? (Answer: the
`onClick` version requires the component to be a Client Component, ships JS to the
browser to wire up the handler, and the action still has to be invoked via a hidden
fetch under the hood. The form version works even if JS fails to load — true progressive
enhancement — and keeps this page a Server Component with zero client-side bundle cost.)

---

## Step 4 — The callback: exchanging a code for a session

This is the part of OAuth most tutorials wave their hands at. Open
[`app/api/auth/callback/route.ts`](../../../app/api/auth/callback/route.ts):

```ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

export async function GET(request: NextRequest) {
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

  const { error } = await auth.exchangeOAuthCode(code, verifier);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  response.cookies.delete(CODE_VERIFIER_COOKIE);
  return response;
}
```

Trace the two values that have to match up for this to succeed:

- `code` comes from the URL — Google/GitHub appended `?insforge_code=...` when it
  redirected the browser back here. This is public; anyone watching network traffic
  could see it.
- `verifier` comes from the cookie set back in Step 2. This is the secret half. It was
  never sent to Google at all in plaintext (PKCE sends a *hash* of it during the initial
  redirect) — it only gets sent here, server-to-server-logic, to prove this exchange
  request originated from the same session that started the flow.

`auth.exchangeOAuthCode(code, verifier)` is where InsForge's backend checks that the
hash of `verifier` matches what was registered when the flow started, and if so, issues
a real session.

One detail worth noticing: `response` is built *before* the cookies are attached to it
(`NextResponse.redirect(...)` first, then `createAuthActions({ responseCookies:
response.cookies })`). The SDK writes the session cookies directly onto that same
response object's `.cookies`, so by the time `return response` executes, the redirect
response already carries the new session.

**Checkpoint:** Why read the verifier from `cookies()` (the request) but pass
`response.cookies` to `createAuthActions`? (Answer: reading the existing session-init
state — "what cookie did we leave ourselves earlier" — happens on the incoming request.
Writing the new session has to happen on the *outgoing* response, because that's the
only place `Set-Cookie` headers can originate. Same request/response asymmetry as Step
1's two-client split.)

**Try it yourself:** Run this against the live dev server to see the failure path with
no real OAuth provider involved:

```bash
npm run dev   # if not already running
curl -i "http://localhost:3000/api/auth/callback"
```

You should get a `307` redirect to `/login?error=oauth` — because there's no `code` and
no `verifier` cookie. This is exactly the check on line 11 of the file firing.

---

## Step 5 — Protecting routes: `proxy.ts`

Open [`proxy.ts`](../../../proxy.ts) at the project root:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { updateSession, getAccessTokenCookieName } from "@insforge/sdk/ssr/middleware";

const PROTECTED_PATHS = ["/dashboard", "/profile", "/find-jobs"];

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  await updateSession({
    requestCookies: { get: (name: string) => request.cookies.get(name) },
    responseCookies: response.cookies,
  });

  const isProtected = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (isProtected && !request.cookies.get(getAccessTokenCookieName())) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/find-jobs/:path*"],
};
```

The filename matters more than it looks. In Next.js 15 and earlier this file was called
`middleware.ts`. **In Next.js 16, that name is silently ignored** — there's no error, no
warning, the file just never runs. `proxy.ts` is the only name Next 16 will execute for
this purpose. (This project's own `context/architecture.md` originally said
`middleware.ts`, and got corrected during this build — see `explanation.md` §4 in the
plan folder for the full story.)

What it does, in order, on every request matching `config.matcher`:

1. `updateSession(...)` runs *first*, before the protection check. If the access token
   is expired but the refresh token is still valid, this silently issues a new access
   token and writes it onto `response.cookies` — so the rest of this function (and any
   Server Component that renders after it) sees a fresh token, not a stale one.
2. *Then* it checks whether the path needs protection and whether an access-token cookie
   exists at all. No cookie + protected path → bounce to `/login`.

**Checkpoint:** Why call `updateSession` before the protection check, rather than after?
(Answer: ordering avoids a race. If the check ran first using a possibly-stale token
read, a user with a valid refresh token but an *expired* access token could get
incorrectly bounced to `/login` even though they're still validly logged in. Refreshing
first means the check always evaluates against the freshest possible token.)

**Try it yourself:** With the dev server running and you logged out, confirm the
protection works without touching a browser:

```bash
curl -i http://localhost:3000/dashboard
curl -i http://localhost:3000/profile
curl -i http://localhost:3000/find-jobs
```

All three should come back as `307` redirects to `/login`. Now try an unprotected path:

```bash
curl -i http://localhost:3000/
```

`200`, no redirect — because `/` isn't in `PROTECTED_PATHS` and isn't matched by
`config.matcher` either.

---

## Step 6 — Reading session state without mutating it: `lib/auth.ts`

Open [`lib/auth.ts`](../../../lib/auth.ts) — the smallest file in this whole feature,
and a good example of "the read path is simple because the write path did the hard work
elsewhere":

```ts
import { createInsforgeServer } from "@/lib/insforge-server";

export async function getCtaHref() {
  const insforge = await createInsforgeServer();
  const { data } = await insforge.auth.getCurrentUser();
  return data.user ? "/dashboard" : "/login";
}
```

This is what the homepage's `Navbar`, `Hero`, and `BottomCTA` components call to decide
whether their call-to-action button should say "Go to Dashboard" or "Sign In" — entirely
on the server, before any HTML reaches the browser. There's no loading spinner, no
client-side `useEffect` checking auth state after the page paints, because the check
already happened during the server render.

**Checkpoint:** This function uses `createInsforgeServer()`, not `createAuthActions()`.
Given what you learned in Step 1, why is that the right choice here? (Answer: this
function only needs to *read* "who is the current user" — it doesn't sign anyone in or
out, so it doesn't need the mutation-capable object. Reaching for `createAuthActions`
here would work but signals the wrong intent to a future reader of this file.)

---

## Step 7 — Signing out

Two sign-out paths exist in this codebase, doing the same underlying thing from
different call sites:

```ts
// app/actions/auth.ts — for a <form action={signOut}> button
export async function signOut() {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  await auth.signOut();
  redirect("/");
}
```

```ts
// app/api/auth/sign-out/route.ts — for a fetch() call from client code
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  const { error } = await auth.signOut();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
  }

  return response;
}
```

The Server Action version is for a plain `<form>` button anywhere in a Server Component
tree (same pattern as login). The Route Handler version exists for any Client Component
that needs to trigger sign-out via `fetch("/api/auth/sign-out", { method: "POST" })` — for
example, a dropdown menu item that needs client-side interactivity for other reasons
(closing the menu, showing a spinner) and so can't be a bare server-action form.

**Checkpoint:** Both versions call `auth.signOut()` from `createAuthActions`. What's
actually different between them? (Answer: not the auth logic — the *cookie plumbing*.
The Server Action gets a mutable `cookieStore` from `next/headers` directly. The Route
Handler has to construct an explicit `NextResponse` first and pass its `.cookies` in,
because Route Handlers don't get an ambient mutable cookie jar the way Server Actions
do.)

---

## Putting it together — trace one full login by hand

Try this end to end with real credentials, narrating each hop out loud (or in a
scratch file) before you click "continue":

1. Visit `/login`. Open devtools → Application → Cookies. Confirm no
   `insforge_code_verifier` cookie exists yet.
2. Click "Continue with Google." Before the redirect completes, you won't catch the
   cookie being set (it happens server-side, response headers only) — but once you land
   on Google's consent screen, refresh devtools and confirm `insforge_code_verifier` is
   now present, `httpOnly` (you can see the flag in devtools even though JS can't read
   the value).
3. Approve the consent screen. Watch the network tab for the redirect back to
   `/api/auth/callback?insforge_code=...`.
4. That request returns a `307` to `/dashboard`. Inspect its response headers — you
   should see `Set-Cookie` for the access and refresh tokens, and a `Set-Cookie` that
   *deletes* `insforge_code_verifier` (look for `Max-Age=0` or an expired date).
5. On `/dashboard`, confirm `insforge_code_verifier` is gone from your cookie jar, and a
   refresh-token cookie is present and marked `httpOnly`.

If every one of those five checks holds, you've independently verified the same flow
`explanation.md` §6 describes in prose — but from the network tab, not just from reading
code.

---

## Self-check quiz

No answers given below on purpose — these are meant to be answerable from what you just
read, not looked up:

1. Why can't `lib/insforge-client.ts`'s exported client call `signOut()`?
2. What's the one file-naming mistake that would make all of `proxy.ts` silently stop
   protecting routes in Next.js 16, with no error at build or runtime?
3. In the callback route, what two values have to match for `exchangeOAuthCode` to
   succeed, and where does each one come from?
4. Why does `updateSession()` run before the "is this path protected" check in
   `proxy.ts`, rather than after?
5. Name the one auth-related method exposed on the *browser* client
   (`lib/insforge-client.ts`'s `insforge`), and explain why mutation methods aren't
   exposed alongside it.

If you want to go deeper on any of these, the original
[`ai-discussion-topics.md`](../../plan/02-auth/ai-discussion-topics.md) has nine prompts
written for exactly this purpose — feed them to an AI one at a time after attempting an
answer yourself first.
