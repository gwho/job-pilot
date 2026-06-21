# Memory — Feature 05 Profile Page — Full UI

Last updated: 2026-06-21

## What was built

- `components/profile/ProfileForm.tsx` — single `"use client"` component (~1070 lines) owning all profile state: completion ring, tag inputs, work experience rows, education, job preferences. No state lift; all derived values (`completionPercentage`, `missingFields`) computed via `useMemo`.
- `components/layout/NavLinks.tsx` — extracted as a standalone thin client component so `Navbar.tsx` stays a Server Component (it calls `getCtaHref()` which needs async server auth).
- `app/profile/page.tsx` — updated to render `ProfileForm`.
- `app/globals.css` — one new token line added.
- `context/ui-tokens.md` — new tokens for profile page.
- `context/ui-registry.md` — updated with profile page patterns.
- `context/progress-tracker.md` — Feature 05 marked complete, next set to Feature 06.
- `docs/plan/05-profile-page/plan.md`, `explanation.md`, `ai-discussion-topics.md` — feature learning docs.
- `docs/architect/05-profile-page/decisions.md`, `discussion.md` — architect session record.
- `docs/project-review/05-profile-page-polish/` — project review docs.
- Multiple tutorial READMEs added under `docs/tutorials/`.
- `lucide-react` added to `package.json`.

## Decisions made

- **Single `"use client"` ProfileForm**: All profile state lives in one component. No state lift needed at this stage — avoids prop drilling for a form this large.
- **`FormState` uses union types with `''` for dropdowns**: `ExperienceLevel | ''` (and similar) required because HTML `<select>` value must be a string, not `null`. Without this TypeScript rejects controlled select components.
- **Mock data typed as `Profile` at declaration**: Structural type safety catches mismatches at the callsite rather than at render time.
- **`TagInput` declared at module scope**: Defining a component inside a render function causes React to treat it as a new type on every render, triggering unnecessary unmount/remount (caught by `react-hooks/static-components` ESLint rule). Declared at module top level instead.
- **NavLinks extracted for server/client boundary**: `Navbar` needs async server-only `getCtaHref()`. `NavLinks` needs `"use client"` for active-link state. Splitting preserves both requirements without making Navbar a client component.
- **`linkedin_connected` and `is_tailored` columns added to `profiles`**: Previously absent from `context/architecture.md` but confirmed needed. Added as booleans (`is_tailored DEFAULT false`).

## Problems solved

- `react-hooks/static-components` lint error: caused by `TagInput` defined inside `ProfileForm`'s function body. Fixed by hoisting to module scope.
- Server/client boundary conflict in `Navbar`: extracting `NavLinks` as a dedicated client component resolved it cleanly.

## Current state

- Feature 05 fully complete and committed (`f06bad5`).
- `context/ui-registry.md` local change committed in wrap-up commit this session.
- `app/practice-01/` tracked and committed (confirmed keeper).
- `profiles` table now has `linkedin_connected` and `is_tailored` columns (added this session).
- Google and GitHub OAuth providers fully configured in InsForge for `http://localhost:3000`.
- Profile page renders with mock data at `http://localhost:3000/profile` — no save logic yet.
- Phase 2 is now active. Phase 1 Foundation is fully complete.

## Next session starts with

Begin **Feature 06: Profile Save Logic**.

Key steps:
- Create `actions/profile.ts` with a `saveProfile` Server Action
- Use `createInsforgeServer()` — never the browser client
- Upsert on `profiles.id = auth.uid()` (shared PK pattern from Feature 04)
- `linkedin_connected` and `is_tailored` are now real columns — include them in the upsert
- Call `revalidatePath('/profile')` after successful write
- Fire `profile_completed` PostHog event on first-time save (check if row previously existed)
- Connect the Server Action to `ProfileForm`'s save button

Run `/architect feature 06` before starting if save logic decisions feel uncertain.

## Open questions

None — all open questions from Feature 04 resolved this session.
