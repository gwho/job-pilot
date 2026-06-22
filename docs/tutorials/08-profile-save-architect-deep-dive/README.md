# Tutorial 08 — Profile Save Architect Session: Plan Comparison, SDK Verification, and Structural Decisions

**After completing this tutorial you will understand:** how to run an architect session
that compares two competing implementation plans and extracts the best ideas from each,
why duplicated business logic across client and server is a silent correctness risk and
how to eliminate it with a shared utility, how a TypeScript named union type acts as a
contract between three call sites, why an SDK documentation file can be wrong and how to
verify it against the actual installed package, and how the choice to fire resume upload
on file-pick (rather than on save) was a deliberate UX and architecture decision.

This tutorial is based on the architect session in
[`docs/architect/06-profile-save/`](../../architect/06-profile-save/) and the
implementation those decisions produced, which is covered in full in Tutorial 07.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 07 (`07-profile-save/README.md`) — the complete implementation of what
>   this architect session designed. Read it first so every decision here has a concrete
>   code referent you have already seen.
> - Tutorial 06 (`06-profile-page/README.md`) — `ProfileForm`'s state buckets and
>   the `useMemo`-derived completion percentage that this session restructured.
>
> Open [`docs/architect/06-profile-save/decisions.md`](../../architect/06-profile-save/decisions.md),
> [`docs/architect/06-profile-save/discussion.md`](../../architect/06-profile-save/discussion.md),
> [`lib/profile-utils.ts`](../../../lib/profile-utils.ts),
> [`actions/profile.ts`](../../../actions/profile.ts), and
> [`types/index.ts`](../../../types/index.ts) alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these warm-up prompts in a separate AI session before reading any code. Each prompt
builds one piece of the mental model you need. Budget 20–30 minutes. Do not paste any
project code — keep the AI conversation in plain concepts and tiny invented examples.

### Concept 1 — Comparing competing implementation plans

> "I am about to study how two competing implementation plans were compared and merged.
> Explain the general value of having a second plan (from a different source) before
> starting to build. What are the structural things a second plan tends to catch that the
> first one misses? Give me three concrete examples. Then ask me: what's the difference
> between a plan that adds a feature and a plan that catches a structural problem in the
> first plan?"

*What to listen for:* A second plan tends to catch missing abstractions (shared logic
that the first plan duplicates), incorrect scope (a step bundled together that should be
separate), and assumptions about libraries that turn out to be wrong. The most valuable
catch is not a new feature — it is a structural problem in the first plan that would have
compounded into hard-to-untangle code.

*Practice question:* If your original plan calculates something in two places and the
second plan extracts it to one shared function, what category of problem does that fix?

---

### Concept 2 — Duplicated business logic across client and server

> "I have a completion percentage that shows in the browser as the user types, AND needs
> to be computed in a Server Action to write `is_complete` to the database. If I write
> the logic in two places — once in a React useMemo, once in the Server Action — what
> is the exact failure mode? Give me one realistic example of how a seemingly harmless
> change to one side makes the two implementations diverge. Then quiz me: name three
> signals that tell you it is time to extract shared logic to a standalone utility."

*What to listen for:* The failure mode is silent. Both implementations compile, both
pass their own checks, but they disagree on what counts as "complete." The UI might show
100% while the server stores `is_complete = false`. The PostHog event never fires. Job
matching never triggers. Nothing crashes — it's just wrong. The fix is a function in
`lib/` that neither side replicates, only imports.

*Practice question:* The shared utility lives in `lib/`. Why not in `components/`? Why
not in `actions/`?

---

### Concept 3 — TypeScript named union types as explicit contracts

> "Explain the difference between `string[]` and a named union type like
> `type MissingField = 'FULL NAME' | 'EMAIL' | 'PHONE'`. If a function returns
> `MissingField[]`, what does TypeScript enforce that `string[]` does not? Show me how
> adding a new required field to the named union makes the compiler catch every call site
> that needs to handle it. Then quiz me on when a named union is worth the ceremony versus
> when plain string is fine."

*What to listen for:* A named union turns the set of valid values into a compiler-checked
contract. If you add `'LINKEDIN'` to the union, TypeScript flags every exhaustive switch
or render that doesn't handle it yet. `string[]` provides no such guarantee. The cost is
that you need to update the type when the set changes — which is the point.

