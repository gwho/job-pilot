# Tutorial 13 — Resume PDF Generation Architect Deep-Dive: Boundaries, Bundling, Temperatures, and the Plan Alignment Step

**After completing this tutorial you will understand:** why the architectural boundary between Server Actions and API routes made every file placement in this feature unambiguous, how `serverExternalPackages` generalizes beyond the `pdf-parse` story from Tutorial 12 to any package with complex Node.js internals, why the task type — not the developer's preference — determines Gemini's temperature setting, why persisting a storage path is always safer than persisting a signed URL for private buckets, and how the architect plan alignment step caught four wrong values before a single line of code was written.

This tutorial is based on the architect session in
[`docs/architect/08-resume-pdf-generation/`](../../architect/08-resume-pdf-generation/) and the implementation it produced, which is covered step-by-step in Tutorial 14.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 11 (`11-profile-extraction-architect-deep-dive/README.md`) — the prior architect deep-dive. This tutorial follows the same structure and builds directly on the API route vs Server Action framework established there.
> - Tutorial 12 (`12-pdf-parse-v2-migration/README.md`) — covers `serverExternalPackages` in depth from the build-error angle. Part 2 of this tutorial generalizes that mechanism to a second package.
>
> Open [`docs/architect/08-resume-pdf-generation/decisions.md`](../../architect/08-resume-pdf-generation/decisions.md),
> [`docs/architect/08-resume-pdf-generation/discussion.md`](../../architect/08-resume-pdf-generation/discussion.md),
> [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx),
> [`agent/resume-template.tsx`](../../../agent/resume-template.tsx),
> [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts), and
> [`next.config.ts`](../../../next.config.ts) alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these five prompts before touching any code. Budget 30–40 minutes. Do not paste project code — keep the conversations in plain concepts.

### Concept 1 — Why architects read code before planning

> "I'm about to plan a new feature for a codebase that already has 7 implemented features. Explain why the first step of planning should be reading the existing code — specifically, what categories of information can only be discovered by reading the code and not by thinking through the feature in the abstract? Give me a list of five things I might plan incorrectly if I skipped the code-reading step. Then quiz me: give me a scenario where a developer skipped code-reading and ask me to predict what went wrong."

*What to listen for:* The key categories are: existing patterns that must be followed for consistency, SDK APIs whose behavior differs from general documentation, configuration values specific to the project, and abstractions that already exist and shouldn't be re-invented. Each of these is something that general knowledge gets wrong and codebase knowledge gets right.

*Practice question:* A project has an existing pattern for file uploads: `remove(key)` then `upload(path, blob)`. A new developer plans the PDF generation feature and writes `upload(path, blob, { upsert: true })`. What did they skip, and what will break?

---

### Concept 2 — Turbopack bundling vs Node.js runtime resolution

> "Explain the difference between a JavaScript bundler and the Node.js runtime module resolver. When I write `import X from 'some-package'` in a server route, which one resolves it during the build phase and which one resolves it at runtime? What is `serverExternalPackages` in Next.js, and what specific hand-off does it cause? Give me a concrete before-and-after: what Turbopack does without it, what Node.js does with it. Then quiz me on which layer each fix operates on."

*What to listen for:* The bundler (Turbopack) does static analysis at build time — it follows import graphs and packs code. `serverExternalPackages` tells the bundler to skip a specific package entirely, leaving it as a runtime external. Node.js then resolves it at runtime using `require()` semantics — the `"require"` condition in the package's exports map, not the `"import"` condition Turbopack would use.

*Practice question:* A package has both an `"import"` condition (ESM) and a `"require"` condition (CJS) in its exports map. Without `serverExternalPackages`, which condition does Turbopack use? With it, which condition does Node.js use at runtime?

---

### Concept 3 — LLM temperature and the nature of the task

> "In language model APIs, there's a `temperature` parameter between 0 and 1. Explain how it affects output without using jargon about 'randomness' — explain it from the user's perspective: what does 0.1 output look like compared to 0.9 output, for the same prompt? Then give me four different AI tasks (extraction, classification, professional writing, creative writing) and explain which temperature range is appropriate for each and why. Quiz me with scenarios."

*What to listen for:* Low temperature makes the model gravitate to the single most likely next token at every step — producing consistent, formulaic, sometimes robotic output. High temperature introduces variation — the same prompt produces different output each time. For extraction, you want the same input to produce the same structured output every run. For professional writing, you want natural-sounding variation. The criterion is: does the task have a right answer (→ low temperature) or is the quality metric how natural and varied the output sounds (→ higher temperature)?

*Practice question:* You have two Gemini calls: one that reads a resume PDF and extracts the candidate's years of experience as a number, and one that writes a 2-sentence professional summary from structured profile data. Which gets temperature 0.3 and which gets 0.7? Why?

---

### Concept 4 — Private storage buckets and signed URLs

> "Explain what a 'signed URL' is for a private file storage bucket. What does it contain, why does it expire, and why can't the server just give the browser a permanent link to a private file? Then walk me through the trade-off: if I need to show the user their file frequently, should I store the signed URL in the database or store the file path and generate a fresh signed URL on demand? What breaks with each approach over time?"

*What to listen for:* A signed URL encodes access permissions and an expiry timestamp into the URL itself. Once expired, the URL produces a 403. Storing an expiring URL in the DB creates a time-bomb: the stored value becomes stale and useless. Every read must then check if the URL is still valid and regenerate it if not — adding round-trips and conditional logic. Storing the file path instead treats the signed URL as a presentation concern generated at the moment of use.

*Practice question:* A resume storage bucket is private. A user views their resume. Should the signed URL generation happen in the database row or in the Server Action that handles the "View" button click? Why?

---

### Concept 5 — The Yoga layout engine vs browser CSS

> "Explain what the Yoga layout engine is and how it differs from browser CSS. It's used in React Native — what CSS properties does it NOT support, and how does this affect rendering? Specifically: what happens if you try to render a horizontal row of items that should wrap onto a second line when they overflow? Give me a concrete example of a CSS property that works in a browser but does nothing in Yoga, and explain how you'd achieve the same visual result without that property."

*What to listen for:* Yoga is a Flexbox implementation designed for mobile — it deliberately omits `flexWrap` because mobile layouts historically didn't wrap like web grids. Without `flexWrap`, a `<View style={{ flexDirection: 'row' }}>` containing multiple children will overflow rather than wrap. The workaround for tag-like content is to render a single text node with all items joined by a visible separator character, letting the text rendering engine handle wrapping naturally.

*Practice question:* You want to render a list of skill tags like "React • TypeScript • Node.js" in an @react-pdf template. You try `<View flexDirection="row">{skills.map(s => <Text>{s}</Text>)}</View>`. What happens in the rendered PDF, and how do you fix it?

---

## The eight decisions at a glance

The architect session for Feature 08 produced seven implementation decisions plus one process decision. Each one governs a different layer of the feature:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Decision 1: Operation category                                      │
│  AI call → API route + agent/, not Server Action                     │
│                                                                      │
│  Decision 2: Completeness gate                                       │
│  Hard-disabled button when profile.is_complete = false               │
│                                                                      │
│  Decision 3: Storage write pattern                                   │
│  remove() then upload() — no upsert; matches existing pattern        │
│                                                                      │
│  Decision 4: What to persist in the DB                               │
│  Storage path, not signed URL — signed URLs expire                   │
│                                                                      │
│  Decision 5: Gemini config                                           │
│  temperature 0.7, max_tokens 1000 — per library-docs.md             │
│                                                                      │
│  Decision 6: Skills rendering in PDF                                 │
│  skills.join(" • ") in one <Text> — Yoga has no flexWrap            │
│                                                                      │
│  Decision 7: Skill update                                            │
│  /architect SKILL.md updated to mandate reading library-docs.md      │
│                                                                      │
│  Process finding: Plan alignment step caught 4 wrong values          │
│  before implementation began                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**The three invariants that cross all decisions:**

