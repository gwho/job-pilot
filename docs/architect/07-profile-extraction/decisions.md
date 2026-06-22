# Architect Decisions — Feature 07: AI Profile Extraction from Resume

---

## Decision 1: API Route + `agent/extractor.ts`, not a Server Action

**What it is:** The extraction logic lives in `app/api/profile/extract/route.ts` (route handler) and `agent/extractor.ts` (AI logic), not in `actions/profile.ts`.

**How it works:**
- Client calls `POST /api/profile/extract` with no body
- Route handler authenticates, fetches `resume_pdf_key` from the profile, downloads the PDF from InsForge Storage, calls `extractProfileFromResume()`, returns JSON
- `agent/extractor.ts` runs `pdf-parse` on the buffer, then calls Gemini, returns structured `ProfileExtraction`

**Why not a Server Action?**
The project has a hard architectural invariant: Server Actions handle UI-triggered DB mutations (`saveProfile`, `uploadResume`). Agent/AI operations go through API routes and the `agent/` folder. From `CLAUDE.md`:

```
UI mutations → Server Action → DB write
Agent operations → API route → agent/ function → AI → DB write
```

Profile extraction is an AI operation (pdf-parse + Gemini call). It returns data to the client for user review — it does NOT write to the DB itself. Putting it in `actions/profile.ts` would break both invariants: it's not a DB mutation, and it's an AI call.

**What the alternative costs:**
A Server Action for extraction would work technically, but it muddies the boundary between "UI mutation" and "agent operation." Future developers reading `actions/profile.ts` would see AI calls mixed with DB upserts — a pattern that signals the wrong mental model and makes it harder to know where to put the next AI feature.

---

## Decision 2: Extract button inline in `ProfileForm`, not extracted to `ResumeSection`

**What it is:** The Extract from Resume button, its loading state, its result banner, and the `handleExtract` handler all live directly in `ProfileForm.tsx`. No new `ResumeSection` sub-component is created.

**How it works:**
- ProfileForm already owns all form state (`setSkills`, `setForm`, `setWorkExperience`, etc.)
- Adding `isExtracting` (useTransition) and `extractResult` (useState) alongside existing state variables is straightforward
- The button renders conditionally inside the existing resume card JSX when `resumeFileName !== null`

**Why not a ResumeSection sub-component wired via page.tsx?**
`page.tsx` is a Server Component — it cannot hold client state or pass callbacks. Wiring `ResumeSection → ProfileForm` through the page would require:
1. A new `ProfilePageClient.tsx` client wrapper component
2. Lifting ALL form state from ProfileForm into that wrapper
3. Splitting ProfileForm into a "form fields only" component

That's a full refactor of Feature 05 and 06's work, triggered by adding one button. The project's own code-standards rule applies: "Do not add features, refactor, or introduce abstractions beyond what the task requires."

**What the alternative costs:**
If `ResumeSection` had been an existing component, extracting it would be free. Since it doesn't exist, creating it now means net-new indirection with no user-visible benefit. A future `/imprint` session can extract it as a presentational sub-component once the feature is shipped and the component feels large.

**One valid sub-option that was considered:** Extracting ResumeSection as a *child* of ProfileForm (not a sibling), with all handlers passed as props. This is cosmetically cleaner but functionally identical to the inline approach. Deferred — acceptable at any point without architectural consequence.

---

## Decision 3: Server downloads PDF from InsForge Storage, client sends no file

**What it is:** The API route reads `resume_pdf_key` from the user's profile in DB, then calls `insforge.storage.from("resumes").download(key)` server-side. The client sends no file data.

**How it works:**
```typescript
const { data: profileRow } = await insforge.database
  .from("profiles")
  .select("resume_pdf_key")
  .eq("id", authData.user.id)
  .single();

const { data: fileBlob } = await insforge.storage
  .from("resumes")
  .download(profileRow.resume_pdf_key);

const buffer = Buffer.from(await fileBlob.arrayBuffer());
```

**Why not re-send the file from the client?**
The resume was already uploaded in a prior step. The file is in InsForge Storage. Re-sending it from the browser would require the user to have it in memory (it may not be) and would double the network transfer. The server has the key and the auth credentials to fetch it directly — this is always the right pattern when the file is already stored.

**What the alternative costs:**
Sending FormData from client → route would couple extraction to the upload moment. If a user uploads, navigates away, and returns tomorrow, they should still be able to click Extract. Server-side download from storage is stateless and works at any time.

---

## Decision 4: `applyExtraction` skips null/empty fields — never overwrites with null

**What it is:** The form population function only updates state for fields where Gemini returned a non-null value. Existing form data is preserved for anything Gemini couldn't extract.

**How it works:**
```typescript
function applyExtraction(data: ProfileExtraction) {
  setForm((prev) => ({
    ...prev,
    ...(data.full_name != null && { full_name: data.full_name }),
    ...(data.phone != null && { phone: data.phone }),
    // ... same for every scalar field
  }));
  if (data.skills?.length) setSkills(data.skills);
  if (data.work_experience?.length) setWorkExperience(data.work_experience);
  if (data.education?.degree) setEducation(data.education);
}
```

**Why not just `setForm({ ...prev, ...data })`?**
If the user already filled in their phone manually and the resume didn't contain it, a naive spread would set `phone: null`, wiping the existing value. For arrays (`skills`, `work_experience`), an empty array from Gemini would also wipe existing tags.

The Gemini system prompt instructs it to return `null` for fields it cannot confidently extract — which is exactly the signal we use here: null means "I didn't find this", not "this is blank."

**What the alternative costs:**
Overwriting with nulls produces a frustrating UX: the user clicks Extract, reviews the form, and discovers fields they already had filled in are now empty. The guard pattern means Extract is additive — it adds what Gemini found without destroying what the user entered.
