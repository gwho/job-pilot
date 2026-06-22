# Tutorial 11 — Profile Extraction Architect Session: AI Boundaries, State Ownership, and Null Contracts

**After completing this tutorial you will understand:** why "simpler to call" is the wrong
criterion for placing an operation in a Server Action vs an API route, how React's state
ownership rule constrains component hierarchy before a single line is written, why the
Gemini system prompt's `null` instruction and `applyExtraction`'s `!= null` guard form a
contract that spans two files, and why not auto-saving after AI extraction is a deliberate
architectural quality gate rather than an oversight.

This tutorial is based on the architect session in
[`docs/architect/07-profile-extraction/`](../../architect/07-profile-extraction/) and
the implementation it produced, which is covered step-by-step in Tutorial 10.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 10 (`10-profile-extraction/README.md`) — the complete implementation of
>   everything this architect session designed. Every decision discussed here has a code
>   referent you have already seen. Read it first.
> - Tutorial 08 (`08-profile-save-architect-deep-dive/README.md`) — the prior architect
>   deep-dive. This tutorial follows the same structure and assumes familiarity with the
>   session format.
>
> Open [`docs/architect/07-profile-extraction/decisions.md`](../../architect/07-profile-extraction/decisions.md),
> [`docs/architect/07-profile-extraction/discussion.md`](../../architect/07-profile-extraction/discussion.md),
> [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts),
> [`agent/extractor.ts`](../../../agent/extractor.ts), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these warm-up prompts in a separate AI session before reading any code. Budget 25–35
minutes. Do not paste project code — keep the conversations in plain concepts.

### Concept 1 — Categorising operations in a full-stack application

> "In a Next.js application, I need to categorise every operation as either a Server
> Action, an API route handler, or a Server Component data fetch. Explain the decisive
> criterion for each category — not the syntax, but the architectural signal that tells
> you which bucket an operation belongs in. Give me five examples of operations and let
> me categorise them, then tell me if I'm right and explain any I got wrong."

*What to listen for:* The decisive criterion is NOT how the operation is triggered or how
easy it is to call — it's what the operation *does*. Server Actions are for UI-triggered
DB mutations. API routes are for operations that call external services (AI, third-party
APIs) or return rich data back to the client. Server Component fetches are for read-only
data needed before the page renders. When you mix these categories, the architecture loses
its signal value — any file could contain anything.

*Practice question:* A user clicks a button. The click triggers a call to an AI model,
which returns structured data the user reviews before a separate save. Is this a Server
Action or an API route? What's the deciding factor?

---

### Concept 2 — React state ownership and component hierarchy

> "In React, explain the rule: 'only the component that owns state can update it.' Now
> give me a scenario: Component A owns an array in useState. Component B (a sibling of
> A, not a child) needs to update that array when a button inside B is clicked. Walk me
> through every option — what are the trade-offs of each? Which option adds the least
> new indirection? Then ask me to apply this thinking to a new scenario."

*What to listen for:* The three options are: (1) lift state up to a shared parent, (2)
pass a callback from the state-owning component to a child (not a sibling — a child
must be nested), (3) global state management. Each has a cost. The key insight: if you
want a *sibling* to update state, you must either lift state (restructuring both
components) or accept that there's no "clean" path — only trade-offs. This is why
"should this be its own component?" must be answered after "who owns the state?"

*Practice question:* You have a `ProfileForm` component that owns `skills: string[]`
in state. You want a new `ResumeSection` button to update `skills` when clicked. What
must you do if `ResumeSection` is a sibling? What if it's a child?

---

### Concept 3 — AI system prompts as formal contracts

> "When I send a system prompt to an AI model, I'm establishing a contract about the
> output format. Explain what happens when the contract is under-specified vs
> over-specified. For example: if I want the model to return JSON with enum fields but
> I don't list the allowed enum values, what are the specific failure modes? Give me
> three concrete examples of prompt under-specification that look fine until they hit
> production. Then quiz me."

*What to listen for:* Under-specified contracts produce outputs that are technically
valid but practically broken — `"Senior"` instead of `"senior"`, a variant spelling,
an extra field the parser doesn't expect, markdown-wrapped JSON. The model is not wrong;
the contract was insufficient. Over-specification reduces creative hallucination but can
make the model refuse to return anything when the input doesn't clearly match. The sweet
spot: specify exactly what you will validate against.

*Practice question:* A system prompt says "return the experience level as a string." A
model returns `"5+ years"`. Your TypeScript type says `"junior" | "mid" | "senior" | "lead"`.
At what layer does this fail — TypeScript, runtime, or UI?

---

### Concept 4 — The "simpler to call" fallacy in architecture decisions