- Agent code in `agent/` never imports from `components/` or `actions/` — PDF generation belongs there, not in `app/api/` directly
- All four Gemini configuration values come from `context/library-docs.md` — never from general knowledge
- The `resumes` bucket is private; signed URLs are generated on demand, never persisted

---

## Part 1 — The architectural boundary that made every file placement obvious

Open [`docs/architect/08-resume-pdf-generation/discussion.md`](../../architect/08-resume-pdf-generation/discussion.md),
"The Architectural Boundary That Drives Every File Placement":

```
Server Actions (actions/) handle UI-triggered mutations: save profile, upload file,
sign out. They take form data, write to the DB, and call revalidatePath(). They
never call agent code.

API Routes (app/api/agent/, app/api/profile/, app/api/resume/) handle agent
operations: things that call Gemini, Adzuna, Browserbase. They run heavier logic
and return JSON.

This isn't just convention — it's stated as a project invariant in
context/architecture.md. When Feature 08 came up, the correct file placement for
the route handler was immediately clear: it calls Gemini, so it belongs in
app/api/. No deliberation required.
```

And from [`CLAUDE.md`](../../../CLAUDE.md), the three data flows in the codebase:

```
UI mutations → Server Action in actions/ → InsForge DB write → revalidatePath()
Agent operations → API route in app/api/agent/ → function in agent/ → Gemini/Adzuna → DB write
Company research → app/api/agent/research → agent/research.ts → Browserbase/Stagehand → dossier saved
```

Resume generation required no decision at all about placement once the boundary was understood. The operation calls Gemini — it is an agent operation. Its route belongs in `app/api/resume/`. Its implementation function belongs in `agent/`. This is the value of an established boundary: it eliminates a whole category of deliberation. There's nothing to argue about because the criterion — "what does this operation do?" — has one answer.

The question the architect session didn't need to ask: should this be a Server Action? This question is unambiguous when you know the rule. `actions/profile.ts:uploadResume` is a Server Action because it writes a file reference to the DB — a pure mutation. `generateResumePdf` calls Gemini and renders a PDF buffer — it is an agent operation.

As covered in Tutorial 11 Part 1, the long-term cost of violating this boundary is compounding. Every future feature looks at existing code for precedent. If resume generation lived in `actions/`, the next AI feature would have a plausible precedent to join it. After four AI features in `actions/`, the folder contains both DB mutations and AI operations — it has become structurally unreadable.

**Checkpoint:** This project separates Server Actions (`actions/`) from API Routes (`app/api/`). Why does resume generation belong in an API route rather than a Server Action? What's the specific project invariant that makes this unambiguous?

<details>
<summary>Reveal answer</summary>

Resume generation calls Gemini and `@react-pdf/renderer` — it is an agent operation. The project invariant from `CLAUDE.md`: "Server Actions never call agent functions — only API routes do." The boundary is drawn at what the operation *does*, not how it is triggered or whether it eventually writes to the DB.

A Server Action *technically could* call Gemini — Next.js doesn't prevent it. But the project's stated invariant prohibits it. Violating it would blur the distinction between `actions/` (DB mutations) and `app/api/` (agent operations), degrading the navigability of the codebase for every future feature.

</details>

**Checkpoint:** The existing resume *upload* uses a Server Action (`actions/profile.ts:uploadResume`), but the resume *generation* uses an API route. These are both "resume operations" — why should they be in different places?

<details>
<summary>Reveal answer</summary>

`uploadResume` receives a file from the client and writes it to InsForge Storage + updates the `profiles` DB row. That is a UI-triggered mutation with no external AI/API call — exactly what `actions/` is for.

`generateResumePdf` calls Gemini to write professional copy and `@react-pdf/renderer` to render a PDF buffer. It is an agent operation. The fact that both operate on a resume file is a semantic coincidence — the structural category is determined by what the operation does, not what it operates on. One is a mutation; the other is an agent operation.

</details>

**Checkpoint:** How would you explain the "two sides of the boundary" rule to a new developer joining this project? What question can they ask about any new piece of code to know which side it belongs on?

<details>
<summary>Reveal answer</summary>

The question: "Does this code call an external AI model or third-party agent API (Gemini, Adzuna, Browserbase)?" If yes → API route + `agent/` function. If no, and it writes to the DB or storage in response to a user action → Server Action in `actions/`. If it reads data for a page render → Server Component data fetch.

The question the boundary does NOT ask: "how is it triggered?" (both Server Actions and API routes can be triggered by button clicks). The boundary is about *what the operation does*, not *how it is invoked*.

</details>

**Checkpoint:** The architecture says "Server Actions never call agent functions — only API routes do." Why is this a useful rule as a codebase grows? What would happen over time if Server Actions were allowed to call Gemini directly?

<details>
<summary>Reveal answer</summary>

Architecture rules derive their value from consistency — they only pay off when every new feature follows them. If Server Actions can call Gemini directly, `actions/profile.ts` becomes a catch-all where both `saveProfile` (DB upsert, ~20 lines) and a Gemini call (prompt, API, JSON parse, ~60 lines) coexist. The next developer scans `actions/` looking for the AI code — it might be there, or in `app/api/`, or in `agent/`. They have to read every file to know.

After five features: `actions/` contains DB mutations, AI calls, file operations, and Server Actions with side effects. None of the folder names mean anything anymore. The rule exists to prevent this specific degradation.

</details>

**Try it yourself:** Open [`actions/profile.ts`](../../../actions/profile.ts). Read the first line of each exported function. Confirm that every function either writes to the DB, reads from storage, or reads the DB — none of them calls Gemini or any external AI API. This folder's contents are its invariant.

---

## Part 2 — `serverExternalPackages`: the same fix for the same root cause

