# Fix Explanation — Sign-Out Route Status Code Default

## Context

`app/api/auth/sign-out/route.ts` builds an error response when `auth.signOut()` returns an SDK-level error:

```ts
const errorResponse = NextResponse.json(
  { success: false, error: "Failed to sign out" },
  { status: error.statusCode },
);
```

## The gap

InsForge SDK error objects expose `statusCode` as an optional property. When it is `undefined`, passing it to `NextResponse.json()` as `status` produces an invalid response status — `undefined` is coerced or rejected depending on the runtime, rather than defaulting to a safe HTTP error code.

The outer `catch` block in the same file correctly hardcodes `500`:

```ts
return NextResponse.json(
  { success: false, error: "Failed to sign out" },
  { status: 500 },
);
```

The SDK error branch had no equivalent default.

## The fix

Apply the nullish coalescing operator so `500` is used when `statusCode` is absent:

```ts
{ status: error.statusCode ?? 500 }
```

## Behavior after the fix

If the SDK provides a specific status code (e.g. `401`, `503`), that value is forwarded. If the SDK error has no `statusCode`, the response correctly returns `500`.
