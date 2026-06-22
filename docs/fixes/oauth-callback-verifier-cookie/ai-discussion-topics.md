# AI Discussion Topics — OAuth Callback Verifier Cookie on Error

1. Explain why a PKCE code verifier must be treated as a one-time secret and cleared after the callback regardless of outcome.
2. Walk through what `response.headers.set("Location", ...)` does to the redirect destination without creating a new response object.
3. Compare the cookie mutation lifecycle when returning the same `response` versus returning `NextResponse.redirect(...)` inside a Route Handler.
4. Review whether the outer `catch` block also needs to delete the verifier cookie, and why it currently does not.
