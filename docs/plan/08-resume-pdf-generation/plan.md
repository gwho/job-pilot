# Plan — Feature 08: Resume PDF Generation from Profile

## What was built

| File | Status | What changed |
|---|---|---|
| `agent/resume-template.tsx` | Created | @react-pdf `Document`/`Page`/`View`/`Text` component (`ResumeDocument`) rendering header, summary, skills, work experience, and education. Exports `ResumeContent` interface. |
| `agent/pdf-generator.tsx` | Created | `generateResumePdf(profile)` — calls Nemotron (temp 0.7, max_tokens 1000) for polished summary + work experience bullets, calls `renderToBuffer(<ResumeDocument .../>)`, returns `{ success, buffer }` |
| `app/api/resume/generate/route.ts` | Created | POST handler: auth → full profile fetch → `is_complete` guard → `generateResumePdf()` → remove existing file → upload Blob → upsert `resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename` |
| `next.config.ts` | Modified | Added `"@react-pdf/renderer"` to `serverExternalPackages` |
| `components/profile/ProfileForm.tsx` | Modified | Added `isGenerating`/`startGenerate` transition, `generateResult` state, `handleGenerate()` handler, wired Generate button with `disabled`, `title` tooltip, loading text, and inline success/error feedback |
| `context/progress-tracker.md` | Modified | Feature 08 ✅; next → Feature 09 |
| `context/ui-registry.md` | Modified | Generate button disabled pattern documented in ProfileForm entry |
| `package.json` / `package-lock.json` | Modified | Added `@react-pdf/renderer` (58 packages) |
| `app/actions/auth.ts` | Modified (pre-existing fix) | Removed `data` from `signOut()` destructuring — method returns `{ error }` only, no `data` |
| `app/practice-01/page.tsx` | Modified (pre-existing fix) | Added `export default` to page component (leftover saboteur bug blocking build) |

## Schema changes

None. `resume_pdf_key`, `resume_pdf_url`, and `resume_pdf_filename` columns already existed from Feature 06.

## Key invariants

1. **PDF generation route only** — `renderToBuffer` is called from `agent/pdf-generator.tsx`, consumed only by `app/api/resume/generate/route.ts`. Never call pdf generation from Server Actions or client components.

2. **Buffer→Blob before upload** — InsForge SDK `storage.upload()` accepts `File | Blob` only. Upload calls must wrap the Buffer: `new Blob([new Uint8Array(buffer)], { type: "application/pdf" })`. Passing a raw `Buffer` directly causes a TypeScript error and would fail at runtime.

3. **Remove before upload, no upsert** — InsForge `upload()` has no upsert option; it auto-renames on key conflict. Always call `storage.from("resumes").remove(existingKey)` before uploading to keep exactly one file per user at `{userId}/resume.pdf`.

4. **is_complete enforced server-side** — The route checks `profile.is_complete` and returns 400 if false. The client-side `disabled` attribute is UX only; the server guard is the real protection.

5. **Nemotron config from library-docs.md** — Resume generation uses `temperature: 0.7` and `max_tokens: 1000` per `context/library-docs.md`. Never change these values without updating `library-docs.md`.

6. **ResumeContent is the single contract** — The `ResumeContent` interface in `agent/pdf-generator.tsx` is the only source of truth between the Nemotron call and the PDF template. If the Nemotron prompt output shape changes, update this interface — the TypeScript compiler will flag all downstream breakage.

7. **@react-pdf/renderer stays in serverExternalPackages** — Removing it causes Turbopack to attempt bundling pdfkit internals, which fails at build time. It must stay alongside `"pdf-parse"` in `next.config.ts`.

8. **Skills are a single joined string in the PDF** — `@react-pdf/renderer` uses Yoga (React Native layout engine) which has no `flexWrap`. Skills must be rendered as `profile.skills.join(" • ")` in one `<Text>` element. Never attempt a flex row of individual tag elements.
