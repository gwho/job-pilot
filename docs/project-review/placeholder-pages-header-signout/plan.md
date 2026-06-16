# Project Review — Placeholder Pages Missing Header + Sign Out

## What was reviewed

The three placeholder pages added in the prior `/recover` session (`app/dashboard/page.tsx`, `app/profile/page.tsx`, `app/find-jobs/page.tsx`) were reviewed against `context/ui-rules.md` and the user's screenshot of expected behavior, using the `/project-review` three-layer process.

## What was found

- **Layer 1 (plan alignment):** the placeholders never imported `Navbar`, so the header disappeared entirely on these routes — not because of any framework limitation, just because the stub never included it. `app/layout.tsx` is a bare shell; every page (including the homepage) is responsible for rendering its own `Navbar`/`Footer`.
- **Layer 2 (system integrity):** the placeholders ignored two established rules in `ui-rules.md` — the "Cards" rule (every content section lives in a white bordered card) and the "Empty States" rule (muted description text plus a CTA "if there's a logical next action"). They also left `app/api/auth/sign-out/route.ts` completely uncalled — the endpoint existed but nothing in the UI used it.
- **Layer 3 (production readiness):** with no sign-out control anywhere, anyone who signs in is stuck authenticated for the session's full lifetime with no in-app way to reset state.

## What was fixed

- Added `signOut()` Server Action to `app/actions/auth.ts`, matching the existing `signInWithGoogle`/`signInWithGithub` pattern.
- Added `components/layout/SignOutButton.tsx` — a plain form/button wired to that action.
- Added `components/layout/ComingSoonCard.tsx` — a reusable empty-state card per `ui-rules.md`, used identically across all three pages.
- Updated all three placeholder pages to render `<Navbar />` followed by the card.
- Updated `context/ui-registry.md` with both new components.

## Verification performed

- `npx tsc --noEmit` — clean.
- `curl` to `/dashboard` while logged out — still 307-redirects to `/login` (proxy.ts protection unaffected by this change).
- Full authenticated-state visual verification (header rendering, card layout, sign-out actually clearing the session) requires a real browser with a real Google/GitHub session — not scriptable from here, left for manual confirmation.
