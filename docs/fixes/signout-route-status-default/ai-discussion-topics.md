# AI Discussion Topics — Sign-Out Route Status Code Default

1. Explain why passing `undefined` as an HTTP status code is problematic, and what value browsers and Next.js assign when the status is invalid.
2. Compare forwarding the SDK's `statusCode` to the client versus always returning `500` — what information does each approach leak?
3. Review whether the `401` or `403` SDK status codes would ever be appropriate to surface for a sign-out failure.
4. Walk through the full error handling shape of `app/api/auth/sign-out/route.ts` and confirm all exit paths return a valid HTTP status.