> "Software engineers sometimes choose an architectural pattern because it's 'easier to
> call from a React component.' Explain why this is a flawed criterion. What's the
> actual cost of choosing ease-of-call over correctness-of-category? Give me a concrete
> example where a team started by putting AI calls in the 'easy' place and describe how
> the architecture degraded over time. Then quiz me: what IS the right criterion?"

*What to listen for:* The cost is precedent. Architecture decisions are chosen by
the next developer based on what already exists. If one AI call goes in the "easy"
place (a Server Action), the second AI call goes there too — because the precedent
says "AI calls go here." After three features, the folder contains both DB mutations
and AI calls with no structural signal about which is which. The right criterion is
always "what does this operation do?" not "how convenient is it to invoke?"

*Practice question:* Server Actions can technically make AI API calls — Next.js doesn't
prevent it. Why is this technically-works-but-architecturally-wrong, and how do you
explain that distinction to a teammate?

---

### Concept 5 — AI output as untrusted input: quality gates before DB writes

> "I have a feature where clicking a button calls an AI model and uses its output to
> populate a form. I'm deciding whether to auto-save the AI output to the database, or
> show it in the form and let the user save manually. Explain the failure modes of each
> approach. What kinds of AI errors make auto-save dangerous? When is auto-save
> acceptable? Give me a rule of thumb. Then quiz me with a few scenarios."

*What to listen for:* AI output should be treated like user input at the boundary: not
trusted until reviewed. Auto-save is acceptable when the AI is performing a deterministic
operation with well-defined correctness (e.g., format conversion, OCR of a known
structure). Auto-save is dangerous when the AI is inferring subjective values (experience
level, job titles, skills) or transforming unstructured text. The rule of thumb: if a
wrong auto-save would produce user-visible data corruption that requires a corrective DB
write to fix, don't auto-save.

*Practice question:* An AI model extracts skills from a resume and produces
`["React", "TypeScript", "Kubernetes"]`. The user has never used Kubernetes — it
appeared once in a job description they helped write. If this auto-saves, what is the
concrete impact on the application's job matching feature?

---

## The four decisions at a glance

The architect session for Feature 07 produced four decisions. Each one governs a
different layer of the feature:

```
┌─────────────────────────────────────────────────────────────────┐
│  Decision 1: Operation category                                 │
│  AI call → API route + agent/, not Server Action                │
│                                                                 │
│  Decision 2: Component hierarchy                                │
│  Extract button inside ProfileForm — state ownership rules      │
│                                                                 │
│  Decision 3: File retrieval                                     │
│  Server downloads from storage — client never re-sends          │
│                                                                 │
│  Decision 4: Form population                                    │
│  Additive, null-guarded — existing data preserved               │
└─────────────────────────────────────────────────────────────────┘
```

The decisions are ordered by scope: the first governs the entire feature's location in
the codebase. The second governs component topology. The third governs the data flow
within the route. The fourth governs how AI output touches client state. Each decision
depends on the one above it being made first.

**The three invariants that cross all four decisions:**

- `agent/extractor.ts` is the only place AI calls live — never in routes, actions, or components
- The client never re-sends data the server already has
- AI output is never auto-saved — the user is always the quality gate

---

## Part 1 — "Simpler to call" is the wrong criterion: placing AI operations correctly

Open [`docs/architect/07-profile-extraction/decisions.md`](../../architect/07-profile-extraction/decisions.md),
Decision 1:

```
Profile extraction is an AI operation (pdf-parse + Gemini call). It returns data to
the client for user review — it does NOT write to the DB itself. Putting it in
actions/profile.ts would break both invariants: it's not a DB mutation, and it's an
AI call.
```

And from [`CLAUDE.md`](../../../CLAUDE.md), the three data flows:

```
UI mutations  → Server Action → agent/ function → DB write
Agent operations → API route → agent/ function → AI → DB write
Data fetch    → Server Component → InsForge DB read
```

The extraction feature sits in an interesting position: it IS user-triggered (like UI
mutations), but it does NOT write to the DB (unlike UI mutations), and it DOES call
an AI model (like agent operations). A developer who looks only at "does it write to
the DB?" could argue either category. The architect session resolved this by identifying
the decisive criterion: **what does the operation primarily do?**

The operation calls `pdf-parse` and Gemini. That makes it an agent operation. Full stop.
The fact that it returns data to the client rather than writing to the DB is irrelevant
to the categorisation — it just means this particular agent operation has a slightly
simpler architecture than others (no DB write at the end).

