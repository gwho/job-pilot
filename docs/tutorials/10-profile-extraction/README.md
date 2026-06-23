# Tutorial 10 — Profile Extraction: Resume Parsing, Binary Types, and Null Contracts

**After completing this tutorial you will understand:** why extraction belongs in an API route and `agent/` rather than a Server Action — and what that structural signal prevents downstream, why the route downloads the resume from storage itself rather than accepting a file from the client, how Node.js `Buffer` and Web API `Blob` represent the same bytes but require an explicit conversion, why the Gemini system prompt's `null` instruction and `applyExtraction`'s `!= null` guard form a two-sided contract that neither side can break alone, and why the no-auto-save decision is the most consequential design choice in the feature.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 07 (`../07-profile-save/README.md`) — the `saveProfile` Server Action and the `resume_pdf_key` written during resume upload. Extraction reads this key; save writes back the reviewed result.
> - Tutorial 09 (`../09-project-review-resume-preview/README.md`) — private buckets and how the storage key is used to generate signed URLs for the browser. Extraction uses the same key for a different purpose: direct server-side download.
>
> Open [`agent/extractor.ts`](../../../agent/extractor.ts),
> [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these five prompts in a separate AI session before reading any code. Budget 30–40 minutes. Each concept warms up a mental model required by the tutorial.

### Concept 1 — When PDF text extraction fails

> "Explain the difference between a text-based PDF and an image-based PDF. When I use a library like pdf-parse to extract text from a PDF, in which of the two cases does it return an empty string — and why? What happens visually in the PDF that explains the difference? Give me three real-world scenarios that produce near-empty text extraction results, and quiz me on how to detect the failure mode in code."

*What to listen for:* A text-based PDF has an invisible text layer embedded alongside the visible content — this is what `pdf-parse` reads. An image-based PDF is essentially a photograph — the PDF contains a raster image with no text layer. `pdf-parse` processes the file structure and finds no text characters to extract, returning `""`. Three common scenarios: scanned paper documents, PDFs exported from design tools (Figma, Canva), and PDFs produced from images without OCR.

*Practice question:* A resume is uploaded as a PDF. `pdf-parse` returns a string of length 47. What does that tell you about the file, and what would you show the user?

---

### Concept 2 — Node.js Buffer vs Web API Blob

> "Explain the difference between Node.js Buffer and Web API Blob. Both represent binary data — what makes them different? Where does each type originate, and what APIs produce or consume each? Give me a concrete example where you have a Blob and need a Buffer (or vice versa), and show me the conversion. Then quiz me on when to use each."

*What to listen for:* `Buffer` is Node.js's native binary type — it extends `Uint8Array` and is the standard for raw bytes in server-side code. `Blob` is the browser Web API for binary data — it's what `fetch()` returns for binary responses and what `<input type="file">` gives you. In Next.js server routes, both coexist because the runtime is Node.js but the SDK returns web-standard types. The conversion: `Blob → arrayBuffer() → Buffer.from()`.

*Practice question:* A Next.js API route receives a `Blob` from InsForge Storage's `download()`. You need to pass its bytes to a Node.js library expecting a `Buffer`. What's the conversion?

---

### Concept 3 — Null as a signal in AI output

> "When I use an AI model to extract structured data from a document, I need the model to distinguish between 'I couldn't find this field' and 'this field has a value.' Explain why I should use null rather than an empty string for missing fields. What problems does using an empty string instead of null cause downstream? Give me a concrete example: a user has manually entered their phone number, and then I run AI extraction on their resume which doesn't contain a phone number. Walk me through what happens with null vs empty string. Then quiz me."

*What to listen for:* Null semantically means "not found" — it is a distinct signal from an empty string, which means "found but empty." If the model returns `""` for phone, the consuming code can't distinguish "user entered nothing" from "AI couldn't find it." Using null allows the consuming code to skip the field when null, preserving whatever the user already had.

*Practice question:* A system prompt says "return phone as a string." A model returns `""` for phone. How do you tell the difference between "the resume had no phone number" and "the resume explicitly listed an empty phone field"?

---

### Concept 4 — React useTransition vs useState loading flag

> "In React, what is the difference between `useTransition` and a `useState(false)` loading flag for tracking async operations? When would you use each? Specifically: what does `startTransition` mark its callback as, how does React treat the state updates inside it differently from normal state updates, and what does `isPending` track that a boolean flag doesn't? Give me a concrete example and quiz me."

*What to listen for:* `useTransition` marks work as non-urgent. `isPending` stays `true` for the entire duration of the transition — from the moment `startTransition` is called until all state updates inside it have settled. A `useState(false)` flag requires manual management: you set it true before the async work and false after, and must handle the reset in both success and error branches. A forgotten reset leaves the button disabled permanently.

*Practice question:* `handleExtract` calls `setExtractResult(null)` before calling `startExtract`. Why does this call happen outside the transition, not inside it?

---

### Concept 5 — Why AI output requires human review before saving

> "I have a feature that uses an AI model to auto-fill a form from a document. I'm deciding whether to auto-save the AI's output to the database, or show it in the form and let the user save manually. Walk me through the specific failure modes of auto-saving AI output — not just 'AI can be wrong' but the concrete consequences for a specific application. Then give me a rule of thumb for when auto-save is and isn't acceptable. Quiz me with scenarios."

*What to listen for:* The key failure mode is downstream contamination. In a job-matching app, the profile feeds a scoring algorithm. A hallucinated skill auto-saved to the DB contaminates every subsequent job match, not just the one extraction that went wrong. Auto-save is acceptable when AI performs deterministic operations with verifiable correctness. Auto-save is dangerous when AI infers subjective fields whose correctness only the user can verify.

*Practice question:* The AI extracts `skills: ["React", "TypeScript", "Kubernetes"]` from a resume. The user has never used Kubernetes — it appeared once in a job posting they helped edit. If this auto-saves, what happens to all future job match scores for this user?

---

## The data flow at a glance

```
CLIENT (browser)                    SERVER (Node.js)
─────────────────                   ─────────────────────────────────────────
ProfileForm.tsx                     app/api/profile/extract/route.ts
│                                   │
│  handleExtract() fires             │
│  setExtractResult(null)            │
│  startExtract(async () => {        │
│    fetch("POST /api/profile/extract") ──►  POST handler runs
│    isExtracting = true             │
│                                   │  1. createInsforgeServer() + auth check
│                                   │  2. DB: profiles.select("resume_pdf_key")
│                                   │  3. storage.download(key) → Blob
│                                   │  4. Buffer.from(blob.arrayBuffer())
│                                   │  5. extractProfileFromResume(buffer)
│                                   │       │
│                                   │       ▼  agent/extractor.ts
│                                   │     new PDFParse({ data: buffer })
│                                   │     → getText() → text string
│                                   │     text.length < 100 → return error
│                                   │     Gemini call → JSON → ProfileExtraction
│                                   │
│    ◄──────────────────────────────── { success, data: ProfileExtraction }
│    applyExtraction(result.data)    │
│    setExtractResult({ success: true })
│    isExtracting = false            │
│  })                                │
│                                   │
ProfileForm fields updated          │
"Review the fields below and save"  │
→ User clicks Save Profile          │
→ saveProfile Server Action →  DB   │
```

**Three invariants that govern every decision in this feature:**

- The API route never receives a file — it fetches from storage using the key already in the DB
- `applyExtraction` never overwrites a field unless Gemini returned a non-null value for it
- Extraction never writes to the DB — the only write path is the user clicking "Save Profile"

---

## Part 1 — The architectural boundary: why this is an API route, not a Server Action

Open [`CLAUDE.md`](../../../CLAUDE.md), the three data flows:

```
UI mutations  → Server Action in actions/ → InsForge DB write → revalidatePath()
Agent operations → API route in app/api/agent/ → function in agent/ → AI → DB write
```

And [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts), lines 1–5:

```typescript
import { NextResponse } from "next/server";
import { createInsforgeServer } from "@/lib/insforge-server";
import { extractProfileFromResume } from "@/agent/extractor";

export async function POST() {
```

The feature is user-triggered (button click) and returns data to the UI — two characteristics that might suggest a Server Action. But it calls `pdf-parse` and Gemini. That single fact places it in the API route + `agent/` category. The project's invariant: "Server Actions never call agent functions — only API routes do."

Server Actions are for mutations: save profile, upload file, sign out. They take data, write to the DB or storage, and call `revalidatePath()`. The `actions/profile.ts` file contains `saveProfile`, `uploadResume`, `deleteResume`, `getResumeSignedUrl` — every one of these is a DB or storage operation. None call AI.

If extraction were a Server Action, `actions/profile.ts` would contain both simple mutations (DB upserts, ~20 lines each) and a complex AI pipeline (Gemini calls, ~60 lines plus error handling). The folder's structural signal — "this file contains DB mutations" — would be gone.

The long-term cost compounds. The next AI feature (job matching) would look at `actions/profile.ts` for a precedent. Company research would look there. Each one would have a plausible reason to join it. The `agent/` folder and API route boundary would be abandoned before it was ever actually useful.

**Checkpoint:** The route handler is `export async function POST()` with no parameters. In Next.js App Router, what is the full function signature for a route handler that reads the request body? Why is the parameter optional here?

<details>
<summary>Reveal answer</summary>

A route handler that reads a request body: `export async function POST(request: NextRequest)`, where `request.json()` or `request.formData()` reads the body. The parameter is optional because this route takes no input from the client — it fetches everything it needs from InsForge Storage using the key already stored in the `profiles` table. The only inputs needed are the session cookie (for auth, read via `createInsforgeServer()`) and the stored storage key.

</details>

**Checkpoint:** The existing resume *upload* uses a Server Action (`actions/profile.ts:uploadResume`), but the resume *extraction* uses an API route. Both operate on a resume file — why should they be in different places?

<details>
<summary>Reveal answer</summary>

`uploadResume` receives a file from the client and writes it to InsForge Storage + updates the `profiles` DB row. That is a UI-triggered mutation with no external AI/API call — exactly what `actions/` is for.

`extractProfileFromResume` calls `pdf-parse` (file processing) and Gemini (AI). It is an agent operation. The structural category is determined by what the operation does, not what it operates on. One is a mutation; the other is an agent operation.

</details>

**Try it yourself:** Open [`actions/profile.ts`](../../../actions/profile.ts). Read the first line of each exported function. Confirm that every function either writes to the DB, reads from storage, or reads the DB — none call `pdf-parse`, Gemini, or any external AI API. This is the invariant the folder enforces.

---

## Part 2 — Stateless server download: why the route fetches the file itself

Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts), lines 19–43:

```typescript
// Fetch resume key from profile
const { data: profileRow, error: profileError } =
  await insforge.database
    .from("profiles")
    .select("resume_pdf_key")
    .eq("id", authData.user.id)
    .single();

if (profileError || !profileRow?.resume_pdf_key) {
  return NextResponse.json(
    { success: false, error: "No resume uploaded" },
    { status: 400 },
  );
}

// Download PDF from private storage bucket
const { data: fileBlob, error: downloadError } = await insforge.storage
  .from("resumes")
  .download(profileRow.resume_pdf_key);

if (downloadError || !fileBlob) {
  return NextResponse.json(
    { success: false, error: "Could not retrieve resume from storage" },
    { status: 500 },
  );
}
```

The route receives no request body. The client sends a body-less `POST`. The route fetches the PDF itself from InsForge Storage using the key stored in the `profiles` table from when the user uploaded it in Feature 06.

The alternative — having the client re-send the PDF as FormData with every extract request — is moment-coupled. It only works if the file exists in the browser's memory at the instant the user clicks Extract. A user who uploaded their resume on Tuesday, closed the browser, returned Thursday, and clicked "Extract from Resume" would find their browser has no file to send. A moment-coupled design fails silently in this case, or forces a re-upload on every extraction.

Server-side storage download is stateless: it works at any time, in any session, as long as the user has a valid session cookie and a `resume_pdf_key` in their profile. Both are durable — they survive page navigations, browser restarts, and sessions.