Open [`next.config.ts`](../../../next.config.ts):

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"],
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
```

`@react-pdf/renderer` was added alongside `pdf-parse` — two packages, one configuration line, the identical fix. As covered in depth in Tutorial 12, `serverExternalPackages` tells Turbopack to not bundle the listed packages, letting Node.js resolve them at runtime via `require()` semantics.

`@react-pdf/renderer` needs this treatment for the same root cause as `pdf-parse`: it internally depends on `pdfkit`, which has complex module resolution — native bindings, non-standard ESM/CJS internal structure, and dynamic `require()` calls that Turbopack's static analysis cannot trace at build time. When Turbopack tries to bundle it, it fails to resolve `pdfkit`'s internal dependency graph and throws a build error.

This generalizes to a class of packages: **any server-only package that uses native bindings, relies on file-system layout assumptions, or uses dynamic `require()` internally will need `serverExternalPackages`**. The diagnostic signal is a build error message like "cannot resolve module X" or "module X has no exports" where X is an internal module path (not the top-level package name).

The pattern can be detected pre-emptively. Before installing a new server-only package, check:
1. Does its `package.json` have an `exports` map with an `"import"` condition?
2. Does the `"import"` condition resolve to an ESM entry that re-exports from a rendering engine or low-level native module?
3. Does the package use `fs`, `Buffer`, or native addons?

If any of these are true, add it to `serverExternalPackages` at the same time you install it.

**Checkpoint:** What is `serverExternalPackages` in Next.js and when should you use it? What happens when you *don't* add a problematic package to this list?

<details>
<summary>Reveal answer</summary>

`serverExternalPackages` tells Turbopack to skip bundling a specific package. Without it, Turbopack follows the `"import"` condition in the package's exports map (ESM semantics), which for packages like `pdf-parse` and `@react-pdf/renderer` resolves to entries that don't export a usable default or are wrappers around native/rendering internals. The build fails with "Export default doesn't exist" or similar.

With it: Turbopack emits the package as a native `require()` call in its output. At runtime, Node.js resolves `require("@react-pdf/renderer")` using the `"require"` condition → CJS entry → correct exports. The package is never bundled; it's loaded on demand by Node.js the normal way.

</details>

**Checkpoint:** `@react-pdf/renderer` and `pdf-parse` are both in `serverExternalPackages`. What do they have in common that makes them need this treatment? Is there a general class of packages that require it?

<details>
<summary>Reveal answer</summary>

Both depend on packages with complex internals that Turbopack cannot statically resolve:
- `pdf-parse` depends on `pdfjs-dist` (a PDF rendering engine with native bindings)
- `@react-pdf/renderer` depends on `pdfkit` (a PDF generation engine with native bindings and file-system assumptions)

The general class: server-only packages with native bindings (`.node` files), packages that use `fs`/`path`/`__dirname` in ways that assume a specific file-system layout, and packages whose ESM exports map resolves to rendering engine internals rather than a usable API. The common thread: they were designed to run in Node.js's native module system, not inside a bundled artifact.

</details>

**Checkpoint:** Feature 07 encountered the exact same bundling issue with `pdf-parse`. What should a developer look for in a new package's documentation or `package.json` that would hint they'll need `serverExternalPackages` before even trying to install it?

<details>
<summary>Reveal answer</summary>

In `package.json`: (1) `"type": "module"` on a package that historically was CJS — signals a major internal restructuring; (2) an `exports` map with an `"import"` condition pointing to an `esm/` directory — means Turbopack will try to bundle the ESM entry, which may not export what you need; (3) a `dist/` folder with separate `cjs/` and `esm/` subdirectories — the dual-publish pattern means the ESM entry may be optimized for browsers, not Node.js bundling.

In documentation: phrases like "Node.js only", "native addon", "requires Node.js runtime" are signals the package was never intended to be bundled.

</details>

**Checkpoint:** Why does `serverExternalPackages` only affect server-side rendering? Could a client-side component ever face the same issue, and if so, how would you handle it differently?

<details>
<summary>Reveal answer</summary>

`serverExternalPackages` only applies to server-side code because it relies on Node.js being present at runtime to resolve the package. Client-side bundles run in the browser — there is no Node.js runtime, no `require()`, no native modules. A client-side component importing `@react-pdf/renderer` would fail for a different reason: the browser doesn't have `fs`, `Buffer`, or the native bindings `pdfkit` needs.

For client-side bundling issues, the approach is different: dynamic `import()` with `next/dynamic` and `{ ssr: false }` to exclude a package from both SSR and client bundles, or simply ensuring server-only packages are never imported in client components. The `"use client"` boundary prevents this category of error from reaching client bundles if the import tree is structured correctly — server-only packages should never appear below a `"use client"` boundary.

</details>

**Try it yourself:** Temporarily comment out `"@react-pdf/renderer"` from `serverExternalPackages` in `next.config.ts` and run `npm run build`. Observe the error message — it will name a specific internal file from `pdfkit` or `@react-pdf/renderer` that Turbopack couldn't resolve. Restore the line and run again to confirm the build passes.

---

## Part 3 — Two Gemini roles, two temperatures: what the task tells you

Open [`docs/architect/08-resume-pdf-generation/discussion.md`](../../architect/08-resume-pdf-generation/discussion.md),
"The Two Roles Gemini Plays in This Feature":

```
In Feature 07 (extraction), Gemini played a parsing role: read unstructured text
(resume PDF), output structured data (profile fields). Low temperature (0.3) was
correct because the goal is precision — the same resume should always produce the
same extracted fields.

In Feature 08 (generation), Gemini plays a writing role: take structured data
(profile fields), output natural language (summary paragraph, polished bullets).
Higher temperature (0.7) is correct because the goal is natural-sounding prose —
a little variation produces better-sounding text than robotically identical output.
```

And from [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx), the Gemini call:

```typescript
const response = await openai.chat.completions.create({
  model: "gemini-2.5-flash-lite",
  response_format: { type: "json_object" },
  temperature: 0.7,
  max_tokens: 1000,
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ],
});
```

Compare to [`agent/extractor.ts`](../../../agent/extractor.ts)'s Gemini call, which uses `temperature: 0.3`. These aren't arbitrary values — they express the fundamental nature of the task.

The temperature mapping follows directly from the task type:

```
Task type          Temperature    Reason
──────────────     ──────────     ──────────────────────────────────────
Extraction         0.3            Same input must produce same output
Classification     0.1–0.2        One correct answer exists
Professional       0.7            Variation improves naturalness
  writing
