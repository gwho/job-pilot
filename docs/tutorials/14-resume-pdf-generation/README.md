# Tutorial 14 — Resume PDF Generation: AI Prose, PDF Rendering, and Storage Replacement

**After completing this tutorial you will understand:** why `@react-pdf/renderer` requires `serverExternalPackages` and what build error appears without it, how @react-pdf's Yoga layout engine differs from browser CSS and why skills cannot be rendered as individual tag elements, exactly how a Node.js `Buffer` from `renderToBuffer` must be converted before it can be uploaded to InsForge Storage (and why two simpler conversion attempts fail with TypeScript errors), why the server-side `is_complete` check is necessary even though the Generate button is disabled on the client, and how the remove-then-upload storage pattern interacts with InsForge's auto-rename behavior when no prior removal is done.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 07 (`../07-profile-save/README.md`) — the remove-then-upload storage sequence, `FormData` vs typed objects, and `useTransition` independent pending states. This tutorial builds the same storage pattern again with a generated file instead of an uploaded one.
> - Tutorial 10 (`../10-profile-extraction/README.md`) — the Gemini system prompt contract, `serverExternalPackages` for `pdf-parse`, and the API route + `agent/` boundary. This tutorial is the counterpart: where Tutorial 10 went PDF → text → profile fields, this one goes profile fields → text → PDF.
>
> Open [`agent/resume-template.tsx`](../../../agent/resume-template.tsx),
> [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx),
> [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these prompts before reading any code. Budget 30–40 minutes.

### Concept 1 — @react-pdf/renderer: PDF rendering in a React environment

> "Explain `@react-pdf/renderer` in plain terms. What does it render to — HTML? A DOM? Something else? What primitives does it provide (Document, Page, View, Text), and how do they map conceptually to HTML? Why can't you use regular HTML elements like `<div>` or `<p>` in a react-pdf template? Show me a minimal example of a Document with a page header and a paragraph. Quiz me at the end."

*What to listen for:* `@react-pdf/renderer` renders to a binary PDF buffer — not to the DOM, not to HTML. Its primitives are `Document`, `Page`, `View`, `Text`, `Image` — roughly analogous to the document root, page, div, span/paragraph, and img. You cannot use `<div>` or any HTML element because there is no DOM; the renderer has its own layout engine (Yoga) that converts the component tree to PDF drawing instructions.

*Practice question:* A developer puts a `<span>` inside a `<Text>` in a react-pdf component and runs the dev server. What happens compared to if they put it in a normal React component?

---

### Concept 2 — serverExternalPackages: opting out of Next.js bundling

> "Explain what `serverExternalPackages` does in Next.js. What does 'bundling' mean in this context, and why does it sometimes fail for certain npm packages? What's the alternative to bundling (runtime resolution), and when should you prefer it? Give me an example of a package that typically needs this and what error appears without it. Quiz me."

*What to listen for:* Next.js bundles server-side code by default — it traces imports and packages them into optimized bundles for deployment. Some packages use native bindings, non-standard module structures, or dynamic `require()` calls that static analysis cannot trace. `serverExternalPackages` tells Next.js to skip bundling for a listed package and let Node.js resolve it at runtime via `node_modules`. The error without it typically looks like "cannot resolve module X" where X is an internal path like `pdfkit/js/pdfkit`.

*Practice question:* Two packages need `serverExternalPackages` in this project. What do they have in common that requires this treatment?

---

### Concept 3 — LLM temperature: extraction vs generation tasks

> "Explain temperature in LLMs. What does a lower temperature do to outputs, and what does a higher temperature do? Why might you use 0.3 for one task and 0.7 for another — give me a concrete example of a task for each setting. What's the failure mode of using the wrong temperature for each task? Quiz me with a scenario."

*What to listen for:* Temperature controls the randomness of token sampling. Lower temperature (0.1–0.4) → the model gravitates toward the most probable next token → outputs are more deterministic, less varied, more "correct" for tasks with right answers. Higher temperature (0.6–0.9) → more randomness → outputs vary more, feel more natural, better for creative tasks with no single right answer. Wrong temperature: 0.3 for prose generation → formulaic, repetitive sentences across profiles; 0.7 for extraction → same resume might extract different phone numbers on different runs.

*Practice question:* A developer is building a feature that classifies a job description into exactly one of five predefined categories. Should they use 0.3 or 0.7 temperature? Why?

---

### Concept 4 — Node.js Buffer vs Web API Blob: the binary type mismatch

> "Explain the difference between a Node.js `Buffer` and a Web API `Blob`. Both represent binary data — how do their interfaces differ? What is `ArrayBuffer` and how does it relate to both? If a function returns a `Buffer` but another function needs a `Blob`, walk me through the conversion steps. What goes wrong if you just pass the Buffer directly to a function expecting a Blob? Quiz me."

*What to listen for:* `Buffer` is Node.js-specific — a `Uint8Array` subclass with Node-specific methods like `readInt32BE`. `Blob` is the Web Standard API for binary data — what browsers use, what `fetch()` accepts, what `FormData` holds. `ArrayBuffer` is the raw byte store that both can be built from. Conversion: `Buffer` → `new Uint8Array(buffer)` → `new Blob([uint8Array])`. Passing a `Buffer` directly to `Blob`'s constructor may fail with TypeScript errors because `Buffer`'s `.buffer` property is `ArrayBufferLike` (a union including `SharedArrayBuffer`), which `Blob` doesn't accept.

*Practice question:* `renderToBuffer()` returns `Buffer`. `storage.upload()` accepts `File | Blob`. List the conversion steps to go from one to the other.

---

### Concept 5 — Client-side disabled buttons and server-side guards

> "A button is disabled in a React component via `disabled={!isComplete}`. A developer says this is sufficient to prevent unauthorized API calls. Explain exactly why it's not. Name three ways an end user or attacker could bypass a `disabled` button. What is the correct principle for where access control must live? Quiz me."

*What to listen for:* The `disabled` attribute is a DOM property — it affects only what the browser renders. The underlying HTTP route has no knowledge of this attribute. Bypasses: (1) curl/Postman with valid session cookie, (2) browser devtools → console → `fetch('/api/resume/generate', { method: 'POST' })`, (3) any script that sends the request programmatically. The correct principle: the server must enforce every access control check independently, regardless of what the client shows.

*Practice question:* If the server-side `is_complete` check is removed from the generate route, what exactly would happen when a user with an empty profile hits the route directly? Walk through each step.

---

## Architecture: what Feature 08 adds

Feature 08 wires the "Generate Resume from Profile" button, which was an inert placeholder since Feature 05. The data flow:

```
[Client: ProfileForm.tsx]
  │  1. User clicks "Generate Resume from Profile"
  │     disabled if: !profile?.is_complete || isGenerating
  │  2. startGenerate(async () => fetch("POST /api/resume/generate"))
  │     isGenerating = true, button shows spinner
  ▼
[Server: app/api/resume/generate/route.ts]
  │  3.  Auth: createInsforgeServer() → getCurrentUser()
  │  4.  SELECT * FROM profiles WHERE id = userId
  │      uses .single() — profile must exist (is_complete = true guarantees it)
  │  5.  Guard: if (!profile.is_complete) → 400
  │  6.  generateResumePdf(profile) ← agent call
  │
  │  [agent/pdf-generator.tsx]
  │    7. Build userPrompt string from profile fields
  │    8. Gemini call (temperature: 0.7, max_tokens: 1000)
  │       → ResumeContent JSON { summary, workExperience[] }
  │    9. renderToBuffer(<ResumeDocument profile content />)
  │       → PDF Buffer
  │    10. return { success: true, buffer }
  │
  │  11. Convert Buffer to Blob: new Blob([new Uint8Array(buffer)])
  │  12. if (profile.resume_pdf_key) → storage.remove(key)
  │  13. storage.upload("{userId}/resume.pdf", blob)
  │      → uploadData: { key, url }
  │  14. profiles.upsert([{ id, resume_pdf_key, resume_pdf_url,
  │      resume_pdf_filename: "AI Generated Resume.pdf" }])
  │  15. return NextResponse.json({ success: true })
  ▼
[Client: ProfileForm.tsx]
  │  16. generateResult = { success: true }
  │      "Resume generated — click 'View current resume' to open it"
  │  17. setResumeFileName("AI Generated Resume.pdf")   ← local state
  │      isGenerating = false
  ▼
[On "View current resume" click]
  │  18. getResumeSignedUrl() Server Action
  │      → signed URL (3600s)
  │      → window.open(url, "_blank")
```

Three invariants govern this feature:

1. The full profile is read from the DB by the route — the form's unsaved state is never included in the generated PDF.
2. `is_complete` is enforced both client-side (disabled button) and server-side (route guard) — neither is sufficient alone.
3. The remove-then-upload sequence from Feature 06 is repeated exactly — the storage SDK has no upsert.

---

## Part 1 — serverExternalPackages: why @react-pdf/renderer cannot be bundled

Open [`next.config.ts`](../../../next.config.ts) and find the `serverExternalPackages` array:

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"],
  // ...
};
```

Tutorial 10 explained why `pdf-parse` needs this treatment. `@react-pdf/renderer` needs it for the same root cause: its internal dependency `pdfkit` uses non-standard module resolution — native bindings, dynamic `require()` calls, and an ESM/CJS internal structure that Turbopack's static analyzer cannot trace.

When `@react-pdf/renderer` is not in `serverExternalPackages`, Turbopack tries to bundle it. It follows import chains looking for every module the package needs. It hits `pdfkit`'s internal paths — something like `pdfkit/js/pdfkit` or a native binding path — and cannot find the file. The build fails with an error like:

```
Module not found: Can't resolve 'pdfkit/js/pdfkit'
```

Adding the package to `serverExternalPackages` changes the strategy: "don't bundle this, let Node.js resolve it at runtime." The package is loaded on demand when a request hits the generate route, exactly as it would be in a plain Node.js server. No static analysis, no bundle inclusion — just the installed files in `node_modules`.

The general pattern: any server-only package that uses native bindings, non-standard ESM, or dynamic internal requires will need this treatment. The diagnostic signal is a "Module not found" error where the unresolvable module is an *internal* path of the package (not the package itself).

**Checkpoint:** `pdf-parse` and `@react-pdf/renderer` both need `serverExternalPackages`. What do they have in common that requires this treatment, and what does the error message look like when either is missing from the list?

<details>
<summary>Reveal answer</summary>

Both use internal module structures that Turbopack's bundler cannot statically resolve. `pdf-parse` depends on internal paths for its parser; `@react-pdf/renderer` depends on `pdfkit` which uses native bindings and dynamic `require()` calls. In both cases, Turbopack follows the import chain and hits a path it cannot find in the file system at build time.

The error looks like: `Module not found: Can't resolve 'X'` where X is an internal module path (e.g., `pdfkit/js/pdfkit`) rather than a top-level package name. This is the reliable diagnostic: if the unresolvable module is an internal path of a package (contains slashes beyond the top-level name), that package likely needs `serverExternalPackages`.

