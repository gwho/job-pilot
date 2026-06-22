# Progress Tracker

Update this file after every completed feature. Any AI agent reading this should immediately know what is done, what is in progress, and what is next.

---

## Current Status

**Phase:** Phase 2 — Profile Page
**Last completed:** 06 Profile Save Logic
**Next:** 07 AI Profile Extraction from Resume

---

## Progress

### Phase 1 — Foundation

- [x] 01 Homepage
- [x] 02 Auth
- [x] 03 PostHog Initialization
- [x] 04 Database Schema

### Phase 2 — Profile Page

- [x] 05 Profile Page — Full UI
- [x] 06 Profile Save Logic
- [ ] 07 AI Profile Extraction from Resume
- [ ] 08 Resume PDF Generation from Profile

### Phase 3 — Find Jobs Page

- [ ] 09 Find Jobs Page — Full UI
- [ ] 10 Adzuna Job Discovery
- [ ] 11 Filter + Sort + Pagination

### Phase 4 — Job Details Page

- [ ] 12 Job Details Page — Full UI
- [ ] 13 Company Research Agent

### Phase 5 — Dashboard

- [ ] 14 Dashboard Page — Full UI
- [ ] 15 Stats Bar — Real Data
- [ ] 16 Recent Activity — Real Data
- [ ] 17 Analytics Charts — PostHog Data

---

## Decisions Made During Build

- **02 Auth**: `context/architecture.md`, `library-docs.md`, and `code-standards.md` referenced a fictional `@insforge/ssr` package and a `middleware.ts` file. Verified against the real published `@insforge/sdk` (v1.4.2, via npm registry + unpkg) and later confirmed via the InsForge MCP once it became available in-session. Corrected all three context files in place: real package is `@insforge/sdk` (SSR helpers at `@insforge/sdk/ssr` and `@insforge/sdk/ssr/middleware`), OAuth is a server-driven PKCE flow (not client-side token-in-URL), get-user method is `getCurrentUser()` not `getUser()`, and Next.js 16 requires `proxy.ts` not `middleware.ts`. Full rationale in `docs/plan/02-auth/explanation.md`.
- **02 Auth completion**: Follow-up audit in `docs/diff/02-auth/README.md` found that the callback and API sign-out routes passed `request.cookies` where the SDK needed the outgoing response cookie writer, and that `proxy.ts` checked the original request cookie instead of `updateSession()`'s refreshed token. Completion pass fixes those issues, adds a friendly `/login?error=oauth` state, keeps the Server Action sign-out button, and documents the corrected Route Handler pattern in `context/library-docs.md`. Full plan in `docs/diff/02-auth/implementation-plan.md`; formal completion docs in `docs/plan/02-auth-completion/`.
- **03 PostHog Initialization**: PostHog is initialized through `instrumentation-client.ts` with the existing reverse proxy, server events now use one-shot clients that call `shutdown()` before returning, the root layout identifies returning authenticated users on the client, and sign-out resets browser identity before the server action clears the session. Full docs in `docs/plan/03-posthog-initialization/`.
- **04 Database Schema**: Four tables (`profiles`, `agent_runs`, `jobs`, `agent_logs`) created via InsForge `run-raw-sql` MCP tool. `profiles` uses shared PK (id = auth user UUID). DB-level `updated_at` trigger on `profiles`. 6 performance indexes on `jobs`, `agent_runs`, `agent_logs` covering RLS filter + sort columns. 16 RLS policies (SELECT/INSERT/UPDATE/DELETE on all four tables). Private `resumes` storage bucket. `types/index.ts` created with typed interfaces for all tables including literal unions and JSONB sub-types. `scripts/schema.sql` saved as durable reference. Full docs in `docs/plan/04-database-schema/`. Architect session documented in `docs/architect/04-database-schema/`.
- **06 Profile Save Logic**: Two Server Actions in `actions/profile.ts` — `saveProfile` (upserts all text fields, calculates `is_complete`, fires `profile_completed` PostHog event on first complete save) and `uploadResume` (removes old file from InsForge Storage, uploads new PDF, saves `resume_pdf_key` + `resume_pdf_url`). `lib/profile-utils.ts` with `calculateCompletion()` is the single source of truth for completion logic — used by both the client ring display and the server action, eliminating divergence risk. `MissingField` type added to `types/index.ts`. `profiles` table now has `resume_pdf_key`, `linkedin_connected`, and `is_tailored` columns. Resume upload fires immediately on file pick (separate from Save). Email sourced from auth session, not form input. Full docs in `docs/plan/06-profile-save/`. Architect session in `docs/architect/06-profile-save/`. — **Review fix**: added `resume_pdf_filename` column + persistence; `getResumeSignedUrl` Server Action for private-bucket preview; "View current resume" button in ProfileForm. Docs in `docs/project-review/06-resume-preview/`.
- **05 Profile Page — Full UI**: Single `"use client"` component (`ProfileForm`) owns all state — completion ring, tag inputs, work experience rows, education, job preferences. No state lift; all derived values (completionPercentage, missingFields) computed via `useMemo`. `FormState` type uses `ExperienceLevel | ''` (and similar unions with `''`) for dropdown fields — required because HTML `<select>` value must be a string, not `null`. Mock data typed as `Profile` at declaration site for structural type safety. `NavLinks.tsx` extracted as a thin client component so `Navbar` stays a Server Component (it calls `getCtaHref()` which needs async server auth). `TagInput` must be declared at module scope, not inside the component function — defining a component inside a render path causes React to treat it as a new type on every render, triggering unnecessary unmount/remount (caught by `react-hooks/static-components` ESLint rule). `lucide-react` added as a dependency. Full docs in `docs/plan/05-profile-page/`. Architect session in `docs/architect/05-profile-page/`.

---

## Notes

- Placeholder pages exist at `/dashboard`, `/profile`, `/find-jobs` purely to prevent 404s from the Feature 02 auth redirect logic (`getCtaHref()` in `lib/auth.ts`) before their real features are built. Each is a one-line "coming soon" Server Component. Replace entirely, don't extend, when 05 Profile Page, 09 Find Jobs Page, and 14 Dashboard Page start.
