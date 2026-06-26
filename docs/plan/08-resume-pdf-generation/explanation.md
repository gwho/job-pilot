# Explanation — Feature 08: Resume PDF Generation from Profile

## 1. The full data flow from button click to PDF in the user's browser

When the user clicks "Generate Resume from Profile," `handleGenerate()` fires in `ProfileForm.tsx`. It calls `startGenerate(async () => {...})` — a React `useTransition` that keeps the UI responsive while the async work runs. Inside, it fetches `POST /api/resume/generate`.

The route handler in `app/api/resume/generate/route.ts` runs server-side:

1. It calls `createInsforgeServer()` and authenticates the user. If there's no session, it returns 401 immediately.
2. It fetches the full profile row with `.select("*")`. This is the *saved* state — the form's current unsaved changes are not included. This is a fundamental constraint of API routes: they have no access to client state.
3. It checks `profile.is_complete`. If false, it returns 400. This is a server-side guard that backs up the client-side `disabled` attribute on the button.
4. It calls `generateResumePdf(profile)` from `agent/pdf-generator.tsx`.

Inside the agent, two things happen in sequence. First, a Nemotron call via the OpenAI-compatible endpoint produces a `ResumeContent` JSON object — containing a `summary` paragraph and `workExperience` array with polished bullets. Second, `renderToBuffer(<ResumeDocument profile={profile} content={content} />)` renders the @react-pdf template into a binary PDF buffer.

Back in the route, the buffer is converted to a `Blob` and uploaded to InsForge Storage at `{userId}/resume.pdf`. Then the `profiles` table is updated with the new `resume_pdf_key`, `resume_pdf_url`, and `resume_pdf_filename` ("AI Generated Resume.pdf"). The route returns `{ success: true }`.

Back in `ProfileForm`, the `generateResult` state updates to `{ success: true }`, the inline success message appears ("Resume generated — click 'View current resume' to open it"), and `resumeFileName` updates to "AI Generated Resume.pdf". The user then clicks "View current resume" — which calls `getResumeSignedUrl()` Server Action — to receive a time-limited signed URL and open the PDF.

## 2. Why @react-pdf/renderer needs serverExternalPackages

Next.js with Turbopack bundles server-side code by default — it traces module imports and packages them at build time. Most packages work fine with this. But `@react-pdf/renderer` internally depends on `pdfkit`, which has complex module resolution: native bindings, non-standard ESM/CJS internal structure, and dynamic `require()` calls that bundlers cannot statically trace. When Turbopack tries to bundle it, it fails to resolve pdfkit's internal graph and throws a build-time error.

The fix is `serverExternalPackages: ["@react-pdf/renderer"]` in `next.config.ts`. This tells Next.js: don't try to bundle this package — let Node.js resolve it at runtime the normal way, via `node_modules`. The package is loaded on demand when the route runs, bypassing the static analysis entirely.

This is the identical fix applied to `pdf-parse` in Feature 07. Both packages have the same root cause: they are Node.js packages with internal module structures that Turbopack's bundler cannot statically resolve. The general pattern is: any server-only package that uses native bindings, non-standard ESM, or dynamic internal requires will need this treatment. It can be diagnosed by the build error message — "cannot resolve module X" or "module X has no exports" — where X is an internal module path, not the top-level package.

## 3. The Buffer → Blob conversion: why it was needed and exactly how it works

`renderToBuffer` from `@react-pdf/renderer` returns `Promise<Buffer>`. A Node.js `Buffer` is a subclass of `Uint8Array` — it's a typed array of bytes. InsForge SDK's `storage.upload()` is typed as `upload(path: string, file: File | Blob)`. It does not accept a `Buffer`.

The first attempt was simply passing the buffer directly:
```typescript
.upload(storagePath, result.buffer)  // TypeScript error: Buffer not assignable to File | Blob
```
TypeScript correctly rejected this because `Buffer` is `Uint8Array<ArrayBufferLike>`, and `File | Blob` requires something different.

