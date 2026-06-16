# Recover — "Start for free" 404

## What went wrong

Clicking "Start for free" on the homepage led to a `404 This page could not be found` error.

## Diagnosis

Identified as **Failure Mode 1 — a specific, isolated thing is broken** (per the `/recover` skill): the problem was confined to one redirect target, the rest of the app worked, and the symptom (404) was clear and specific.

**Root cause:** `lib/auth.ts`'s `getCtaHref()` correctly implements the build-plan spec — returns `/dashboard` when a session exists, `/login` otherwise. The 404 only happened when already authenticated: it correctly resolved to `/dashboard`, but `app/dashboard/page.tsx` didn't exist yet, because Dashboard is Feature 14 (Phase 5) and only Features 01–02 were complete at the time. This was never a bug in the auth redirect logic — it was a forward reference to a real future feature that correctly hadn't been built yet.

**A wrong claim was caught and discarded during diagnosis:** an earlier exploration pass claimed `proxy.ts` "is never executed because Next.js expects `middleware.ts`." This was re-verified live — `curl http://localhost:3000/dashboard` while logged out returned a `307` redirect to `/login`, proving `proxy.ts` was running correctly — and cross-checked against Next.js 16's own installed docs, which state the opposite: `middleware.ts` is the deprecated name, `proxy.ts` is current. No fix was applied to `proxy.ts`.

## Fix applied

Added three minimal placeholder pages — `app/dashboard/page.tsx`, `app/profile/page.tsx`, `app/find-jobs/page.tsx` — each rendering a one-line "X — coming soon" message, explicitly scoped as throwaway stubs to be replaced when their real features (05, 09, 14) are built. Logged `progress-tracker.md`'s Notes section accordingly.

## Outcome

This fix correctly stopped the 404. A follow-up `/project-review` (see `docs/project-review/placeholder-pages-header-signout/`) later found that "minimal stub" had been read too narrowly — it dropped the page header and left no way to sign out — and added both back without touching the underlying diagnosis or fix described here.