The temptation to use a Server Action comes from the ergonomics. `await extractProfile()`
is simpler to call than `fetch("/api/profile/extract", { method: "POST" })`. But
ergonomics is not the criterion. The project's `CLAUDE.md` is explicit: the criterion is
what the operation does, not how easy it is to call. Choosing based on ergonomics is how
`actions/profile.ts` ends up containing both `saveProfile` (DB upsert) and an AI call
— destroying the folder's signal value for every future feature.

The long-term cost is compounding. Job matching (the next AI feature) will look at
`actions/profile.ts` for a pattern. Company research will look there. Resume generation
will look there. If extraction is in that file, all three have a plausible precedent to
join it. The `agent/` folder and API route boundary would be abandoned before it was ever
actually needed.

**Checkpoint:** Feature 07's extraction route returns `ProfileExtraction` data — it never
writes to the DB. Feature 08 will probably have a job matching operation that DOES write
a score to the DB. Should job matching be an API route or a Server Action? What's the
deciding criterion?

<details>
<summary>Reveal answer</summary>

Job matching is an AI operation — it calls Gemini to score a job description against a
profile. It should be an API route calling an `agent/` function, even though it writes
to the DB. The criterion is "what does this operation primarily do?" — it calls AI, so
it belongs in `agent/` and an API route. The DB write is the *outcome* of the AI
operation, not its category.

A Server Action whose primary job is "call Gemini, write the score" would break the
`CLAUDE.md` invariant. The correct pattern: API route → `agent/matcher.ts` → Gemini call
→ `createInsforgeServer().database.from("jobs").update(...)`. The DB write happens inside
the agent function, not in the route handler.

</details>

**Try it yourself:** Open [`actions/profile.ts`](../../../actions/profile.ts). Read the
first line of each exported function (`saveProfile`, `uploadResume`, `deleteResume`,
`getResumeSignedUrl`). Confirm that every function either writes to the DB or reads from
it — none of them makes an external AI call. This is the invariant the folder enforces.
If extraction were here, what would that signal to a developer reading the file?

---

## Part 2 — State ownership determines component hierarchy before a line is written

Open [`docs/architect/07-profile-extraction/decisions.md`](../../architect/07-profile-extraction/decisions.md),
Decision 2:

```
Why not a ResumeSection sub-component wired via page.tsx?
page.tsx is a Server Component — it cannot hold client state or pass callbacks.
Wiring ResumeSection → ProfileForm through the page would require:
1. A new ProfilePageClient.tsx client wrapper component
2. Lifting ALL form state from ProfileForm into that wrapper
3. Splitting ProfileForm into a "form fields only" component

That's a full refactor of Feature 05 and 06's work, triggered by adding one button.
```

The question that triggered this analysis was: could a `ResumeSection` component sit
alongside `ProfileForm` as a sibling in `page.tsx`, with an "Extract from Resume" button
inside it that, on click, calls the API and populates `ProfileForm`'s fields?

The intuition is reasonable — "resume management" feels like a coherent piece of UI that
could be its own component. But the question to ask before any componentisation is: **who
owns the state this component needs to update?**

`ProfileForm` owns `setForm`, `setSkills`, `setWorkExperience`, `setEducation`. These are
the state setters `applyExtraction` calls. For `ResumeSection` to call these setters, one
of two things must be true:

1. The setters live in a parent of both components, and are passed down as props
2. `ResumeSection` is a *child* of `ProfileForm`, receiving the setters as props

Option 1 requires lifting state from `ProfileForm` to a new client wrapper — a full
rewrite of the component hierarchy established in Features 05 and 06. `page.tsx` is a
Server Component; it cannot hold `useState`. A new `ProfilePageClient.tsx` would be
needed, and `ProfileForm` would need to become stateless, receiving all state as props.
This is not a refactor of the extraction feature — it's a refactor of two prior features.

Option 2 (child component) is technically valid but achieves nothing. `ResumeSection`
would be nested inside `ProfileForm`, receiving `setForm`, `setSkills`, etc. as props. The
state still lives in `ProfileForm`. All that changes is that some JSX is moved to another
file. This is a valid future `/imprint` session extract — but it's cosmetic, not
architectural.

The decision: keep the Extract button inline in `ProfileForm`. The button is three lines
of JSX plus two state variables. It is not large enough to justify any component boundary
that doesn't already exist. The `code-standards.md` rule applies directly: "Do not add
features, refactor, or introduce abstractions beyond what the task requires."

**Checkpoint:** Suppose `ResumeSection` already existed as a child component inside
`ProfileForm` in Feature 05. Would the decision about where to put the Extract button
change? Why or why not?

<details>
<summary>Reveal answer</summary>