**Checkpoint:** `insforge.database.from("profiles").select("resume_pdf_key").eq("id", userId).single()` — what does `.single()` return if the user has no profile row yet? How does the existing error guard handle both this case and the case where the profile exists but has no resume?

<details>
<summary>Reveal answer</summary>

`.single()` expects exactly one row. If no profile row exists, InsForge returns `{ data: null, error: { code: 'PGRST116', ... } }` — a "not found" error rather than an empty array. The guard `if (profileError || !profileRow?.resume_pdf_key)` catches both cases: `profileError` is truthy when the query fails (no row), and `!profileRow?.resume_pdf_key` catches the case where a profile row exists but `resume_pdf_key` is null (profile exists but no resume uploaded yet). Both return the same user-facing error: "No resume uploaded."

</details>

**Checkpoint:** `insforge.storage.from("resumes").download(key)` is used instead of generating a signed URL and using `fetch()`. What's the practical difference — why is direct download the correct tool here?

<details>
<summary>Reveal answer</summary>

A signed URL approach requires two steps: generate the URL, then `fetch()` it. This is an extra network round-trip and introduces a timing risk — if the URL's expiry time is hit between generation and the subsequent fetch, the fetch fails even though the file exists.

More importantly, signed URLs are for when the *browser* needs to access the private file directly (as in Feature 09's preview flow). Here only the server needs the bytes — so direct download with service-role credentials is both simpler and more appropriate. Direct download: one step, no expiry race, no unnecessary URL generation.

</details>

**Try it yourself:** Find where `resume_pdf_key` is written. Open [`actions/profile.ts`](../../../actions/profile.ts) and find `uploadResume`. Trace what happens to the `key` after a successful upload — confirm it gets written to the `profiles` table. This is the value the extraction route reads back.

---

## Part 3 — The Blob → Buffer conversion: bridging web types to Node.js

Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts), line 45:

```typescript
const buffer = Buffer.from(await fileBlob.arrayBuffer());
```

`insforge.storage.from("resumes").download(key)` returns `{ data: Blob, error }`. The `Blob` type is the Web API standard representation for binary data. `pdf-parse` is a Node.js library that expects a `Buffer` — the Node.js native binary type.

These two types wrap identical bytes with incompatible interfaces. `Blob` was designed for browsers and includes methods like `.stream()` and `.text()` but not the direct byte-array access Node.js code expects. `Buffer` extends `Uint8Array` with Node.js-specific methods and is the standard way to handle raw bytes in server-side code.

The conversion path:
1. `fileBlob.arrayBuffer()` — extracts the raw bytes as an `ArrayBuffer`, the shared intermediate type accessible from both web and Node.js contexts
2. `Buffer.from(arrayBuffer)` — wraps the `ArrayBuffer` in Node.js's `Buffer` representation

This conversion is necessary because the InsForge SDK was designed with web-standard types (for browser compatibility), while `pdf-parse` was written for the Node.js runtime. They don't share a type hierarchy despite both representing the same underlying bytes.

Note the direction: here data flows *from* storage *into* a Node.js library, so `Blob → Buffer`. In Feature 08's storage upload, the direction flips: `Buffer → Blob` (from `renderToBuffer` back to storage). The mismatch is always at the boundary between InsForge's web-standard SDK and Node.js libraries.

**Checkpoint:** Why is `pdf-parse` a Node.js-only library? What in its implementation makes it incompatible with the browser bundle, and what error would you see at build time if it were accidentally imported in a client component?

<details>
<summary>Reveal answer</summary>

`pdf-parse` (and its dependency `pdfjs-dist`) uses Node.js-specific APIs: `fs` for file reading, `Buffer` for binary data, and native bindings. Browser environments don't have `fs` or Node.js's `Buffer`. If accidentally imported in a client component, Turbopack would fail at build time trying to resolve the Node.js internals — with errors like `Module not found: Can't resolve 'fs'` or `Module not found: Can't resolve 'buffer'`. The `agent/extractor.ts` file is imported only by `app/api/profile/extract/route.ts` (a server route), which keeps it in the Node.js runtime.

