# Deep Discussion — Feature 08: Resume PDF Generation

## The Architectural Boundary That Drives Every File Placement

The most important constraint in this project isn't a technology choice — it's the separation between Server Actions and API Routes.

**Server Actions (`actions/`)** handle UI-triggered mutations: save profile, upload file, sign out. They take form data, write to the DB, and call `revalidatePath()`. They never call agent code.

**API Routes (`app/api/agent/`, `app/api/profile/`, `app/api/resume/`)** handle agent operations: things that call Gemini, Adzuna, Browserbase. They run heavier logic and return JSON.

This isn't just convention — it's stated as a project invariant in `context/architecture.md`. When Feature 08 came up, the correct file placement for the route handler was immediately clear: it calls Gemini, so it belongs in `app/api/`. No deliberation required.

The consequence of violating this boundary is subtle but cumulative. `actions/` becomes a catch-all. You can no longer navigate the codebase by asking "is this UI logic or agent logic?" You have to read each file to know. Over dozens of features, this degrades the codebase's readability far more than any single wrong choice.

**The takeaway:** Before placing any new file, ask which side of the boundary it belongs on. Actions = simple mutations. Routes = agent operations.

---

## Why @react-pdf/renderer Needs serverExternalPackages

Next.js (with Turbopack) bundles server-side code by default. Most Node.js packages work fine bundled. But some packages — particularly those with native bindings, complex ESM/CJS boundaries, or lazy-loaded internals — break when bundled.

`@react-pdf/renderer` uses `pdfkit` internally, which has complex module resolution behavior. When Turbopack tries to bundle it, it fails to resolve the internal dependencies correctly at build time. The fix is to tell Next.js to treat it as an "external" package — meaning it will be resolved by Node.js at runtime rather than bundled at build time.

```typescript
// next.config.ts
serverExternalPackages: ["pdf-parse", "@react-pdf/renderer"]
```

This project already learned this lesson with `pdf-parse` (Feature 07 recover session). The pattern repeats: any package that uses complex module internals or native bindings needs this treatment.

**Mental model:** `serverExternalPackages` is the escape hatch that says "don't bundle this — let Node.js handle it at runtime the normal way." It's always the right fix when you see a build error like "cannot resolve module X" for a server-side package.

---

## The Two Roles Gemini Plays in This Feature

In Feature 07 (extraction), Gemini played a **parsing role**: read unstructured text (resume PDF), output structured data (profile fields). Low temperature (0.3) was correct because the goal is precision — the same resume should always produce the same extracted fields.

In Feature 08 (generation), Gemini plays a **writing role**: take structured data (profile fields), output natural language (summary paragraph, polished bullets). Higher temperature (0.7) is correct because the goal is natural-sounding prose — a little variation produces better-sounding text than robotically identical output.

This is a core principle for using LLMs: **the task determines the temperature.**

| Task type | Temperature | Why |
|---|---|---|
| Extraction / parsing | 0.1 – 0.3 | Repeatability, precision |
| Classification | 0.0 – 0.2 | Single correct answer |
| Professional writing | 0.5 – 0.7 | Natural variation improves quality |
| Creative writing | 0.7 – 1.0 | High variation is the goal |

The project documents its specific choices in `context/library-docs.md`. Always consult that file rather than using general defaults. The extraction endpoint uses 0.3; the resume generation endpoint uses 0.7. Both are correct for their respective tasks.

**What breaks if you get it wrong:** Using 0.3 for resume writing produces text that sounds formulaic and slightly robotic — the same phrasing patterns across different profiles. Using 0.7 for extraction produces inconsistent field values — the same PDF might extract a different job title on two different calls.

---

## Why the DB Stores a Storage Path, Not a URL

The `resumes` bucket is private. InsForge (Supabase-compatible) private storage requires generating a signed URL to read a file — the URL is valid for a configurable duration (this project uses 1 hour).

There are two approaches to managing this:

**Option A — Persist the signed URL:** Generate a 1-hour (or 1-week) signed URL at upload time. Store it in `resume_pdf_url`. Read it from the DB when the user wants to view the file.

**Problem:** The stored URL becomes stale. After it expires, the value in the DB is useless. You'd need a refresh mechanism: check if the URL is expired, regenerate it, write it back to the DB, return the fresh one. That's three DB roundtrips and conditional logic in every place that reads `resume_pdf_url`.

**Option B — Persist the storage path:** Store `"{userId}/resume.pdf"` in `resume_pdf_url` (same value as `resume_pdf_key`). Generate a fresh signed URL on-demand whenever the user clicks "View current resume."

**Why Option B is better:** The path never expires. The signed URL is a presentation concern — it only matters at the moment the user clicks the button. Keeping it out of the DB keeps the DB row clean and eliminates the refresh problem entirely.

This is a general pattern: **never persist derived, expiring values in the DB. Persist the stable source (the path) and derive the ephemeral value (the signed URL) at the point of use.**

---

## Why resume_pdf_url and resume_pdf_key Hold the Same Value