Creative writing   0.7–1.0        High variation is the explicit goal
```

Extraction asks: "what is in this text?" There is one right answer. If the user's name is "Alex Chen" in the PDF, Gemini should return "Alex Chen" every time. A temperature of 0.7 for extraction would produce `"Alex"` on one call and `"A. Chen"` on another — both plausible, both wrong because the user can't rely on the results.

Generation asks: "write a compelling professional summary for this candidate." There is no single right answer. A sentence generated at 0.3 would read formulaically — the same sentence structure appears across every profile because the model collapses on the single most probable token sequence. At 0.7, the model explores more of the probability space, producing prose that sounds written rather than assembled.

The `max_tokens` setting follows the same logic: extraction needs 800 (structured fields, compact JSON); generation needs 1000 (a 2-3 sentence summary paragraph plus work experience bullets with context). These values come from `context/library-docs.md`, not from guessing.

**Checkpoint:** This feature uses temperature 0.7 for resume writing, while the extraction feature (Feature 07) uses 0.3. What's the reasoning behind this difference? What would a resume generated at 0.3 tend to look like vs. 0.7?

<details>
<summary>Reveal answer</summary>

The task type determines the temperature. Extraction has a correct answer — the same resume should produce the same structured output every run. Temperature 0.3 maximizes repeatability. Generation has no single correct answer — the quality metric is how natural and compelling the prose sounds. Temperature 0.7 introduces enough variation that the model produces prose that reads naturally rather than formulaically.

A resume generated at 0.3 would sound robotic: "Results-driven software engineer with 5 years of experience in React and TypeScript." The same sentence structure appears across profiles because at low temperature, the model gravitates to the most statistically common phrasing. At 0.7: "Alex brings seven years of building high-throughput APIs to teams that need reliability at scale." Same facts, naturally varied expression. The difference is audible to any reader.

</details>

**Checkpoint:** Why does the project document Gemini configuration values in `context/library-docs.md` rather than leaving them as inline comments in the code? What problem does that solve?

<details>
<summary>Reveal answer</summary>

Inline comments are file-local — a developer writing a new feature never reads the comments inside existing agent files. `context/library-docs.md` is the single source of truth for project-specific third-party configuration. It's read during the architect session before planning, which means wrong values are caught before implementation begins.

The architect session for Feature 08 initially planned temperature 0.5 and max_tokens 1500 — values inferred from general knowledge rather than from reading `library-docs.md`. When the plan was reviewed against the doc, both were corrected before any code was written. If these values were in inline comments instead, the new feature would simply use different (wrong) values with no mechanism to catch the inconsistency.

</details>

**Checkpoint:** The `ResumeContent` interface defines exactly what Gemini must return (`summary`, `workExperience` with `bullets`). What breaks if Gemini returns a differently shaped JSON? How does the `response_format: { type: "json_object" }` setting help, and what doesn't it guarantee?

<details>
<summary>Reveal answer</summary>

If Gemini returns a differently shaped JSON — say, `{ summary: "...", experience: [...] }` instead of `{ summary: "...", workExperience: [...] }` — `JSON.parse(raw) as ResumeContent` would succeed at runtime (TypeScript `as` casts do not validate). Then `content.workExperience` would be `undefined`. In `resume-template.tsx`, the guard `content.workExperience && content.workExperience.length > 0` would prevent rendering, but the Experience section would simply be absent from the PDF with no error.

`response_format: { type: "json_object" }` guarantees the output is valid JSON (not markdown-wrapped JSON, not a prose explanation). It does NOT guarantee the JSON has any particular shape. Only the system prompt's explicit JSON schema instruction and the `as ResumeContent` cast at the call site define the expected shape.

</details>

**Checkpoint:** Why is `max_tokens: 1000` a reasonable limit for resume content? What would happen to the PDF if Gemini returned 3000 tokens? What would happen if it returned 200?

<details>
<summary>Reveal answer</summary>

The target is a single-page PDF. A professional summary (2-3 sentences ≈ 60-80 tokens) plus three work experience entries with 3-4 bullets each (≈ 700-900 tokens total for content), plus JSON structural overhead, fits comfortably in 1000 tokens.

At 3000 tokens: Gemini would produce more work entries, longer bullets, or more elaborate summary prose than a single page can contain. The PDF would overflow — `@react-pdf/renderer` continues rendering past the page boundary rather than truncating, producing a multi-page document. At 200 tokens: the JSON would be truncated mid-structure, `JSON.parse()` would throw a `SyntaxError`, the `catch` block would return `{ success: false }`, and the user would see the error state. This would be caught immediately in testing.

</details>

**Try it yourself:** Open [`context/library-docs.md`](../../../context/library-docs.md). Find the Gemini temperature configuration section. Confirm that temperature 0.7 / max_tokens 1000 for resume generation and temperature 0.3 for extraction are both documented there. This is the source of truth — the architect session reads this file before proposing any configuration values.

---

## Part 4 — Never persist derived, expiring values: the path-not-URL decision

Open [`docs/architect/08-resume-pdf-generation/decisions.md`](../../architect/08-resume-pdf-generation/decisions.md), Decision 4:

```
After upload, the profile is updated with:
  resume_pdf_url: `${userId}/resume.pdf`  // same value as resume_pdf_key
  resume_pdf_key: `${userId}/resume.pdf`
No "real" URL is persisted. Signed URLs are generated on-demand by getResumeSignedUrl().

Why this choice: The resumes bucket is private. Signed URLs expire (1 hour in this
project). Persisting an expiring URL creates a time-bomb: the URL stored in the DB
is useless after an hour. Storing the storage path instead is permanent and always
accurate. The signed URL is generated fresh whenever the user clicks "View current
resume."
```

And from [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts), lines 69–79:

```typescript
const { error: updateError } = await insforge.database
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

`uploadData.url` here is the storage path (`{userId}/resume.pdf`), not a signed URL. InsForge's `upload()` returns a `url` field in `uploadData` — but for a private bucket, this is the storage path used as a key reference, not a browser-accessible URL.

The general principle from the architect session's discussion: **never persist derived, expiring values in the DB. Persist the stable source (the path) and derive the ephemeral value (the signed URL) at the point of use.**

The alternative — persisting a signed URL with a long expiry — creates drift. The signed URL stored in `resume_pdf_url` is valid at upload time. After 1 hour, it returns 403. After 1 week (if a longer expiry were used), it still eventually expires. Every read of `resume_pdf_url` would need to: check if the URL is still valid, regenerate it if not, write the new URL back to the DB, then return it. That's three DB round-trips and conditional logic in every component that reads the resume URL. Storing the path eliminates this problem entirely.

The `resume_pdf_key` and `resume_pdf_url` columns holding the same value (`{userId}/resume.pdf`) is intentional and not redundant. The original schema intent: `resume_pdf_key` is always the storage key; `resume_pdf_url` might eventually hold a CDN URL if the bucket policy changes. For now, both hold the path. The extraction route uses `resume_pdf_key` to download the file; the display logic generates signed URLs also from the key. The columns exist for forward compatibility.

**Checkpoint:** This project stores `"{userId}/resume.pdf"` in `resume_pdf_url` — the storage path, not a real URL. Why is persisting a path better than persisting a signed URL for a private bucket?

<details>
<summary>Reveal answer</summary>

A signed URL encodes access permissions and an expiry timestamp. After expiry (1 hour in this project), the URL returns 403 — it's useless. Persisting it creates a time-bomb: the DB row becomes stale after an hour with no mechanism to detect or fix it, unless every reader implements "check expiry, regenerate if expired, write back to DB" — adding complexity to every read path.

The storage path never expires. It's the durable identifier. The signed URL is a presentation concern — it only needs to exist for the brief window when the user is viewing the file. Generating it on demand (in `getResumeSignedUrl()`) keeps the DB clean and eliminates the refresh problem.

</details>

**Checkpoint:** Both `resume_pdf_key` and `resume_pdf_url` hold the same value (`"{userId}/resume.pdf"`). What was the original intent of having two separate columns? When would they hold different values?

<details>
<summary>Reveal answer</summary>

`resume_pdf_key` was always intended as the storage key — the path used to retrieve the file from the bucket. `resume_pdf_url` was intended as a display URL — which might eventually be a CDN URL, a pre-signed URL, or a different URL format if the storage layer changed.

They would hold different values if: (1) the bucket were made public (then `resume_pdf_url` would be the permanent public URL); (2) the project moved to a CDN that assigns persistent URLs to stored objects; (3) the storage provider used different identifiers for keys vs URLs. For now, both hold the path because the bucket is private and signed URLs are generated on demand.

</details>

**Checkpoint:** The storage write uses `remove` then `upload` rather than `{ upsert: true }`. In what scenarios would `upsert: true` and remove-then-upload produce different outcomes? Why is consistency with the existing pattern valuable even if upsert would work?

<details>
<summary>Reveal answer</summary>

If InsForge's `upload()` had a `upsert: true` option, both approaches would overwrite the existing file. The difference is only observable when the upload fails after the remove: with remove-then-upload, the old file is gone and the new one wasn't created — the user has no resume file. This is a real failure mode, though uncommon.

The actual issue is that `upload()` has no upsert option — it auto-renames on conflict (`resume1.pdf`, `resume2.pdf`...). So the only correct approach is remove-then-upload. Beyond correctness, consistency with `actions/profile.ts:uploadResume` matters: a developer who sees two different storage patterns for the same operation has to understand why they differ. Using the same pattern removes that cognitive load.