*Practice question:* If `MissingField` lives in `types/index.ts` and is used in
`lib/profile-utils.ts`, `actions/profile.ts`, and `components/profile/ProfileForm.tsx`,
what has to change in all three files when you add a new required field?

---

### Concept 4 — How SDK documentation can be wrong and how to verify it

> "Library documentation can go out of date or contain errors. What are the most reliable
> ways to verify what an SDK actually supports, when the documentation says one thing?
> Specifically: if a library's docs say `upload({ upsert: true })` is a valid call, how
> would you check whether that option actually exists? Give me two verification strategies
> and explain their trade-offs."

*What to listen for:* The two most reliable strategies are (1) reading the installed type
definition files in `node_modules/<package>/dist/*.d.ts` — if the option isn't in the
type signature, it doesn't exist; and (2) reading the source or compiled JS to see what
the function body actually does with its arguments. Documentation can be aspirational,
copy-pasted from another SDK, or outdated. The installed types never lie about what the
current version accepts.

*Practice question:* You find `upload({ upsert: true })` in a project's `library-docs.md`
but not in the SDK's TypeScript types. What do you do, and what downstream code needs to
change?

---

### Concept 5 — UX decisions in save flows: immediate vs. bundled operations

> "I have a profile form with a text fields section and a file upload section. I could
> wire them so a single Save button saves everything together, OR I could fire the file
> upload immediately when the user picks a file and keep the Save button for text fields
> only. Walk me through the UX and architectural trade-offs of each approach. What does
> the user experience in each case? What does the code architecture look like differently?
> Then ask me: are there cases where bundling is clearly better and cases where separation
> is clearly better?"

*What to listen for:* Immediate upload gives the user feedback right away — they see the
spinner resolve before doing anything else with the form. Bundled upload means the user
has to wait for both file upload (slow) and text save (fast) to complete together before
getting any confirmation. The architectural difference is that immediate upload is a
separate Server Action with its own pending state, while bundled is a single action that
must handle both binary data (FormData) and typed text fields simultaneously.

*Practice question:* If resume upload is immediate, what happens if the user uploads a
file and then closes the browser without clicking Save? Is that acceptable, and why?

---

## The session in one diagram

```
Before architect session                  After architect session
────────────────────────────              ────────────────────────────────────
Our plan:                                 Merged plan:
  - completion inline in useMemo          - calculateCompletion in lib/ (shared)
  - completion inline in Server Action    - MissingField named union in types/
  - resume upload inside saveProfile      - uploadResume fires on file pick
  - typed object parameter                - typed object for save, FormData for upload
  - string[] for missing fields           - insforge.database.from() (not .from())
  - assumes upsert: true in storage       - remove() before upload
                                          - email from session (not form state)

Cursor's additions:
  - calculateCompletion shared utility    What the session caught:
  - MissingField named union              - library-docs.md: upsert: true is wrong
  - uploadResume as separate action       - library-docs.md: insforge.from() is wrong
  - ProfileAttentionBanner (deferred)     Verified against actual SDK types
```

**Key invariant 1:** `calculateCompletion` in `lib/profile-utils.ts` is the only place
completion logic lives. Neither the form nor the Server Action implements its own version.

**Key invariant 2:** Every decision in the architect session's `decisions.md` corresponds
to a specific failure mode in the rejected alternative. A decision without a named failure
mode is a preference, not a structural choice.

---

## Part 1 — Running the comparison: what each plan contributed

Open [`docs/architect/06-profile-save/discussion.md`](../../architect/06-profile-save/discussion.md).

The session started from two independent plans: the team's original plan and a
Cursor-generated plan. Here is exactly what each side contributed:

**Our original plan contributed:**
- The typed object parameter for `saveProfile` — correct
- Email sourced from the auth session — correct
- The intent to wire the inert Save button

**Cursor's plan contributed three structural improvements:**

```
1. MissingField type in types/index.ts
   → explicit type contract for the missing-fields return value

2. lib/profile-utils.ts with calculateCompletion()
   → shared by ProfileForm's useMemo AND the Server Action
   → eliminates the risk of their logic diverging

3. uploadResume as a separate Server Action
   → fires on file pick, not on Save
   → gives immediate feedback; keeps Save scoped to text fields
```

**Cursor's plan also proposed:**

