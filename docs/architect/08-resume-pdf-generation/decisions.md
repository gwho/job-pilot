# Architectural Decisions — Feature 08: Resume PDF Generation

## Decision 1: API Route Handler, Not Server Action

**What:** `POST /api/resume/generate` is a Next.js Route Handler (`app/api/resume/generate/route.ts`), not a Server Action in `actions/`.

**How it works:** The ProfileForm component fetches the route directly:
```typescript
const res = await fetch("/api/resume/generate", { method: "POST" });
const data = await res.json();
```
The route handler runs server-side, calls the agent, uploads the PDF, updates the DB, and returns `{ success, error }`.

**Why this choice:** The project architecture has a hard invariant: *Server Actions never call agent functions — only API routes do.* Resume generation calls an agent (Gemini + @react-pdf). It belongs in `app/api/`, symmetric with the existing `/api/profile/extract` endpoint.

Server Actions are for UI-triggered mutations (save profile, upload resume file). API routes are for agent operations. Mixing them breaks the architectural boundary and makes the codebase harder to reason about.

**Alternative cost:** A Server Action *could* technically work — Next.js doesn't prohibit it. But it violates the project's separation principle, making `actions/` responsible for both simple mutations and complex AI operations. That blurs the line that makes the codebase navigable.

---

## Decision 2: Hard Disable on Incomplete Profile

**What:** The "Generate Resume from Profile" button is `disabled` when `profile.is_complete === false`, with a tooltip: "Complete your profile first."

**How it works:**
```tsx
<button
  type="button"
  disabled={!profile.is_complete || isGenerating}
  title={!profile.is_complete ? "Complete your profile first." : undefined}
  onClick={handleGenerate}
>
  Generate Resume from Profile
</button>
```

**Why this choice:** Generating from an incomplete profile produces a degraded PDF — missing name, email, or work experience means empty sections. A hard disable prevents the user from wasting time and getting a confusing result.

**Alternative cost:** A soft warning (button enabled, toast on click) lets the user proceed but risks generating a barely-useful resume. The resulting PDF might confuse them ("why is my name missing?"). Hard disable sets a clear contract: fill in the required fields, then generate.

---

## Decision 3: Remove-Then-Upload, Not Upsert

**What:** The route handler removes the existing file from InsForge Storage before uploading the new one:
```typescript
await insforge.storage.from("resumes").remove([`${userId}/resume.pdf`]);
const { error } = await insforge.storage
  .from("resumes")
  .upload(`${userId}/resume.pdf`, buffer, { contentType: "application/pdf" });
```

**Why this choice:** This matches exactly how `actions/profile.ts:uploadResume` already works for manual resume uploads. Using the same pattern keeps the two operations symmetric and avoids introducing a different storage behavior for the same bucket and path.

**Alternative cost:** `{ upsert: true }` would work in InsForge (Supabase-compatible) and is slightly simpler code. But it diverges from the existing pattern in this codebase, creating two different behaviors for what is conceptually the same operation: replacing a file at a known path. Future developers would have to understand why the two cases differ.

---

## Decision 4: DB Stores Storage Path, Not a Signed URL

**What:** After upload, the profile is updated with:
```typescript
resume_pdf_url: `${userId}/resume.pdf`  // same value as resume_pdf_key
resume_pdf_key: `${userId}/resume.pdf`
```
No "real" URL is persisted. Signed URLs are generated on-demand by `getResumeSignedUrl()`.

**Why this choice:** The `resumes` bucket is private. Signed URLs expire (1 hour in this project). Persisting an expiring URL creates a time-bomb: the URL stored in the DB is useless after an hour. Storing the storage path instead is permanent and always accurate. The signed URL is generated fresh whenever the user clicks "View current resume."

**Alternative cost:** Persisting a signed URL with a long expiry (e.g., 1 week) would work but creates drift: the URL in the DB becomes stale, and you'd need a refresh mechanism. Simpler to never persist the URL at all.

---

## Decision 5: Gemini Temperature 0.7 / max_tokens 1000

**What:** The Gemini call for resume content uses:
```typescript
temperature: 0.7
max_tokens: 1000
```

**Why this choice:** `context/library-docs.md` documents project-specific Gemini configuration per use case. Resume writing is listed at 0.7 / 1000. These values differ from what a general-knowledge default would produce (the initial plan guessed 0.5 / 1500 before consulting the doc).

Temperature 0.7 (vs. 0.3 used for extraction) reflects the task type: extraction needs precision and repeatability, so low temperature. Resume writing benefits from more varied, natural-sounding language, so higher temperature is appropriate.

**Alternative cost:** Using undocumented values creates inconsistency across the codebase and risks exceeding token budgets or producing too-terse output.

---

## Decision 6: Skills Rendered as Joined String in @react-pdf

**What:** The Skills section of the PDF template renders:
```tsx
<Text>{profile.skills.join(" • ")}</Text>
```

**Why this choice:** `@react-pdf/renderer` uses React Native's Yoga layout engine, not browser CSS. Yoga does not support `flexWrap`. A list of `<Text>` components in a `<View>` with `flexDirection: "row"` will overflow the page without wrapping. Joining into a single string with a separator character is the correct workaround for tag-like content in PDF rendering.

**Alternative cost:** Rendering individual `<Text>` elements per skill looks right in code but breaks in the PDF — skills overflow horizontally off the page. This is a non-obvious constraint that only appears at render time.

---

## Decision 7: Architect Skill Updated to Mandate library-docs.md

**What:** `architect/SKILL.md` Step 1 now explicitly instructs: when the feature touches AI calls, storage, or any third-party integration, always read `context/library-docs.md` before planning.

**Why this change:** Four values in the initial plan were wrong (temperature, max_tokens, storage pattern, URL persistence strategy) because the Explore agents were not directed to read `library-docs.md`. These values are project-specific and cannot be inferred from general knowledge.

**Effect:** Future `/architect` sessions that involve Gemini or InsForge will automatically read the correct project-specific configuration before proposing values.