</details>

**Checkpoint:** What happens if the `remove` step succeeds but the `upload` step fails? The file is deleted but the new one wasn't created. How would you handle this to avoid leaving the user with no resume file?

<details>
<summary>Reveal answer</summary>

The current route does not handle this case — if `upload` fails after `remove` succeeds, the user's old resume is gone and no new one exists. The route returns `{ success: false, error: "Failed to save generated resume" }` and the DB row is not updated, so `resume_pdf_key` still points to the old (now-deleted) file.

A more robust approach: check if `resume_pdf_key` exists before removing; if the upload fails, attempt to re-upload the old file (if the buffer is available). Or: use a temp path (`{userId}/resume-new.pdf`), upload to the temp path first, only delete the old file after the new one is confirmed uploaded, then rename. This "write new, verify, delete old" pattern eliminates the gap. The current implementation accepts the risk as acceptable for this use case — a failed generation is visible to the user immediately (error state shown), and they can try again.

</details>

**Try it yourself:** Open [`actions/profile.ts`](../../../actions/profile.ts). Find the `uploadResume` function. Confirm it uses the same remove-then-upload pattern that `app/api/resume/generate/route.ts` follows. This is the existing pattern the route mirrors — if you change one, you should change both to stay consistent.

---

## Part 5 — The Yoga layout engine and the flex-wrap problem

Open [`docs/architect/08-resume-pdf-generation/discussion.md`](../../architect/08-resume-pdf-generation/discussion.md),
"@react-pdf/renderer's Layout Engine and the Flex Wrap Problem":

```
@react-pdf/renderer does not use browser CSS. It uses Yoga — the same layout engine
that React Native uses. Yoga implements a subset of CSS Flexbox, but with meaningful gaps:

- No flexWrap support (confirmed in @react-pdf docs)
- No grid
- No overflow: auto for scrolling
- Text flow is handled differently
```

And from [`agent/resume-template.tsx`](../../../agent/resume-template.tsx), lines 170–178:

```tsx
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

A single `<Text>` element with all skills joined by ` • `. This is the correct workaround for Yoga's missing `flexWrap`.

The approach that looks correct but fails:

```tsx
// This breaks — skills overflow horizontally off the page
<View style={{ flexDirection: "row" }}>
  {skills.map(skill => <Text key={skill}>{skill}</Text>)}
</View>
```

In a browser, `flexDirection: "row"` with `flexWrap: "wrap"` produces a tag cloud that wraps onto multiple lines. In Yoga, there is no `flexWrap`, so the children simply continue to the right until they fall off the page. The symptoms in the rendered PDF: only the first few skills are visible; the rest are clipped at the page edge. No error is thrown — the layout is simply wrong.

The joined-string approach delegates wrapping to the text layout engine, which does support line breaks. `@react-pdf/renderer` correctly handles multi-line text within a single `<Text>` element — the text engine breaks lines at word boundaries when the content exceeds the available width. `profile.skills.join(" • ")` produces a single string that wraps naturally.

This constraint affects any list-like content in a PDF: skills, industries, tech stack tags, certifications. The pattern to follow: always join into a single string with a visual separator. Never attempt a flex row of individual elements unless you can guarantee they fit on one line (e.g., a company name and a date on the same row — that's a common `flexDirection: "row"` with `justifyContent: "space-between"` in the resume template, and it works because exactly two items always fit on one line).

**Checkpoint:** `@react-pdf/renderer` uses Yoga — the same layout engine as React Native — rather than browser CSS. What is Yoga, and why does it not support `flexWrap`? How is this different from what you'd expect in a browser?

<details>
<summary>Reveal answer</summary>

Yoga is Facebook's open-source Flexbox layout engine, designed for React Native's mobile rendering. Mobile layouts historically didn't need wrapping flex rows — screens are narrow enough that content stacks vertically. Yoga implements the Flexbox spec but explicitly omits `flexWrap` (and a few other properties) to keep it lightweight and focused on mobile use cases.

In a browser, `flexWrap: wrap` causes a flex container to wrap its children onto multiple lines when they overflow — essential for responsive grid-like layouts. In Yoga, children simply overflow their container without wrapping. A web developer who designs the skills section the "normal" way (individual tags in a flex row) gets a layout that looks fine in browser preview but breaks in the rendered PDF.

</details>

**Checkpoint:** The correct approach for rendering a list of skills in @react-pdf is `skills.join(" • ")` in a single `<Text>`. What would happen visually if you rendered individual `<Text>` elements in a `<View style={{ flexDirection: "row" }}>`?

<details>
<summary>Reveal answer</summary>

The individual `<Text>` elements would be laid out horizontally, left-to-right, with no wrapping. If the skills list is long enough to exceed the page width (which it almost certainly would for most professionals), the elements would continue past the right page margin and be clipped. The PDF would show the first 4-5 skills and then nothing — the remaining skills are technically rendered but outside the page boundary. There would be no error, no warning — just a visually truncated skills section.

</details>

**Checkpoint:** A PDF is a fixed-size document, not a scrollable webpage. How does this constraint change how you design a layout compared to a responsive web UI? What happens when content exceeds the page boundary in @react-pdf?

<details>
<summary>Reveal answer</summary>

In a web UI, overflow can scroll — content beyond the viewport is still accessible. In a PDF, the page boundary is physical. Content that exceeds the page in `@react-pdf/renderer` continues onto the next page automatically for some content types (long text blocks), or gets clipped silently for others (overflowing flex children). There is no CSS `overflow: auto` to scroll.

This changes layout decisions fundamentally: every section must be size-bounded. The single-page target requires the Gemini prompt to constrain output length (`"Keep the entire output concise — it must fit on a single-page PDF"`). Skills must join into a string. Long job titles may need truncation. These are constraints that don't exist in web UI design.

</details>

**Checkpoint:** The plan calls for "single-page PDF" as a target but with no hard cap on rendering. What specific Gemini prompt strategies could enforce one-page output? Is it better to constrain at the LLM level or the PDF rendering level?

<details>
<summary>Reveal answer</summary>

Gemini-level strategies in the current `SYSTEM_PROMPT`: "Keep the entire output concise — it must fit on a single-page PDF" and "bullets: 3-4 per role maximum" + "Keep each bullet under 20 words." These are soft constraints — Gemini follows them probabilistically, not deterministically.

PDF-level enforcement would require measuring rendered content height and truncating sections that overflow — feasible with `@react-pdf/renderer`'s page height constants, but significantly more implementation complexity. The current approach trusts Gemini to stay within bounds (usually correct for professional resumes) and accepts that edge cases (very long work histories) might produce two pages.

LLM-level constraints are simpler to implement and usually sufficient. PDF-level enforcement is more robust but adds substantial code. For a feature that targets single-page PDFs, LLM-level is the right first implementation — if users report overflowing PDFs, add render-level truncation then.

</details>

**Try it yourself:** Open [`agent/resume-template.tsx`](../../../agent/resume-template.tsx). Find the bullet rendering for work experience (lines 185–198). Notice that bullets use `<View style={styles.bulletRow}>` with `flexDirection: "row"` — a bullet dot and the text side by side. This works because exactly two items are on each row, and neither overflows. Compare this to the skills section, which uses a single `<Text>`. That's the distinction: known-bounded rows use flex row; potentially-long lists use joined text.

---

## Part 6 — The ResumeContent interface: a typed contract across two files

Open [`agent/resume-template.tsx`](../../../agent/resume-template.tsx), lines 6–14:

```typescript
export interface ResumeContent {
  summary: string;
  workExperience: Array<{
    company: string;
    title: string;
    period: string;
    bullets: string[];
  }>;
}
```

And [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx), lines 5 and 73:

```typescript
import { ResumeDocument, type ResumeContent } from "./resume-template";

