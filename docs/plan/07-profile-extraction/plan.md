# Plan — Feature 07-profile-extraction: AI Profile Extraction from Resume

## What was built

- **`agent/extractor.ts`** (new) — exports `ProfileExtraction` type and `extractProfileFromResume(buffer)`: runs `pdf-parse` on the PDF buffer, guards on text length < 100, calls Gemini 2.5 Flash-Lite via OpenAI-compatible endpoint, returns typed `ProfileExtraction` JSON
- **`app/api/profile/extract/route.ts`** (new) — `POST /api/profile/extract`: authenticates user, fetches `resume_pdf_key` from `profiles`, downloads PDF blob from InsForge Storage, passes buffer to `extractProfileFromResume`, returns JSON response
- **`components/profile/ProfileForm.tsx`** (modified) — added `import type { ProfileExtraction }` from `agent/extractor`; added `isExtracting` / `startExtract` transition and `extractResult` state; added `applyExtraction()` helper and `handleExtract()` handler; added "Extract from Resume" button + feedback block in resume card (conditionally rendered when `resumeFileName !== null`)
- **`context/progress-tracker.md`** (modified) — Feature 07 marked complete, current status updated to Feature 08
- **`package.json` / `package-lock.json`** (modified) — added `openai`, `pdf-parse`, `@types/pdf-parse`

## Schema changes

None. No DB columns, tables, or policies were added.

## Key invariants

- `agent/extractor.ts` must never be imported in client components or any file that could be bundled for the browser — `pdf-parse` is Node.js only
- `ProfileExtraction` type is the single definition shared between the API route response and `ProfileForm` — never redefine it inline in the component
- `applyExtraction()` must use `!= null` guards (not truthy checks) before applying each scalar field — this preserves existing form values for fields Gemini could not extract
- Array fields (`skills`, `industries`, `job_titles_seeking`, `work_experience`) are only applied if the returned array has `.length > 0` — an empty array means "not found", not "blank"
- The API route reads the PDF from InsForge Storage using `resume_pdf_key` from the DB — the client never re-sends the file
- Extraction does not write to the DB — the user reviews populated fields and saves manually via the existing `saveProfile` Server Action
- The Gemini client in `agent/extractor.ts` uses `GOOGLE_API_KEY` and `baseURL: https://generativelanguage.googleapis.com/v1beta/openai/` — never use the default OpenAI endpoint or `OPENAI_API_KEY` in this project
- Model string is always `gemini-2.5-flash-lite` — defined in `agent/extractor.ts`, never hardcoded elsewhere
