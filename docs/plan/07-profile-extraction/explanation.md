# Explanation — Feature 07: AI Profile Extraction from Resume

## 1. The full data flow from button click to form populated

When the user clicks "Extract from Resume," `handleExtract()` fires in `ProfileForm.tsx`. It calls `startExtract(async () => {...})` — a React `useTransition` that wraps the async work so the UI can remain responsive while the fetch is in flight. Inside, it fetches `POST /api/profile/extract` with no body.

The route handler in `app/api/profile/extract/route.ts` runs server-side:

1. It calls `createInsforgeServer()` and authenticates the user. A missing session returns 401.
2. It queries the `profiles` table for only `resume_pdf_key` — not the full profile. The route needs one thing: the storage path where the uploaded resume lives.
3. If `resume_pdf_key` is absent (the user has no profile row yet, or hasn't uploaded a resume), it returns 400: "No resume uploaded."
4. It calls `insforge.storage.from("resumes").download(profileRow.resume_pdf_key)`. This returns a `Blob` — the binary file as a web-standard type.
5. The `Blob` is converted to a Node.js `Buffer` via `Buffer.from(await fileBlob.arrayBuffer())`. This conversion bridges the web-standard `Blob` (what InsForge returns) and the Node.js-native `Buffer` (what `pdf-parse` expects).
6. `extractProfileFromResume(buffer)` is called in `agent/extractor.ts`.

Inside the agent: `new PDFParse({ data: buffer })` instantiates the v2 parser and `await parser.getText()` extracts the raw text string. The text is length-checked against 100 characters. If it passes, a Gemini call via the OpenAI-compatible endpoint produces a structured `ProfileExtraction` JSON object. The route returns it directly: `return NextResponse.json(result)`.

Back in `ProfileForm`, `applyExtraction(result.data)` runs. It iterates over each field in the returned object and applies it to the relevant piece of form state — but only if Gemini returned a non-null value. The success banner appears ("Profile filled in from your resume — review the fields below and save when ready"), and `extractResult` state updates to show it.

## 2. Why extraction belongs in an API route + `agent/`, not a Server Action

The project's `CLAUDE.md` states the invariant explicitly: "Server Actions never call agent functions — only API routes do." Profile extraction calls `pdf-parse` (file processing) and Gemini (AI) — it is unambiguously an agent operation.

A developer writing this feature without reading the architecture docs might reach for a Server Action because Server Actions are the most convenient way to wire a button to server logic in Next.js App Router. `await extractProfile()` is simpler to call from a React component than `fetch("/api/profile/extract", { method: "POST" })`. But ergonomics is not the criterion. The project's criterion is: "what does this operation do?"

The extraction operation calls AI. That places it in the API route + `agent/` category regardless of anything else — regardless of the fact that it returns data rather than writing to the DB, regardless of how convenient a Server Action would be to call. If extraction went into `actions/profile.ts`, that file would then contain both `saveProfile` (a DB upsert with ~20 lines) and an AI pipeline with Gemini calls (~60 lines plus error handling). The folder's structural signal — "this file contains DB mutations" — would be broken for every future developer who opens it.

The long-term cost compounds: the next AI feature (job matching) would look at `actions/profile.ts` for a pattern. Company research would look there. Each one would have a plausible precedent for joining it. The `agent/` folder and API route boundary would be abandoned before it was ever actually useful.

## 3. Why the route downloads from storage rather than the client re-sending the file

The route receives no request body — `export async function POST()` has no parameters. The client sends nothing. The route fetches the PDF itself from InsForge Storage using the key stored in the `profiles` table.

The alternative — having the client re-upload the file in a `FormData` body — is what Tutorial 11 calls "moment-coupled." It only works if the file is in the browser's memory at the instant the user clicks Extract. In practice:

- The user uploads their resume on a Tuesday.
- They navigate away, come back Thursday, click "Extract from Resume."
- Their browser has no record of a file. No `File` object in memory, no blob URL, nothing.

A moment-coupled design fails silently in this case, or it forces the user to re-upload the file on every extract, doubling network transfer for no benefit.

Server-side storage download is stateless. The route needs two things: a valid session (for auth) and a `resume_pdf_key` in the `profiles` table (written when the resume was originally uploaded in Feature 06). Both are durable — they survive page navigations, browser restarts, and sessions. The operation works identically whether the user uploaded the resume one minute ago or one month ago.

## 4. The Blob → Buffer conversion and why it's necessary

`insforge.storage.from("resumes").download(key)` returns `{ data: Blob, error }`. The `Blob` type is the browser Web API representation of binary data. `pdf-parse` is a Node.js library that expects a `Buffer` — the Node.js native representation of binary data.

These two types wrap the same raw bytes with different interfaces. The conversion:
```typescript
const buffer = Buffer.from(await fileBlob.arrayBuffer());
```

`fileBlob.arrayBuffer()` extracts the raw bytes as an `ArrayBuffer` — an intermediate binary type accessible from both web and Node contexts. `Buffer.from(arrayBuffer)` wraps it in Node.js's representation. This conversion is necessary because the InsForge SDK (web-standard) returns a `Blob`, but the pdf-parse library (Node.js) only accepts a `Buffer`. They don't share a type hierarchy despite both representing the same underlying data.

This is the reverse of the conversion needed in Feature 08's storage upload (where a Node.js `Buffer` from `renderToBuffer` had to become a `Blob` for `insforge.storage.upload()`). The direction of the mismatch flips depending on whether data is flowing from storage into a Node.js library or from a Node.js library into storage.

## 5. The 100-character text length guard and what it protects against

```typescript
if (text.length < 100) {
  return {
    success: false,
    error: "Could not extract text from this PDF. Please try a different file.",
  };
}
```

The guard exists because `pdf-parse` successfully processes image-based PDFs — it doesn't throw an error, it just returns an empty or near-empty `text` string. An image-based PDF (a scanned document where the resume was photographed rather than produced digitally) contains no embedded text layer. `pdfData.text` comes back as `""` or a few characters of PDF metadata.

Calling Gemini on an empty or near-empty string would waste a token call and produce garbage output — Gemini would hallucinate fields rather than extracting real ones, because there's nothing to extract. The 100-character threshold filters out both zero-text PDFs (purely image-based) and near-empty PDFs (where only a few form field labels or metadata strings were extracted).

The threshold is 100 because a real resume's name, contact line, and one work experience entry would exceed it — even a minimal one-page resume would be well over 200 characters of extractable text. Below 100 is reliable signal that the PDF doesn't have a readable text layer. This is a soft heuristic, not a guarantee — a pathological PDF could contain exactly 200 characters of text and still be unreadable. But the threshold filters the common case of scanned documents correctly.

## 6. Why `applyExtraction` uses `!= null` per-field rather than spreading the whole object

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

The naive alternative — `setForm({ ...prev, ...data })` — would spread every field from Gemini's output onto the form state, including the ones Gemini returned `null` for. If the user had manually entered their phone number and the resume didn't contain it, their phone would now be `null` in the form state. One click of Save would wipe it from the DB.

The `!= null` guard (not `!== null`) is deliberate. TypeScript's `!= null` is a loose inequality check — it catches both `null` and `undefined`. The `ProfileExtraction` type uses optional fields (`phone?: string | null`). When Gemini omits a field entirely from its JSON response (structurally absent rather than explicitly `null`), TypeScript sees `undefined`. A strict `!== null` check would miss this case: `undefined !== null` is `true`, so the field would be spread with `undefined` as the value, which is functionally null but passes through the guard incorrectly. The loose `!= null` catches both cases.

The null contract exists at both ends. The Gemini system prompt instructs: "Use null for any field you cannot confidently extract — never guess." `applyExtraction`'s `!= null` guard honours that signal: null means "Gemini didn't find this, skip it." If the system prompt were weaker ("use your best judgement"), Gemini would fill every field with plausible values — and `applyExtraction` would apply all of them, with no way to distinguish "confidently extracted" from "guessed." The constraint that `null` means "skip" is enforced by both the prompt and the code.

## 7. Why arrays use a `.length` guard rather than `!= null`

```typescript
if (data.skills?.length) setSkills(data.skills);
if (data.work_experience?.length) setWorkExperience(data.work_experience);
```

An empty array from Gemini (`skills: []`) is a valid, meaningful JSON response — it means "I found no skills in this resume." `skills: []` is not `null`; it is an explicit statement that the skills section was absent or unreadable. If `!= null` were used for arrays, `if (data.skills != null)` would pass even when Gemini returned an empty array, and `setSkills([])` would wipe the user's manually-entered skill tags with nothing. That would be a destructive operation that looks like a success.

The `.length` guard treats an empty array the same way the `!= null` guard treats `null`: as "no signal." Only a non-empty array — meaning Gemini actually found something — triggers the state update. The distinction between "null" (field not returned) and "empty array" (field returned but empty) is meaningful for arrays even though it's not meaningful for scalar fields.

The `education` check is the most specific: `if (data.education?.degree) setEducation(data.education)`. The `education` field is always present in Gemini's JSON (it's part of the required shape), but all its sub-fields may be `null`. A check of `if (data.education != null)` would pass even when Gemini returns `{ degree: null, fieldOfStudy: null, institution: null, graduationYear: null }`, which would overwrite existing education data with all-null sub-fields. Checking specifically for `degree` is a proxy for "did Gemini extract any meaningful education content at all?" — the degree is the minimum identifying field.