```
4. ProfileAttentionBanner extracted as its own component
   → nice refactor but not blocking Feature 06
   → deferred
```

The session's job was to evaluate each structural addition. Items 1–3 were adopted
because each one eliminated a real failure mode. Item 4 was deferred because it was a
refactor — the inline banner already works.

This is the key distinction a good architect session makes: **does this addition fix a
failure mode, or does it just make the code nicer?** If it's the former, adopt it. If
it's the latter, assess whether it's in scope.

**Checkpoint:** What is the structural difference between adopting MissingField type (item 1)
and deferring ProfileAttentionBanner extraction (item 4)?

<details>
<summary>Reveal answer</summary>

`MissingField` creates a shared type contract between `lib/profile-utils.ts`,
`actions/profile.ts`, and `components/profile/ProfileForm.tsx`. Without it, those three
call sites are all working with raw `string[]` — the compiler cannot catch drift if a
field name changes. `ProfileAttentionBanner` extraction is a UI refactor that changes
nothing about correctness, data flow, or contracts. The inline banner already renders
correctly. Extraction is deferred because it adds zero Feature 06 value.

</details>

**Try it yourself:** Open [`docs/architect/06-profile-save/decisions.md`](../../architect/06-profile-save/decisions.md)
and find the "Reason" column. For each decision, identify whether the reason names a
failure mode ("prevents X") or a preference ("cleaner", "nicer"). Decisions that name a
failure mode are structural. Preferences are candidates for deferral.

---

## Part 2 — The divergence problem: why shared `calculateCompletion` was the structural fix

Open [`lib/profile-utils.ts`](../../../lib/profile-utils.ts):

```typescript
import type { MissingField } from "@/types/index";

type CompletionInput = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  current_title?: string | null;
  experience_level?: string | null;
  years_experience?: number | string | null;
  skills?: string[] | null;
  work_experience?: unknown[] | null;
  education?: { degree?: string | null } | null;
};

type CompletionResult = {
  percentage: number;
  missingFields: MissingField[];
};

export function calculateCompletion(p: CompletionInput): CompletionResult {
  const missingFields: MissingField[] = [];

  if (!p.full_name?.trim()) missingFields.push("FULL NAME");
  if (!p.email?.trim()) missingFields.push("EMAIL");
  if (!p.phone?.trim()) missingFields.push("PHONE");
  if (!p.location?.trim()) missingFields.push("LOCATION");
  if (!p.current_title?.trim()) missingFields.push("CURRENT TITLE");
  if (!p.experience_level) missingFields.push("EXPERIENCE LEVEL");

  const yoe = Number(p.years_experience);
  if (!p.years_experience || isNaN(yoe) || yoe <= 0) missingFields.push("YEARS EXP");

  if (!p.skills || p.skills.length === 0) missingFields.push("SKILLS");
  if (!p.work_experience || p.work_experience.length === 0) missingFields.push("WORK EXPERIENCE");
  if (!p.education?.degree) missingFields.push("EDUCATION");

  const total = 10;
  const filled = total - missingFields.length;
  const percentage = Math.round((filled / total) * 100);

  return { percentage, missingFields };
}
```

The original plan kept two implementations: one `useMemo` inside `ProfileForm` for the
live ring, and a parallel block inside `saveProfile` to compute `is_complete`. Here is
the exact failure mode that parallel implementation creates:

```
Developer adds "PORTFOLIO URL" as a new required field.
They update the useMemo check.
They forget the parallel check in saveProfile.

Result:
  - ProfileForm shows 100% once portfolio_url is filled
  - saveProfile computes is_complete = false (the old 10 checks, no portfolio)
  - profile_completed PostHog event never fires
  - Job matching never marks this user as ready
  - No crash, no error, no TypeScript violation
```

The shared utility eliminates this at the source. There is exactly one place to update.
The TypeScript types enforce the input shape. Both call sites import and call the same
function.

### Why `CompletionInput` uses wide types

Notice the input type:

```typescript
experience_level?: string | null;
years_experience?: number | string | null;
work_experience?: unknown[] | null;
```

The `Profile` database type has `experience_level: ExperienceLevel | null`. The
`ProfileSavePayload` has `experience_level: ExperienceLevel | ""`. The utility accepts
both because it only needs to know whether the value is present — not which literal
variant. `string | null` is wide enough for both callers without coupling the utility to
either type surface. `years_experience` accepts both `number` (from the DB) and `string`
(from the form), because both call sites need it and the coercion to `Number()` happens
inside.