</details>

**Try it yourself:** In `next.config.ts`, confirm that `"pdf-parse"` appears in `serverExternalPackages`. This is the same escape hatch that `"@react-pdf/renderer"` requires in Feature 08 — both packages have Node.js internals that Turbopack cannot statically bundle. The pattern: any server-only package with native bindings or non-standard module resolution needs this treatment.

---

## Part 4 — The 100-character guard: detecting image-based PDFs

Open [`agent/extractor.ts`](../../../agent/extractor.ts), lines 59–68:

```typescript
// Step 1 — extract raw text from PDF
const parser = new PDFParse({ data: buffer });
const pdfData = await parser.getText();
const text = pdfData.text?.trim() ?? "";

if (text.length < 100) {
  return {
    success: false,
    error:
      "Could not extract text from this PDF. Please try a different file.",
  };
}
```

`PDFParse` (v2.x API: class instantiated with `{ data: buffer }`, then `getText()` called) processes the PDF buffer and returns the embedded text layer. The `text.length < 100` guard exists because `pdf-parse` succeeds for image-based PDFs — it doesn't throw an error, it simply returns an empty or near-empty string because there is no text layer to extract.

An image-based PDF is a scanned document: the resume was photographed or printed and then scanned. The PDF contains a raster image with no embedded text characters. `pdf-parse` processes the file structure and finds no text, returning `""`. Without the guard, a near-empty string would reach the Gemini call. Gemini would attempt to extract profile fields from `""` or `"Resume"` — and it would hallucinate. It would invent a name, invent skills, invent work history. That output would reach `applyExtraction` and populate the user's form with fictional data.

The threshold of 100 is a heuristic. A real resume's name, email, and one work experience entry produce well over 200 characters. Below 100 reliably signals that the PDF doesn't have a readable text layer, without false-positives on minimal but real resumes.

**Checkpoint:** Walk through exactly what happens when a user uploads a scanned-paper resume. At which line in `agent/extractor.ts` does the failure get caught, and what does the user see?

<details>
<summary>Reveal answer</summary>

1. The scanned PDF is uploaded and stored at `{userId}/resume.pdf` in the `resumes` bucket.
2. User clicks "Extract from Resume" → `handleExtract()` → `POST /api/profile/extract`.
3. Route fetches PDF from storage → `Blob` → `Buffer`.
4. `extractProfileFromResume(buffer)` called in `agent/extractor.ts`.
5. `new PDFParse({ data: buffer })` initializes the parser.
6. `await parser.getText()` processes the image-only PDF → returns `{ text: "" }`.
7. `text = "".trim() ?? "" = ""`, `text.length = 0`.
8. `0 < 100` → `true` at the guard: returns `{ success: false, error: "Could not extract text from this PDF. Please try a different file." }`.
9. Route returns `NextResponse.json(result)`.
10. `ProfileForm`: `result.success` is `false` → `setExtractResult({ success: false, error: "..." })` → error banner renders. No form fields change.

</details>

**Checkpoint:** What kind of PDF would produce between 1 and 99 characters of text — not zero, but not enough to be a real resume — and why does the 100-character threshold catch this case?

<details>
<summary>Reveal answer</summary>

Common cases: (1) PDFs exported from design tools where the body is an SVG/image but a header is embedded as text — `"John Doe — Resume"` (18 characters); (2) scanned documents where a PDF creation tool embedded the page number `"Page 1 of 1"` as a text annotation; (3) PDFs that consist mostly of embedded images with a few caption words; (4) PDFs produced from screenshots with the filename appended as metadata.

These look like successes to `pdf-parse` — it found text — but the text contains no meaningful resume information. Calling Gemini on them would produce hallucinated output that looks like a successful extraction. The 100-character threshold filters all of these because no name + email + one work title + company fits in 100 characters.

</details>

**Try it yourself:** In `agent/extractor.ts`, temporarily add `console.log("Extracted text length:", text.length, "preview:", text.slice(0, 100))` after the `text` assignment. Run `npm run dev`, upload a real resume if not already done, and click Extract. Check the server terminal output to see how much text your resume produces.

---

## Part 5 — The Gemini call: OpenAI SDK redirect, temperature, and system prompt contract

Open [`agent/extractor.ts`](../../../agent/extractor.ts), lines 72–90:

```typescript
// Step 2 — structured extraction via Gemini
const openai = new OpenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const response = await openai.chat.completions.create({
  model: "gemini-2.5-flash-lite",
  response_format: { type: "json_object" },
  temperature: 0.3,
  max_tokens: 800,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `RESUME TEXT:\n${text}` },
  ],
});

const raw = response.choices[0].message.content!;
const data = JSON.parse(raw) as ProfileExtraction;
return { success: true, data };
```

The `openai` package is an HTTP client with typed helpers. Its `baseURL` determines where requests go. By setting `baseURL` to Google's OpenAI-compatible endpoint and `apiKey` to `GOOGLE_API_KEY`, every `openai.chat.completions.create()` call goes to Gemini. The request and response shapes are identical — `messages`, `choices[0].message.content`, `response_format`, `temperature` — because Google implements the same REST spec. Only two values change: the URL and the key.

`temperature: 0.3` reflects the task type. Extraction has a correct answer — the same resume should produce the same structured output every time. Low temperature minimizes variation: the model converges on the most likely value rather than exploring alternatives. For comparison, Feature 08's resume *generation* uses `temperature: 0.7` — writing professional prose benefits from natural variation, but extraction does not.

