# Feature 02 Auth Completion — Plan

## What was built

This completion pass fixed the correctness gaps found in `docs/diff/02-auth/README.md` so Feature 02 Auth matches its original design.

Built changes:

- Fixed `app/api/auth/callback/route.ts` so `createAuthActions()` writes session cookies to the outgoing redirect response.
- Fixed `app/api/auth/sign-out/route.ts` so API sign-out clears cookies on the outgoing JSON response.
- Hardened `app/actions/auth.ts` so OAuth init failures log internally and redirect to `/login?error=oauth` instead of throwing raw errors.
- Kept `components/layout/SignOutButton.tsx` on the existing Server Action sign-out path.
- Fixed `proxy.ts` so route protection uses the `updateSession()` result, allowing refreshed sessions through protected routes.
- Preserved cookie mutations when `proxy.ts` redirects unauthenticated users.
- Added a friendly `/login?error=oauth` message to the login page without converting it to a Client Component.
- Updated `context/library-docs.md`, `context/progress-tracker.md`, `context/ui-registry.md`, and the original `docs/plan/02-auth/` docs to reflect the corrected pattern.

## Why this was needed

The first Auth implementation had the correct shape but two Route Handlers passed `request.cookies` as the SDK's `responseCookies` writer. That is wrong because login/logout cookie changes must be attached to the response sent back to the browser.

The first implementation also refreshed sessions in `proxy.ts` but still checked the original request cookie. That could reject a valid session that had just been refreshed.

## Verification target

Feature 02 Auth should be considered truly complete when:

- Logged-out protected routes redirect to `/login`.
- Missing callback params redirect to `/login?error=oauth`.
- OAuth failures show a friendly login error.
- Callback success writes auth cookies to the redirect response.
- API sign-out writes cookie-clearing headers to the JSON response.
- Refreshed sessions are allowed through protected routes.
- Lint, TypeScript, and production build pass.
- Manual Google/GitHub provider click-through is completed with a real account.

## Verification performed

- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed after allowing network access for the `next/font` Inter download.
- Logged-out `/dashboard` redirects to `/login`.
- Logged-out `/profile` redirects to `/login`.
- Logged-out `/find-jobs` redirects to `/login`.
- Logged-out `/find-jobs/example-id` redirects to `/login`.
- `/api/auth/callback` with missing params redirects to `/login?error=oauth`.
- `/api/auth/refresh` with no session returns `401` and cookie-clearing headers.
- `/api/auth/sign-out` with no session returns `{ "success": true }` and cookie-clearing headers.
- `/login?error=oauth` renders the friendly message: "We could not complete sign in. Please try again."

## Not verified automatically

- Real Google provider consent click-through.
- Real GitHub provider consent click-through.
- Expired-access-token plus valid-refresh-token behavior with real InsForge cookies.