Yes — if `ResumeSection` already existed as a child of `ProfileForm`, putting the Extract
button there would be correct and free. The state setters could be passed down as props
from `ProfileForm` to `ResumeSection`. The component boundary is already established;
adding a button to it adds no new indirection.

The architect session's decision was specifically about creating `ResumeSection` fresh for
this feature. Creating a new component to hold three lines of JSX — when that component
has no standalone value, no reuse, and no existing boundary to slot into — is the
over-abstraction the CLAUDE.md standards warn against. The decision is not "never use
sub-components"; it's "don't create them for zero benefit."

</details>

**Try it yourself:** Open [`app/profile/page.tsx`](../../../app/profile/page.tsx). Confirm
it is a Server Component (no `"use client"` directive). Find where it renders
`<ProfileForm ... />`. Then answer: could `page.tsx` hold `const [skills, setSkills] =
useState<string[]>([])` and pass `setSkills` to both `ProfileForm` and a hypothetical
`ResumeSection`? Why not?

---

## Part 3 — Server-side file retrieval: stateless over moment-coupled

Open [`docs/architect/07-profile-extraction/decisions.md`](../../architect/07-profile-extraction/decisions.md),
Decision 3, and [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts):

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
```

The route takes no request body — `POST()` has no parameters. The client sends no file.
Instead, the server looks up `resume_pdf_key` from the DB and fetches the file from
storage itself.

The alternative — having the client re-upload the file in a FormData body — is
moment-coupled. "Moment-coupled" means the operation only works if the file is in the
browser's memory at the instant the user clicks Extract. In practice:

- The user uploads their resume on a Tuesday
- They navigate away, come back Thursday
- They click "Extract from Resume"
- Their browser has no record of a file — no `File` object in memory, no blob URL, nothing

A moment-coupled design would silently fail in this case (the user would see an error
about missing file data), or it would require re-uploading the file on every extract,
which doubles network transfer.

Server-side download from storage is stateless. The route needs two things: a valid
session (for auth) and a `resume_pdf_key` in the user's profile (written when the resume
was uploaded in Feature 06). Both are durable — they survive page navigations, browser
restarts, and sessions. The operation works the same way whether the user uploaded the
resume one minute ago or one month ago.

The `Buffer.from(await fileBlob.arrayBuffer())` conversion is also worth understanding.
InsForge's `download()` returns a `Blob` — the browser-compatible binary representation.
`pdf-parse` expects a Node.js `Buffer`. These are different interfaces for the same raw
bytes. `fileBlob.arrayBuffer()` extracts the raw bytes as an `ArrayBuffer`, and
`Buffer.from()` wraps them in Node.js's representation. This conversion is necessary
because the code runs in the Node.js runtime (server route) but the InsForge SDK returns
web-standard types.

**Checkpoint:** The route calls `insforge.storage.from("resumes").download(key)` using
the server-side InsForge client. Why can't the client component call this same storage
method directly and pass the result to the route?

<details>
<summary>Reveal answer</summary>

Two reasons. First, the "resumes" bucket is private — only the server-side InsForge client
(initialised with service-role credentials) has permission to download from it. The
browser client has the anon key, which does not have read access to private buckets.

Second, even if the bucket were public, downloading the file in the browser and sending it
to the route in a FormData body re-introduces the moment-coupling problem — plus adds
unnecessary round-trips: browser → storage → browser → route → pdf-parse, when
route → storage → pdf-parse is sufficient.

The general rule: if data is already on the server (or accessible from the server), the
server should fetch it directly. Only involve the client when it has information the
server doesn't have.

</details>

**Try it yourself:** Look up `resume_pdf_key` in the InsForge Storage console (or check
[`actions/profile.ts`](../../../actions/profile.ts) to see the `uploadResume` action that
writes it). Confirm the key format — it should be something like `<user-id>/<filename>`.
This is the key the extraction route uses. Notice it is stored in the `profiles` table
`resume_pdf_key` column, not in the `resume_pdf_url` column — that's a signed URL, not
a storage key. The extraction route always needs the key, not the URL.

---

## Part 4 — Null as a signal: the contract between the system prompt and `applyExtraction`

Open [`docs/architect/07-profile-extraction/decisions.md`](../../architect/07-profile-extraction/decisions.md),
Decision 4:

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

And from [`agent/extractor.ts`](../../../agent/extractor.ts), the system prompt instruction:

```
Use null for any field you cannot confidently extract — never guess.
```

These two pieces of code form a contract that spans two files and one network call. The
system prompt tells Gemini what `null` means: "I didn't find this." `applyExtraction`
honours that signal: null means "skip this field." Together, they guarantee that
extraction is additive — it only sets fields where Gemini found something real.

The alternative — `setForm({ ...prev, ...data })` — treats Gemini's output as ground
truth for every field, including the ones Gemini returned `null` for. If the user had
manually entered their phone number and the resume didn't contain it, their phone is now
`null` in the form state. They click Save, and the number is gone from the DB. This is
not a theoretical risk — resumes regularly omit phone numbers (when submitted through a
platform that already has them), have non-standard formats, or place them in an image
portion the text extractor can't read.

The `!= null` check (not `!== null`) catches both `null` and `undefined`. This matters
because the `ProfileExtraction` type uses optional fields (`phone?: string | null`).
When Gemini omits a field entirely from its JSON response, TypeScript sees `undefined`.
A strict `!== null` check would miss this case — `undefined !== null` is `true`, so
the field would be spread with `undefined`, which is functionally null but passes through
the guard incorrectly.

The array guard is different and for a different reason. `if (data.skills?.length)` guards
on non-empty rather than non-null. An empty array from Gemini (`skills: []`) is a valid
JSON response — it means "I found no skills." But applying an empty array overwrites the
user's manually-entered skill tags with nothing. The guard treats empty arrays as "no
signal" rather than "clear the field."

The `education` check is the most specific: `if (data.education?.degree)`. The `education`
field is always present in Gemini's JSON (it's part of the required shape) — but all its
sub-fields may be `null`. `if (data.education != null)` would pass even when Gemini
returns `{ degree: null, fieldOfStudy: null, institution: null, graduationYear: null }`,
which would overwrite existing education data with all-null. Checking only `degree` is a
proxy for "did Gemini find any education content at all?"

**Checkpoint:** The system prompt says "never guess." Why is this instruction the
necessary counterpart to `applyExtraction`'s null guards — and what breaks if Gemini
ignores it and guesses instead of returning null?

<details>
<summary>Reveal answer</summary>

If Gemini guesses (returns `"mid"` for experience_level when it couldn't actually
determine the level), `applyExtraction` will apply it — the guard passes because
`"mid" != null`. The user would see "Mid-level" selected in the experience dropdown
without noticing it was a guess. If they save without reviewing, the incorrect value
goes to the DB and affects job matching.

The system prompt's "never guess" instruction is the producer side of the null contract:
it tells Gemini to signal uncertainty with `null`. The `!= null` guard is the consumer
side: it treats `null` as "skip." The contract only holds if both sides honour it. If the
prompt were weaker ("use your best judgement"), Gemini would fill every field with plausible
values — and `applyExtraction` would apply all of them, with no way to distinguish
"confidently extracted" from "guessed."

</details>

**Try it yourself:** Open [`agent/extractor.ts`](../../../agent/extractor.ts) and read
the system prompt in full. Count how many fields have explicit enum values listed (not
just a type hint). Then open [`types/index.ts`](../../../types/index.ts) and find the
`ExperienceLevel`, `WorkAuthorization`, and `RemotePreference` types. Confirm each
enum value in the system prompt matches exactly (case-sensitive) to the TypeScript union.
A case mismatch here — `"Senior"` vs `"senior"` — would pass JSON parsing but silently
fail the `<select>` rendering.

---

## Part 5 — Enum constraints in the system prompt: teaching the model its contract

Open [`agent/extractor.ts`](../../../agent/extractor.ts), the system prompt (lines 15–51):

```typescript
const SYSTEM_PROMPT = `You extract profile information from resume text. Return ONLY
valid JSON matching the exact shape below. Use null for any field you cannot
confidently extract — never guess. Allowed enum values are listed exactly.

{
  ...
  "experience_level": "junior" | "mid" | "senior" | "lead" | null,
  "work_authorization": "citizen" | "permanent_resident" | "visa_required" | null,
  "remote_preference": "remote" | "onsite" | "hybrid" | "any" | null,
  ...
}`;
```

Without the explicit enum values, Gemini would produce valid output that breaks the
application in ways that don't produce errors. If the system prompt said `"experience_level":
string | null` and Gemini returned `"Senior Software Engineer"`, three things would happen:

1. `JSON.parse` succeeds — the value is a string, syntactically valid
2. `applyExtraction` applies it — `"Senior Software Engineer" != null` is true
3. The `<select>` for experience level finds no matching `<option>` — it silently stays
   on the default value or displays nothing

No error is thrown. No type guard fires at runtime (TypeScript types are erased). The
form simply doesn't update the expected field. The user would have to notice that the
dropdown didn't change, which is easy to miss.

The system prompt listing exact enum values acts as a runtime constraint, not a
TypeScript constraint. TypeScript catches mismatches at compile time in your own code;
it cannot catch them in external AI output. The system prompt is the only runtime
mechanism that guides Gemini's output toward the values TypeScript expects.

`temperature: 0.3` reinforces this. Lower temperature means more deterministic outputs —
the model converges on the most likely value rather than exploring variations. For
extraction tasks, this is correct: the same resume should produce the same output every
time. A higher temperature would introduce variation in how Gemini interprets the same
experience level, producing inconsistent results across runs.

**Checkpoint:** The system prompt's enum list is maintained by hand. What's the failure
mode when a new enum value is added to `types/index.ts` (say, `"staff"` is added to
`ExperienceLevel`) but the system prompt is not updated?

<details>
<summary>Reveal answer</summary>

TypeScript would accept the new value in all type declarations. The application would
compile without errors. But Gemini would never return `"staff"` — it's not in the
system prompt's allowed values. If a resume clearly described a staff engineer, Gemini
would either pick the closest alternative (`"lead"`) or return `null`. Neither is wrong
from Gemini's perspective; it's following the prompt. But the result is that the new
enum value can never be extracted automatically, even though the type supports it.

The fix: whenever a union type used in `ProfileExtraction` gains a new value, update
the system prompt's allowed values list in the same commit. This is a coupling that
lives in prose rather than code — it can't be enforced by the compiler.

</details>

**Try it yourself:** Add `| "contract"` temporarily to the `work_authorization` field in
both `types/index.ts` and the `ProfileExtraction` type in `agent/extractor.ts`. Run
`npm run build` — confirm it compiles. Now check: is `"contract"` in the system prompt?
If not, what would Gemini return for a resume that lists "contract worker" under
employment type? Revert the change when done.

---

## Part 6 — No auto-save: making the quality gate explicit in the UX

From [`docs/architect/07-profile-extraction/discussion.md`](../../architect/07-profile-extraction/discussion.md):

```
Extraction errors are invisible until you look. Gemini might misparse a date,
hallucinate a skill, or misidentify the experience level. If we auto-saved, the user
would need to go back and correct the DB record — a more destructive flow than just
reviewing before saving.