`response_format: { type: "json_object" }` guarantees the output is valid JSON. Without it, Gemini might wrap its JSON in a markdown code block (` ```json ... ``` `), include an explanation sentence before the JSON, or produce prose. With it, the response is always parseable by `JSON.parse()`. It does NOT guarantee the JSON matches the `ProfileExtraction` shape — that responsibility belongs to the system prompt.

**Checkpoint:** The `openai` package is calling Google's API. What are the two config values that redirect it to Gemini instead of OpenAI? What stays identical between a standard OpenAI call and this Gemini call?

<details>
<summary>Reveal answer</summary>

Two values change: `apiKey` (set to `GOOGLE_API_KEY`) and `baseURL` (set to `"https://generativelanguage.googleapis.com/v1beta/openai/"`). Everything else stays identical: `openai.chat.completions.create()`, the `messages` array format, `response_format`, `temperature`, `max_tokens`, and the `choices[0].message.content` path for reading the response. The `model` string also changes — but that's a provider-specific ID, not part of the SDK API. Google's OpenAI-compatible layer accepts standard OpenAI-shaped requests and maps them to Gemini.

</details>

**Checkpoint:** `response_format: { type: "json_object" }` is set. What does this parameter actually guarantee — and what does it NOT guarantee?

<details>
<summary>Reveal answer</summary>

It guarantees the returned string is valid JSON — parseable by `JSON.parse()` without a `SyntaxError`. It does NOT guarantee the JSON has a specific shape. Gemini will produce valid JSON, but it might use different field names, nest objects differently, or include extra fields. Without `response_format`, Gemini (like GPT models) frequently wraps JSON in markdown fences, prepends explanation sentences, or produces prose when uncertain — all of which cause `JSON.parse(raw)` to throw. Shape conformance is enforced only by the system prompt's explicit JSON schema instruction, not by `response_format`.

</details>

**Checkpoint:** The system prompt lists exact enum values for `experience_level` (`"junior"`, `"mid"`, `"senior"`, `"lead"`). What would happen if Gemini returned `"Senior"` (capitalized) instead of `"senior"`? Where would the type mismatch surface — TypeScript compile time, runtime, or UI?

<details>
<summary>Reveal answer</summary>

1. `JSON.parse(raw)` succeeds — `"Senior"` is a valid JSON string.
2. `as ProfileExtraction` succeeds — TypeScript `as` casts don't validate at runtime; the type is erased.
3. `applyExtraction(data)` runs — `data.experience_level != null` is `true` ("Senior" is not null), so `setForm` is called with `experience_level: "Senior"`.
4. The `<select>` for experience level has `<option value="senior">` — but the current value is `"Senior"`, which matches no option. The select renders blank.

No TypeScript error. No runtime error. No console warning. Failure is invisible until the user visually inspects the dropdown. The system prompt listing exact lowercase enum values prevents this by telling Gemini exactly what string to produce.

</details>

**Checkpoint:** `max_tokens: 800` is set. What happens if the structured JSON response would exceed 800 tokens? How would you detect this in production?

<details>
<summary>Reveal answer</summary>

Gemini truncates the output at 800 tokens. A truncated JSON string is not valid JSON — `JSON.parse(raw)` throws `SyntaxError: Unexpected end of JSON input`. The error propagates to the route's outer `catch(error)` block → `console.error("[api/profile/extract]", error)` logs it → the route returns `{ success: false, error: "Internal server error" }` → the user sees the error banner.

To detect proactively: check `response.choices[0].finish_reason === "length"` before `JSON.parse`. Gemini sets this to `"length"` when truncated (vs `"stop"` for natural completion). If `"length"`, return a specific error: "Your resume is too long to extract. Try with fewer work experience entries." Without this check, max-token truncation produces the same generic error as every other unhandled exception.

</details>

**Try it yourself:** Open [`agent/extractor.ts`](../../../agent/extractor.ts) and read the full `SYSTEM_PROMPT`. Find every field that has an explicit enum list. Then open [`types/index.ts`](../../../types/index.ts) and find the `ExperienceLevel`, `WorkAuthorization`, and `RemotePreference` types. Confirm each enum value in the system prompt matches exactly (case-sensitive) to the corresponding TypeScript union member.

---

## Part 6 — The null contract: applyExtraction's per-field guard

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), lines 349–380:

```typescript
function applyExtraction(data: ProfileExtraction) {
  setForm((prev) => ({
    ...prev,
    ...(data.full_name != null && { full_name: data.full_name }),
    ...(data.phone != null && { phone: data.phone }),
    ...(data.location != null && { location: data.location }),
    ...(data.current_title != null && { current_title: data.current_title }),
    ...(data.experience_level != null && {
      experience_level: data.experience_level,
    }),
    ...(data.years_experience != null && {
      years_experience: String(data.years_experience),
    }),
    ...(data.linkedin_url != null && { linkedin_url: data.linkedin_url }),
    ...(data.portfolio_url != null && { portfolio_url: data.portfolio_url }),
    ...(data.work_authorization != null && {
      work_authorization: data.work_authorization,
    }),
    ...(data.remote_preference != null && {
      remote_preference: data.remote_preference,
    }),
    ...(data.salary_expectation != null && {
      salary_expectation: data.salary_expectation,
    }),
  }));
  if (data.skills?.length) setSkills(data.skills);
  if (data.industries?.length) setIndustries(data.industries);
  if (data.job_titles_seeking?.length)
    setJobTitlesSeeking(data.job_titles_seeking);
  if (data.work_experience?.length) setWorkExperience(data.work_experience);
  if (data.education?.degree) setEducation(data.education);
}
```

