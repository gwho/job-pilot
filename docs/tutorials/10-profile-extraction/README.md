# Tutorial 10 — AI Profile Extraction: pdf-parse, Gemini via OpenAI SDK, and Null-Safe Form Population

**After completing this tutorial you will understand:** how `pdf-parse` extracts raw text
from a PDF buffer and why the text length matters before calling any AI model, how the
`openai` npm package can call Google's Gemini API unchanged by swapping two config values,
why AI operations belong in an API route and `agent/` rather than a Server Action, how a
server downloads a user's stored file without the client re-sending it, and how to apply
partial AI output to a form without destroying data the AI couldn't find.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 07 (`../07-profile-save/README.md`) — `useTransition`, Server Actions, and the
>   `resume_pdf_key` stored in the `profiles` table. This tutorial builds on the upload
>   flow completed there.
> - Tutorial 09 (`../09-project-review-resume-preview/README.md`) — private buckets and the
>   `resume_pdf_key` / `resume_pdf_url` distinction. This tutorial uses the key to download
>   from the private bucket server-side.
>
> Open [`agent/extractor.ts`](../../../agent/extractor.ts),
> [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these warm-up prompts in a separate AI session before reading any code. Budget 20–30
minutes. Each targets one mental model this tutorial requires. Do not paste project code.

### Concept 1 — PDF format: text vs image

> "Explain what a PDF file actually contains at a structural level. What's the difference
> between a PDF that was exported from a word processor (like Google Docs) and a PDF that
> was created by scanning a paper document? If I call a function that extracts text from
> each, what would I get in each case and why? Give me a concrete example of what the
> extracted text might look like from a real resume. Then ask me three short questions to
> check my understanding."

*What to listen for:* Exported-from-editor PDFs embed text objects in the file — the
actual characters, fonts, and positions are stored in the PDF binary. Scanning a paper
document produces an image embedded in a PDF wrapper — no text objects, only pixels.
`pdf-parse` reads text objects; it cannot OCR pixel data. The extracted text from an
editor-exported resume is a flat, unformatted character stream — no bold, no columns, just
words in roughly reading order.

*Practice question:* A user hands you a PDF of their resume and `pdf-parse` returns an
empty string. What are the two most likely explanations?

---

### Concept 2 — The OpenAI REST protocol as a standard interface

> "The OpenAI API has become a de facto standard that other AI providers implement. Explain
> what this means at the HTTP level — what is the shape of the request and response for a
> chat completion? If I have an `openai` npm package configured to call OpenAI, what are
> the minimum changes to make it call a different provider (like Google or Anthropic) that
> also implements this spec? Give me a concrete before/after comparison. Then quiz me."

*What to listen for:* The `openai` SDK is essentially an HTTP client with typed helpers.
Its `baseURL` determines where requests go. The request/response body shape — `messages`,
`model`, `choices[0].message.content` — stays identical as long as the provider implements
the same REST spec. The only two values that change are `baseURL` and `apiKey`. Everything
else — streaming, `response_format`, `temperature` — works identically.

*Practice question:* If `baseURL` is the only thing that changes, why does the `model`
string also need to change when switching providers?

---

### Concept 3 — Server Actions vs API route handlers: when to use which

> "In Next.js, when should I use a Server Action versus an API route handler? Describe a
> clear rule of thumb. Give me three examples where a Server Action is the right choice and
> three where an API route is the right choice. Then ask me to categorise five more
> scenarios and tell me if I got them right."

*What to listen for:* Server Actions are for UI-triggered mutations that write to the
database and call `revalidatePath`. API routes are for operations that involve AI calls,
external services, complex computation, or returning rich data back to the client. The key
signal: if the operation returns meaningful data the client needs to display (rather than
just a success/error flag), use an API route.

*Practice question:* A form saves text fields to a database. Is this a Server Action or
API route? A user clicks a button to score a job against their profile using an AI model.
Which is it?

---

### Concept 4 — Null-safe object spreading in JavaScript

> "In JavaScript, I have two objects. I want to spread one into the other but skip any
> keys where the value is null or undefined, so I don't overwrite existing values in the
> target. Show me three different approaches to conditional spreading and explain the
> trade-offs. I want to understand the pattern `{ ...prev, ...(x != null && { key: x }) }`
> specifically — explain exactly what JavaScript evaluates when x is null, and when x has
> a value. Then give me two practice exercises."

*What to listen for:* When `x` is `null`, `(x != null && { key: x })` evaluates to
`false`. Spreading `false` into an object (`{ ...false }`) is a no-op — JavaScript silently
ignores it. When `x` has a value, the right side evaluates to `{ key: x }`, which is then
spread normally. The `!=` (not strict) catches both `null` and `undefined`. This is the
idiomatic pattern for conditional object field inclusion without intermediate variables.

*Practice question:* `const result = { ...{ a: 1 }, ...(false), ...(undefined), ...({ b: 2 }) }`. What is `result`?

---

### Concept 5 — AI model temperature and structured output

> "Explain what the `temperature` parameter does in an AI language model call. What is
> the practical effect of setting it to 0.3 vs 0.7 vs 1.0 for a task like extracting
> structured data from a resume? Also explain `response_format: { type: 'json_object' }` —
> what does it actually guarantee, and what are its limits? Quiz me at the end."

*What to listen for:* Lower temperature = more deterministic output, less variation across
repeated calls. For extraction tasks (same resume should produce same output every time),
0.3 is appropriate. `response_format: { type: 'json_object' }` instructs the model to
only return valid JSON — it reduces (but doesn't eliminate) parsing failures. The model
still chooses what JSON to produce; the format constraint just ensures it's valid JSON.

*Practice question:* A resume is extracted twice with temperature 0.3. Are the results
guaranteed to be identical? What about temperature 0.0?

---

## Architecture overview

```
Browser (ProfileForm.tsx — "use client")
│
│  1. User clicks "Extract from Resume"
│     handleExtract() → startExtract(async () => {
│       fetch("POST /api/profile/extract")
│                              │
│              ┌───────────────▼──────────────────────────┐
│              │  app/api/profile/extract/route.ts         │
│              │  (Server — Node.js runtime)               │
│              │                                          │
│              │  2. Authenticate user via session cookie  │
│              │  3. Fetch resume_pdf_key from profiles    │
│              │     (InsForge DB)                         │
│              │  4. Download PDF blob from InsForge       │
│              │     Storage (private resumes bucket)      │
│              │  5. Call extractProfileFromResume(buffer) │
│              └──────────────┬───────────────────────────┘
│                             │
│              ┌──────────────▼───────────────────────────┐
│              │  agent/extractor.ts                       │
│              │  (Node.js — never bundled for browser)    │
│              │                                          │
│              │  6. pdf-parse: buffer → raw text string  │
│              │  7. Guard: text.length < 100 → error     │
│              │  8. Gemini API call via openai SDK        │
│              │     → ProfileExtraction JSON             │
│              └──────────────┬───────────────────────────┘
│                             │
│       { success: true, data: ProfileExtraction }
│                             │
│  9. applyExtraction(result.data)
│     — null-safe field-by-field form state update
│ 10. setExtractResult({ success: true })
│     — success banner renders
│ 11. User reviews → clicks "Save Profile"
│     — existing saveProfile Server Action writes to DB
│
└── No DB write happens during extraction
```

**Key invariants:**
- `agent/extractor.ts` imports `pdf-parse` — it must never be imported in any client
  component or browser bundle
- Extraction returns data to the client; it never writes to the DB
- `applyExtraction` is additive — it only updates fields where Gemini returned a non-null value

---

## Part 1 — The two-library pipeline: pdf-parse extracts, Gemini structures

Open [`agent/extractor.ts`](../../../agent/extractor.ts) lines 53–90:

```typescript
export async function extractProfileFromResume(
  buffer: Buffer,
): Promise<
  { success: true; data: ProfileExtraction } | { success: false; error: string }
> {
  // Step 1 — extract raw text from PDF
  const pdfData = await pdf(buffer);
  const text = pdfData.text?.trim() ?? "";

  if (text.length < 100) {
    return {
      success: false,
      error:
        "Could not extract text from this PDF. Please try a different file.",
    };
  }

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
}
```

Two completely separate jobs are happening here. `pdf-parse` does one thing: it reads a
PDF binary buffer and returns the raw text content embedded in the file's text objects. The
result is a flat, unformatted string — no headings, no columns, no bold, just words in
roughly reading order.

Gemini does the other thing: it reads that flat string and returns a typed JSON object
with exactly the field names the profile form needs. This is where the intelligence lives.
The AI handles date parsing, deduplication of skills across sections, inferring experience
level from job titles, and everything else that would take hundreds of regex patterns to
approximate.

The `text.length < 100` guard exists because image-based PDFs (scanned paper resumes)
produce `pdfData.text = ""` — there are no embedded text objects, only pixel data that
`pdf-parse` cannot read. The 100-character threshold also catches near-empty PDFs: some
PDFs contain a few characters of metadata or font rendering artifacts that pass `length > 0`
but are useless as resume content. Calling Gemini on 20 characters of junk would waste a
token call and return garbage. The error message is surfaced directly to the user.

**Checkpoint:** A user submits a PDF that returns `pdfData.text = "   "` (three spaces,
no real content). Does it pass the `< 100` guard or fail it? What does the user see?

<details>
<summary>Reveal answer</summary>

After `.trim()`, the string becomes `""`, which has length 0. `0 < 100` is true, so the
guard returns `{ success: false, error: "Could not extract text from this PDF. Please try
a different file." }`. The API route returns this as its JSON response, `handleExtract` sets
`setExtractResult({ success: false, error: "..." })`, and the error paragraph renders below
the Extract button in the resume card.

</details>

**Checkpoint:** Walk through exactly what happens when a user uploads a scanned-paper
resume — a PDF that is actually an image. At which line in `agent/extractor.ts` does the
failure get caught, and what does the user see?

<details>
<summary>Reveal answer</summary>

A scanned resume is a pixel image embedded in a PDF container. `pdf-parse` reads text
objects from the PDF binary — it does not OCR pixel data. So `pdfData.text` returns `""`
(empty string). After `.trim()`, `text = ""`, `text.length = 0`. `0 < 100` is true →
the guard fires: `return { success: false, error: "Could not extract text from this PDF.
Please try a different file." }`.

This propagates through the route: `return NextResponse.json(result)` sends
`{ success: false, error: "..." }` with status 200 (not 500 — it's a handled error, not
an exception). `handleExtract` reads `result.success === false` → `setExtractResult({
success: false, error: "..." })` → the error paragraph renders in the UI.

</details>

**Checkpoint:** `pdfData.text` from `pdf-parse` is an unformatted flat string. Why does
this make it unreliable to use regex patterns for field extraction — and why does that
make Gemini the right tool for the structured extraction step?

<details>
<summary>Reveal answer</summary>

`pdf-parse` concatenates text objects in roughly reading order, but with no semantic
structure preserved. A resume with two columns might interleave words from both columns.
"Skills" and "Experience" section headers appear as plain text among other words. Dates,
phone numbers, and URLs look the same as any other text — there are no HTML tags or
formatting markers to anchor regex patterns to.

Writing regex patterns for "skills section" would require matching exact section header
strings, handling indentation, and accounting for every possible resume layout. A single
unexpected format breaks them. Gemini reads the unstructured text and understands natural
language structure — it can infer that "Python, React, TypeScript" is a skills list
regardless of what section header precedes it or how the columns were arranged.

</details>

**Checkpoint:** What kind of PDF would produce between 1 and 99 characters of text — not
zero, but not enough to be a real resume — and why does the 100-character threshold catch
this case?

<details>
<summary>Reveal answer</summary>

Several cases:
- **Metadata-only PDFs:** Some PDFs embed title or author metadata as text objects (e.g.,
  `"John Smith Resume"` — 17 characters). The content is an image, but the metadata
  renders as text. `pdf-parse` returns the metadata string.
- **Corrupt or truncated PDFs:** A partially uploaded or corrupted file might produce a
  few lines of garbled text from partially decoded text objects.
- **Template/blank PDFs:** A resume template with placeholder text like `"[Name]"` or a
  nearly-empty file with just a name field filled in.

In all these cases, calling Gemini on the text would produce garbage extraction — a
`ProfileExtraction` object with mostly `null` fields or fabricated values. The 100-character
guard treats these as "not a real resume" and returns the user-facing error, preserving
the quality gate.

</details>

**Try it yourself:** In `agent/extractor.ts`, add a `console.log("Extracted text length:", text.length)` immediately after the `text` assignment. Run `npm run dev` and click Extract on a real uploaded resume. Check the server-side terminal output to see how much raw text your resume contains.

---

## Part 2 — Calling Gemini with the `openai` SDK

Open [`agent/extractor.ts`](../../../agent/extractor.ts) lines 71–85:

```typescript
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
```

The `openai` npm package is an HTTP client with typed helpers. It sends requests to
whatever `baseURL` is configured. By setting `baseURL` to Google's OpenAI-compatible
endpoint and `apiKey` to `GOOGLE_API_KEY`, every `openai.chat.completions.create()` call
goes to Gemini instead of OpenAI. The request and response shapes are identical —
`messages`, `choices[0].message.content`, `response_format`, `temperature` — because
Google implements the same REST spec. Only two things change: the URL and the key.

The `model` string must also change because model IDs are provider-specific. `"gpt-4o"`
means nothing to Google's API; `"gemini-2.5-flash-lite"` is what their endpoint expects.

`response_format: { type: "json_object" }` tells Gemini to only return valid JSON. Without
it, the model might wrap its JSON in markdown code fences (` ```json ... ``` `), which
would cause `JSON.parse()` to throw. The system prompt also reinforces this: it ends with
"Return ONLY valid JSON matching the exact shape below." Belt and suspenders.

`temperature: 0.3` keeps extraction deterministic — the same resume should produce the
same output on every call. Higher temperatures introduce variation that the user would
notice ("why did my skills list change?"). `max_tokens: 800` caps the response cost; for
the fields being extracted, a complete response typically fits within this limit.

**Checkpoint:** The `openai` SDK is configured with `baseURL` pointing to Google's endpoint.
What are the two config values that redirect it to Gemini instead of OpenAI — and what
stays identical between a standard OpenAI call and this Gemini call?

<details>
<summary>Reveal answer</summary>

Two things change:
1. `baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"` — routes
   requests to Google's API instead of OpenAI's
2. `apiKey: process.env.GOOGLE_API_KEY!` — authenticates with Google instead of OpenAI

Everything else is identical: `response_format`, `temperature`, `max_tokens`, the
`messages` array structure, the `choices[0].message.content` path for reading the
response, and all the TypeScript types. The `openai` package is an HTTP client — it
doesn't know or care which provider it's talking to, as long as the response shape matches
the OpenAI spec that Google also implements.

The `model` string (`"gemini-2.5-flash-lite"`) must also change, because model IDs are
provider-specific namespaces, not a shared standard.

</details>

**Checkpoint:** What happens at runtime if you remove `response_format: { type: "json_object" }` and Gemini decides to wrap its response in a markdown code block?

<details>
<summary>Reveal answer</summary>

`response.choices[0].message.content` would be something like:
`` ```json\n{ "full_name": "..." }\n``` ``

`JSON.parse(raw)` would throw a `SyntaxError` because the string starts with three
backticks, not a `{`. The error propagates up through `extractProfileFromResume`, gets
caught by the `try/catch` in the API route, and returns `{ success: false, error: "Internal
server error" }`. The user sees an error message, and the `[api/profile/extract]` prefix
in `console.error` tells you exactly where to look.

</details>

**Checkpoint:** The system prompt lists exact enum values for `experience_level`
(`"junior"`, `"mid"`, `"senior"`, etc.). What would happen if Gemini returned `"Senior"`
(capital S) instead of `"senior"` for `experience_level`? Where would the mismatch
surface — at the TypeScript level, the runtime level, or the UI level?

<details>
<summary>Reveal answer</summary>

TypeScript would not catch this at compile time — `JSON.parse(raw) as ProfileExtraction`
is a type assertion, not a runtime validation. TypeScript trusts the assertion.

At the UI level: `applyExtraction` would call `setForm((prev) => ({ ...prev, experience_level: "Senior" }))`. The `<select>` for experience level has options with lowercase values
(`value="senior"`, `value="mid"`, etc.). When React sets the selected value to `"Senior"`,
no `<option>` matches — the select falls back to its default. No error is shown; the field
just silently fails to update correctly.

The fix is the enum constraint in the system prompt: instructing Gemini to use exact
lowercase values makes this case rare. But the deeper lesson is that `as ProfileExtraction`
is a cast, not validation. A Zod parse or manual field check would catch the casing
mismatch at runtime.

</details>

**Checkpoint:** `max_tokens: 800` caps the response. What would happen if a resume is
very long and the structured JSON response would exceed 800 tokens? How would you detect
this happening in production?

<details>
<summary>Reveal answer</summary>

Gemini truncates the response at 800 tokens. A truncated JSON string fails
`JSON.parse()` — `SyntaxError: Unexpected end of JSON input`. The route's catch block
logs it and returns "Internal server error" to the client.

To detect in production: the `choices[0].finish_reason` field in the response tells you
why generation stopped. `"stop"` means normal completion; `"length"` means the token
limit was hit. Adding a check before `JSON.parse`:
```typescript
if (response.choices[0].finish_reason === "length") {
  return { success: false, error: "Resume too long to process. Try a shorter version." };
}
```
would turn a silent crash into a user-readable error. Without this, max-token truncation
produces the same generic "Internal server error" as every other unhandled exception.

</details>

**Try it yourself:** Look at `SYSTEM_PROMPT` in `agent/extractor.ts` lines 25–51. Find where it specifies the exact allowed values for `experience_level`. Now open `types/index.ts` and find the `ExperienceLevel` type. Confirm they match exactly. If they drifted, Gemini could return a value TypeScript accepts but the form's `<select>` would silently fail to match.

---

## Part 3 — API route, not Server Action: enforcing the AI boundary

Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts):

```typescript
import { NextResponse } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { extractProfileFromResume } from "@/agent/extractor";

export async function POST() {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData } = await insforge.auth.getCurrentUser();

    if (!authData.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    // ...
    const result = await extractProfileFromResume(buffer);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/profile/extract]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

This project has a hard boundary: Server Actions handle UI-triggered DB mutations.
API routes handle agent/AI operations. The data flows from `CLAUDE.md` describe this
explicitly:

```
UI mutations  → Server Action → agent/ function → DB write
Agent operations → API route → agent/ function → AI → (optional DB write)
```

Profile extraction is an AI operation — it calls `pdf-parse` and Gemini. It belongs in
an API route calling `agent/extractor.ts`, not in `actions/profile.ts` alongside
`saveProfile` and `uploadResume`.

The practical cost of blurring this boundary is architectural drift. If one AI call goes
into `actions/profile.ts`, the next developer building job matching will look at that
precedent and put their AI call there too. Within a few features, `actions/profile.ts`
becomes a file where DB upserts and AI calls sit side by side with no structural signal
about which is which. The `agent/` folder exists precisely so there is always one place
to look for AI logic.

Note that the function signature is `POST()` with no parameters — the request body is
empty (the route needs no input from the client). In Next.js App Router, route handler
parameters are optional. If you need to read the request body, the signature becomes
`POST(req: NextRequest)`. Since this route derives everything it needs from the session
cookie (user identity) and the DB (resume key), no client input is needed at all.

**Checkpoint:** A teammate proposes putting `extractProfileFromResume` directly in a
Server Action so the client can just call `await extractFromResume()` without a `fetch`.
It would technically work. What's the argument against it?

<details>
<summary>Reveal answer</summary>

Two reasons. First, it breaks the architectural invariant: Server Actions are for DB
mutations. `extractProfileFromResume` calls `pdf-parse` and makes an external Gemini API
call — it is an agent/AI operation. Mixing these in `actions/profile.ts` destroys the
signal value of that folder.

Second, it sets a precedent. Job matching (Feature 10), company research (Feature 13), and
job description structuring are all AI operations still to be built. If extraction is a
Server Action, each of those features has a plausible reason to also be Server Actions.
The `agent/` folder and API route boundary would be abandoned before it was ever needed.

</details>

**Checkpoint:** `agent/extractor.ts` imports `pdf-parse`. Why can't this file ever be
imported in a client component? What would happen at runtime if it were accidentally
included in the browser bundle?

<details>
<summary>Reveal answer</summary>

`pdf-parse` is a Node.js library — it uses Node.js-specific APIs: `Buffer`, the filesystem
APIs used internally by `pdfjs-dist`, and native bindings. These APIs do not exist in the
browser. If Next.js's bundler includes `agent/extractor.ts` in the client bundle (for
example if a component imports it directly), the build would fail with an error like
`Module not found: Can't resolve 'fs'` — because `fs` is being bundled for the browser
where it doesn't exist.

If somehow the build succeeded (via polyfills or wrong config), the runtime error would be
`ReferenceError: Buffer is not defined` or a similar Node.js API missing error. The `agent/`
folder convention — "no React, no browser APIs" — enforces this boundary. Because
`agent/extractor.ts` is only imported by `app/api/profile/extract/route.ts` (a server
route), it stays in the Node.js runtime.

</details>

**Checkpoint:** The route handler is `export async function POST()` with no parameters.
In Next.js App Router, what is the full function signature for a route handler that also
reads the request body? Why is the parameter optional here?

<details>
<summary>Reveal answer</summary>

The full signature for reading the request body:
```typescript
export async function POST(req: NextRequest) {
  const body = await req.json();
  // ...
}
```

The `req: NextRequest` parameter gives access to headers, body, URL params, and cookies.
It's optional because Next.js App Router passes the request object only when the handler
declares it — if the handler doesn't need it, there's no reason to add the parameter.

Here the route needs nothing from the client's request body: the user identity comes from
the session cookie (read by `createInsforgeServer()`), and the resume key comes from the
DB. The client sends a body-less `POST` and the server derives everything it needs
server-side. Adding `req: NextRequest` when you don't use it would just be noise.

</details>

**Try it yourself:** Open `actions/profile.ts` and look at what `saveProfile` and `uploadResume` do. Both call `createInsforgeServer()`, authenticate, and write to the DB via `insforge.database.from(...)`. Notice that neither calls any external AI API. This is the pattern the folder enforces — and why extraction doesn't belong here.

---

## Part 4 — Server-side storage download: stateless retrieval

Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts) lines 18–45:

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

