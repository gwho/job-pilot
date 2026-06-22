# Explanation — Feature 06: Profile Save Logic

## Why a shared calculateCompletion utility?

The form needs to show a live completion ring and missing field tags as the user types. The Server Action needs to set `is_complete` in the database. Both need the same set of rules: which fields are required, what counts as "filled."

If these live in two places, they drift. A developer fixes a bug in the form's logic but forgets the server action. Now the user sees 100% in the UI but `is_complete = false` in the DB. The PostHog event never fires. Jobs aren't matched.

`lib/profile-utils.ts` solves this at the source. One function. One set of rules. Import it in both places.

## Why does useTransition work here?

`useTransition` marks an async operation as a non-urgent state update. React keeps the UI interactive while the transition runs. In ProfileForm, this means:
- `isSaving` is `true` while the Server Action runs
- The button shows "Saving..." and is disabled
- React doesn't block the rest of the UI

Two separate transitions (`startSave` and `startUpload`) let save and upload have independent pending states.

## Why remove-then-upload instead of upsert?

InsForge Storage's `upload()` function doesn't have an `upsert` option — this was a documentation error in `library-docs.md`. When you upload to an existing path, the SDK appends a timestamp to avoid collision: `${userId}/resume-1705315200000.pdf`. Old files pile up.

The correct pattern: read `resume_pdf_key` from the profile row, call `remove(key)` to delete the old file, then `upload()` to get a fresh key and URL. Save both to DB.

## Why are email and linkedinConnected/isTailored not in FormState?

`email` is auth-owned. The form displays it read-only but never sends it back — the Server Action reads it from the session. This prevents any client-side spoofing.

`linkedin_connected` and `is_tailored` are flags set by other parts of the system (OAuth integration for LinkedIn, agent for tailoring). The profile form doesn't let users toggle them directly. They're initialized from the profile prop and passed through to `saveProfile` unchanged.

## Why does profile/page.tsx pass email as a separate prop?

The auth user's email lives on `authData.user.email`, not on the `profiles` row. They could be different (a user could change their auth email). Passing it as a separate prop makes the data source explicit: email always comes from auth, not from the profiles table.

## Why is is_complete checked before upserting (not after)?

The PostHog gate needs to know the *previous* state. If we check after upsert, we'd have to read back our own write to compare. Checking before is one round trip cheaper and avoids any race condition where the post-upsert read sees stale data.
