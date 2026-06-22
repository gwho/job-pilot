# Architect Discussion — Feature 07: AI Profile Extraction from Resume

---

## The Core Flow: Two Libraries, One Goal

Feature 07 chains two separate libraries in sequence:

```
PDF buffer
  └── pdf-parse          → raw text string
        └── Gemini API   → structured JSON
              └── client ← ProfileExtraction object
```

Understanding why two libraries are needed, and why they can't be collapsed into one, is the foundation for this feature.

**Why pdf-parse?**
Gemini cannot directly receive a PDF binary. It works with text. `pdf-parse` is a Node.js library that reads a PDF buffer and returns `.text` — the raw character stream extracted from the PDF's embedded text objects. This text has no formatting, no columns, no structure — it's just the words in roughly reading order.

**Why Gemini after that?**
The raw text from `pdf-parse` looks like:

```
John Smith john@example.com 555-1234
Software Engineer at Acme Corp (2021–present)
Skills: React, TypeScript, Node.js
```

Gemini's job is to take that unstructured dump and return a typed JSON object with the exact field names the profile form needs. This is where the AI earns its cost: it handles layout ambiguity, date parsing, inferring experience level from years, deduplicating skill mentions across different sections.

**The failure mode that guards both steps:**
Image-based PDFs (scanned paper resumes) produce `.text = ""` because there are no embedded text objects — only pixel data. The `text.length < 100` guard catches this before wasting a Gemini API call:

```typescript
if (text.length < 100) {
  return { success: false, error: "Could not extract text from this PDF. Please try a different file." };
}
```

---

## Why the AI Operation Lives in the API Route + `agent/`, Not a Server Action

This is the most architecturally important decision in the feature.

The project has three distinct data flow patterns, and confusing them produces bugs that are hard to trace:

| Pattern | Trigger | Lives in | Writes to DB? |
|---------|---------|----------|---------------|
| UI mutation | User clicks Save/Upload | Server Action | Yes |
| Agent operation | User triggers AI task | API route → agent/ | Yes (usually) |
| Data fetch | Page load | Server Component | No |

Profile extraction is unusual: it's an AI operation, but it **does not write to the DB**. It returns data to the client for the user to review. This creates a question: is it a Server Action or an API route?

The answer is API route, for two reasons:

1. **The AI-call boundary.** Server Actions are for DB mutations with a predictable output shape. The moment you add pdf-parse + a 2-second Gemini API call inside a Server Action, you've broken the mental model of what Server Actions are for. The `agent/` folder is where AI calls live — that's an explicit invariant in this project.

2. **Return shape.** Server Actions return `{ success, error? }` — the UI just needs to know if it worked. API routes can return rich data (`ProfileExtraction`). The extraction response is data the client needs to display, not just a success flag.

**The common mistake:** Developers reach for Server Actions because they're simpler to call from a React component (`await saveProfile(formData)`). But "simpler to call" isn't the right criterion. The criterion is "what is this operation doing?" If it's calling an AI model, it belongs in `agent/` and an API route.

---

## The Form Population Problem: State Ownership

ProfileForm is a large "use client" component that owns all form state via multiple `useState` hooks:

```typescript
const [form, setForm] = useState<FormState>({ full_name: "", phone: "", ... });
const [skills, setSkills] = useState<string[]>([]);
const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([]);
const [education, setEducation] = useState<Education>(EMPTY_EDUCATION);
// ...
```

This matters enormously for understanding why the Extract button must live inside ProfileForm, not outside it.

**React's rule:** Only the component that owns state can update it. If you want `ResumeSection` (a sibling component) to update ProfileForm's state, there are only two ways:
1. Lift state up to a shared parent
2. Pass a callback down from ProfileForm to ResumeSection

Option 2 (callback) looks attractive: `<ResumeSection onExtraction={applyExtraction} />`. But `ResumeSection` would be a *child* of `ProfileForm`, not a sibling. The only thing that changes is that some JSX is extracted to another file — all state and handlers stay in ProfileForm.

**Why the sibling approach (via page.tsx) doesn't work:**
`page.tsx` is a Server Component. It fetches data from InsForge and renders the page. It cannot:
- Hold `useState`
- Accept callbacks from children
- Pass callbacks between siblings