The naive alternative — `setForm({ ...prev, ...data })` — would spread every field from Gemini's output onto the form state, including the ones Gemini returned `null` for. A user who manually entered their phone number and whose resume doesn't contain a phone number would see their phone become `null` in the form. One click of Save would permanently wipe it from the DB.

The `!= null` guard (loose inequality) preserves the existing form value for any field Gemini couldn't confidently extract. The null contract exists at both ends: the Gemini system prompt instructs "Use null for any field you cannot confidently extract — never guess." `applyExtraction` honours that signal: null means "Gemini didn't find this, skip it, leave whatever the user had."

### Why `!= null` rather than `!== null`

The `ProfileExtraction` type uses optional fields (`phone?: string | null`). When Gemini's JSON response omits a field entirely — structurally absent rather than explicitly `null` — TypeScript sees `undefined`. A strict `!== null` check would miss this: `undefined !== null` is `true`, so the field would be spread with `undefined`, which is functionally null but passes through the guard incorrectly. The loose `!= null` catches both `null` and `undefined` in a single check.

**Checkpoint:** `...(data.full_name != null && { full_name: data.full_name })` — what does JavaScript evaluate `...(false)` to inside an object literal? Why does this work as a conditional field-inclusion pattern?

<details>
<summary>Reveal answer</summary>

`...(false)` inside an object literal spreads nothing — it is equivalent to `...{}`. JavaScript's spread operator treats falsy primitives as empty objects — they have no enumerable own properties to spread. So `{ a: 1, ...(false), b: 2 }` evaluates to `{ a: 1, b: 2 }`. This makes `...(condition && { key: value })` a valid pattern: when `condition` is false, you spread `false` (empty), contributing nothing; when `condition` is true, you spread `{ key: value }`, adding the key. Confirmed in the ECMAScript spec for spread in object literals.

</details>

**Checkpoint:** Why is `!= null` used instead of a strict `!== null` check? What is the extra case the loose version catches, and when does that extra case matter here?

<details>
<summary>Reveal answer</summary>

`!= null` (loose inequality) catches both `null` and `undefined` because `null == undefined` is `true` in JavaScript's abstract equality. `!== null` (strict) only catches `null` — `undefined !== null` is `true`, meaning `undefined` would pass through.

The extra case matters when Gemini's JSON response omits a field entirely. Optional fields in `ProfileExtraction` (e.g., `phone?: string | null`) have the value `undefined` when the key is absent from the object. With strict `!== null`, `undefined` would pass the guard, and `setForm` would receive `{ phone: undefined }`. Spreading `undefined` into the form state effectively sets `phone` to `undefined`, which clears the field. The loose `!= null` treats absent fields the same as explicitly-null fields — both mean "skip."

</details>

**Try it yourself:** In a browser DevTools console:
```javascript
const prev = { name: "Alice", phone: "555-1234", location: "NYC" };
const data = { name: "Alice Chen", phone: null, location: undefined };
const result = {
  ...prev,
  ...(data.name != null && { name: data.name }),
  ...(data.phone != null && { phone: data.phone }),
  ...(data.location != null && { location: data.location }),
};
console.log(result);
// Expected: { name: "Alice Chen", phone: "555-1234", location: "NYC" }
```
Confirm that `phone` stays `"555-1234"` (null skipped) and `location` stays `"NYC"` (undefined skipped).

---

## Part 7 — Array guards vs scalar guards: different semantics for different field types

From [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), lines 374–379:

```typescript
if (data.skills?.length) setSkills(data.skills);
if (data.industries?.length) setIndustries(data.industries);
if (data.job_titles_seeking?.length)
  setJobTitlesSeeking(data.job_titles_seeking);
if (data.work_experience?.length) setWorkExperience(data.work_experience);
if (data.education?.degree) setEducation(data.education);
```

Array fields use `.length` guards, not `!= null` guards. The distinction is meaningful: `skills: []` from Gemini is a valid, explicit JSON value — it means "I found no skills in this resume." It is not `null`. If the guard were `if (data.skills != null)`, an empty array would pass, and `setSkills([])` would wipe the user's manually-entered skill tags with nothing. That is a destructive operation that looks like a success.

The `.length` guard treats an empty array as equivalent to `null` for the purposes of form population: both mean "Gemini found nothing worth setting." Only a non-empty array — meaning Gemini found something real — triggers the state update. The distinction between "null" (field not returned) and `[]` (returned but empty) is meaningful for arrays in a way it isn't for scalar fields, where there's no useful "empty string" vs "null" difference.

### The education check: checking a sub-field, not the object

The `education` guard checks `data.education?.degree` rather than `data.education != null`. The `education` field is always present in Gemini's JSON (it's part of the required shape from the system prompt). But all its sub-fields might be null: `{ degree: null, fieldOfStudy: null, institution: null, graduationYear: null }`. This object is non-null — it would pass `!= null`. Applying it would overwrite the user's existing education data with all-null sub-fields.