The second attempt was wrapping it in `new Blob([result.buffer], { type: "application/pdf" })`. This also failed:
```
Type 'Buffer<ArrayBufferLike>' is not assignable to type 'BlobPart'.
Type 'Buffer<ArrayBufferLike>' is not assignable to type 'ArrayBufferView<ArrayBuffer>'.
Types of property 'buffer' are incompatible.
  Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
    Type 'SharedArrayBuffer' is missing the following properties...
```

This error reveals the exact problem. `Blob`'s constructor accepts `BlobPart[]`, and `BlobPart` includes `ArrayBufferView<ArrayBuffer>`. A `Buffer`'s `.buffer` property is typed as `ArrayBufferLike` — a union of `ArrayBuffer | SharedArrayBuffer`. TypeScript's type system sees that `ArrayBufferLike` might be `SharedArrayBuffer`, which `Blob` doesn't accept, so it rejects the type.

The fix:
```typescript
const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
```

`new Uint8Array(typedArray)` — when passed another typed array as its argument — creates a **copy** of the data with its own fresh `ArrayBuffer`. The resulting object's `.buffer` property is typed as `ArrayBuffer` (not `ArrayBufferLike`), which satisfies `BlobPart`. TypeScript accepts it, and the upload works.

The conceptual rule this reveals: when bridging Node.js `Buffer` to a Web API that expects `Blob` or `ArrayBuffer`, always go through `new Uint8Array(buffer)` first. The copy is small overhead for a PDF (typically < 1 MB), and the type safety is correct.

## 4. Why InsForge upload() requires remove-then-upload, not upsert

The InsForge storage `upload()` signature is `upload(path: string, file: File | Blob)`. It has no options parameter — the third argument shown in the `@react-pdf/renderer` section of `context/library-docs.md` (`{ contentType: "application/pdf", upsert: true }`) was an error in that doc snippet. When the route was first written with three arguments, the build caught it: `Type error: Expected 2 arguments, but got 3.`

More importantly, `upload()` has no upsert behaviour at all. If a file already exists at the given path, InsForge silently renames the new file — the response `data.key` comes back as `resume1.pdf` instead of `resume.pdf`. If that key were saved to the DB, every subsequent `getResumeSignedUrl()` call would reference `resume1.pdf`, the next generation would create `resume2.pdf`, and so on. Users would accumulate orphaned files in the storage bucket indefinitely, and the resume displayed after each generation would be whichever numbered copy the SDK chose.

The correct pattern — documented in the Storage section of `context/library-docs.md` and implemented in `actions/profile.ts:uploadResume` — is:
```typescript
if (profile.resume_pdf_key) {
  await insforge.storage.from("resumes").remove(profile.resume_pdf_key);
}
const { data: uploadData } = await insforge.storage.from("resumes").upload(path, blob);
```

Remove the existing file first, then upload fresh. The key after upload will always be the expected path. The `@react-pdf` example snippet in `library-docs.md` showed `upsert: true` — this was contradicted by both the Storage section of the same file and the real SDK type signature. The incorrect example should be treated as a copy-paste error that predated the actual storage patterns being established.

## 5. Why Nemotron uses temperature 0.7 for generation versus 0.3 for extraction

The project documents Nemotron configuration values in `context/library-docs.md` under "Temperature settings":

```
0.3 — matching, scoring, extraction, research synthesis — deterministic results
0.7 — resume generation — natural variation
```

The choice of temperature is not aesthetic — it follows from the task type. The extraction endpoint (Feature 07) takes an unstructured resume PDF and maps it to structured profile fields. There is one correct answer for what the user's name is, or what their current job title is. High repeatability matters — the same resume should extract the same fields every time. Low temperature minimizes variance in the output.

Resume generation is different in kind. The task is: take structured profile data and produce natural-sounding professional prose. The inputs are already structured and correct. The output quality metric is how natural and compelling the language sounds — not correctness. A summary paragraph generated at 0.3 reads formulaically: the same sentence patterns appear across different profiles because the model gravitates to the single most probable next token at every step. At 0.7, there's enough randomness that each generation reads differently and more naturally. The tradeoff — less repeatability — is acceptable because there's no "right answer" to check repeatability against.

Max tokens follows the same logic: extraction needs 800 (structured fields, compact JSON), resume generation needs 1000 (summary paragraph + 3 work entries × 3-4 bullets each ≈ 600-900 tokens for the content, plus JSON overhead). These values come from `library-docs.md` and should not be changed without updating that file.