const buffer = Buffer.from(await fileBlob.arrayBuffer());
```

The route does not read any body from the client's `POST` request. There is no file in the
payload. The server fetches the PDF itself, from the InsForge Storage bucket, using the
`resume_pdf_key` stored in the `profiles` table from when the user uploaded it in Feature 06.

The alternative — having the client re-send the PDF as FormData with every extract
request — has two problems. First, the file might not be in the browser's memory. The user
could have uploaded their resume days ago, closed the browser, and returned today. The
browser has no record of that file. Second, it doubles network transfer: the user already
uploaded the file once; uploading it again just to extract from it is wasteful.

Server-side download is stateless: it works at any time, in any session, as long as the
user has a valid session cookie and a `resume_pdf_key` in their profile. The private
bucket requires the InsForge server-side credentials — which the server has, and the
browser doesn't.

The `Buffer.from(await fileBlob.arrayBuffer())` line converts the downloaded `Blob` into a
Node.js `Buffer`. `pdf-parse` expects a `Buffer`, not a `Blob` — they are different binary
representations, one for browsers and one for Node.js. `arrayBuffer()` extracts the raw
bytes as an `ArrayBuffer`, and `Buffer.from()` wraps them in a Node.js Buffer.

**Checkpoint:** The route calls `.single()` on the profile query. What does `.single()` return if the user's `profiles` row doesn't exist yet (they authenticated but never saved their profile)?

<details>
<summary>Reveal answer</summary>

`.single()` returns `{ data: null, error: { ... } }` when no row is found — it errors
rather than returning an empty array. The `if (profileError || !profileRow?.resume_pdf_key)`
guard catches this: `profileError` is truthy, so the route returns `{ success: false, error: "No resume uploaded" }` with status 400. The user would see the error message in the Extract button's feedback area.

</details>

**Checkpoint:** Why does the route use a direct storage download (`insforge.storage.from("resumes").download(key)`) instead of generating a signed URL and using `fetch()` to retrieve the bytes? What's the practical difference?

<details>
<summary>Reveal answer</summary>

A signed URL approach would:
1. Generate a short-lived URL for the private bucket object
2. Make a second HTTP request from the server to that URL to fetch the bytes

This adds an unnecessary round-trip: server → InsForge (generate URL) → server (fetch URL)
→ same bytes. The direct download skips the URL generation step.

There's also a timing risk with signed URLs: if URL generation and the subsequent `fetch()`
straddle the URL's expiry time, the fetch would fail even though the file exists and the
user is authenticated. Direct download has no expiry race condition.

The signed URL pattern is correct for a different use case: when the *browser* needs to
access the file directly (without routing through your server). For feature 09's preview,
a signed URL is generated so the browser can render the PDF in an iframe. Here, only the
server needs the bytes — so direct download is the correct tool.

</details>

**Try it yourself:** Open `actions/profile.ts` and find `getResumeSignedUrl()`. Compare how it retrieves the `resume_pdf_key` — it uses the same `select("resume_pdf_key").eq("id", ...)` pattern. The extract route takes a different next step: instead of generating a signed URL for the browser, it downloads the raw bytes. Two different uses of the same stored key.

---

## Part 5 — `applyExtraction`: null-safe, additive form population

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), the `applyExtraction` function:

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

The naive approach would be `setForm({ ...prev, ...data })`. This spreads Gemini's entire
response into the form state — including every field Gemini returned as `null` because it
couldn't extract it. If the user had manually entered their phone number and Gemini didn't
find a phone in the resume, their phone would now be `null`. The form clears it. The user
clicks Save and loses their data.

The pattern `...(condition && { key: value })` avoids this. When `data.full_name` is
`null`, JavaScript evaluates `(null != null && ...)` as `false`. Spreading `false` into an
object literal — `{ ...false }` — is a no-op in JavaScript. The key is never added. When
`data.full_name` has a real value, the condition is truthy, `{ full_name: data.full_name }`
is spread, and the field updates.

`!= null` (loose inequality) catches both `null` and `undefined`. Strict `!== null` would
miss `undefined`, which can appear when Gemini omits a field entirely. A truthy check
(`if (data.phone)`) would incorrectly skip `""` or `0` — valid values that should still
update the form.

For arrays, the check is different: `if (data.skills?.length) setSkills(data.skills)`.
An empty array from Gemini (`skills: []`) means "I found no skills" — not "the user has
no skills." Applying an empty array would wipe manually-entered tags. A non-zero length
means Gemini found real skills worth replacing with.

The `education` check — `if (data.education?.degree)` — guards on the `degree` field
rather than the education object itself. Gemini always returns the education object (it's
part of the required shape), but it may return all fields as `null` if no education
section was found. Checking only the object's existence (`if (data.education != null)`)
would apply `{ degree: null, fieldOfStudy: null, institution: null, graduationYear: null }`
to the form, overwriting any education data the user entered.

**Checkpoint:** `years_experience` is stored in `FormState` as a `string` (because HTML `<select>` and `<input>` values are always strings), but Gemini returns it as `number | null`. What does line `years_experience: String(data.years_experience)` do, and why is this conversion inside the `!= null` guard rather than outside it?

<details>
<summary>Reveal answer</summary>

`String(null)` produces `"null"` — the literal string "null". If the conversion happened
outside the guard, a `null` value from Gemini would populate the years field with the
string `"null"`, which would appear in the input box and would cause `parseInt("null")` to
return `NaN` when saving. The guard ensures the conversion only runs when the value is a
real number: `data.years_experience != null` is `true`, so `String(5)` produces `"5"`.

</details>

**Checkpoint:** What does JavaScript evaluate `...(false)` to inside an object literal?
Why does this work as a conditional field-inclusion pattern — and what is the risk if you
used a truthy check (`if (data.phone)`) instead of `!= null`?

<details>
<summary>Reveal answer</summary>

`{ ...false }` is a no-op in JavaScript — spreading a non-object primitive into an object
literal produces nothing. This is specified behavior, not an accident. `undefined`, `null`,
`false`, `0`, and `""` all spread as no-ops. So `{ a: 1, ...(false), b: 2 }` evaluates to
`{ a: 1, b: 2 }`.

The risk of a truthy check: `data.phone` would be falsy for `""` (empty string), `0`, and
`false` — all values that could theoretically be valid and should still update the form. For
example, if `years_experience` is `0` (just starting out), a truthy check would skip it,
leaving the old value in the form instead of updating to the correct value. `!= null` catches
only `null` and `undefined` — the only two values that mean "Gemini didn't find this field."

</details>

**Checkpoint:** Why does `!= null` (loose inequality) catch an additional case that
`!== null` (strict inequality) would miss? When does that extra case matter here?

<details>
<summary>Reveal answer</summary>

JavaScript's `==` (abstract equality) applies type coercion, and specifically:
`null == undefined` is `true`. So `x != null` returns `false` for both `null` AND
`undefined`. Strict `x !== null` returns `false` only for `null` — it treats `undefined`
as a different value.

When does `undefined` appear in Gemini's response? When Gemini omits a field entirely from
the JSON object. If the `ProfileExtraction` type has `phone?: string | null` and Gemini
returns `{}` (no `phone` key), then `data.phone` is `undefined`. `undefined !== null` is
`true` (strict would pass the guard), but `undefined != null` is `false` (loose catches
it). If `undefined` passed the guard, `setForm` would receive `{ phone: undefined }`,
which spreading into form state would set `phone` to `undefined` — effectively clearing it.

</details>

**Checkpoint:** `if (data.education?.degree) setEducation(data.education)` checks for
`degree` specifically rather than the education object itself. What would happen if you
changed it to `if (data.education != null) setEducation(data.education)`?

<details>
<summary>Reveal answer</summary>

`data.education` is always non-null — it's part of the required JSON shape Gemini returns
(the system prompt always asks for an education object). But when no education section is
found, Gemini returns `{ degree: null, fieldOfStudy: null, institution: null,
graduationYear: null }` — the object exists but all fields are null.

If you use `if (data.education != null)`, the condition is always `true`. `setEducation({
degree: null, fieldOfStudy: null, ... })` would always run, overwriting any education the
user manually entered with all-null values. The user's manually typed degree and institution
would be silently deleted on every extraction.

Checking `data.education?.degree` makes the guard meaningful: it only applies the
extraction result when Gemini actually found at least a degree string — the minimum signal
that the education section was real.

</details>

**Try it yourself:** In a browser console, run:
```javascript
const result = { a: 1, ...(false), ...(undefined), ...({ b: 2 }) };
console.log(result);
```
Confirm `result` is `{ a: 1, b: 2 }`. Then try `{ ...null }` — also a no-op. This is the
JavaScript behaviour the entire `applyExtraction` pattern relies on.

---

## Part 6 — The Extract button: conditional visibility and transition feedback

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), the Extract button block (lines 654–674):

```tsx
{resumeFileName && (
  <div className="mt-4 pt-4 border-t border-border">
    {extractResult?.success && (
      <p className="text-sm text-success mb-3">
        Profile filled in from your resume — review the fields below
        and save when ready.
      </p>
    )}
    {extractResult && !extractResult.success && (
      <p className="text-sm text-error mb-3">{extractResult.error}</p>
    )}
    <button
      type="button"
      onClick={handleExtract}
      disabled={isExtracting}
      className="bg-accent text-white text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors disabled:opacity-60"
    >
      {isExtracting ? "Extracting..." : "Extract from Resume"}
    </button>
  </div>
)}
```

And `handleExtract` (lines 375–389):

```typescript
function handleExtract() {
  setExtractResult(null);
  startExtract(async () => {
    const res = await fetch("/api/profile/extract", { method: "POST" });
    const result = (await res.json()) as
      | { success: true; data: ProfileExtraction }
      | { success: false; error: string };
    if (!result.success) {
      setExtractResult({ success: false, error: result.error });
      return;
    }
    applyExtraction(result.data);
    setExtractResult({ success: true });
  });
}
```

The entire Extract section is wrapped in `{resumeFileName && (...)}`. There is no resume
key without a filename, and there is nothing to extract from. The button is only meaningful
after a file has been uploaded and `resumeFileName` is set — so the button only exists in
that state. This avoids a disabled button state that would require a tooltip to explain.

`setExtractResult(null)` at the top of `handleExtract` clears any previous result before
starting a new call. Without this, a prior error message would persist while the new
extraction runs.

`isExtracting` comes from `useTransition`. As covered in Tutorial 07, `useTransition`
gives React permission to batch the resulting state updates as a non-urgent transition —
the UI stays interactive during the fetch. `isExtracting` is `true` from the moment
`startExtract` is called until all state updates inside it have settled, which includes
both the `fetch` call and the subsequent `applyExtraction` state updates. A plain
`useState(false)` loading flag would require manual `setLoading(true)` before and
`setLoading(false)` after, and would not include the state-update settling time.

The success banner uses the word "review" deliberately: *"Profile filled in from your
resume — review the fields below and save when ready."* Gemini can misparse dates,
misidentify experience level, or hallucinate skills. The banner cues the user that the
next step is theirs — to read through the populated fields before clicking Save. Extraction
does not auto-save; the existing `saveProfile` Server Action handles that when the user is
ready.

**Checkpoint:** The `handleExtract` handler calls `setExtractResult(null)` before `startExtract`. Why isn't this call inside `startExtract`?

<details>
<summary>Reveal answer</summary>

`startExtract` schedules its callback as a non-urgent React transition. React may not run
it synchronously — it might batch or defer it slightly. If `setExtractResult(null)` were
inside `startExtract`, the previous error message would remain visible for a brief moment
at the start of the new extraction. By calling it before `startExtract`, the error clears
synchronously as part of the click handler, before the transition begins. The UI is clean
immediately on click.

</details>

**Checkpoint:** `isExtracting` from `useTransition` represents the transition being active.
What does this actually include — is it true only during the `fetch`, during the state
updates in `applyExtraction`, or both? How does this differ from a `useState(false)`
loading flag?

<details>
<summary>Reveal answer</summary>

`isExtracting` is `true` from when `startExtract` is called until ALL state updates inside
the transition callback have settled — including both the `await fetch(...)` call AND the
subsequent `applyExtraction(result.data)` and `setExtractResult({ success: true })` calls.
React treats everything inside `startExtract` as a single transition, not individual state
updates.

A `useState(false)` flag:
- Must be manually set to `true` before the async operation: `setLoading(true)`
- Must be manually reset to `false` after it completes: `setLoading(false)` in a `finally` block
- Does NOT include the time for state updates to settle — only the time between your
  manual `setLoading(true)` and `setLoading(false)` calls

`useTransition` is more accurate because it ends when React has finished processing all
the resulting state changes, not when your code finished executing.

</details>

**Checkpoint:** Extraction populates the form but does not auto-save. If Gemini fills in
the form and the user immediately navigates to `/dashboard` without clicking "Save
Profile", what happens to the extracted data?

<details>
<summary>Reveal answer</summary>

It's lost. The extracted data exists only in the `ProfileForm` component's in-memory React
state (`form`, `skills`, `industries`, etc.). Navigating away destroys the component and
its state. When the user returns to `/profile`, the page Server Component re-fetches the
profile from the DB — which has not changed — and re-initializes the form from that
unchanged data.

This is intentional. The no-auto-save design is a quality gate: it forces the user to
review what Gemini extracted before it's committed. The alternative — auto-save immediately
after extraction — would silently commit whatever Gemini produced, including hallucinated
skills, wrong experience levels, and misidentified job titles. The "review the fields
below and save when ready" banner exists precisely to make this two-step process explicit.

</details>

**Try it yourself:** Add a 3-second delay inside `handleExtract` before the `fetch`:
```typescript
await new Promise(resolve => setTimeout(resolve, 3000));
```
Click Extract. Observe that `isExtracting` is `true` for 3 seconds and the button shows
"Extracting..." while disabled. Try clicking other buttons on the page — confirm they still
respond (the transition doesn't block the rest of the UI). Remove the delay when done.

---

## Full data flow: user clicks "Extract from Resume" to form population

1. User clicks "Extract from Resume" → `handleExtract()` fires
2. `setExtractResult(null)` clears any previous result synchronously
3. `startExtract(async () => { ... })` begins the transition; `isExtracting` becomes `true`; button shows "Extracting..."
4. `fetch("POST /api/profile/extract")` — no body — sends session cookie automatically
5. **`route.ts` line 8:** `createInsforgeServer()` creates server-side InsForge client
6. **`route.ts` line 9:** `insforge.auth.getCurrentUser()` reads session from cookie → gets `authData.user`
7. **`route.ts` line 19–24:** `insforge.database.from("profiles").select("resume_pdf_key").eq("id", userId).single()` → returns `{ resume_pdf_key: "user-id/resume.pdf" }`
8. **`route.ts` line 34–36:** `insforge.storage.from("resumes").download(key)` → returns `Blob`
9. **`route.ts` line 45:** `Buffer.from(await fileBlob.arrayBuffer())` → `Buffer` passed to extractor
10. **`extractor.ts` line 59:** `pdf(buffer)` → `pdfData.text` (flat string of resume content)
11. **`extractor.ts` line 62:** `text.length < 100` check — passes for real resumes
12. **`extractor.ts` line 76–85:** `openai.chat.completions.create({ model: "gemini-2.5-flash-lite", ... })` → Gemini API call via Google's endpoint
13. **`extractor.ts` line 87:** `JSON.parse(response.choices[0].message.content!)` → `ProfileExtraction` object
14. **`route.ts` line 47:** `return NextResponse.json({ success: true, data: ProfileExtraction })`
15. **`ProfileForm.tsx` line 381:** `result = await res.json()` — typed union discriminated by `success`
16. **`ProfileForm.tsx` line 386:** `applyExtraction(result.data)` — null-safe per-field state updates
17. React re-renders: form fields populated with extracted values
18. **`ProfileForm.tsx` line 387:** `setExtractResult({ success: true })` — success banner renders
19. `isExtracting` becomes `false`; button returns to "Extract from Resume"
20. User reviews fields → clicks "Save Profile" → existing `saveProfile` Server Action writes to DB

---

## Extend it (challenges)

### Challenge 1 — Trace: follow a Gemini enum value through the stack (15–20 min)

Trace the value `"senior"` for the `experience_level` field from the Gemini response all
the way to a rendered `<select>` in the profile form.

Your trace should answer:
- In which file and at which line is `"senior"` first parsed from the JSON string?
- What TypeScript type gates it before it enters `applyExtraction`?
- Which `useState` setter receives it?
- Which JSX `<select>` renders it as the selected option?

Write your trace as a numbered list with file names and approximate line numbers.

<details>
<summary>Hint</summary>

Start at `extractor.ts` line 88 where `JSON.parse` returns the raw data. Follow the
`ProfileExtraction` type — specifically the `experience_level` field. Then follow it
into `applyExtraction`, into `setForm`, and from there into the `<select>` in the
Professional Info section of the form. Search for `experience_level` in `ProfileForm.tsx`
to find the `<select>`.

</details>

---

### Challenge 2 — Extend: add a `cover_letter_tone` extraction field (20–30 min)

`cover_letter_tone` is a profile field with values `"formal" | "casual" | "enthusiastic"`.
It's not currently extracted from resumes (resumes don't contain this preference directly).

Add it to the system prompt as an *inferred* field: Gemini should infer the tone from the
resume's writing style if possible, or return `null`. Wire it through `ProfileExtraction`,
`applyExtraction`, and the button section.

Files to touch: `agent/extractor.ts` (type + system prompt), `components/profile/ProfileForm.tsx` (`applyExtraction`).

<details>
<summary>Hint</summary>

1. Add `cover_letter_tone?: "formal" | "casual" | "enthusiastic" | null` to `ProfileExtraction` in `extractor.ts`
2. Add it to the JSON shape in `SYSTEM_PROMPT` with a description: `"cover_letter_tone": "formal" | "casual" | "enthusiastic" | null`
3. Add a rule: `"cover_letter_tone: infer from overall tone and vocabulary of the resume text"`
4. Add `...(data.cover_letter_tone != null && { cover_letter_tone: data.cover_letter_tone })` to `applyExtraction`'s `setForm` call

</details>

---

### Challenge 3 — Break and fix: corrupt the extraction and reason about the failure (30–45 min)

In `agent/extractor.ts`, temporarily change the system prompt to remove the JSON shape
definition — leave only the rules, not the example structure. Call Extract on a real
resume.

Observe what happens:
- Does Gemini still return JSON?
- If it returns JSON, does `JSON.parse` succeed?
- If parsing succeeds, does `applyExtraction` populate any fields?
- What does the user see?

Then restore the system prompt and explain in writing: at which layer does a malformed
Gemini response get caught? What would you need to add to the code to produce a more
helpful error message than "Internal server error" when the extracted JSON has the wrong
shape?

<details>
<summary>Hint</summary>

Without the shape definition, Gemini may return JSON with different field names (e.g.
`"name"` instead of `"full_name"`). `JSON.parse` would succeed, but `applyExtraction`
would find all fields `undefined` (which `!= null` catches correctly — so no fields would
update). The user sees the success banner but nothing populates.

To improve this: after `JSON.parse`, validate that the returned object has at least some
expected keys (e.g. `if (!data.full_name && !data.skills?.length && !data.work_experience?.length)`).
If all are empty, return `{ success: false, error: "Extraction returned no usable data. Try uploading a clearer PDF." }`.

</details>

---

For deeper exploration, `docs/plan/07-profile-extraction/ai-discussion-topics.md` has 15
prompts covering pdf-parse failure modes, the OpenAI-compatible protocol, null-safe
spreading, and `useTransition` internals. Feed them to an LLM *after* forming your own
answer first — the gap between what you thought and what you learn is where understanding
lands.