Checking `data.education?.degree` is a proxy: "did Gemini extract any meaningful education content?" The `degree` field is the minimum identifying piece. If Gemini found the degree, the other fields are likely also there. If `degree` is null, the entire education object is effectively empty, and no state update happens.

**Checkpoint:** `if (data.education?.degree) setEducation(data.education)` — what would break if you changed it to `if (data.education != null) setEducation(data.education)`?

<details>
<summary>Reveal answer</summary>

`data.education` is always non-null — Gemini's system prompt includes it as part of the required JSON shape, so it's always returned. But when no education section is found, Gemini returns `{ degree: null, fieldOfStudy: null, institution: null, graduationYear: null }` — the object exists but all fields are null.

With `if (data.education != null)`, this all-null object passes the guard every time. `setEducation({ degree: null, ... })` always runs, overwriting any education the user manually entered. The user's degree, institution, and graduation year would be silently erased on every extraction where the resume had no education section.

</details>

**Checkpoint:** `isExtracting` from `useTransition` — what does it actually represent? Is it true during the fetch, during state updates, or both? How does this differ from a `useState(false)` loading flag?

<details>
<summary>Reveal answer</summary>

`isExtracting` (React's `isPending` from `useTransition`) is `true` for the entire transition — from when `startExtract` is called until all state updates inside the callback have settled. This includes both the async `fetch(...)` call AND the subsequent `applyExtraction`, `setExtractResult` state updates. React treats everything inside `startExtract` as a single non-urgent transition.

A `useState(false)` flag requires manual management: `setIsExtracting(true)` before the async work and `setIsExtracting(false)` after — in both success and error branches. A forgotten reset in an error path leaves the button disabled permanently. `useTransition` eliminates this: `isPending` automatically resets to `false` when the transition completes, regardless of how it completes.

</details>

**Try it yourself:** Open the browser DevTools Network panel and click "Extract from Resume." While the request is in flight, inspect the "Extract from Resume" button — confirm it shows "Extracting..." and has the `disabled` attribute. After the response arrives, confirm the button returns to "Extract from Resume" and the `disabled` attribute is removed.

---

## Part 8 — No auto-save: the quality gate that protects job matching

From [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), lines 690–694:

```tsx
{extractResult?.success && (
  <p className="text-sm text-success mb-3">
    Profile filled in from your resume — review the fields below
    and save when ready.
  </p>
)}
```

After `applyExtraction()` runs, the form fields update — but nothing writes to the database. The word "review" in the success banner is a UX instruction that makes the quality gate explicit. The user's next action is reading and verifying, not clicking.

The quality gate exists because Gemini can and does make mistakes: misparse dates, misidentify experience level, hallucinate skills from context (a skill mentioned once in a job description the user helped write), or pick up a previous employer's name as the current one. These are not hypothetical failures — they occur with normal resumes and a state-of-the-art extraction model.

The cost of a wrong extraction depends entirely on what happens to the extracted data. In this project, the profile feeds job matching — every field in the profile is an input to the scoring algorithm. A hallucinated skill auto-saved to the DB contaminates every subsequent job match. A wrong experience level affects which jobs are surfaced and what scores they receive. The cost of a bad auto-save is not one wrong field — it is contaminated inputs for every future computation that reads the profile.

The architectural enforcement: `applyExtraction` calls `setForm`, `setSkills`, `setWorkExperience`, `setEducation` — React state setters. None of these write to the database. The only DB write path is the user clicking "Save Profile," which fires the existing `saveProfile` Server Action from Feature 06. The save path is unchanged; only the form population path has been added.

**Checkpoint:** Name two concrete changes to the implementation that would be required to make extraction auto-save, and name the invariant from `plan.md` that would need to be explicitly removed or updated.

<details>
<summary>Reveal answer</summary>

To implement auto-save: (1) The API route would need to write to the `profiles` table after extraction — calling `insforge.database.from("profiles").upsert([...])` with the extracted data, either inline in `route.ts` or via a dedicated action. (2) The success banner text would change — "review and save when ready" would become "Profile updated from your resume." The banner might still display the extracted fields without using `applyExtraction` at all, since the form would be revalidated from the DB rather than populated from client state.

The invariant to update from `plan.md`: "Extraction does not write to the DB — the user reviews populated fields and saves manually via the existing `saveProfile` Server Action." This is the load-bearing rule. Removing it should be a conscious decision recorded in the plan, not a side effect of a feature change.

</details>

**Try it yourself:** Confirm the no-auto-save invariant in code. Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts). Search for any call to `insforge.database.from("profiles").update(` or `.upsert(`. Confirm there are none — the route reads from the DB (to get `resume_pdf_key`) but never writes to it. The only write in the feature is the existing `saveProfile` Server Action fired by the Save button.

---

## Full data flow: a click on "Extract from Resume" through every layer