</details>

**Checkpoint:** `serverExternalPackages` entries only affect server-side code. What would happen if you tried to import `@react-pdf/renderer` in a Client Component (`"use client"` file)?

<details>
<summary>Reveal answer</summary>

`@react-pdf/renderer` uses Node.js-specific APIs (file system access, native bindings) that don't exist in the browser. Importing it in a client component would fail — either at build time (bundler can't include it in the browser bundle) or at runtime (browser doesn't have `fs`, `path`, or the native `pdfkit` bindings).

`serverExternalPackages` doesn't solve this — it only tells Next.js how to handle the package on the server. Client-side use of server-only packages requires either a different architecture (keep it server-side) or a dedicated browser-compatible PDF library (a different package entirely). This is why `agent/pdf-generator.tsx` is in `agent/` — it runs server-side only, called from an API route, never from a Client Component.

</details>

---

## Part 2 — agent/resume-template.tsx: @react-pdf primitives and Yoga layout

Open [`agent/resume-template.tsx`](../../../agent/resume-template.tsx), the skills section (lines 169–178):

```tsx
{/* Skills */}
{profile.skills && profile.skills.length > 0 ? (
  <>
    <Text style={styles.sectionLabel}>SKILLS</Text>
    <View style={styles.sectionRule} />
    <Text style={styles.skillsText}>
      {profile.skills.join(" • ")}
    </Text>
  </>
) : null}
```

This renders all skills as a single string — `"React • TypeScript • Node.js • ..."` — inside one `<Text>` element. The naive approach would be to render each skill as its own element, similar to how the skills section in `ProfileForm` renders individual chip badges:

```tsx
{/* ❌ Does not work in @react-pdf */}
<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
  {profile.skills.map((skill) => (
    <View key={skill} style={skillChipStyle}>
      <Text>{skill}</Text>
    </View>
  ))}
</View>
```

In a browser, `flexWrap: "wrap"` makes elements spill to the next line when the row is full. @react-pdf uses the Yoga layout engine — the same engine used by React Native — rather than browser CSS. Yoga does support `flexWrap`, but the specific combination of per-element chip views with varying widths and gaps produces inconsistent or broken layout in the PDF: chips may not wrap correctly, may overflow their parent, or may render at incorrect sizes depending on the Yoga version and content length.

The single `<Text>` with `.join(" • ")` is the safe pattern: one text node of known width that wraps at word boundaries using the text layout engine. It loses the visual chip styling but gains reliable layout across all content lengths and PDF viewers.

The same Yoga constraint applies to any layout that requires elements of unknown width to wrap onto the next line. Long navigation bars, tag collections, inline code with varying lengths — all need the "join into one string" or "pre-calculate widths" approach in react-pdf.

**Checkpoint:** Why can't you use `flexWrap: "wrap"` reliably for a skills chip layout in @react-pdf, even though the same CSS property works in the browser?

<details>
<summary>Reveal answer</summary>

Browser CSS's flex layout engine performs layout in the rendering engine, which measures actual rendered text widths before determining where to wrap. It knows exactly how many pixels each chip takes and wraps accordingly.

Yoga (used by @react-pdf and React Native) is a simplified layout engine designed for environments where text measurement is expensive or unavailable. It handles flex layouts but makes different assumptions about content widths — particularly for `<View>` elements containing `<Text>`, where the text width isn't known until render time. The result is that `flexWrap: "wrap"` with variable-width children (chips containing text of different lengths) produces layout that may be correct in simple cases but breaks in complex or edge cases: chips may not wrap, may overflow the page, or may render at incorrect widths.

The join-to-string approach sidesteps this entirely: one `<Text>` element handles its own text wrapping via the PDF text layout engine, which is designed for exactly this case.

</details>

Now look at the styles definition (lines 16–118):

```tsx
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    lineHeight: 1.3,
  },
  // ...
  sectionLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#888888",
    marginTop: 12,
    marginBottom: 3,
  },
```

All color values are plain hex strings (`"#1a1a1a"`, `"#888888"`). This is the only option available — @react-pdf uses a React Native-style `StyleSheet.create()` API that accepts raw CSS property values as strings. Tailwind class names like `text-text-primary` are compiled to CSS at build time and have no meaning in this environment. The `@theme` tokens in `app/globals.css` are browser CSS variables — also unavailable. For react-pdf templates, hex values are the correct and only approach.

**Checkpoint:** The project rule from `CLAUDE.md` says "Never use raw Tailwind color classes or hex values in components — only project token classes." But `resume-template.tsx` uses hex values throughout. Is this a violation?

<details>
<summary>Reveal answer</summary>

No — this is the correct and required approach for react-pdf files. The rule in `CLAUDE.md` applies to browser-rendered React components where Tailwind's compiler can process class names into browser CSS. `resume-template.tsx` is not a browser component — it renders to a PDF buffer using `@react-pdf`'s layout engine, which has no knowledge of Tailwind, CSS variables, or `@theme` tokens.

The rule's intent is to maintain visual consistency via design tokens in the browser UI. `resume-template.tsx` lives in `agent/` precisely because it's not a UI component — it's a PDF template used by an agent operation. Using hex values here is correct. The project's color consistency for the browser UI is maintained in `components/`; the PDF has its own styling that doesn't need to share those tokens.

</details>

**Checkpoint:** `profile.skills.join(" • ")` uses a bullet separator. What would happen to a skill that contains a bullet character in its text? Is this a realistic concern for user-entered skills?

<details>
<summary>Reveal answer</summary>

If a skill contained a `•` character (e.g., a user typed "A•B skill"), the join would produce ambiguous output: "A•B skill • Next.js • TypeScript" — the separator and the in-skill bullet are visually identical. A reader scanning skills would misparse the skill boundaries.

In practice this is very low risk: users enter skills as short labels ("React", "TypeScript", "Node.js") via a chip input that appends on Enter or comma. The input pattern makes it unlikely anyone would type a bullet character in a skill name. The current join implementation accepts this as an acceptable edge case. A more defensive version might use a different separator (`" | "` or a `" · "` middle dot) that's less commonly typed.

</details>

---

## Part 3 — agent/pdf-generator.tsx: Gemini call and renderToBuffer

Open [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx) in full:

```typescript
const SYSTEM_PROMPT = `You are a professional resume writer. Given a candidate's profile data, produce polished resume content.

Return ONLY valid JSON with this exact shape:
{
  "summary": string,
  "workExperience": [
    {
      "company": string,
      "title": string,
      "period": string,
      "bullets": string[]
    }
  ]
}

Rules:
- summary: 2-3 sentences. Open with the candidate's role and experience level, then their key strengths and value proposition.
- bullets: 3-4 per role maximum. Start each with a strong past-tense action verb (Led, Built, Reduced, Increased). Quantify impact wherever the raw data allows. Keep each bullet under 20 words.
- period: Format as "YYYY – Present" or "YYYY – YYYY". Use "Present" if current is true.
- Keep the entire output concise — it must fit on a single-page PDF.
- Return valid JSON only. No markdown fences, no extra text.`;
```

The Gemini call uses `temperature: 0.7` and `max_tokens: 1000` — documented in `context/library-docs.md`. This contrasts with Feature 07's extraction call which uses `temperature: 0.3`. The difference is the task type.

Extraction has a right answer: the user's name, their phone number, their current title — these are facts in the document. High repeatability matters: the same resume should produce the same extracted fields every run. Low temperature minimizes variance.

Resume generation has no right answer: the task is producing natural, compelling prose from structured data. A summary paragraph at 0.3 reads formulaic — every profile gets a similar sentence structure because the model gravitates to the highest-probability tokens. At 0.7, each generation reads differently. The tradeoff (less repeatability) is acceptable because there's nothing to check repeatability against — any fluent, accurate summary is correct.

The file is `pdf-generator.tsx` rather than `pdf-generator.ts` because it contains JSX:

```tsx
const buffer = await renderToBuffer(
  <ResumeDocument profile={profile} content={content} />,
);
```

JSX syntax (`<ResumeDocument ... />`) is only valid in `.tsx` (or `.jsx`) files when TypeScript's `jsx` compiler option is `"preserve"` (which Next.js sets). Renaming to `.ts` would cause a parse error on the `<` character. The alternative — `React.createElement(ResumeDocument, { profile, content })` — is semantically identical but less readable. Since the file renders a component, `.tsx` is the correct extension.

The `ResumeContent` interface is defined here in `pdf-generator.tsx` and imported by `resume-template.tsx`. The direction matters: `pdf-generator.tsx` calls Gemini and controls what `ResumeContent` contains. It's the producer. `resume-template.tsx` is the consumer — it renders whatever `content` it receives. If the interface lived in `resume-template.tsx` and was imported by `pdf-generator.tsx`, the template would implicitly control the shape of the Gemini output. A change to the template interface would require tracing back to the Gemini system prompt to verify the output still matches. With the interface in the producer, both sides are co-located: change the Gemini prompt, update the interface in the same file, and the template sees the updated type immediately.

**Checkpoint:** Why does `pdf-generator.tsx` use `temperature: 0.7` while `agent/extractor.ts` (Feature 07) uses `temperature: 0.3`? What would the failure mode look like if you used 0.3 for resume generation?

<details>
<summary>Reveal answer</summary>

Extraction is a retrieval task with correct answers (the user's name, phone, employer). Low temperature ensures the model repeatedly selects the most probable token — which is usually the literal text from the source document. High repeatability is desirable: the same resume should extract the same fields on every run.

Resume generation is a creative writing task — there's no single correct summary. At 0.3, the model gravitates toward the most probable next token at every step. For a creative task, this means: very similar sentence patterns across different profiles ("Experienced [role] with [N] years of expertise in..."), repetitive bullet structures, and overall formulaic prose. The PDF would technically be accurate but would read like it was generated by a template rather than a skilled writer.

At 0.7, there's enough randomness that each generation reads differently. The tradeoff — the same profile might produce slightly different summaries on separate generations — is acceptable for a prose generation task.

</details>

**Checkpoint:** The `ResumeContent` interface is defined in `pdf-generator.tsx` and imported by `resume-template.tsx`. What would break if the direction were reversed — the interface in `resume-template.tsx`, imported by `pdf-generator.tsx`?

<details>
<summary>Reveal answer</summary>

`pdf-generator.tsx` controls what Gemini returns. If the Gemini system prompt is updated — adding a `targetJobTitle` field to the summary prompt, or splitting the work experience bullets into different categories — the `ResumeContent` interface must be updated to match. With the interface in `pdf-generator.tsx`, both the prompt and the interface are in the same file: the developer making the prompt change sees the interface immediately and updates it atomically.

If the interface lived in `resume-template.tsx`, the same change would require editing two files in two different locations with no structural link between them. A developer could update the system prompt to add `targetJobTitle` without updating the interface, TypeScript would not catch this (the Gemini output is parsed as `unknown` then cast), and the field would silently be missing from the rendered PDF.

The producer (the code that determines what the data looks like) should own the type. The consumer (the code that renders the data) should import it.

</details>

**Checkpoint:** Where in the project are `temperature: 0.7` and `max_tokens: 1000` documented for resume generation? What would happen to the generated PDF if `max_tokens` was reduced to 300?

<details>
<summary>Reveal answer</summary>

These values are documented in `context/library-docs.md` under "Temperature settings" and Gemini configuration guidance. The comment `// per library-docs.md resume writing entry` in the original plan traces the source.

If `max_tokens` was reduced to 300: Gemini's JSON response would be truncated mid-generation. A summary sentence might end mid-word. The work experience section might be cut off after the first role's first bullet. `JSON.parse(raw)` would then throw a `SyntaxError` (invalid JSON), which would be caught by the outer `try/catch` in `generateResumePdf`, and the function would return `{ success: false, error: "Failed to generate resume PDF" }`. The user would see an error message rather than a generated PDF.

</details>

**Try it yourself:** Open `agent/pdf-generator.tsx` and rename it temporarily to `pdf-generator.ts`. Run `npx tsc --noEmit`. You'll see a parse error on line 75 where the JSX expression `<ResumeDocument .../>` appears. Rename it back before continuing.

---

## Part 4 — The Buffer → Blob conversion: three attempts and why only the third works

The conversion happens in [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts), line 56:

```typescript
const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
const { data: uploadData, error: uploadError } = await insforge.storage
  .from("resumes")
  .upload(storagePath, blob);
```

`renderToBuffer` returns `Promise<Buffer>`. InsForge Storage's `upload()` is typed as `upload(path: string, file: File | Blob)`. A Node.js `Buffer` is not assignable to `File | Blob` — it's a Node.js-specific type that the browser SDK's type signatures don't accept. Three approaches were tried before the working solution was found:

**Attempt 1 — Pass Buffer directly:**
```typescript
await insforge.storage.from("resumes").upload(storagePath, result.buffer);
// TypeScript error: Argument of type 'Buffer<ArrayBufferLike>' is not assignable
// to parameter of type 'Blob | File'
```
TypeScript correctly rejects this. `Buffer` is `Uint8Array<ArrayBufferLike>` — a typed array, not a `Blob` or `File`.

**Attempt 2 — Wrap in `new Blob([result.buffer])`:**
```typescript
const blob = new Blob([result.buffer], { type: "application/pdf" });
// TypeScript error:
// Type 'Buffer<ArrayBufferLike>' is not assignable to type 'BlobPart'.
// Type 'Buffer<ArrayBufferLike>' is not assignable to type 'ArrayBufferView<ArrayBuffer>'.
// Types of property 'buffer' are incompatible.
//   Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
//     Type 'SharedArrayBuffer' is missing the following properties...
```
The error message reveals the root cause precisely. `Blob`'s constructor accepts `BlobPart[]`, where `BlobPart` includes `ArrayBufferView<ArrayBuffer>`. A Node.js `Buffer`'s `.buffer` property is typed as `ArrayBufferLike` — a union of `ArrayBuffer | SharedArrayBuffer`. TypeScript sees that `ArrayBufferLike` might be `SharedArrayBuffer`, which `Blob` doesn't accept. The entire union is therefore rejected.

**Attempt 3 — `new Uint8Array(result.buffer)` first:**
```typescript
const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
// ✅ TypeScript accepts this
```
`new Uint8Array(typedArray)` — when passed another typed array as its argument — creates a *copy* of the data with its own fresh `ArrayBuffer`. The new object's `.buffer` property is typed as `ArrayBuffer` (not `ArrayBufferLike`), which satisfies `BlobPart`. TypeScript accepts it, and the bytes are preserved correctly.

The copy is small overhead for a PDF (typically < 1 MB) and introduces no observable performance impact for this use case.

**Checkpoint:** Walk through why `new Blob([result.buffer])` fails with a TypeScript error. What is `ArrayBufferLike`, and why does its presence in the type signature cause `Blob` to reject the input?

<details>
<summary>Reveal answer</summary>

`ArrayBufferLike` is a TypeScript utility type defined as `ArrayBuffer | SharedArrayBuffer`. It represents "any typed array's backing store" — because Node.js `Buffer` and some typed arrays can be backed by either a regular `ArrayBuffer` or a `SharedArrayBuffer` (used in multi-threaded environments).

`Blob`'s constructor accepts `BlobPart[]`. The `BlobPart` type includes `ArrayBufferView<ArrayBuffer>` — specifically requiring `ArrayBuffer`, not `ArrayBufferLike`. The `SharedArrayBuffer` branch of the union is excluded.

When you pass `result.buffer` (a `Buffer<ArrayBufferLike>`) to `new Blob([...])`, TypeScript checks: "is `Buffer<ArrayBufferLike>` assignable to `BlobPart`?" To satisfy `ArrayBufferView<ArrayBuffer>`, the buffer's `.buffer` property must be `ArrayBuffer`. But `Buffer.buffer` is `ArrayBufferLike` — which includes `SharedArrayBuffer`. TypeScript can't prove it's always `ArrayBuffer`, so it rejects the assignment.

`new Uint8Array(result.buffer)` creates a new typed array with a fresh `ArrayBuffer` as its backing store — no `SharedArrayBuffer` ambiguity. TypeScript sees `Uint8Array<ArrayBuffer>`, which satisfies `ArrayBufferView<ArrayBuffer>`, which satisfies `BlobPart`. The conversion compiles.

</details>

**Checkpoint:** This is the reverse of the conversion in Feature 07 (Tutorial 10, Part 3), where InsForge storage returned a `Blob` that had to be converted to `Buffer` for `pdf-parse`. What are the two conversion directions and when is each needed?

<details>
<summary>Reveal answer</summary>

**Blob → Buffer (Feature 07 / Tutorial 10):** InsForge `storage.download()` returns a `Blob`. `pdf-parse` (a Node.js library) expects a `Buffer`. Conversion: `Buffer.from(await blob.arrayBuffer())`. Direction: storage download → Node.js processing library.

**Buffer → Blob (Feature 08 / this tutorial):** `renderToBuffer` (a Node.js function returning a `Buffer`) produces binary data. InsForge `storage.upload()` accepts `Blob | File`. Conversion: `new Blob([new Uint8Array(buffer)])`. Direction: Node.js library output → storage upload.

The pattern: Web APIs (fetch, Blob, File) communicate in one type; Node.js libraries communicate in another. At every boundary between them, a conversion is needed. The `ArrayBuffer` is the neutral intermediate that both sides understand, but the type safety of the conversion requires going through `Uint8Array` to get a properly typed `ArrayBuffer`.

</details>

**Try it yourself:** In the route, temporarily replace line 56 with `const blob = new Blob([result.buffer], { type: "application/pdf" })`. Run `npx tsc --noEmit`. Read the full error message — notice how it mentions `ArrayBufferLike` and `SharedArrayBuffer`. Restore the original line after reading it.

---

## Part 5 — app/api/resume/generate/route.ts: auth, guards, and the remove-then-upload sequence

Open [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts) in full.

The route mirrors the architecture from `app/api/profile/extract/route.ts` (Tutorial 10). The differences are meaningful:

**`.single()` vs `.maybeSingle()`:** The extraction route uses `.maybeSingle()` because a user might not have a `profiles` row yet (they may not have saved). The generate route uses `.single()` because `is_complete = true` implies a profile row exists — a complete profile requires at least one save, which creates the row. If somehow there's no row, `.single()` returns an error which the route catches and returns as 404.

**The server-side `is_complete` check (lines 34–39):**
```typescript
if (!profile.is_complete) {
  return NextResponse.json(
    { success: false, error: "Complete your profile before generating a resume" },
    { status: 400 },
  );
}
```

The Generate button in `ProfileForm` has `disabled={!profile?.is_complete || isGenerating}`. This prevents a normal user from clicking it. But the `disabled` attribute is a DOM property — it affects only what the browser renders. Anyone with a valid session cookie can send `curl -X POST http://localhost:3000/api/resume/generate`. The server sees a valid authenticated POST request and has no way to know whether the button was enabled or disabled on the client.

Without the server-side check: Gemini is called with empty work experience and missing profile fields, generates a PDF with blank sections, uploads it to storage, sets `resume_pdf_filename: "AI Generated Resume.pdf"`, and returns success. The user now has a broken "AI Generated Resume" in their storage that they can't distinguish from a real one until they open it.

**The remove-then-upload sequence (lines 51–59):**
```typescript
if (profile.resume_pdf_key) {
  await insforge.storage.from("resumes").remove(profile.resume_pdf_key);
}

const storagePath = `${userId}/resume.pdf`;
const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
const { data: uploadData, error: uploadError } = await insforge.storage
  .from("resumes")
  .upload(storagePath, blob);
```

This is the identical pattern from Tutorial 07 (Feature 06's `uploadResume`). InsForge Storage has no upsert option for `upload()`. If a file exists at the target path, the SDK auto-renames the new file — returning a timestamped key like `{userId}/resume1.pdf`. Every subsequent generation creates another numbered variant while orphaned files accumulate.

The `context/library-docs.md` file had a `@react-pdf/renderer` code snippet showing `{ contentType: "application/pdf", upsert: true }` as a third argument to `upload()`. This was incorrect: `upload()` takes exactly two arguments. The build caught it immediately: `Type error: Expected 2 arguments, but got 3.` The Storage section of the same `library-docs.md` documents the correct remove-then-upload pattern. When a code example contradicts a documented pattern in the same file, the pattern section is authoritative.

**The partial upsert (lines 69–78):**
```typescript
await insforge.database
  .from("profiles")
  .upsert([
    {
      id: userId,
      resume_pdf_key: uploadData.key,
      resume_pdf_url: uploadData.url,
      resume_pdf_filename: "AI Generated Resume.pdf",
    },
  ]);
```

Only four fields are upserted — `id`, `resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename`. Not the full profile. A full profile upsert would require re-reading every profile field and re-writing them all — introducing the possibility that a field changed between the `SELECT *` at line 21 and the upsert here. More critically, it would overwrite any fields the user edited in the form but hadn't saved yet (since the form's unsaved state is never visible to the route). The partial upsert touches only the fields the generate route owns.

**Checkpoint:** Why does this route use `.single()` to fetch the profile while the extraction route (Tutorial 10) uses `.maybeSingle()`? What would happen if you switched this to `.maybeSingle()`?

<details>
<summary>Reveal answer</summary>

The generate route requires `is_complete = true` to proceed. `is_complete = true` means the user has saved a complete profile — which means the `profiles` row exists. Using `.single()` is appropriate: if for some reason the row doesn't exist, `.single()` returns an error, which the route catches and returns as 404.

The extraction route uses `.maybeSingle()` because it only needs `resume_pdf_key` — the user might have uploaded a resume without ever saving a complete profile (possible in some edge cases). `.maybeSingle()` safely returns `null` if the row doesn't exist.

Switching the generate route to `.maybeSingle()` would work correctly but would be semantically wrong: `.maybeSingle()` signals "the row might not exist" when in fact, for a complete profile, it always does. Using `.single()` is both more precise and provides a layer of defense — an unexpected missing row returns an error rather than silently passing `null` to downstream code.

</details>

**Checkpoint:** `context/library-docs.md` had a `@react-pdf` example showing `upsert: true` in the upload options. How would you detect this discrepancy between the example snippet and the real SDK behaviour without running the code?

<details>
<summary>Reveal answer</summary>

Three approaches:

1. **Read the SDK TypeScript types directly.** Open `node_modules/@insforge/sdk` (or wherever the SDK lives) and find the `upload()` function signature. If it accepts only two parameters, any third-argument example in the docs is wrong. The installed types are authoritative over documentation snippets.

2. **Read the Storage section of `library-docs.md` itself.** The file has a dedicated Storage section that documents the remove-then-upload pattern. If the pattern section contradicts a code snippet elsewhere in the same file, the pattern section reflects deliberate documentation while the snippet may be a copy-paste from an earlier API version.

3. **Read how the project already does it.** `actions/profile.ts:uploadResume` (Feature 06) implements the correct pattern. Any new feature implementing the same operation should match the existing implementation rather than the library-docs snippet.

The general principle: installed SDK types > project-established patterns > library-docs pattern sections > library-docs code snippets. The further you are from the actual installed code, the more likely a discrepancy reflects outdated examples.

</details>

**Checkpoint:** After the upload, the route does a partial upsert of only four fields (`id`, `resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename`). Why not re-fetch the full profile and do a full upsert?

<details>
<summary>Reveal answer</summary>

A full upsert would require reading the profile again (another DB round trip) and overwriting all profile fields with the values from the first SELECT. Two problems:

1. **Race condition risk:** Between the first `SELECT *` and the final upsert, the user could have saved their profile with updated fields (via `saveProfile`). A full upsert would overwrite those updates with the stale first-read values.

2. **Scope creep:** The generate route's job is to save the generated PDF reference — not to update the user's profile data. Writing only the four fields the route owns is the correct minimal-write principle: each operation writes only what it created or determined.

The partial upsert correctly limits the route's blast radius. Only the three new values (`resume_pdf_key`, `resume_pdf_url`, `resume_pdf_filename`) plus the primary key `id` are written. All other profile fields are untouched.

</details>

**Checkpoint:** The feature adds no new PostHog event even though resume generation is a significant user action. What rule in this project prevents adding one, and what would be required to add an event in the future?

<details>
<summary>Reveal answer</summary>

`CLAUDE.md` explicitly states: "exactly four PostHog events — do not add more without updating `context/code-standards.md`." The four events are `job_search_started`, `job_found`, `profile_completed`, and `company_researched`. Resume generation is not in the list.

To add an event in the future: (1) add it to the four-event table in `context/code-standards.md` with its name and trigger condition, (2) update `CLAUDE.md` to reference the updated count, (3) implement the `captureServerEvent` call in the route. The rule's purpose is preventing analytics sprawl — having a documented, reviewed list ensures events are intentional, properly named, and deduplicated.

</details>

**Try it yourself:** Remove the `if (!profile.is_complete)` block from the route temporarily. Using curl with a valid session cookie (or the browser console), send a POST to `/api/resume/generate` while your profile is incomplete. Observe the Gemini-generated content and what gets uploaded to storage. Then restore the guard and observe the 400 response for the same request.

---

## Part 6 — ProfileForm: the generate button, isGenerating transition, and stale state

The Generate button in `ProfileForm.tsx` uses the same `useTransition` pattern established in Feature 06. The handler:

```typescript
const [isGenerating, startGenerate] = useTransition();

function handleGenerate() {
  setGenerateResult(null);
  startGenerate(async () => {
    const res = await fetch("/api/resume/generate", { method: "POST" });
    const data = await res.json();
    setGenerateResult(data);
    if (data.success) {
      setResumeFileName("AI Generated Resume.pdf");
    }
  });
}
```

And the button:

```tsx
<button
  onClick={handleGenerate}
  disabled={!profile?.is_complete || isGenerating}
>
  {isGenerating ? <Spinner /> : "Generate Resume from Profile"}
</button>
```

The `disabled` condition has two components: `!profile?.is_complete` is checked against the `profile` prop (the DB value from the last page load, not the form state). A user who fills all fields but hasn't clicked Save yet would still see a disabled button. The `profile` prop is updated only after a save + page revalidation — this is intentional. The generate route reads from the DB, not from the form. If the button were enabled based on the form state (the `useMemo` completion percentage), it could appear enabled while the DB still has an incomplete profile, and the generation would fail with a 400 after the user clicks.

After a successful generation, `setResumeFileName("AI Generated Resume.pdf")` is a local state update — it changes the displayed filename in the "Current resume" section without a full page revalidation. The alternative — calling `revalidatePath("/profile")` from the route — would cause `ProfilePage` to re-run its SELECT and pass fresh props, including the updated `resume_pdf_filename`. This would show "AI Generated Resume.pdf" in the form too, but it would also re-initialize all form fields from the DB, discarding any unsaved edits the user had in progress.

Local state update is the safer choice when the user's form state should be preserved. A `revalidatePath` call from an API route (not a Server Action in this case) would also require the client to navigate to trigger the re-render — the client would need to listen for the response and force a router refresh. The local update avoids this complexity for a cosmetic change (filename display).

**Checkpoint:** The button `disabled` condition is `!profile?.is_complete || isGenerating`. `profile` here is the prop value from the last page load. What happens if a user fills all fields and clicks Save (making the profile complete), then immediately clicks Generate before the page revalidation has propagated a new `profile` prop?

<details>
<summary>Reveal answer</summary>

The button would remain disabled briefly. After `saveProfile` succeeds, the Server Action calls `revalidatePath("/profile")`. The client doesn't immediately receive new props — Next.js invalidates the cache for the route, and the next time `ProfilePage` is rendered (on navigation or explicit refresh), it'll run a fresh SELECT and pass `profile.is_complete = true` as a prop.

In practice, the client triggers a navigation after the Server Action returns (via `router.refresh()` or the automatic refresh triggered by the Server Action's response headers). This happens quickly — typically within the same event loop after the action completes — so the button becomes enabled within a fraction of a second after the save succeeds.

If a user is very fast and clicks Generate during this brief window, the button is still disabled (correct behavior — the DB hasn't confirmed completion yet). Once `profile` prop updates, the button becomes enabled.

</details>

**Checkpoint:** After generation, `setResumeFileName("AI Generated Resume.pdf")` updates local state rather than calling `revalidatePath`. What would be different from the user's perspective if `revalidatePath("/profile")` was called from the route instead?

<details>
<summary>Reveal answer</summary>

`revalidatePath("/profile")` from an API route doesn't automatically re-render the page. The route would mark the path as stale, but the client would need to refresh (via router navigation or explicit `router.refresh()`) to see the updated props. The client-side handler would need to trigger a refresh after the fetch completes:

```typescript
const data = await res.json();
if (data.success) {
  router.refresh();  // triggers re-render with fresh props from DB
}
```

This would re-initialize the form from the DB — resetting all form fields to their DB values and discarding any unsaved edits. For a user who was editing fields while the generation ran, this would be destructive.

The local state update (`setResumeFileName("AI Generated Resume.pdf")`) changes only the displayed filename. The form state is preserved. The tradeoff: the displayed filename is derived from local state, not from the DB, so if the user refreshes the page, the filename will re-read from the DB (which has already been updated by the route's partial upsert). Both the local update and the post-refresh DB read converge on "AI Generated Resume.pdf" — they just take different paths to get there.

</details>

---

## Full data flow: from saved profile fields to viewable PDF

Trace a single work experience entry — `job.company: "Acme Corp"` — from the DB through generation to the opened PDF:

```
1.  ProfilePage runs SELECT * FROM profiles WHERE id = userId
    → profile.work_experience = [{ company: "Acme Corp", title: "Engineer", ... }]
    → passed as prop to ProfileForm

2.  User clicks "Generate Resume from Profile"
    handleGenerate() → startGenerate() → isGenerating = true

3.  fetch("POST /api/resume/generate") fires as HTTP POST with session cookie
    Route authenticates → userId from session

4.  Route: SELECT * FROM profiles WHERE id = userId
    profile.work_experience[0].company = "Acme Corp"

5.  Route: profile.is_complete = true → guard passes

6.  generateResumePdf(profile) called in agent/pdf-generator.tsx

7.  userPrompt built:
    "WORK EXPERIENCE:
    Company: Acme Corp
    Title: Engineer
    Period: 2020 – Present
    Responsibilities: ..."

8.  Gemini (temperature: 0.7) processes system prompt + user prompt
    Returns JSON: {
      summary: "Experienced Engineer with 5+ years...",
      workExperience: [{
        company: "Acme Corp",
        title: "Engineer",
        period: "2020 – Present",
        bullets: ["Led migration of...", "Reduced latency by..."]
      }]
    }

9.  renderToBuffer(<ResumeDocument profile={profile} content={parsedContent} />)
    → React renders the component tree to @react-pdf instructions
    → Yoga lays out sections (header, summary, skills, EXPERIENCE)
    → "Acme Corp" appears in companyName style (bold, 10pt)
    → bullets appear in bulletText style
    → PDF bytes generated → Buffer returned

10. Buffer.from(buffer) → result.buffer
    new Uint8Array(result.buffer) → Uint8Array<ArrayBuffer>
    new Blob([uint8Array], { type: "application/pdf" }) → Blob

11. storage.remove(profile.resume_pdf_key) — old file deleted
    storage.upload("{userId}/resume.pdf", blob)
    → uploadData.key = "{userId}/resume.pdf"
    → uploadData.url = "https://..."

12. profiles.upsert([{ id: userId,
    resume_pdf_key: "{userId}/resume.pdf",
    resume_pdf_url: "...",
    resume_pdf_filename: "AI Generated Resume.pdf" }])

13. return NextResponse.json({ success: true })

14. Client: setGenerateResult({ success: true })
    setResumeFileName("AI Generated Resume.pdf")
    isGenerating = false
    "Resume generated — click 'View current resume' to open it"

15. User clicks "View current resume"
    getResumeSignedUrl() Server Action
    → SELECT resume_pdf_key FROM profiles
    → storage.createSignedUrl("{userId}/resume.pdf", 3600)
    → window.open(signedUrl, "_blank")

16. Browser opens PDF
    "Acme Corp" visible in EXPERIENCE section
```

---

## Extend it (challenges)

### Challenge 1 — Trace the complete Yoga layout path (15–20 min)

Open `agent/resume-template.tsx` and trace what happens when `profile.work_experience` has three entries. Count the `View` and `Text` elements that get rendered for all three entries combined. Then answer:

1. How many `<View style={styles.jobBlock}>` nodes are created?
2. How many `<Text style={styles.bulletDot}>` nodes exist if each entry has three bullets?
3. What `flexDirection` is set on `styles.bulletRow`, and why is it needed?
4. What would happen to the bullet layout if `flexDirection: "row"` was removed from `bulletRow`?

Write out your answers in plain prose before checking with the code.

---

### Challenge 2 — Add a LinkedIn URL section (20–30 min)

The template currently puts `linkedin_url` and `portfolio_url` in the contact line header. Add them as their own row below the contact line, only if they exist:

1. In `resume-template.tsx`, add a new conditional `<Text>` block below the `{contactLine}` section for the links line — already computed as `linksLine`.
2. Ensure the links only render if `linksLine` is truthy (either URL is present).
3. Use a slightly smaller fontSize than the main contact line to visually distinguish it.
4. Verify by generating a PDF with and without a LinkedIn URL in your profile.

**What to notice:** The template uses plain string concatenation (`filter(Boolean).join("  ·  ")`) rather than actual hyperlinks. @react-pdf supports `<Link>` from `@react-pdf/renderer` for clickable URLs. Research how `<Link>` works in @react-pdf and consider whether it would improve the template.

---

### Challenge 3 — Design: progress indicator for generation (30–45 min)

Resume generation takes 3–7 seconds (Gemini call + render). Currently the user sees a spinner on the Generate button with no indication of which step is in progress. Design a two-phase progress indicator without implementing it.

Answer these questions first:

1. The current route is a single POST that does everything. What architectural change would allow reporting progress mid-operation?
2. How would you surface phase status to the client — polling, streaming, WebSockets, or something else?
3. What would the UI look like? (three states: "Polishing content...", "Rendering PDF...", "Uploading...")
4. What's the minimum code change that would give the user *some* additional feedback without restructuring the route?

<details>
<summary>Hint for question 4</summary>

The simplest feedback improvement that requires no architectural change: use the `isGenerating` state to show a message like "This usually takes 5–10 seconds..." below the spinner. No streaming, no polling — just text that sets expectations. A two-phase indicator requires either splitting the route into two endpoints (generate → then upload) or using streaming responses (`ReadableStream`) from the Next.js route.

</details>

---

For deeper exploration, `docs/plan/08-resume-pdf-generation/ai-discussion-topics.md` has 18 prompts across end-to-end data flow, @react-pdf rendering constraints, the Buffer→Blob type mismatch, storage replace patterns, and architectural invariants. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
