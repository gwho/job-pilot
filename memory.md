# Memory — Feature 06 Profile Save Logic + Review Fixes

Last updated: 2026-06-23

## What was built

### Feature 06 — Profile Save Logic (completed wrap-up this session)
- `lib/profile-utils.ts` — `calculateCompletion()` shared between ProfileForm useMemo and saveProfile Server Action; single source of truth for completion logic
- `types/index.ts` — `MissingField` named union type added; `resume_pdf_key`, `linkedin_connected`, `is_tailored`, `resume_pdf_filename` added to `Profile` interface
- `actions/profile.ts` — `saveProfile()` upserts all text fields, calculates `is_complete`, fires `profile_completed` PostHog event on first complete transition; `uploadResume()` removes old file then uploads new PDF, persists `resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename`; `getResumeSignedUrl()` generates 1-hour signed URL for private bucket preview
- `app/profile/page.tsx` — Server Component fetches real profile from DB, passes as `profile: Profile | null` prop + `email` from auth session
- `components/profile/ProfileForm.tsx` — replaced mock data with prop-based initialization; wired `saveProfile` and `uploadResume` via `useTransition`; added `handleViewResume` + "View current resume" button; `resumeFileName` state now initialized from `profile?.resume_pdf_filename`
- `scripts/schema.sql` — documented new columns
- `context/library-docs.md` — corrected wrong storage pattern (no `upsert: true`; must `remove(key)` then `upload()` for private bucket; use `createSignedUrl` not `getPublicUrl`)
- `context/ui-registry.md` — Server Action + useTransition pattern added
- `context/progress-tracker.md` — Feature 06 marked complete including review fix note
- `docs/architect/06-profile-save/discussion.md`, `decisions.md` — architect session record
- `docs/plan/06-profile-save/plan.md`, `explanation.md`, `ai-discussion-topics.md` — feature learning docs
- `docs/project-review/06-resume-preview/plan.md`, `explanation.md`, `ai-discussion-topics.md` — review fix docs

### DB changes applied (via InsForge MCP)
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS linkedin_connected boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_tailored boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_pdf_key TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_pdf_filename TEXT;
```

## Decisions made

- **Shared `calculateCompletion` utility**: Lives in `lib/profile-utils.ts`. Both the client ring display (useMemo in ProfileForm) and the server action import it. Never duplicate this logic.
- **`resume_pdf_filename` persisted to DB**: Not derived from key or kept in state — must survive page reloads. State initializes from `profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)`.
- **Signed URLs generated on demand**: `getResumeSignedUrl()` re-reads `resume_pdf_key` from DB every call (not cached state). Expires in 3600 seconds. Never stored.
- **Email sourced from auth session only**: `saveProfile` reads `authData.user.email` — never from form payload. Prevents client-side spoofing.
- **`is_complete` read before upsert**: Lets the PostHog gate compare previous vs new state in one round trip.
- **Resume upload fires on file pick (separate from Save)**: Two distinct `useTransition` instances — `startUpload` and `startSave` — give independent pending states.
- **`insforge.database.from(...)` not `insforge.from(...)`**: Verified from actual SDK types. The `library-docs.md` pattern was wrong. Fixed.
- **`upload()` has no `upsert` option**: SDK auto-renames on conflict. Pattern is always: read `resume_pdf_key` from DB → `remove(key)` → `upload()` → save new key.
- **"Generate Resume from Profile" button is an intentional stub**: Confirmed by project-review check against `build-plan.md`. It's the Feature 08 placeholder (Resume PDF Generation). No action needed until Feature 08 starts.

## Problems solved

- **`insforge.from()` doesn't exist**: Real API is `insforge.database.from()`. Caught during Feature 06 implementation.
- **`upsert: true` doesn't exist in storage SDK**: `library-docs.md` was wrong. Correct pattern is remove-then-upload.
- **`resume_pdf_url` is not publicly accessible**: `resumes` bucket is private. `getPublicUrl()` returns 403. Fixed with `createSignedUrl(key, 3600)` in a new Server Action.
- **Filename lost on page reload**: `resumeFileName` was local state initialized to hardcoded `"Resume on file"`. Fixed by persisting `resume_pdf_filename` to DB and reading it on page load.
- **6 accessibility errors in ProfileForm**: Select elements and disabled email input had no `aria-label` or `title`. Fixed by adding both attributes to each flagged element.
- **Unused variable lint warning**: `percentage: _` in destructuring in `actions/profile.ts`. Fixed by only destructuring `missingFields`.

## Current state

- Feature 06 fully complete with all review fixes applied. Lint is clean.
- Profile page: form pre-fills from DB, save works, upload works, "View current resume" generates signed URL and opens PDF in new tab, filename persists across reloads.
- `resumes` storage bucket is private — signed URL is the only way to serve files.
- Progress tracker: Feature 06 ✅, next → Feature 07 AI Profile Extraction from Resume.

## Next session starts with

Begin **Feature 07: AI Profile Extraction from Resume**.

Key steps per build plan:
- "Extract from Resume" button appears after resume is uploaded (ProfileForm already has the upload zone — add the button there)
- `pdf-parse` extracts raw text from the uploaded PDF buffer via a Server Action or API route
- If text is empty or too short → return error: "Could not extract text from this PDF. Please try a different file."
- GPT-4o reads extracted text and returns structured JSON matching all profile field names
- ProfileForm fields populate with extracted data (user reviews before saving)
- User saves manually after reviewing

Run `/architect feature 07` before starting — the AI extraction flow has enough edge cases (short PDF, scanned image PDF, partial extraction) to warrant planning before coding.

## Open questions

- None — all open questions from this session resolved.