## 8. Why `ProfileExtraction` is defined in `agent/extractor.ts` and not `types/index.ts`

The `ProfileExtraction` type is the return shape of `extractProfileFromResume`. It is tightly coupled to the Gemini system prompt — every field in the type corresponds to a field in the JSON schema Gemini is instructed to return. It is an implementation contract between the AI extraction pipeline and its caller; it is not a domain model type like `Profile` or `Job`.

Placing it in `types/index.ts` would imply it belongs to the shared domain model — something that might be used anywhere in the codebase. But `ProfileExtraction` is only meaningful in two places: `agent/extractor.ts` (where it is produced) and `components/profile/ProfileForm.tsx:applyExtraction()` (where it is consumed). The import in `ProfileForm.tsx` is `import type { ProfileExtraction }` — a type-only import erased at compile time, adding zero runtime dependency.

The type lives in `agent/extractor.ts` because that is where the logic that determines its shape lives. If the Gemini system prompt gains a new field (say, `portfolio_url`), both the prompt and the type would be updated in the same file, in the same edit. If the type were in `types/index.ts`, the same change would require edits to two files — and there would be no structural signal that the two are coupled (a developer could update the type without updating the prompt, or vice versa).

## 9. Why there is no auto-save after extraction

After `applyExtraction()` runs, the form fields update — but nothing writes to the database. The only DB write path is the user clicking "Save Profile," which fires the pre-existing `saveProfile` Server Action from Feature 06. Extraction has no DB write path of its own.

This is a deliberate architectural quality gate. Gemini can misparse dates, misidentify experience level, hallucinate skills from context (a skill mentioned once in a job description the user helped write), or pick up a previous employer's name as the current one. These are not hypothetical failures — they happen with normal resumes and normal extraction pipelines. If extraction auto-saved, incorrect values would enter the `profiles` DB row, which feeds job matching. A hallucinated skill would appear in every subsequent job match. The cost of a bad extraction that auto-saves is not one wrong field — it's contaminated inputs for every future computation that reads the profile.

The success banner — "Profile filled in from your resume — review the fields below and save when ready" — uses the word "review" intentionally. It cues the user that their next action is reading and verifying, not clicking. The banner is a UX mechanism that makes the quality gate explicit rather than relying on the user to know they should check the pre-filled values.

The architectural rule in `plan.md`: "Extraction does not write to the DB — the user reviews populated fields and saves manually via the existing `saveProfile` Server Action." This invariant is load-bearing. The `applyExtraction` function calling `setForm`, `setSkills`, etc. — React state setters — and nothing else ensures this is always true. Any future change that adds a DB write to the extraction flow would need to consciously decide to remove this quality gate.