const content = JSON.parse(raw) as ResumeContent;
```

`ResumeContent` is defined once in `resume-template.tsx` and imported by `pdf-generator.tsx`. This is the single source of truth for the shape that Gemini must return and that the PDF template must accept.

The interface spans three concerns: (1) what the Gemini system prompt instructs, (2) what the `as ResumeContent` cast asserts, and (3) what the PDF template renders. All three must agree on the same shape. If they disagree, one of two things happens:

- **If the system prompt drifts from the interface:** `JSON.parse(raw) as ResumeContent` succeeds (TypeScript `as` casts don't validate at runtime), but `content.workExperience` might be `undefined`. The template's `content.workExperience && content.workExperience.length > 0` guard would silently omit the Experience section.
- **If the template drifts from the interface:** TypeScript catches it at compile time — the template's `{job.bullets.map(...)}` would fail if `bullets` were renamed `responsibilities` in the interface.

The direction of the import matters: `pdf-generator.tsx` imports from `resume-template.tsx`, not the reverse. The template is the "source of shape" — it knows what it needs to render. The generator is the consumer — it asks for that shape from Gemini and casts the result. If the dependency ran the other way (template importing from generator), the generator would be both the producer and the definer of the shape — and any change to the generator's Gemini call would ripple into the template.

**Checkpoint:** The `ResumeContent` interface is defined in `agent/resume-template.tsx` and imported by `agent/pdf-generator.tsx`. Why is this the right direction for the import? What would break if the type were defined in `pdf-generator.tsx` and imported by `resume-template.tsx`?

<details>
<summary>Reveal answer</summary>

The template is the final consumer — it defines what structure it needs to render. The generator exists to produce content that satisfies the template. The natural ownership direction: the template defines the contract; the generator fulfills it. If the type were in `pdf-generator.tsx`, the generator would define the contract and the template would depend on the generator. This creates a semantic mismatch: the template needs data to render, but the type it depends on is co-located with the code that produces it, not with the code that uses it.

Practically: if `ResumeContent` moves to `pdf-generator.tsx`, changing the Gemini output format (reordering fields, renaming `workExperience` to `experience`) would require updating the type in the generator's file. The template would see a type change in its import, TypeScript would flag breakage, and the fix would happen. The direction doesn't change the compile-time safety — but it changes where the conceptual ownership lives.

</details>

**Checkpoint:** The Gemini prompt instructs "concise output" to help the PDF fit on one page. What other prompt engineering techniques could you use to control output length for PDF rendering?

<details>
<summary>Reveal answer</summary>

1. **Max word/character counts in the prompt:** "bullets: 3-4 per role maximum. Keep each bullet under 20 words." (already present in the current `SYSTEM_PROMPT`). Explicit limits are more reliable than vague "concise" instructions.
2. **Structural framing:** Specify exactly how many sections to produce: "Generate exactly one summary paragraph, exactly three work experience entries." If the profile has five jobs, Gemini should select the three most relevant.
3. **JSON schema constraints in the prompt:** List maximum array lengths: `"workExperience": [ ... ] // maximum 3 entries`. This communicates structural limits, not just length.
4. **Post-processing truncation:** After `JSON.parse`, truncate `content.workExperience.slice(0, 3)` and each `bullets.slice(0, 4)` regardless of what Gemini returned. This is a hard cap enforced in code, independent of the prompt.

The tradeoff: prompt constraints reduce cognitive load in code but are probabilistic. Code-level truncation is deterministic but can produce abrupt cuts mid-thought. Using both gives belt-and-suspenders coverage.

</details>

**Try it yourself:** Open [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx). Read the full `SYSTEM_PROMPT` string. Map each instruction to the corresponding field in `ResumeContent`: "summary" → `{ summary: string }`, "bullets" → `{ bullets: string[] }`, "period" → `{ period: string }`. The system prompt is a prose encoding of the TypeScript interface — any change to one requires updating the other.

---

## Part 7 — Hard-disabled, not soft-warned: the completeness gate design

Open [`docs/architect/08-resume-pdf-generation/decisions.md`](../../architect/08-resume-pdf-generation/decisions.md), Decision 2:

```
What: The "Generate Resume from Profile" button is disabled when
profile.is_complete === false, with a tooltip: "Complete your profile first."

Why this choice: Generating from an incomplete profile produces a degraded PDF —
missing name, email, or work experience means empty sections. A hard disable prevents
the user from wasting time and getting a confusing result.

Alternative cost: A soft warning (button enabled, toast on click) lets the user
proceed but risks generating a barely-useful resume. The resulting PDF might confuse
them ("why is my name missing?"). Hard disable sets a clear contract: fill in the
required fields, then generate.
```

And from [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), lines 668–685:

```tsx
<button
  type="button"
  onClick={handleGenerate}
  disabled={!profile?.is_complete || isGenerating}
  title={!profile?.is_complete ? "Complete your profile first." : undefined}
  className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
>
  {isGenerating ? "Generating..." : "Generate Resume from Profile"}
</button>
{generateResult?.success && (
  <p className="text-sm text-success mt-2">
    Resume generated — click &ldquo;View current resume&rdquo; to open it.
  </p>
)}
{generateResult && !generateResult.success && (
  <p className="text-sm text-error mt-2">{generateResult.error}</p>
)}
```

And from [`app/api/resume/generate/route.ts`](../../../app/api/resume/generate/route.ts), lines 34–39:

```typescript
if (!profile.is_complete) {
  return NextResponse.json(
    { success: false, error: "Complete your profile before generating a resume" },
    { status: 400 },
  );
}
```

The client-side `disabled` attribute is a UX affordance — it prevents the *typical user* from clicking the button with an incomplete profile. It does not prevent a technical user from sending `POST /api/resume/generate` directly via curl, Postman, or browser DevTools with a valid session cookie. The `disabled` attribute never reaches the server.

The server-side `is_complete` check is the real guard. Without it, a direct POST from an incomplete profile would: call Gemini with empty work experience and missing fields, generate a PDF with mostly blank sections, upload it, and update `resume_pdf_filename` to "AI Generated Resume.pdf" — leaving the user with a broken file that looks identical to a real one until they open it.

The "hard disable vs soft warning" decision is specific to this feature's failure mode. A soft warning on, say, an optional newsletter subscription is low-cost — the user proceeds, sees a minor UI artifact, and moves on. A degraded PDF is high-cost: it involves a multi-second Gemini call, a storage write, and a DB update, and produces a persistent artifact (the file in storage) that is wrong. The hard disable prevents a cost that the user would not understand ("why is my resume blank?").

**Checkpoint:** The Generate button is hard-disabled when `is_complete === false`. What specific form fields must be filled for `is_complete` to become true? Why were these particular fields chosen as the completeness bar?

<details>
<summary>Reveal answer</summary>