Looking at the profile schema, it can seem redundant: why have both `resume_pdf_key` and `resume_pdf_url` if they both hold `"{userId}/resume.pdf"`?

The distinction was originally intended for future flexibility: `resume_pdf_key` would always be the storage key, while `resume_pdf_url` might eventually hold a CDN URL or pre-signed URL. In practice, for a private bucket with on-demand signed URLs, they converge to the same value.

The extraction route downloads using `resume_pdf_key`. The display logic generates signed URLs also from the key. The `resume_pdf_url` column is currently redundant but exists for forward compatibility if the bucket policy changes.

**For Feature 08:** Set both to `"{userId}/resume.pdf"` — matching the pattern already established by `uploadResume` in `actions/profile.ts`.

---

## @react-pdf/renderer's Layout Engine and the Flex Wrap Problem

`@react-pdf/renderer` does not use browser CSS. It uses **Yoga** — the same layout engine that React Native uses. Yoga implements a subset of CSS Flexbox, but with meaningful gaps:

- No `flexWrap` support (confirmed in @react-pdf docs)
- No `grid`
- No `overflow: auto` for scrolling
- Text flow is handled differently (multiline text within a `<Text>` element wraps correctly, but sibling elements do not wrap into a grid)

This means you cannot render "tags" or "chips" — individual `<View>` or `<Text>` elements that flow and wrap like inline elements on the web. The approach that looks correct:

```tsx
// This breaks — skills overflow horizontally off the page
<View style={{ flexDirection: "row" }}>
  {skills.map(skill => <Text key={skill}>{skill}</Text>)}
</View>
```

The correct approach:
```tsx
// This works — single Text wraps naturally
<Text>{skills.join(" • ")}</Text>
```

This constraint affects any list-like content in the PDF: skills, industries, tech stack. Always join them into a single string with a visual separator. The PDF looks professional; the layout doesn't break.

**Broader principle:** When working with rendering engines that aren't browsers, always check which CSS properties are actually supported. Don't assume browser behavior applies.

---

## The "Saved Profile" Constraint and Its UX Implication

The Generate button reads from the `profiles` DB table — the saved state — not the current form state. This is the only practical approach for an API route: routes don't receive form state, they fetch from the DB after authenticating the user.

This creates a subtle UX contract: if the user has changed fields in the form but not saved, those changes won't appear in the generated PDF.

There are a few ways to handle this:

1. **Say nothing** — the user is expected to know that "Generate" uses saved data. Risk: confusing discrepancy between what they see in the form and what's in the PDF.
2. **Show static copy** — label or tooltip near the button: "Generates a PDF from your saved profile." Low friction, honest about the behavior.
3. **Dirty-state detection** — track whether any form field has changed since the last save; if dirty, show a warning banner near the Generate button. More accurate but adds significant implementation complexity.

The plan uses approach 2 — static informational copy. Dirty-state detection is left as a future enhancement if user testing reveals confusion.

**The principle being applied:** Don't implement complexity that might not be needed. Test the simpler version first. If users are confused, add the dirty-state warning then.

---

## How the Plan Caught Four Wrong Values Before Implementation

In the initial plan draft, four values were wrong:

| Value | Initial plan | Correct | Source of correct answer |
|---|---|---|---|
| Gemini temperature | 0.5 | 0.7 | `context/library-docs.md` |
| Gemini max_tokens | 1500 | 1000 | `context/library-docs.md` |
| Storage write pattern | `upsert: true` | `remove` then `upload` | `actions/profile.ts:uploadResume` |
| resume_pdf_url value | "a real URL" | storage path | existing pattern in `actions/profile.ts` |

All four were wrong because the Explore agents were not directed to read `context/library-docs.md` or `actions/profile.ts`. The values were inferred from general knowledge.

**What this reveals about the architect session's role:** The plan alignment step (where the developer reviewed the draft plan and provided corrections) caught all four errors before a single line of code was written. This is exactly what the architect session is for: surface wrong assumptions cheaply, before they become bugs in the codebase.

The fix was two-fold: update the plan with correct values, and update the `/architect` skill to explicitly mandate reading `library-docs.md` for any feature touching integrations. The skill change ensures future sessions don't repeat the same miss.

---

## The Gemini Output Contract and Why It Matters

The API route and the PDF template are decoupled through the `ResumeContent` interface:

```typescript
interface ResumeContent {
  summary: string;
  workExperience: Array<{
    company: string;
    title: string;
    period: string;    // e.g. "2021 – Present"
    bullets: string[]; // 3–5 items
  }>;
}
```

Gemini's JSON output must match this shape. The route passes this to the template, which renders it. The template doesn't know how the content was generated; the generator doesn't know how it's rendered.

**Why the explicit interface matters:** Without it, the generator might return `responsibilities: "text"` (a string) while the template expects `bullets: string[]` (an array). TypeScript catches this mismatch at compile time only if both sides are typed against the same interface.

Keeping the `ResumeContent` type in `agent/pdf-generator.ts` (exported, imported by the template) gives it a single source of truth. If the Gemini output shape ever changes, there's one place to update and the compiler flags every downstream breakage.
