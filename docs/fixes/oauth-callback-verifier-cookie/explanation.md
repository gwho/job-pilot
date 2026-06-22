# Fix Explanation — OAuth Callback Verifier Cookie on Error

## Context

The PKCE OAuth flow stores the code verifier in an httpOnly cookie:

```
Set-Cookie: insforge_code_verifier=...; HttpOnly; Max-Age=600
```

The callback route uses that verifier once — to exchange the code for a session. After that exchange (success or failure) the verifier is no longer needed and should be deleted from the browser.

## The gap — error path returned a new response

Before the fix:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
const auth = createAuthActions({ ..., responseCookies: response.cookies });

const { data, error } = await auth.exchangeOAuthCode(code, verifier);
if (error) {
  return NextResponse.redirect(new URL("/login?error=oauth", request.url)); // new object
}

response.cookies.delete(CODE_VERIFIER_COOKIE); // only reached on success
return response;
```

On failure:
- A new response was returned that knew nothing about the verifier cookie — no `Set-Cookie: insforge_code_verifier=; Max-Age=0` header was sent.
- Any `Set-Cookie` headers written by `createAuthActions` onto `response.cookies` were also silently discarded.

## The fix

Delete the verifier cookie unconditionally on the shared `response` object before the exchange call:

```ts
const response = NextResponse.redirect(new URL("/dashboard", request.url));
response.cookies.delete(CODE_VERIFIER_COOKIE);  // ← runs regardless of outcome

const auth = createAuthActions({ ..., responseCookies: response.cookies });

const { data, error } = await auth.exchangeOAuthCode(code, verifier);
if (error) {
  response.headers.set("Location", loginUrl.toString()); // reuse response, change destination
  return response;
}
```

On failure the same response is returned with its destination changed — all `Set-Cookie` mutations (including the verifier deletion) are preserved.

## Early guard also fixed

The early return for `!code || !verifier` also created a fresh response. That path can't reach `createAuthActions` so there are no auth cookie mutations to preserve, but the verifier should still be deleted if it exists:

```ts
if (!code || !verifier) {
  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(CODE_VERIFIER_COOKIE);
  return response;
}
```

## Behavior after the fix

In every exit path — missing params, exchange failure, unexpected throw, success — the browser receives a `Set-Cookie` header that expires the verifier cookie.