The user's profile is their ground truth. The profile is used for job matching. An
incorrect save from a bad extraction would affect every subsequent job score.
```

And from [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx),
the success banner text:

```tsx
<p className="text-sm text-success mb-3">
  Profile filled in from your resume — review the fields below
  and save when ready.
</p>
```

The word "review" is not filler. It is the UX instruction that makes the quality gate
explicit to the user. Without it, a user might see the populated form and click Save
without reading anything — treating the AI's output as ground truth. "Review" signals
that their next action is reading, not clicking.

The no-auto-save decision connects to the feature's position in the user's workflow.
The profile is the foundation for job matching — every job will be scored against it.
A hallucinated skill (`"Kubernetes"` appearing once in a job description the user helped
write) would appear in every subsequent match. The cost of a bad extraction that auto-saves
is not one wrong field — it's contaminated job scores for every future search.

This is the specific case where the quality gate matters most: when AI output feeds
downstream systems rather than being displayed in isolation. If extraction populated a
preview-only field that was never used for matching, auto-save would be less risky. But
skills, experience level, and job titles feed the matching algorithm directly — every
field extracted is an input to a future computation.

The architecture enforces this: `applyExtraction` calls `setForm`, `setSkills`, etc. —
React state setters. Nothing writes to the DB. The only path to DB persistence is the
user clicking "Save Profile," which fires the existing `saveProfile` Server Action
established in Feature 06. The save path has not changed; only the form population path
has been added.

**Checkpoint:** A product manager proposes "Extract and Auto-Save" as a power user
feature — one click, no review. Describe the complete architectural change required,
and name the invariant from `CLAUDE.md` that would need to be updated if implemented.

<details>
<summary>Reveal answer</summary>

The change would require: (1) `applyExtraction` calling `saveProfile` after populating
state, or (2) the API route writing to the DB before returning. Option 2 is more
efficient — the server already has the extraction data and could write it directly.

But Option 2 changes the route from a pure data-returning agent operation to an agent
operation with a DB side-effect — which is architecturally valid (the job matching route
will also write to the DB). The change isn't impossible; it requires updating the route
and removing the "extraction does not write to the DB" invariant from `plan.md`.

The CLAUDE.md invariant to update: "Agent operations → API route → agent/ function →
AI → DB write" already supports this. The specific project invariant from `plan.md` that
would change is: "Extraction does not write to the DB — the user reviews populated fields
and saves manually via the existing `saveProfile` Server Action." If the feature ships,
this line should be removed and the commit message should explain why the quality gate
was relaxed.

</details>

**Try it yourself:** Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts).
Find the line that returns `NextResponse.json(result)`. This is the only output of the
route — it returns data, writes nothing. Now open [`actions/profile.ts`](../../../actions/profile.ts)
and find `saveProfile`. Notice that it is still the only function that writes to the
`profiles` table. The extraction route has zero DB writes. Confirm this architectural
separation is maintained.

---

## Decision dependency trace: how the four decisions connect

The four decisions of this session have a dependency order. Changing Decision 1 would
cascade into all four. Changing Decision 2 would not affect Decisions 3 or 4.

```
Decision 1: Extraction is an API route + agent/
  │
  └── establishes that agent/extractor.ts exists
        │
        ├── Decision 3: Route downloads from storage (the route exists to do so)
        │     │
        │     └── enables the stateless download pattern
        │
        └── Decision 5 (system prompt): Gemini call lives in agent/, prompt defined there
              │
              └── Decision 4: applyExtraction honours null from the system prompt