```
1.  User clicks "Extract from Resume" button
    ProfileForm.tsx:701 onClick={handleExtract}

2.  handleExtract() fires (line 382)
    setExtractResult(null)  ← clears previous banner synchronously
    startExtract(async () => {  ← wraps async work as a React transition

3.  fetch("POST /api/profile/extract")  ← no body
    isExtracting = true  ← button shows "Extracting...", disabled

4.  app/api/profile/extract/route.ts POST() runs
    createInsforgeServer()  ← server-side client, service-role credentials
    auth.getCurrentUser()  ← reads session cookie

5.  DB query (line 20–24)
    profiles.select("resume_pdf_key").eq("id", userId).single()
    → { resume_pdf_key: "user-id/resume.pdf" }

6.  Storage download (line 34–36)
    storage.from("resumes").download(resume_pdf_key)
    → { data: Blob }  (binary PDF from private bucket)

7.  Buffer conversion (line 45)
    Buffer.from(await fileBlob.arrayBuffer())
    → Node.js Buffer, ready for pdf-parse

8.  extractProfileFromResume(buffer) in agent/extractor.ts (line 46)

9.  PDFParse instantiation and text extraction (lines 59–61)
    new PDFParse({ data: buffer }) → parser.getText()
    → { text: "Alex Chen\nSoftware Engineer\n..." }
    text.length = 2847

10. text.length < 100? No (2847 >= 100) → continue

11. Gemini call (lines 72–86)
    model: gemini-2.5-flash-lite
    temperature: 0.3, max_tokens: 800
    SYSTEM_PROMPT + "RESUME TEXT:\n" + text
    → raw JSON string

12. JSON.parse(raw) as ProfileExtraction (line 89)
    → { full_name: "Alex Chen", phone: "+1-555-0100", skills: ["React", ...], ... }

13. Route returns NextResponse.json({ success: true, data }) (line 48)

14. ProfileForm receives response (line 386–388)
    result.success = true
    applyExtraction(result.data)  ← populates form state field by field
    setExtractResult({ success: true })

15. React re-renders:
    Form fields update with Gemini's values (non-null only)
    Success banner: "Profile filled in from your resume — review..."
    isExtracting = false  ← button returns to "Extract from Resume"

User reviews changes, clicks "Save Profile"
→ Feature 06's saveProfile Server Action
→ profiles table upsert
→ DB updated with reviewed data
```

---

## Extend it (challenges)

### Challenge 1 — Trace: follow one field from PDF text to form state (15–20 min)

Choose a scalar field — for example `current_title`. Trace it end-to-end:

1. Find where in the PDF text `pdf-parse` would extract the job title
2. Find the exact instruction in the `SYSTEM_PROMPT` that tells Gemini to extract it
3. Find the key in `ProfileExtraction` that holds it
4. Find the line in `applyExtraction` that applies it to form state
5. Find the `<input>` or `<select>` in `ProfileForm.tsx` that renders its value

Write out each file, function name, and line number. Then do the same trace for `experience_level` — notice that it has an enum constraint in both the type and the system prompt.

<details>
<summary>Hint</summary>

System prompt: search for `"current_title"` in `agent/extractor.ts`. Type: `ProfileExtraction.current_title` in the same file. `applyExtraction`: look for `current_title` in the `setForm` call. Form JSX: search `ProfileForm.tsx` for `current_title` in an `<input value=...`. For `experience_level`: find the `"junior" | "mid" | "senior" | "lead"` string in both the system prompt and the `<select>` options.

</details>

---

### Challenge 2 — Extend: add extraction confidence reporting (25–35 min)

The current success banner says "review the fields below" but doesn't indicate how much was filled in. Add a feature that shows which fields were extracted.

In `handleExtract`, after `applyExtraction`, count how many non-null scalar fields were in `result.data`. In the success banner, show: "Extracted N fields — review before saving."

This requires:
1. Modifying `handleExtract` in `ProfileForm.tsx` to compute the count
2. Updating the `extractResult` state type to include `count: number`
3. Updating the success banner JSX to display it

Consider: should the count include array fields (skills, work_experience)? What counts as "extracted"?

<details>
<summary>Hint</summary>

The count is the number of keys in `result.data` where the value `!= null` (for scalars) or `.length > 0` (for arrays). After `applyExtraction(result.data)`:

```typescript
const count = Object.values(result.data).filter(v =>
  Array.isArray(v) ? v.length > 0 : v != null
).length;
setExtractResult({ success: true, count });
```

Update the `extractResult` type: `{ success: true; count: number } | { success: false; error: string }`. Update the banner: `Profile filled in from your resume — {count} field{count === 1 ? "" : "s"} extracted. Review before saving.`

</details>

---

### Challenge 3 — Break and fix: remove the text length guard (30–45 min)

In [`agent/extractor.ts`](../../../agent/extractor.ts), comment out the `text.length < 100` guard (lines 63–68). Then:

1. Upload an image-based PDF (a screenshot saved as PDF, or a scanned document — any PDF where you expect near-zero text extraction)
2. Click "Extract from Resume"
3. Observe what appears in the form fields

Write down: what did Gemini extract from near-empty text? Were any fields plausible? Were any hallucinated? Were any null?

Then re-enable the guard. Design a better error message that tells the user specifically why extraction failed and what they can do about it — "try a different file" is vague. What specific instruction would actually help?

<details>
<summary>Hint</summary>

Common Gemini behavior with near-empty text: it may return all-null, or it may hallucinate a plausible-looking name and skills based on whatever few characters were extracted. A hallucinated extraction with `result.success = true` looks like a successful extraction — the user sees fields populated with fictional data and a success banner.

A better error message: "This PDF doesn't contain readable text — it may be a scanned image. Try exporting your resume directly from Word, Google Docs, or a PDF editor instead of scanning a paper copy." This names the specific cause and gives an actionable fix.

</details>

---

For deeper exploration, `docs/plan/07-profile-extraction/ai-discussion-topics.md` has 15 prompts covering PDF text extraction failure modes, the OpenAI-compatible protocol redirect, null-safe form population, and the no-auto-save quality gate. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