To make ResumeSection and ProfileForm true siblings that share state, you'd need a new `ProfilePageClient.tsx` — a client wrapper that holds all the form state currently in ProfileForm. That's a complete rewrite of Feature 05 and 06's component architecture for zero user-visible benefit.

**The rule this illustrates:** State ownership determines component hierarchy. Before asking "should this be its own component?", ask "who owns the state this component needs?" If the answer is another component, the new component must be a child of that component — or you're signing up for state lifting.

---

## The Null-Safe Population Pattern

When Gemini returns the extraction JSON, every field is potentially null. A naive application of the result would be:

```typescript
setForm({ ...form, ...data }); // WRONG
```

This wipes every field Gemini couldn't extract with `null`. If the user had already filled in their phone number manually and the resume didn't contain it, their phone is now gone.

The correct pattern uses conditional spreading:

```typescript
setForm((prev) => ({
  ...prev,
  ...(data.full_name != null && { full_name: data.full_name }),
  ...(data.phone != null && { phone: data.phone }),
  // ...
}));
```

`...(condition && { key: value })` is a common JavaScript idiom. When `condition` is false, `false` spread into an object is a no-op (`{ ...false }` = `{}`). When it's true, the key-value pair is applied.

**Why `!= null` and not just `if (data.field)`?**
Using a truthy check (`if (data.full_name)`) would skip empty strings, which is almost always wrong for form fields. A user's phone might legitimately be something a truthy check could misread. `!= null` catches both `null` and `undefined` while preserving `""`, `0`, and `false` as valid values.

**For arrays:** The pattern is slightly different — we only overwrite if Gemini returned a non-empty array:
```typescript
if (data.skills?.length) setSkills(data.skills);
```

An empty array from Gemini means "I found no skills" — which should not wipe the user's manually-entered skills. A non-empty array means Gemini found something useful.

---

## The Gemini System Prompt: Teaching Constraints, Not Just Tasks

The system prompt for extraction is longer than just "extract fields from this resume." It specifies exact enum values:

```
"experience_level": "junior" | "mid" | "senior" | "lead" | null,
"work_authorization": "citizen" | "permanent_resident" | "visa_required" | null,
```

**Why this matters:** Without enum constraints, Gemini might return `"Senior Engineer"` for experience_level, which TypeScript expects to be `"senior"`. The form dropdown would render incorrectly or silently break.

The system prompt also includes this instruction: *"Use null for any field you cannot confidently extract — never guess."* This is the counterpart to the null-safe population pattern. The AI's `null` is a signal: it means "I didn't find this", not "the field is blank". The client trusts that signal and preserves existing data.

**Temperature 0.3:** Extraction is deterministic work. The same resume should return the same structured output every time. Higher temperatures introduce variation that the user would notice ("why did my skills list change?"). 0.3 is the project's standard for all AI extraction tasks.

---

## Package Installation: Why Both Are New

Neither `openai` nor `pdf-parse` was in `package.json` at the start of this session. This is worth noting because both have been discussed throughout the project context files — they were always planned but never installed.

**`openai` package:** Despite the name, this is being used to call Google's Gemini API through Google's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`). The package is unchanged — only the `baseURL` and `apiKey` are different. This means any `openai` SDK pattern (streaming, tool use, response formats) works identically against Gemini's API.

**`pdf-parse`:** A Node.js-only library. It must never be imported in client components or bundled for the browser. Its import belongs in `agent/extractor.ts`, which is never touched by Next.js client bundling.

**`@types/pdf-parse`:** `pdf-parse` has no bundled TypeScript types. Without `@types/pdf-parse`, TypeScript will complain about the import. It's a devDependency because types are only needed at compile time.

---

## The "No Auto-Save" Choice

After extraction, the form populates but does not auto-save. The user must click "Save Profile" manually. This was specified in the build plan and is worth understanding why.

**Extraction errors are invisible until you look.** Gemini might misparse a date, hallucinate a skill, or misidentify the experience level. If we auto-saved, the user would need to go back and correct the DB record — a more destructive flow than just reviewing before saving.

**The user's profile is their ground truth.** The profile is used for job matching. An incorrect save from a bad extraction would affect every subsequent job score. The review step is a forced quality gate.

**The UX is: extract → review → save.** The success banner communicates this explicitly: *"Profile filled in from your resume — review the fields below and save when ready."* The word "review" is intentional — it cues the user that their action is next.