Decision 2: Extract button inside ProfileForm
  │
  └── independent of Decisions 3, 4, 5 (state ownership is a component-topology
      concern — it doesn't affect the server-side architecture)
```

**Decision 2 is the only isolated decision.** The component placement could change
(extract button moved to a child `ResumeSection` component) without touching the route,
the storage download, or `applyExtraction`. All other decisions are coupled: if extraction
moved to a Server Action (reversing Decision 1), the server-side storage download would
become a more awkward pattern (Server Actions can still download from storage, but the
return value shape differs), and the null contract with the system prompt would need to
survive into the new location.

---

## Self-check quiz

<details>
<summary><strong>1. The extraction feature is an AI operation that does not write to the DB. Some might argue this makes it closer to a "read" operation and suitable for a Server Component data fetch. Why is it still an API route?</strong></summary>

A Server Component data fetch is read-only data fetched at render time, before the page
is displayed. Extraction is user-triggered (a button click) and returns dynamic data that
varies based on AI output — it cannot be fetched at page render time. More fundamentally,
it calls an AI model, which places it in the "agent operation" category regardless of
whether it writes to the DB. The category is determined by what the operation does
(calls AI), not by its output (returns data vs writes DB).

</details>

<details>
<summary><strong>2. Why is `page.tsx` being a Server Component the decisive constraint that prevents ResumeSection from being a sibling of ProfileForm wired through the page?</strong></summary>

Server Components cannot hold client state (`useState`) and cannot pass callbacks to
children. For `ResumeSection` to update `ProfileForm`'s state via `page.tsx`, the page
would need to hold the shared state — which it cannot. The only alternative is a new
client wrapper component (`ProfilePageClient.tsx`) that replaces `page.tsx`'s role for
the form area. That wrapper would need to receive all form state currently in `ProfileForm`,
which is a complete rewrite of Feature 05 and 06's component architecture.

</details>

<details>
<summary><strong>3. `applyExtraction` uses `!= null` for scalar fields and `.length` for arrays. A teammate proposes unifying them: use `!= null` for everything (since an empty array also passes `!= null`). What breaks?</strong></summary>

For arrays, `if (data.skills != null)` would apply an empty array from Gemini
(`skills: []`) — wiping the user's manually-entered skill tags with nothing. An empty
array from Gemini means "I found no skills," not "the user has no skills." The `.length`
guard treats empty as "no signal" and preserves existing data. The `!= null` check for
scalars works because `null` is Gemini's explicit "I didn't find this" signal — there's
no meaningful distinction between `null` and empty for scalars. For arrays, there is:
`null` means "not returned" while `[]` means "returned but empty."

</details>

<details>
<summary><strong>4. The system prompt says "never guess" but this is unenforceable — Gemini might ignore it. What is the one-line code change in `applyExtraction` that would make extraction safer if Gemini guesses on enum fields?</strong></summary>

After `JSON.parse(raw)`, add a validation step that checks enum fields against their
allowed values before passing to `applyExtraction`:
```typescript
if (data.experience_level && !["junior","mid","senior","lead"].includes(data.experience_level)) {
  data.experience_level = null;
}
```
This treats unrecognized enum values as null — preserving the existing form value rather
than applying a guessed one. The same pattern applies to `work_authorization` and
`remote_preference`. This is belt-and-suspenders: the system prompt is the first line of
defence, validation is the second.

</details>

<details>
<summary><strong>5. Why does `handleExtract` call `setExtractResult(null)` before `startExtract` rather than as the first line inside `startExtract`?</strong></summary>

`startExtract` schedules its callback as a non-urgent React transition — React may
not execute it synchronously. If `setExtractResult(null)` were inside `startExtract`,
the previous error or success banner would remain visible for a brief moment at the
start of the new extraction. By calling it before `startExtract`, the clear happens
synchronously as part of the click handler — the UI is clean immediately when the user
clicks, before the transition begins.

</details>

---

## Extend it (challenges)

### Challenge 1 — Trace: map all three CLAUDE.md data flows to actual files (20–30 min)

`CLAUDE.md` defines three data flow patterns. Your task: for each pattern, find a
concrete example that exists in the codebase right now and trace it end-to-end.

```
Pattern 1: UI mutations → Server Action → DB write
Pattern 2: Agent operations → API route → agent/ function → AI → (optional DB write)
Pattern 3: Data fetch → Server Component → InsForge DB read
```

For each pattern, write out:
- Which user action triggers it
- Which files are involved (in order)
- Which line or function at each layer is the entry point
- What the output is (response type, UI change, etc.)

Use only code that exists in the repo right now. Do not invent examples.

<details>
<summary>Hint</summary>

Pattern 1: Look at `actions/profile.ts` — `saveProfile` is the clearest example. Trace
from the "Save Profile" button in `ProfileForm.tsx` through to the InsForge DB write.

Pattern 2: `app/api/profile/extract/route.ts` is the only current example. Trace from
the "Extract from Resume" button click through `handleExtract` → `fetch` → route →
`agent/extractor.ts` → Gemini.

Pattern 3: `app/profile/page.tsx` fetches the user's profile row before rendering.
Find where `createInsforgeServer()` is called and what data is passed to `ProfileForm`.

</details>

---

### Challenge 2 — Design: architect Feature 08 (job matching) before seeing the plan (30–40 min)

Feature 08 will let users click "Find Jobs" to search Adzuna for IT jobs, score each
result against their profile using Gemini, and save the matches to a `jobs` DB table.

Using only what you know from the four decisions in this tutorial, design the architecture:

1. Which file should the Adzuna API call live in? Why?
2. Which file should the Gemini scoring call live in?
3. Should there be one `agent/` file or two? What's the criterion?
4. Should the route write to the DB, or return results for the client to save?
5. What would the `POST /api/agent/jobs` route handler look like (pseudocode)?

Write your answers before checking the actual implementation in `context/build-plan.md`.

<details>
<summary>Hint</summary>

Apply Decision 1's criterion: both Adzuna and Gemini are external AI/API calls → both
belong in `agent/`. Whether they go in one file or two depends on cohesion: if they're
always called together, one file is simpler. If they can be called independently, two
files keeps them composable.

For DB writes: the route writes to the DB for agent operations that produce persistent
results (unlike extraction, which produces ephemeral UI state). Job scores are persistent
— they need to survive page refreshes and feed future features. The route should write
to the DB.

</details>

---

### Challenge 3 — Design: a first-time user experience for extraction (40–60 min)

Currently, the Extract button only appears when `resumeFileName !== null`. A new user
who hasn't uploaded a resume yet sees no extraction affordance.

Design a "first-time flow" where the profile page, on first visit, shows a prominent
call-to-action: "Upload your resume to auto-fill your profile." After upload, the Extract
button immediately appears and the extraction runs automatically.

Answer these questions before writing any code:

1. Where does the "first visit" state live — DB, local storage, or React state?
2. After automatic extraction, should the results auto-save? Revisit Decision 6 —
   does the reason for the quality gate change in a first-time context?
3. If auto-save is acceptable on first visit but not on subsequent visits, how does
   the route know which case it's handling?
4. Which CLAUDE.md invariant would need to be updated to support case-conditional
   auto-save?

Write your design as a one-page spec. Then evaluate: does the complexity this adds
justify the UX improvement?

<details>
<summary>Hint</summary>

"First visit" state is cleanest in the DB — an `extraction_count` int column on
`profiles` (0 on creation, incremented after each extraction). The route reads it,
auto-saves only when `extraction_count === 0`, increments it before returning.

But revisit the quality gate: on first visit, the user has no manually-entered data to
lose. The risk of overwriting existing values with null is zero. So the argument against
auto-save (Part 6) doesn't apply. The case for a quality gate is weaker when the form
is empty — but the case against Gemini hallucinations remains. A hallucinated skill still
affects job matching whether it's the user's first session or their tenth.

The invariant to update: "Extraction does not write to the DB" would become conditional
on extraction count. This is a significant weakening of a clean invariant.

</details>

---

For deeper exploration, `docs/architect/07-profile-extraction/ai-discussion-topics.md`
has 25 prompts grouped across the system prompt contract, the Gemini/OpenAI SDK
boundary, API route vs Server Action reasoning, state ownership, and the null-safe
population pattern. Feed them to an LLM *after* forming your own answer first — the gap
between what you thought and what you learn is where understanding lands.
