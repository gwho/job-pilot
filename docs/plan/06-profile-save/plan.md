# Plan — Feature 06: Profile Save Logic

## What was built

- `lib/profile-utils.ts` — `calculateCompletion()` shared between client ring display and Server Action
- `types/index.ts` — `MissingField` named union type added
- `actions/profile.ts` — `saveProfile()` and `uploadResume()` Server Actions
- `app/profile/page.tsx` — Server Component that fetches real profile and passes it as prop
- `components/profile/ProfileForm.tsx` — replaced mock data, wired save + upload, useTransition pending states
- `scripts/schema.sql` — documented `resume_pdf_key`, `linkedin_connected`, `is_tailored` columns
- `context/library-docs.md` — corrected wrong storage pattern documentation

## Schema changes (applied via InsForge MCP)

- `profiles.resume_pdf_key TEXT` — stores the InsForge storage object key for remove-before-reupload
- `profiles.linkedin_connected BOOLEAN NOT NULL DEFAULT FALSE` — added in session wrap-up
- `profiles.is_tailored BOOLEAN NOT NULL DEFAULT FALSE` — added in session wrap-up

## Key invariants

- `calculateCompletion()` is the ONLY place completion logic lives — never duplicate it
- `uploadResume` reads `resume_pdf_key` from DB, calls `remove()` before uploading
- `saveProfile` reads `is_complete` from DB before upsert to gate the PostHog event
- Email always comes from `authData.user.email` — never from form state
- `profile_completed` PostHog event fires exactly once: when `is_complete` transitions false → true