Open [`lib/utils.ts`](../../../lib/utils.ts) and find `calculateCompletion` to see the exact fields. Typically: `full_name`, `email`, `current_title`, `experience_level`, `years_experience`, and at least one entry in `work_experience`. These are the fields that would produce a visible gap in the PDF if missing — a resume with no name or no work experience is not usable. Fields like `phone`, `location`, and `portfolio_url` contribute to the completion percentage but may not be required for `is_complete = true`. The threshold was set to produce a minimum viable resume, not a perfect one.

</details>

**Checkpoint:** The alternative to hard-disable was "soft warning" — allow the click but show a warning toast. What's the specific user experience failure mode of a soft warning for resume generation that doesn't apply to, say, a soft warning for an email newsletter signup?

<details>
<summary>Reveal answer</summary>

The failure mode is a persistent, misleadingly-named artifact. If the user bypasses a soft warning and clicks Generate with an incomplete profile:
1. Gemini calls succeed (the profile has *some* data)
2. A PDF is rendered with empty Name header, no work experience section
3. The file uploads to storage
4. The DB updates `resume_pdf_filename` to "AI Generated Resume.pdf"
5. The UI shows success state

The user now has a file called "AI Generated Resume.pdf" in their storage that is effectively unusable. They click "View current resume", open it, and see a nearly-blank document. Nothing in the UI communicates that it's broken.

For a newsletter signup, a soft warning on an optional field ("you didn't fill in your city — this helps us send local event invites") has no destructive outcome. The operation succeeds, the user is in the newsletter, the optional field just has no value. No persistent broken artifact.

</details>

**Checkpoint:** The Generate button reads from the saved DB profile, not the current form state. A user with unsaved changes will get a PDF that doesn't match what they see in the form. The plan addresses this with static copy ("Need a fresh document based on the fields below?"). What would dirty-state detection require to implement, and when would it be worth adding?

<details>
<summary>Reveal answer</summary>

Dirty-state detection would require: comparing current form state to the last-saved DB state for every field, surfacing a warning when they differ ("Your profile has unsaved changes — save before generating for the latest version"), and updating the comparison every time the form state changes.

In `ProfileForm.tsx`, this would mean adding a `savedProfile` state variable (the DB state as of last save), a `useEffect` or `useMemo` that computes whether any form field differs, and conditional rendering of a warning banner or changed button text near the Generate button.

It's worth adding when: user testing reveals that multiple users generate a resume and are confused that their recent edits aren't in it. The simpler static copy ("based on the fields below") sets expectations upfront. The static copy is the right first implementation — measure confusion before adding implementation complexity.

</details>

**Checkpoint:** After generation succeeds, the `resumeFileName` in the UI updates to "AI Generated Resume.pdf." This replaces whatever filename was previously shown (including manually uploaded PDFs). Why is it important to update the displayed filename immediately in client state rather than waiting for a page reload?

<details>
<summary>Reveal answer</summary>

The user's mental model after clicking Generate: something happened. If the UI doesn't change to reflect the result (filename update, success message), the user doesn't know the operation succeeded — they might click Generate again, or navigate away and come back confused about why the filename changed.

Updating `resumeFileName` in client state immediately (via `setResumeFileName("AI Generated Resume.pdf")`) produces the feedback the user expects: the button returns to its normal state, the filename updates, and the success message appears. These all happen synchronously from `setGenerateResult({ success: true })` and `setResumeFileName(...)` — both are React state updates that re-render the component.

A page reload (`revalidatePath("/profile")`) would produce the correct final state but with a visible flash — the page would blank briefly as Next.js re-fetched the server data. Client state updates produce the same result without the flash, because the DB was already updated before the client-side updates run.

</details>

---

## Part 8 — The plan alignment step: how four wrong values were caught before implementation

Open [`docs/architect/08-resume-pdf-generation/discussion.md`](../../architect/08-resume-pdf-generation/discussion.md),
"How the Plan Caught Four Wrong Values Before Implementation":

```
| Value             | Initial plan | Correct | Source of correct answer         |
|---                |---           |---      |---                               |
| Gemini temperature| 0.5          | 0.7     | context/library-docs.md          |
| Gemini max_tokens | 1500         | 1000    | context/library-docs.md          |
| Storage pattern   | upsert: true | remove  | actions/profile.ts:uploadResume  |
|                   |              | + upload|                                  |
| resume_pdf_url    | "a real URL" | storage | existing pattern in              |
|   value           |              | path    | actions/profile.ts               |
```

All four wrong values shared the same root cause: the Explore agents during the architect session were not directed to read `context/library-docs.md` or `actions/profile.ts`. The values were inferred from general knowledge — what a developer might assume without reading the project's specific configuration.

The plan alignment step caught all four. When the architect session's draft plan was reviewed by the developer before implementation, the developer checked the values against `library-docs.md` and found three mismatches (temperature, max_tokens, storage pattern). The review of `actions/profile.ts` caught the fourth (the storage path vs URL decision).

**What this reveals about the architect session's role:** The value of the plan phase is not the plan itself — it's the opportunity to compare proposed values against authoritative sources before any code exists. A wrong value in the plan costs 30 seconds to fix. The same wrong value discovered during implementation (a failing build, a type error, a broken PDF) costs significantly more: debugging time, rollback, context switching.

The fix was two-fold: correct the plan's values, and update the `/architect` skill to explicitly mandate reading `library-docs.md` for any feature touching integrations. Open [`.claude/skills/architect/SKILL.md`](../../../.claude/skills/architect/SKILL.md) and find the Step 1 addition:

```
Always read context/library-docs.md when the feature touches AI calls, storage, or
any third-party integration. This file documents project-specific values — Gemini
temperature, max_tokens, storage patterns, API endpoints — that differ from general
defaults. Never guess these values from general knowledge; always defer to what is
documented there.
```

This skill change turns a one-time correction into a permanent process improvement: every future architect session will read `library-docs.md` before proposing configuration values.

**Checkpoint:** The initial plan had temperature 0.5 for resume generation instead of 0.7. This was corrected during plan review. What process change ensures this category of error doesn't repeat?

<details>
<summary>Reveal answer</summary>

The `/architect` skill now explicitly instructs reading `context/library-docs.md` before planning any feature that touches AI calls, storage, or third-party integrations. This turns "read the context docs" from something a developer must remember into a skill-enforced step.

The root cause was that the Explore agents used during the architect session didn't receive `library-docs.md` as a mandatory read. By updating the skill, every future session that uses `/architect` will automatically include this step before proposing values. The skill change is visible in the repository — it's a permanent process artifact, not a comment in someone's head.

</details>

**Checkpoint:** Four wrong values were all caught before implementation. What's the highest-leverage moment in the development workflow to catch this category of error? What makes it highest-leverage?

<details>
<summary>Reveal answer</summary>

The plan review step — after the architect session produces a draft plan and before implementation begins. This is the highest-leverage moment because: (1) no code exists yet, so there's nothing to undo; (2) the full plan is visible in one place, making it easy to compare all proposed values against authoritative sources at once; (3) the developer and the AI are both focused on "is this correct?" rather than "does this compile?" — a different, more valuable question.

Compare to the alternative: discovering wrong values during implementation. A wrong temperature value would compile fine, produce a slightly-off PDF that's hard to detect, and require re-running generation to verify. A wrong storage pattern would produce a type error (`Expected 2 arguments, but got 3`) or silent file accumulation in the storage bucket. Each discovery is slower and more disruptive than catching it in the plan.

</details>