## 6. Why is_complete is enforced in the route even though the button is disabled on the client

The Generate button has `disabled={!profile?.is_complete || isGenerating}` in `ProfileForm`. This prevents a normal user from clicking it with an incomplete profile — they can't interact with a disabled button.

But the route also checks:
```typescript
if (!profile.is_complete) {
  return NextResponse.json({ success: false, error: "Complete your profile before generating a resume" }, { status: 400 });
}
```

The client-side `disabled` attribute is a UX affordance. It can be bypassed by anyone with curl, Postman, the browser's developer tools, or any script that sends a `POST /api/resume/generate` request with a valid session cookie. The `disabled` attribute does not reach the server. Every API route must enforce its own preconditions independently.

Without the server-side check, a direct POST from an incomplete profile would: call Nemotron with empty work experience and missing fields, generate a PDF with mostly blank sections, upload it to storage, and update `resume_pdf_filename` to "AI Generated Resume.pdf" — leaving the user with a broken file they can't tell from a real one until they open it.

## 7. Why the PDF skills are in agent/ rather than components/ or app/api/

The project architecture has two clear rules:
- `agent/` — all agent logic (AI calls, PDF generation); no React UI
- `components/` — UI only; no DB calls, no AI calls

`@react-pdf/renderer` uses React components (`Document`, `Page`, `View`, `Text`) but these are not DOM components — they're specialised primitives that render to a binary PDF buffer, not to the browser. They are closer in nature to a server-side rendering library than to a UI component. Placing `resume-template.tsx` in `components/` would be incorrect: it's not a browser-rendered component, it's a PDF template used by an agent operation.

The route at `app/api/resume/generate/route.ts` is the entry point — it orchestrates the operation per the agent/API boundary. The actual rendering logic lives in `agent/`. This is consistent with how `app/api/profile/extract/route.ts` calls `agent/extractor.ts` for the AI work, rather than embedding Nemotron calls directly in the route.

## 8. Why pdf-generator.tsx is .tsx and not .ts

`renderToBuffer` takes a React element. The call:
```tsx
const buffer = await renderToBuffer(<ResumeDocument profile={profile} content={content} />);
```
uses JSX syntax (`<ResumeDocument ... />`). JSX can only appear in files with a `.tsx` (or `.jsx`) extension when the TypeScript `jsx` compiler option is set to `"preserve"` (which Next.js uses). Renaming to `.ts` would cause the build to fail with a parse error on the JSX expression.

An alternative would have been `React.createElement(ResumeDocument, { profile, content })` in a `.ts` file. This is semantically identical — JSX is just syntactic sugar for `createElement`. But it's less readable, departs from the project's JSX style, and offers no benefit. Since the file conceptually "renders" a component, `.tsx` is the right choice.

## 9. Pre-existing bugs fixed during the build verification pass

### app/practice-01/page.tsx — missing export default

Build error: `Type error: Property 'default' is missing in type 'typeof import(".../practice-01/page")'`

This file was a leftover from a saboteur skill practice session. The intentional bug was that the page function was exported as a named export (`export function PracticePage`) instead of a default export. Next.js App Router requires every `page.tsx` to have a `export default` function — it's what the framework calls when routing to that path. The fix was one keyword: `export function` → `export default function`. This unblocked the build without affecting any Feature 08 code.

### app/actions/auth.ts — signOut() returns no data

Build error at line 91: `Type error: Property 'data' does not exist on type '{ error: InsForgeError | null; }'`

The InsForge `auth.signOut()` returns only `{ error }` — there is no `data` field. The code was destructuring `const { data, error } = result` and then calling `void data` (presumably to suppress an unused variable warning). The `void data` was a sign this field was expected but not actually used — the pattern was likely copied from a DB query or `getCurrentUser()` call that does return data, without checking whether `signOut` does too.

Fix: removed `data` from the destructuring, leaving only `const { error } = result`. The `void data` line was removed as well. This pre-existing bug had been blocking any production build since the auth module was written — it was masked by dev server (`next dev`) not running full TypeScript checking.