**Checkpoint:** Why is `years_experience?: number | string | null` in `CompletionInput`
instead of just `number | null` (which matches the DB column exactly)?

<details>
<summary>Reveal answer</summary>

`ProfileForm` stores `years_experience` as `string` because HTML inputs return strings.
When `calculateCompletion` is called from the `useMemo` in `ProfileForm`, it passes a
`string` value. When called from `saveProfile`, it passes the typed payload value which
is also `string` (the `ProfileSavePayload` keeps it as `string` for the same reason).
If the type were `number | null`, the form's call site would fail TypeScript validation.
The wide type makes the utility importable from both callers without type coercion at the
call site.

</details>

**Try it yourself:** Open `lib/profile-utils.ts` and temporarily change
`years_experience?: number | string | null` to `years_experience?: number | null`. Then
open `actions/profile.ts` around line 68 where `calculateCompletion` is called. Does
TypeScript flag it? Why or why not?

---

## Part 3 — `MissingField` as a named type contract

Open [`types/index.ts`](../../../types/index.ts) lines 21–30:

```typescript
export type MissingField =
  | 'FULL NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'LOCATION'
  | 'CURRENT TITLE'
  | 'EXPERIENCE LEVEL'
  | 'YEARS EXP'
  | 'SKILLS'
  | 'WORK EXPERIENCE'
  | 'EDUCATION'
```

This type is imported in three places:

- `lib/profile-utils.ts` — the function that pushes to `missingFields: MissingField[]`
- `actions/profile.ts` — `import type { ... MissingField ... } from "@/types/index"`
  (indirectly, through `calculateCompletion`'s return type)
- `components/profile/ProfileForm.tsx` — the banner renders `missingFields.map(field => ...)`

Without `MissingField`, those three places all work with `string[]`. The immediate
problem is not runtime behaviour — `string[]` works at runtime. The problem is that
`string[]` makes no compiler guarantee about what strings can appear. Consider what
happens when a new required field is added:

```
With string[]:
  Developer adds check in calculateCompletion: missingFields.push("LINKEDIN URL")
  The banner renders it correctly.
  Profile page, dashboard, or future agent code might switch on missing fields.
  TypeScript has no way to catch the code that doesn't yet handle "LINKEDIN URL".
  The gap is silent.

With MissingField:
  Developer adds 'LINKEDIN URL' to the union in types/index.ts.
  TypeScript flags every exhaustive switch that doesn't include the new member.
  The compiler becomes the checklist.
```

The named union doesn't just document the valid values — it makes the compiler enforce
completeness wherever the type is handled exhaustively. This is the "named union as
contract" pattern: the type is the specification, and TypeScript is the auditor.

### The cost and when it's worth it

The cost is maintenance: adding a required field means touching `types/index.ts` in
addition to `lib/profile-utils.ts`. For a type used in one place, this overhead is not
worth it. For a type that crosses three modules (`lib/`, `actions/`, `components/`), it
earns its keep — each module now has a shared vocabulary for what "missing" means.

**Checkpoint:** Imagine the team adds `'LINKEDIN URL'` to `MissingField` and the push
in `calculateCompletion`. The banner in `ProfileForm` currently maps over `missingFields`
and renders each as a pill. Is there any TypeScript error? Why or why not?

<details>
<summary>Reveal answer</summary>

No TypeScript error — the banner uses `.map(field => ...)` which accepts any member of
the union without exhaustive handling. Named unions only trigger compiler errors on
exhaustive switches (`switch (field) { case "FULL NAME": ... }`). A simple `.map()`
renders any new member automatically. The value of `MissingField` here is documentation
clarity and the protection it provides at *other* call sites that do need to handle
specific values — for example, analytics code or future matching logic that checks for a
specific missing field by name.

</details>

**Try it yourself:** In `types/index.ts`, add `| 'TEST FIELD'` to the `MissingField`
union. In `lib/profile-utils.ts`, do NOT add a corresponding push. Run
`npm run build` or `npm run lint`. Does anything complain? Then revert. This shows you
that the named union's enforcement only activates when a switch is exhaustive — the
utility itself won't complain about the unused type member.

---

## Part 4 — Separate `uploadResume`: the UX and the architecture

The original plan bundled resume upload inside `saveProfile` — one action, one click.
The architect session adopted Cursor's recommendation: a separate `uploadResume` Server
Action that fires when a PDF file is picked.

Open [`actions/profile.ts`](../../../actions/profile.ts) lines 145–215. The key decision
is at the parameter level:

```typescript
export async function saveProfile(
  payload: ProfileSavePayload,
): Promise<{ success: boolean; error?: string }> {
```

```typescript
export async function uploadResume(
  formData: FormData,
): Promise<{ success: boolean; key?: string; url?: string; filename?: string; error?: string }> {
```

`saveProfile` accepts a typed object. `uploadResume` accepts `FormData`. The
[`decisions.md`](../../architect/06-profile-save/decisions.md) records the reason:

> *"File upload requires FormData; text fields are cleaner as typed args"*

This is a JavaScript constraint, not a stylistic one. `File` objects cannot be serialized
to JSON — they are binary. Server Actions that receive `File` must use `FormData`. Text
fields, on the other hand, serialize cleanly as typed parameters, and the TypeScript
type checker validates the full `ProfileSavePayload` shape at the call site.

### The UX consequence of separation

Bundled save:

```
User picks file →
User fills all text fields →
User clicks Save →
[file upload: 2-5 seconds] + [DB write: ~200ms] =
UI shows spinner for 2-5 seconds on a click that feels like it should be fast
```

Separate upload:

```
User picks file →
[file upload fires immediately: 2-5 seconds with its own spinner]
[User continues filling text fields during the upload]
User clicks Save →
[DB write: ~200ms — fast, focused]
```

The user's perception of the Save button changes completely. With bundled save, a slow
network makes every Save feel broken. With separate upload, the slow operation already
ran while the user was working.

### The accepted trade-off

The architect session notes this explicitly:

> *"The resume URL is in the DB before the profile is saved. If the user uploads a resume
> and then closes the browser without saving, they have a resume key but incomplete profile
> fields. Acceptable for this use case."*

This is a deliberate design choice, not an oversight. Orphaned resume objects in storage
are a minor storage cost. The UX win of immediate upload feedback outweighs it.

**Checkpoint:** Why can't `saveProfile` just accept `File` as part of its typed object
parameter, avoiding the need for two separate actions?

<details>
<summary>Reveal answer</summary>

`File` objects are binary and cannot be serialized as JSON. Next.js Server Actions that
receive a typed object serialize the arguments as JSON over the network. A `File` would
either be stripped or cause a serialization error. `FormData` is the only transport
that supports binary payloads in Server Actions, which is why `uploadResume` must use it.
Separating the actions is not just a UX decision — it is a constraint of the protocol.

</details>

**Try it yourself:** In `components/profile/ProfileForm.tsx`, find the `handleFileChange`
handler. Notice that it calls `uploadResume(formData)` inside a `startTransition` — not
inside `handleSave`. Trace the call site and confirm that `handleSave` never calls
`uploadResume`. This verifies the separation at the call site, not just the parameter level.

---

## Part 5 — Catching the `upsert: true` SDK documentation error

This is the most important catch of the architect session: an error in
`context/library-docs.md` that would have caused a production bug.

The original `library-docs.md` documented the storage upload pattern as:

```typescript
// WRONG — this does not exist in the InsForge SDK
await insforge.storage.from("resumes").upload(path, file, { upsert: true });
```

The session verified this against the actual installed SDK type definition. Open your
terminal and run:

```bash
grep -n "upsert" node_modules/@insforge/sdk/dist/client-BR9o-WUm.d.ts | head -20
```

If `upsert` does not appear in the storage upload signature, the option doesn't exist.
The SDK simply does not support overwrite — when you upload to an existing path, it
auto-renames the file by appending a timestamp:

```
First upload:   userId/resume.pdf
Second upload:  userId/resume-1705315200000.pdf  ← SDK auto-renamed, old file still present
Third upload:   userId/resume-1705398400000.pdf  ← another accumulation
```

Old files pile up. The profile row points to the latest URL, but storage bills for all
of them. This is the failure mode of believing the documentation over the types.

### The correct pattern from the real SDK

Open [`actions/profile.ts`](../../../actions/profile.ts) lines 169–198:

```typescript
// Remove existing file if one exists
const { data: existing } = await insforge.database
  .from("profiles")
  .select("resume_pdf_key")
  .eq("id", userId)
  .maybeSingle();

if (existing?.resume_pdf_key) {
  await insforge.storage.from("resumes").remove(existing.resume_pdf_key);
}

// Upload new file — path is deterministic; SDK may suffix if race condition
const { data: uploadData, error: uploadError } = await insforge.storage
  .from("resumes")
  .upload(`${userId}/resume.pdf`, file);
```

The sequence:
1. Read `resume_pdf_key` from the profile row (not `resume_pdf_url` — the key is the storage object identifier)
2. Call `remove(key)` to delete the old file if one exists
3. Upload the new file to the same deterministic path
4. Save the new `key`, `url`, and `filename` back to the profile row

Notice `remove()` failure is silently swallowed. If the old file was already deleted from
storage (by a previous partial failure), `remove()` would return an error and the upload
would still work correctly. Blocking on a `remove()` failure is the worse default — it
would prevent re-upload after any partial state.

### Why `resume_pdf_key` rather than using the URL to delete

Storage SDKs identify objects by their storage path (the key), not by their public URL.
The URL may include a CDN hostname, query parameters, or signed tokens that are not part
of the storage object's identity. `resume_pdf_key` stores the raw path
(`userId/resume.pdf`) that the storage API uses for `remove()` and `createSignedUrl()`.
The URL is for display and for embedding in HTML — the key is for operations.

**Checkpoint:** If the code called `remove(existing.resume_pdf_url)` instead of
`remove(existing.resume_pdf_key)`, what would happen?

<details>
<summary>Reveal answer</summary>

`remove()` expects a storage object key (a path like `userId/resume.pdf`), not a URL.
A URL contains the full hostname and possibly a CDN prefix or signed token. Passing a URL
to `remove()` would either return a "not found" error (if the SDK tries to look up the
exact string as a key and fails) or silently do nothing. The old file would not be
deleted, and files would pile up on re-upload — exactly the bug the remove-then-upload
pattern was designed to prevent.

</details>

**Try it yourself:** In your terminal, run:

```bash
grep -n "remove\|upload" node_modules/@insforge/sdk/dist/*.d.ts | grep "storage" | head -20
```

Find the type signature for `upload()`. Confirm whether `upsert` appears as a valid
option. This is exactly the verification step the architect session performed.

---

## Part 6 — Catching the `insforge.from()` DB path error

The second SDK error was less dramatic but equally real. The project's
`context/library-docs.md` documented DB queries as:

```typescript
// WRONG — insforge.from() does not exist
const { data } = await insforge.from("profiles").select("*");
```

The session verified the actual client type definition:

```bash
grep -n "from\b" node_modules/@insforge/sdk/dist/client-BR9o-WUm.d.ts | head -20
```

The database accessor lives at `insforge.database`, not at the top level of the client.
The correct pattern:

```typescript
const { data } = await insforge.database.from("profiles").select("*");
```

Open [`actions/profile.ts`](../../../actions/profile.ts) line 59 and line 83:

```typescript
const { data: existing } = await insforge.database
  .from("profiles")
  .select("is_complete")
  .eq("id", userId)
  .maybeSingle();
```

```typescript
const { error: upsertError } = await insforge.database
  .from("profiles")
  .upsert([{ ... }]);
```

Every DB call in the project uses `insforge.database.from()`. If the original pattern
from `library-docs.md` had been used, every DB call would have thrown a runtime error:
`TypeError: insforge.from is not a function`. This would have surfaced immediately at
runtime, but only after writing code against a wrong API.

### The meta-lesson: documentation files are part of the system

`context/library-docs.md` is referenced before writing any third-party library code (see
`AGENTS.md` — "Before any third party library — load its installed skill first, then read
`context/library-docs.md`"). That means errors in `library-docs.md` compound: every
subsequent feature that follows the wrong pattern inherits the bug.

The architect session corrected both errors in `library-docs.md` before writing a line
of Feature 06 code. This is why the verification step against the actual SDK types is
not optional — it is the safeguard that keeps the reference documentation accurate.

**Checkpoint:** Why is `insforge.from()` not a more serious bug than `upsert: true`
(even though both are documentation errors)?

<details>
<summary>Reveal answer</summary>

`insforge.from()` would fail immediately with a runtime `TypeError` the first time any
DB call ran. It's a loud error that surfaces in the first test of any feature. `upsert: true`
is a silent bug — the upload succeeds, the SDK just auto-renames the file instead of
replacing it. Files accumulate in storage without any error being thrown. Silent,
accumulatory bugs are harder to detect than loud ones. That makes the `upsert: true` error
the more dangerous of the two despite being the less dramatic discovery.

</details>

**Try it yourself:** Run the following in your terminal to verify the current
`library-docs.md` has the correct storage pattern:

```bash
grep -n "remove\|upload\|upsert" /Users/jessejames/Desktop/job-pilot/context/library-docs.md | head -20
```

If the file was corrected by the architect session, you should see `remove()` in the
storage section and no `upsert: true` on uploads.

---

## Full data flow: what the architect session changed between "plan" and "built"

This trace shows the diff between the original plan (before the session) and what was
actually built, following a profile save operation from UI click to DB write.

**Without architect session corrections (the original plan):**

```
1. User clicks Save
2. handleSave collects form state + file
3. Calls saveProfile(payload, file) — bundled
4. saveProfile: reads session → auth OK
5. Computes is_complete inline (copy of useMemo logic, will drift)
6. Calls insforge.from("profiles").upsert(...)
                ↑ WRONG — RuntimeError: insforge.from is not a function
```

The first DB call would crash. Even if the API path were correct:

```
7. Uploads file inline: insforge.storage.from("resumes").upload(path, file, { upsert: true })
                                                          ↑ WRONG — option silently ignored
                                                          Old files accumulate
8. is_complete computed differently than useMemo → silent divergence
```

**With architect session corrections (what was built):**

```
1. User picks file → handleFileChange
2. startUpload: calls uploadResume(formData) — separate action
3. uploadResume: auth → read resume_pdf_key → remove(key) → upload(path) → upsert profile row
4. [user fills text fields while upload runs]

5. User clicks Save → handleSave
6. startSave: calls saveProfile(payload) — text only, no file
7. saveProfile: createInsforgeServer() → reads session cookie → userId
8. insforge.database.from("profiles")
              ↑ CORRECT — database namespace
9. Reads current is_complete (pre-upsert gate for PostHog)
10. calculateCompletion(payload + email) — shared utility
11. insforge.database.from("profiles").upsert([{...}])
12. if (!wasComplete && is_complete): captureServerEvent("profile_completed")
13. revalidatePath("/profile")
14. Client receives { success: true }
15. setSuccessMessage / isPending resets
16. Next request to /profile re-renders with fresh data
```

The session moved the process from a plan that would have crashed on step 6 to an
implementation that is correct at every step.

---

## Self-check quiz

<details>
<summary><strong>1. What is the failure mode of keeping completion logic in two places instead of a shared utility?</strong></summary>

Silent divergence. The `useMemo` in `ProfileForm` and the inline check in `saveProfile`
start identical but drift over time as one side gets updated and the other doesn't. The
user sees a different completion percentage in the UI than the server stores as
`is_complete`. The PostHog `profile_completed` event may never fire. Nothing crashes —
the system just computes the wrong answer. `lib/profile-utils.ts` eliminates the second
implementation entirely.

</details>

<details>
<summary><strong>2. What does the `MissingField` named union type enforce that `string[]` does not?</strong></summary>

The named union makes the set of valid missing-field values a compiler-checked contract.
If you add a new member (like `'LINKEDIN URL'`) to the union, TypeScript flags every
exhaustive switch in the codebase that doesn't handle the new member. `string[]` provides
no such guarantee — any string can appear without the compiler noticing. The cost is one
extra type definition in `types/index.ts`; the benefit is that the compiler audits
completeness wherever the type is handled exhaustively.

</details>

<details>
<summary><strong>3. Why does the resume upload fire on file pick rather than on the Save button?</strong></summary>

Two reasons: UX and protocol. For UX: file uploads are slow (2–5 seconds). Firing on
pick lets the user continue filling text fields while the upload runs, so Save is fast.
For protocol: `File` objects are binary and cannot be serialized as JSON. Server Actions
that receive a `File` must use `FormData`. Since `saveProfile` uses a typed object
(better TypeScript, cleaner call site), file upload must be a separate action. The
separation is both a deliberate UX decision and a JavaScript constraint.

</details>

<details>
<summary><strong>4. How was the `upsert: true` storage documentation error caught, and what would have happened if it wasn't?</strong></summary>

The session verified the InsForge SDK's TypeScript type definition file in
`node_modules/@insforge/sdk/dist/client-BR9o-WUm.d.ts`. The `upsert` option did not
appear in the `upload()` signature, which proves the SDK doesn't support it. Without this
catch, the code would compile and run without error — the SDK would auto-rename each new
upload, appending a timestamp. Old files would silently accumulate in storage with each
re-upload, creating a storage leak with no indication in the app.

</details>

<details>
<summary><strong>5. Why is the `insforge.from()` error less dangerous than the `upsert: true` error, even though `insforge.from()` is a complete crash?</strong></summary>

`insforge.from()` fails loudly on the first DB call with a runtime `TypeError`. It
surfaces in the first manual test of any feature that reads or writes the database. It
cannot go undetected past initial development. `upsert: true` is a silent bug: the upload
succeeds, storage returns a success response, the DB row is updated — but old files
accumulate without any signal. Silent, accumulatory failures are harder to detect and may
not surface until months of storage costs have built up. Silent bugs are almost always
more dangerous than loud ones.

</details>

---

## Extend it (challenges)

**Challenge 1 — Trace the `calculateCompletion` call sites (15–20 min)**

Find every file that imports `calculateCompletion`. For each call site, document:
- What shape of data is passed as the `CompletionInput`
- What part of the return value (`percentage` vs `missingFields`) is used
- Which state bucket or DB value provides `email` at that call site

Write out your findings. Do not change any code.

<details>
<summary>Hint</summary>

There are two call sites: `components/profile/ProfileForm.tsx` (in the `useMemo`) and
`actions/profile.ts` (in `saveProfile`). In the form, `email` comes from the `email`
prop passed from `page.tsx`. In the Server Action, `email` comes from
`authData.user.email`. Both use different mechanisms to get the same value — which is why
it's intentionally excluded from `ProfileSavePayload`.

</details>

---

**Challenge 2 — Add a required field end-to-end (20–30 min)**

Add `portfolio_url` as a required completion field (currently it is optional). This
requires touching every file that the architect session's decisions involved:

1. Add `'PORTFOLIO URL'` to the `MissingField` union in `types/index.ts`
2. Add the check to `calculateCompletion` in `lib/profile-utils.ts`
3. Add `portfolio_url` to the `CompletionInput` type
4. Update `ProfileSavePayload` in `actions/profile.ts` to pass it through

After making the changes, load the profile page and verify:
- The banner shows `PORTFOLIO URL` as missing when the field is empty
- Filling the field removes it from the banner
- The percentage increases correctly

<details>
<summary>Hint</summary>

The `total = 10` in `calculateCompletion` must become `total = 11` or the percentage
math will be wrong. Check the `CompletionInput` type — you need to add
`portfolio_url?: string | null` to make the new check compile.

</details>

---

**Challenge 3 — Write a correct library-docs storage entry (30–45 min)**

The architect session corrected `context/library-docs.md` after discovering the
`upsert: true` error. Write a correct, minimal library-docs-style reference entry for
the InsForge storage operations used in this feature.

Your entry should cover:
- `upload(path, file)` — what it returns, what happens if the path already exists
- `remove(key)` — what `key` means vs. URL, when it can be called safely
- `createSignedUrl(key, seconds)` — when to use signed vs. public URL
- The remove-then-upload sequence as a canonical example

Verify each claim against the SDK types before writing. Do not document options that do
not appear in the type definition.

<details>
<summary>Hint</summary>

Run `grep -n "upload\|remove\|createSignedUrl" node_modules/@insforge/sdk/dist/*.d.ts`
to see the actual signatures before writing. Pay attention to return types — what does
`upload()` return on success? Is it `key` and `url` as separate fields, or a different
shape?

</details>

---

For deeper exploration, `docs/plan/06-profile-save/ai-discussion-topics.md` has 12
prompts covering Server Actions, shared utilities, InsForge storage design trade-offs,
PostHog event gating, and the read-before-write DB pattern. Feed them to an LLM *after*
forming your own answer first — the gap between what you thought and what you learn is
where understanding lands.