**Try it yourself:** Open [`context/library-docs.md`](../../../context/library-docs.md). Find every Gemini configuration section. List all the temperature and max_token values documented there. Then open [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx) and [`agent/extractor.ts`](../../../agent/extractor.ts). Confirm that both files use values from `library-docs.md` — not any other values. This is the invariant the plan alignment step enforces.

---

## Full data flow: a "Generate Resume from Profile" click through all eight decisions

The following trace maps each architectural decision to its concrete code location. Each numbered step is where one decision's consequence appears at runtime:

```
USER CLICKS "Generate Resume from Profile"
  │
  ▼
1. ProfileForm.tsx:handleGenerate() fires
   Decision 2 already enforced: button was enabled only because profile.is_complete = true
   setGenerateResult(null); startGenerate(async () => { ... })
   │
  ▼
2. fetch("POST /api/resume/generate")
   Decision 1: this is an API route, not a Server Action — route lives in app/api/resume/
   │
  ▼
3. app/api/resume/generate/route.ts runs on the server
   createInsforgeServer() → auth check (401 if no session)
   profile fetch → .select("*") → profile row
   │
  ▼
4. if (!profile.is_complete) return 400
   Decision 2's server-side guard: button disabled is UX only; this is the real check
   │
  ▼
5. generateResumePdf(profile) called in agent/pdf-generator.tsx
   Decision 5: temperature 0.7, max_tokens 1000 (per library-docs.md)
   Gemini call → raw JSON → JSON.parse(raw) as ResumeContent
   Part 6: ResumeContent interface is the single contract
   │
  ▼
6. renderToBuffer(<ResumeDocument profile={profile} content={content} />)
   in agent/resume-template.tsx
   Decision 6: skills rendered as profile.skills.join(" • ") — Yoga has no flexWrap
   @react-pdf/renderer builds PDF from Yoga layout → returns Buffer
   Possible only because: Decision (from next.config.ts): serverExternalPackages includes
   "@react-pdf/renderer" — Node.js resolves at runtime, not Turbopack at build time
   │
  ▼
7. Buffer → Blob conversion
   new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" })
   Required: InsForge SDK upload() accepts File | Blob, not Buffer
   │
  ▼
8. remove-then-upload to InsForge Storage
   Decision 3: storage.from("resumes").remove(existingKey) first
   then: storage.from("resumes").upload(storagePath, blob)
   │
  ▼
9. DB upsert
   Decision 4: uploadData.key = "{userId}/resume.pdf" (path, not a signed URL)
   profiles table updated: resume_pdf_key, resume_pdf_url (both = storage path),
   resume_pdf_filename = "AI Generated Resume.pdf"
   │
  ▼
10. Route returns { success: true }
    Back in ProfileForm.tsx:
    setResumeFileName("AI Generated Resume.pdf")  ← immediate client state update
    setGenerateResult({ success: true })           ← success message renders
    │
  ▼
USER SEES: "Resume generated — click 'View current resume' to open it."
USER CLICKS "View current resume" → getResumeSignedUrl() Server Action
→ insforge.storage.from("resumes").createSignedUrl(key, 3600)
→ browser opens signed URL → PDF displays
Decision 4 confirmed: signed URL generated on demand, never persisted
```

---

## Extend it (challenges)

### Challenge 1 — Trace: map all 7 architectural decisions to their exact code locations (20–30 min)

The architect session produced 7 implementation decisions. Your task: for each decision, find the **exact lines** in the implementation files where that decision appears as code.

For each:
1. Decision number and name (from `decisions.md`)
2. File and line range where the decision is encoded
3. One sentence: what would break if this line were changed to the rejected alternative

Write your answers before checking the full trace section above.

<details>
<summary>Hint</summary>

Decision 1 (API route): Look for the route file location (`app/api/resume/` not `actions/`).
Decision 2 (hard disable): Find the `disabled` attribute and the server-side `is_complete` check.
Decision 3 (remove-then-upload): The `if (profile.resume_pdf_key)` guard before `remove()`.
Decision 4 (path not URL): The value stored in `resume_pdf_url` after upload.
Decision 5 (temperature): The `temperature: 0.7` literal in `pdf-generator.tsx`.
Decision 6 (skills join): The `profile.skills.join(" • ")` in `resume-template.tsx`.
Decision 7 (skill update): The `library-docs.md` mandate in `.claude/skills/architect/SKILL.md`.

</details>

---

### Challenge 2 — Design: architect Feature 09 (job search agent) using this session's framework (30–40 min)

Feature 09 will let users click "Find Jobs" to search Adzuna for IT jobs, score each result against their profile using Gemini, and save the matches to a `jobs` DB table.

Using only the decision-making framework from this architect session and Tutorial 11:

1. Which folder should the Adzuna API call live in? Why?
2. Which folder should the Gemini scoring call live in?
3. Should job search be a Server Action or an API route? What's the deciding factor?
4. What Gemini temperature would you use for job matching (scoring a job against a profile)? Why?
5. What would you read in `context/library-docs.md` before proposing configuration values?

Write your answers, then check `context/build-plan.md` to see what was actually planned.

<details>
<summary>Hint</summary>

Apply Decision 1's criterion: Adzuna is an external third-party API call, Gemini is an AI call — both belong in `agent/`. Whether they go in one file or two depends on cohesion: if they're always called together, one file. If they can be called independently, two files.

For temperature: job matching is a scoring/classification task (how well does this job match this profile? → a score). That's closer to extraction than writing — one correct answer exists. Temperature 0.3.

For library-docs.md: check if Adzuna has a project-specific configuration section. Check if job matching has its own temperature/max_tokens entry. If not, propose values and document them.

</details>

---

### Challenge 3 — Break and fix: observe the temperature difference in practice (30–45 min)

Change `temperature` in [`agent/pdf-generator.tsx`](../../../agent/pdf-generator.tsx) from `0.7` to `0.1`. Generate a resume for the same profile three times. Read each generated PDF.

1. What do you notice about the summary paragraphs across the three generations?
2. Are the bullet points for the same work experience entry meaningfully different across runs?
3. Now change it back to `0.7` and generate three more times. What changes?

Write your observations, then design a measurement approach: if you wanted to formally test "temperature 0.7 produces more natural-sounding prose than temperature 0.3," what would your test methodology look like? What's the challenge of measuring "naturalness"?

<details>
<summary>Hint</summary>

At 0.1: the three summaries will be nearly identical — the same sentence structure, the same phrasing, possibly even the same word choices. At 0.7: each generation produces a noticeably different paragraph that expresses the same facts differently.

For measuring naturalness: human evaluation is the most reliable (have people rate "which of these two summaries sounds more professional?" as a blind A/B). Automated metrics like perplexity measure how "surprising" the text is to a language model, which correlates loosely with naturalness but isn't a perfect proxy. The challenge: naturalness is subjective and task-specific. What sounds natural for a senior engineer's resume sounds different from what sounds natural for an entry-level graduate's.

Revert `temperature` to `0.7` when done — the deviation from `library-docs.md` should not persist.

</details>

---

For deeper exploration, [`docs/architect/08-resume-pdf-generation/ai-discussion-topics.md`](../../architect/08-resume-pdf-generation/ai-discussion-topics.md) has 25 prompts grouped across architectural boundaries, bundling mechanics, LLM temperature reasoning, InsForge storage patterns, PDF rendering constraints, and UX decision-making. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
