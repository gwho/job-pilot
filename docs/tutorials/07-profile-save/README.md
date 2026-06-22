# Tutorial 07 — Profile Save: Server Actions, Shared Utilities, Storage, and One-Shot Analytics Events

**After completing this tutorial you will understand:** why shared logic between the
client and server belongs in a standalone utility rather than being duplicated, how a
Server Action receives typed data from a Client Component and writes it to the database,
the exact sequence of a safe file replace-then-upload pattern, why `useTransition` keeps
the UI interactive without blocking during async operations, how a PostHog event is
gated to fire exactly once on a state transition, and why `email` is passed as a
separate prop rather than read from the database row.

> [!NOTE]
> **Prerequisites:**
> - Tutorial 02 (`02-auth/README.md`) — `createInsforgeServer()`, `getCurrentUser()`,
>   and the session-cookie model that every Server Action relies on.
> - Tutorial 05 (`05-database-schema/README.md`) — the `profiles` table schema,
>   `is_complete` column, and the RLS policy that scopes every DB write to the
>   authenticated user.
> - Tutorial 06 (`06-profile-page/README.md`) — `ProfileForm`'s state buckets,
>   `useMemo`-derived completion percentage, and the `"use client"` boundary. This
>   tutorial picks up exactly where that one ended: Feature 06 wires the inert Save
>   button into a real Server Action.
>
> Open [`actions/profile.ts`](../../../actions/profile.ts),
> [`lib/profile-utils.ts`](../../../lib/profile-utils.ts),
> [`app/profile/page.tsx`](../../../app/profile/page.tsx), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these warm-up prompts in a separate AI session before reading any code. Attempt your
own answer first, then compare. Budget 20–30 minutes. Each prompt is designed to build
one piece of the mental model you need before the real code makes it concrete.

### Concept 1 — Server Actions: where they run and how they get the session

> "Explain Next.js Server Actions in plain terms. Where does the code actually execute?
> How does a Server Action know which user is logged in — does it read from a cookie,
> from a header, from a token passed by the client? Give me a minimal example of a
> Server Action that reads the current user and writes one row to a database."

*What to listen for:* Server Actions run on the server, called via a POST request the
framework generates automatically. The session is read from cookies on the incoming
request — the same cookies set by the OAuth callback in Tutorial 02. The client never
passes a user ID explicitly; the server derives it from the session.

*Practice question:* Why would it be a security problem to let the client pass its own
`userId` as a parameter to a save function instead of reading it from the session?

### Concept 2 — `useTransition`: non-blocking async UI

> "Explain React's `useTransition` hook. What does it return, and how is it different
> from just calling an async function directly in an onClick handler? Show me a button
> that fires an async operation, shows 'Saving...' during it, and goes back to 'Save'
> when done — once using useState + async, once using useTransition."

*What to listen for:* `useTransition` returns `[isPending, startTransition]`. The async
work runs inside `startTransition(async () => { ... })`. React treats this as
non-urgent — the UI stays interactive and `isPending` is `true` while it runs. Using
plain `async onClick` works but doesn't give you `isPending` without manual state.

*Practice question:* What's the benefit of having three separate transitions
(`startSave`, `startUpload`, `startViewResume`) instead of one shared `isPending` flag?

### Concept 3 — Single source of truth: extracting shared logic

> "I have a completion percentage that needs to show live in the browser as the user
> types, and also needs to be computed in a Server Action to decide what to store in the
> database. If I write the logic twice, what can go wrong? What's the right abstraction,
> and where does it live in a Next.js project?"

*What to listen for:* Duplicated logic drifts — one side gets a bug fix the other
doesn't. The right abstraction is a plain function in `lib/` with no framework
dependencies, importable by both the client component and the server action.

### Concept 4 — File storage: why remove-then-upload exists

> "I want to let users replace an uploaded file. If I just upload to the same path
> again, what happens? Explain the difference between an overwrite and an append-with-
> renamed-path behaviour. Why would a storage SDK auto-rename on collision instead of
> overwriting, and what's the correct pattern to replace a file safely?"

*What to listen for:* Many storage SDKs avoid silent overwrites by appending timestamps
to the key on collision. Correct pattern: read the existing key from DB → delete it →
upload to the fixed path → save the new key+URL back to DB.

*Practice question:* Why store the `key` (storage path) separately from the `url`
(public/signed link)? When would the URL alone be insufficient?

### Concept 5 — One-shot analytics events

> "I want a 'profile_completed' PostHog event to fire exactly once — the first time a
> user fills out all required fields and saves. It should never fire again, even if the
> user edits and saves again later. How do I gate this correctly in a server action?"

*What to listen for:* Read the `is_complete` flag *before* the upsert (not after).
Compare `wasComplete` (old state) to the newly computed `is_complete` (new state). Fire
only when `!wasComplete && is_complete` — the false→true transition.

---

## Architecture: what this feature adds

Feature 05 left the Save button inert and the form initialized from mock data. Feature
06 wires up the full read–write loop:

```
[Server: app/profile/page.tsx]
  │  1. Read auth session → get userId + email
  │  2. SELECT * FROM profiles WHERE id = userId
  │  3. Pass profile + email as props to ProfileForm
  ▼
[Client: ProfileForm]
  │  4. Initialize all state from props (no more mock data)
  │  5. User edits the form
  │  6. useMemo calls calculateCompletion() → live ring update
  │  7. User clicks Save
  │  8. useTransition wraps the async call
  ▼
[Server: actions/profile.ts → saveProfile()]
  │  9.  Read session → verify userId
  │  10. SELECT is_complete FROM profiles (pre-upsert PostHog gate)
  │  11. calculateCompletion(payload) → compute new is_complete
  │  12. UPSERT profiles row
  │  13. If !wasComplete && is_complete → fire profile_completed event
  │  14. revalidatePath("/profile") → Next.js drops the route cache
  ▼
[Server: app/profile/page.tsx re-runs]
  │  15. Fresh SELECT → updated profile data
  │  16. New props flow into ProfileForm
```

Two invariants that govern the whole design:

1. `calculateCompletion()` is the **only** place completion logic lives. The client
   calls it for the live ring. The server calls it before saving. They always agree.
2. `email` always comes from `authData.user.email` — never from the `profiles` row and
   never from the form payload. The form displays it read-only; the Server Action
   reads it from the session.

---

## Part 1 — `lib/profile-utils.ts`: the shared utility

Open [`lib/profile-utils.ts`](../../../lib/profile-utils.ts) in full:

```ts
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
  if (!p.email?.trim())     missingFields.push("EMAIL");
  if (!p.phone?.trim())     missingFields.push("PHONE");
  if (!p.location?.trim())  missingFields.push("LOCATION");
  if (!p.current_title?.trim()) missingFields.push("CURRENT TITLE");
  if (!p.experience_level)  missingFields.push("EXPERIENCE LEVEL");

  const yoe = Number(p.years_experience);
  if (!p.years_experience || isNaN(yoe) || yoe <= 0) missingFields.push("YEARS EXP");

  if (!p.skills || p.skills.length === 0)             missingFields.push("SKILLS");
  if (!p.work_experience || p.work_experience.length === 0) missingFields.push("WORK EXPERIENCE");
  if (!p.education?.degree) missingFields.push("EDUCATION");

  const total = 10;
  const filled = total - missingFields.length;
  const percentage = Math.round((filled / total) * 100);

  return { percentage, missingFields };
}
```

### Why this exists as a separate file

In Feature 05, the completion logic lived in two `useMemo` calls inside `ProfileForm`.
Feature 06 needs the same rules on the server — `saveProfile()` must compute
`is_complete` before writing to the database. That means the function has to be shared.

The naive approach is to copy the logic into the Server Action:

```ts
// ❌ Don't do this — duplicated logic drifts
// In ProfileForm (client):
const isComplete = skills.length > 0 && form.full_name.trim() !== "" && ...

// In saveProfile (server):
const is_complete = payload.skills.length > 0 && payload.full_name.trim() !== "" && ...
```

One month later, someone decides phone is no longer required. They update `ProfileForm`
and forget the Server Action. Now the UI shows 100% but `is_complete = false` sits in
the database. The PostHog event never fires. Job matching considers the profile
incomplete. It's a silent data bug — no error, just wrong state.

`lib/profile-utils.ts` is a plain TypeScript file with no `"use client"`, no `"use
server"`, no Next.js imports. It imports only a type. That makes it importable anywhere:
Client Components, Server Actions, API routes, test files.

### Why `CompletionInput` uses optional/nullable types

`Profile` (from Tutorial 05) has many `string | null` fields. But `calculateCompletion`
is also called from the Server Action with a `ProfileSavePayload`, which uses `string`
for most fields (empty string for "nothing entered"). Rather than overloading the
function signature with two different call shapes, `CompletionInput` uses
`string | null | undefined` (via `?:`) for every field. Both callers fit.

`work_experience` is typed as `unknown[]` — the function only cares whether the array
is empty, not about the shape of entries. This avoids coupling the utility to the full
`WorkExperienceEntry` type unnecessarily.

### `MissingField` named union type

```ts
// types/index.ts
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

Without this, `missingFields` would be typed as `string[]`. Any string could be pushed
into it. With `MissingField[]`, TypeScript enforces that only these ten specific values
are valid — the same exhaustive-switch benefit from Tutorial 05's literal unions.
When a new required field is added (say, `job_titles_seeking`), adding its string to
`MissingField` turns every place in the codebase that handles missing fields into a
type-checked surface.

**Checkpoint:** The function counts `total = 10` as a hard-coded constant and derives
`filled = total - missingFields.length`. What's the advantage of computing the count
this way compared to counting passing checks directly?

<details>
<summary>Reveal answer</summary>

Computing as `total - missing.length` means the total count is the single source of
truth for "how many fields exist." If you added a field and forgot to update a
`passing++` counter elsewhere, the percentage would be wrong in a non-obvious way.
With the subtraction approach: the function pushes to `missingFields` for every failed
check. If you add a new check and forget to update `total`, the percentage exceeds 100%
— an obvious, hard-to-miss error. It's a slightly safer accounting pattern.
</details>

---

## Part 2 — `page.tsx`: data fetching and the two-prop pattern

Open [`app/profile/page.tsx`](../../../app/profile/page.tsx):

```ts
export default async function ProfilePage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } = await insforge.auth.getCurrentUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const { data: profile } = await insforge.database
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <ProfileForm profile={profile as Profile | null} email={authData.user.email} />
      </main>
    </>
  );
}
```

### Why `email` is a separate prop

`authData.user.email` comes from the auth session. `profile.email` (if it exists) came
from whatever was written to the `profiles` table by a previous save. These could
diverge — a user could change their auth email after their profile was last saved.

More importantly, `saveProfile` always writes `email: authData.user.email` (the
session-derived value, not `payload.email`) to the database. Passing `email` as a
separate prop makes this data-source choice visible at the page level: the form displays
email, but that email is authoritative from the session, not from the form.

### Why `maybeSingle()` instead of `single()`

`.single()` throws an error when zero rows are returned. A first-time user has no
`profiles` row yet — the upsert in `saveProfile` creates it on first save. `.maybeSingle()`
returns `null` when zero rows exist. `profile` can therefore be `Profile | null`, which
`ProfileForm` handles by initialising all state to empty defaults.

### The redundant auth check

`proxy.ts` (Tutorial 02) already redirects unauthenticated requests away from
`/profile` before the page renders. The `if (authError || !authData.user) redirect("/login")`
inside `ProfilePage` is a second layer of defence. If `proxy.ts` somehow fails (a bug,
a misconfigured matcher), the page itself won't render with a null user. Defence in
depth, not redundancy for its own sake.

**Try it yourself:** Confirm that an unauthenticated request to `/profile` is caught by
`proxy.ts` before it ever reaches `ProfilePage`:

```bash
npm run dev   # if not running
curl -i http://localhost:3000/profile
# Expect: 307 → /login (from proxy.ts, before page renders)
```

---

## Part 3 — `saveProfile`: the full Server Action walkthrough

Open [`actions/profile.ts`](../../../actions/profile.ts) lines 43–139. Walk through it
in four phases:

### Phase 1: authentication and parameter building

```ts
"use server";

export async function saveProfile(
  payload: ProfileSavePayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } =
      await insforge.auth.getCurrentUser();

    if (authError || !authData.user) {
      return { success: false, error: "Not authenticated" };
    }

    const userId = authData.user.id;
    const email = authData.user.email;   // ← always from session, not payload
```

`userId` and `email` come from the session, not from `payload`. Even if the client were
malicious and sent `payload.userId = 'someone-elses-uuid'`, it would be ignored — the
server derives the user from the cookie-bound session. This is the same model as every
other server-side operation in this codebase.

`ProfileSavePayload` is the typed contract between the client and the action. It includes
every form field the client can legitimately send — but not `userId`, not `email`, and
not `is_complete`. Those are all derived on the server.

### Phase 2: the pre-upsert `is_complete` check

```ts
// Read current is_complete before upserting (PostHog gate)
const { data: existing } = await insforge.database
  .from("profiles")
  .select("is_complete")
  .eq("id", userId)
  .maybeSingle();

const wasComplete = existing?.is_complete ?? false;

// Calculate new completion from the incoming payload + email
const { missingFields } = calculateCompletion({
  full_name: payload.full_name,
  email,                           // ← session email, not payload
  phone: payload.phone,
  // ...rest of payload fields
});

const is_complete = missingFields.length === 0;
```

This is the gate for the one-shot PostHog event. The logic requires knowing the *old*
`is_complete` and the *new* `is_complete` simultaneously. Reading after the upsert would
require a second SELECT, and that SELECT might see a stale value in certain edge cases.
Reading before gives a clean "what was true before this save" baseline.

`wasComplete` defaults to `false` if the profile row doesn't exist yet (first save). In
that case, if the first save completes the profile, `!wasComplete && is_complete` = true
and the event fires — correct behaviour.

### Phase 3: the upsert with `''` → `null` coercion

```ts
const { error: upsertError } = await insforge.database
  .from("profiles")
  .upsert([
    {
      id: userId,
      email,
      full_name: payload.full_name || null,          // '' → null
      phone: payload.phone || null,                  // '' → null
      experience_level: payload.experience_level || null,  // '' → null
      years_experience: payload.years_experience
        ? Number(payload.years_experience)           // string → number
        : null,
      // ...all other fields
      is_complete,                                   // computed, not from payload
    },
  ]);
```

`FormState` allows `experience_level: ExperienceLevel | ''` (Tutorial 06, Part 3). The
database schema has `experience_level TEXT` — it accepts `NULL` to mean "not set" but
would accept `''` too. Storing empty strings for unset optional fields is bad practice:
you'd have to check for both `''` and `NULL` in every query. The `|| null` coercion
normalises every empty string to `NULL` at the point of persistence.

`years_experience` is stored as `STRING` in `FormState` (because `<input type="number">`
returns a string in React). The upsert converts it: `Number(payload.years_experience)`.

`is_complete` is computed from `calculateCompletion`, not sent by the client. Even if a
client crafted a request with `is_complete: true` in the payload, the Server Action
ignores it and computes the value itself.

### Phase 4: the one-shot PostHog event and cache invalidation

```ts
// Fire profile_completed on first transition to complete
if (!wasComplete && is_complete) {
  try {
    await captureServerEvent({
      distinctId: userId,
      event: "profile_completed",
      properties: { userId },
    });
  } catch {
    // Best effort — never block save on analytics
  }
}

revalidatePath("/profile");
return { success: true };
```

`!wasComplete && is_complete` is the false→true gate. Four possible states:

| `wasComplete` | `is_complete` | fires? | meaning |
|---|---|---|---|
| `false` | `false` | no | still incomplete |
| `false` | `true` | **yes** | just completed for the first time |
| `true` | `false` | no | was complete, now incomplete (user removed data) |
| `true` | `true` | no | was already complete — event already fired before |

The analytics call is wrapped in `try/catch` with an empty catch — if PostHog fails,
the save still succeeds. Analytics failure must never block a user's data write.

`revalidatePath("/profile")` is the mechanism that makes the page show fresh data after
the save. Next.js caches rendered output for route segments. Without this call, the user
would see their old profile data until the cache expired. `revalidatePath` purges the
cache for that path, forcing `ProfilePage` to re-run its `SELECT` on the next request.

**Checkpoint:** Why is the PostHog call inside a `try/catch` that silences all errors,
while the upsert error is returned to the caller? What principle decides which failures
are silent and which propagate?

<details>
<summary>Reveal answer</summary>

Data integrity failures (the upsert) propagate — the caller needs to know the save
failed so it can show the user an error. Analytics failures are "best effort" — PostHog
being down or rate-limiting should never prevent a user from saving their work. The
general principle: failures in the path-to-value (the actual operation the user
requested) propagate; failures in observability or side-effects are silenced so they
never become user-visible blockers. The PostHog `profile_completed` event has already
been gated correctly — if it silently fails, the next save where `!wasComplete &&
is_complete` is still true will fire it again. Eventual consistency is acceptable for
analytics.
</details>

---

## Part 4 — `uploadResume`: the remove-then-upload pattern

Open [`actions/profile.ts`](../../../actions/profile.ts) lines 145–215:

```ts
export async function uploadResume(
  formData: FormData,
): Promise<{ success: boolean; key?: string; url?: string; filename?: string; error?: string }> {
```

### Why `FormData`, not a typed object

`File` objects cannot be serialised to JSON — they contain binary data. Server Actions
accept `FormData` specifically for file uploads, because `FormData` is a native web API
that browsers know how to encode binary payloads. Every other Action in this project
uses a typed object parameter (`ProfileSavePayload`), which travels as JSON. `uploadResume`
must use `FormData`.

### The remove-then-upload sequence

```ts
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

InsForge Storage's `upload()` does not overwrite by default — when you upload to an
existing path, the SDK appends a timestamp to avoid collision:
`abc-123/resume-1705315200000.pdf`. After three uploads, the user has three orphaned
files in storage with no way to know which is current.

The correct sequence:
1. **Read** the existing `resume_pdf_key` from the database (the storage path of the
   current file, e.g., `abc-123/resume.pdf`).
2. **Remove** it from storage if it exists.
3. **Upload** the new file to the deterministic path `${userId}/resume.pdf`.
4. **Save** the new `key`, `url`, and `filename` back to the database.

`resume_pdf_key` (the storage path) and `resume_pdf_url` (the publicly accessible URL)
serve different purposes. The key is needed for `remove()` — you can only delete by
key, not by URL. The URL is what you put in an `<img>` or `<a href>` to let the user
access the file. `filename` (the original `file.name`) is stored so the UI can show a
friendly name instead of `resume.pdf`.

### File validation

```ts
const file = formData.get("resume");

if (!(file instanceof File) || file.size === 0) {
  return { success: false, error: "No file provided" };
}

if (file.type !== "application/pdf") {
  return { success: false, error: "Only PDF files are accepted" };
}
```

`formData.get("resume")` returns `FormDataEntryValue | null` — a union of `File |
string | null`. The `instanceof File` check narrows it. `file.size === 0` catches the
edge case where a file element is present but empty. `file.type` is the MIME type sent
by the browser — not a cryptographic guarantee (a user could rename a `.jpg` to `.pdf`),
but sufficient for this use case.

**Try it yourself:** Without a running backend, simulate the validation logic in
isolation. Write a small test in your editor (or in a scratch file) that calls
`formData.get()` on a constructed `FormData` and traces what `instanceof File` returns:

```ts
const fd = new FormData();
fd.append("resume", new Blob(["fake content"], { type: "text/plain" }), "test.pdf");
const entry = fd.get("resume");
console.log(entry instanceof File);  // true — Blob appended with filename becomes File
console.log((entry as File).type);   // "text/plain" — the actual type, not the extension
```

**Checkpoint:** If `remove()` fails (e.g., the old file was already deleted manually),
should the upload still proceed? Trace the current code to determine what happens.

<details>
<summary>Reveal answer</summary>

Yes — the upload proceeds. `remove()` is called but its result is not checked:
`await insforge.storage.from("resumes").remove(existing.resume_pdf_key)` — no `const {
error }`, no conditional. If `remove()` fails (e.g., storage key not found), execution
continues to `upload()`. The worst case is a small amount of orphaned storage (one extra
file sitting in the bucket with no DB reference). This is acceptable — the user's new
upload succeeds, and the orphaned file causes no data integrity issue. Blocking the
upload on a failed remove would be the worse user experience: "couldn't replace your
resume because we couldn't delete the old one" is a confusing failure mode.
</details>

---

## Part 5 — `getResumeSignedUrl`: signed vs public URLs

```ts
export async function getResumeSignedUrl(): Promise<{
  url?: string;
  error?: string;
}> {
  // ...auth check...

  const { data, error } = await insforge.storage
    .from("resumes")
    .createSignedUrl(profile.resume_pdf_key, 3600);

  if (error || !data?.signedUrl) {
    return { error: "Could not generate preview link" };
  }

  return { url: data.signedUrl };
}
```

The `resumes` bucket is **private** (created as private in Feature 04). Private buckets
have no public URLs — the file is not directly accessible via a static URL. Instead,
`createSignedUrl(key, seconds)` generates a time-limited URL that includes a
cryptographic signature. After 3600 seconds (1 hour), the link expires.

Why signed URLs for resumes:
- Resume PDFs are personal documents — you don't want them publicly indexable by
  Google, accessible by competitors, or shareable forever via URL.
- `3600` seconds is enough time to open and review a document. Attackers who somehow
  got the URL would have at most an hour of access.
- A new signed URL is generated on every "View current resume" click — there's no
  long-lived link to leak.

The `getResumeSignedUrl` Server Action pattern means the browser never has direct bucket
access. The user clicks "View current resume" → `handleViewResume()` calls the Action →
the Action generates a signed URL server-side → `window.open()` opens it. The signing
key never leaves the server.

---

## Part 6 — `useTransition` in `ProfileForm`: three independent pending states

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
lines 207–209:

```tsx
const [isSaving, startSave] = useTransition();
const [isUploading, startUpload] = useTransition();
const [isViewingResume, startViewResume] = useTransition();
```

Three separate transitions. Each wraps its own async operation:

```tsx
function handleSave() {
  setSaveResult(null);
  startSave(async () => {
    const result = await saveProfile({ ... });
    setSaveResult(result);
  });
}

function handleFileChange(e: ...) {
  startUpload(async () => {
    const fd = new FormData();
    fd.append("resume", file);
    const result = await uploadResume(fd);
    setUploadResult(result);
    if (result.success) setResumeFileName(result.filename ?? file.name);
    if (fileInputRef.current) fileInputRef.current.value = "";
  });
}

function handleViewResume() {
  startViewResume(async () => {
    const result = await getResumeSignedUrl();
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  });
}
```

### Why three instead of one

One shared `isPending` flag would mean: uploading a resume disables the Save button,
and saving disables the upload zone. These operations are independent — a user could
theoretically be in the middle of reviewing their resume in a new tab while also editing
the form. Separate transitions give each operation its own loading state without
blocking the others.

### What `useTransition` does that manual `useState` doesn't

The naive alternative:

```tsx
// Without useTransition
async function handleSave() {
  setIsSaving(true);
  const result = await saveProfile({ ... });
  setSaveResult(result);
  setIsSaving(false);
}
```

This works for simple cases. `useTransition` adds two things:

1. **React keeps the current UI rendered** during the transition. If a state update
   inside `startTransition` causes a re-render that would be slow (e.g., a large list
   re-sort), React deprioritises it and shows the current UI first. For the profile
   form (no slow renders), the practical difference is negligible.
2. **`isPending` is directly tied to the transition scope**, not to manual state
   management. You can't accidentally forget to `setIsSaving(false)` on an error
   path — the transition automatically goes from pending to resolved when its callback
   completes.

### The save button's three states

```tsx
<button
  type="button"
  onClick={handleSave}
  disabled={isSaving}
  className="... disabled:opacity-60 disabled:cursor-not-allowed"
>
  {isSaving ? "Saving..." : "Save Profile"}
</button>

{saveResult && (
  <p className={saveResult.success ? "text-success" : "text-error"}>
    {saveResult.success
      ? "Profile saved successfully"
      : saveResult.error ?? "Failed to save profile"}
  </p>
)}
```

Three distinct UI states:
- **Idle**: "Save Profile", full opacity, clickable
- **Pending** (`isSaving = true`): "Saving...", disabled, 60% opacity
- **Resolved** (`saveResult != null`): success or error message below the button,
  button returns to idle state

`saveResult` is reset to `null` at the start of each `handleSave` call
(`setSaveResult(null)`) — so if a user clicks Save twice, the previous result message
clears before the new one appears.

**Checkpoint:** The upload zone also has three states: empty, uploading, and
"has a file." Find the JSX in `ProfileForm` that renders these three states (around
lines 527–556). Identify which `useTransition` variable drives the "uploading" state
and which piece of component state drives the "has a file" state.

<details>
<summary>Reveal answer</summary>

```tsx
{isUploading ? (
  // State 1: uploading — driven by isUploading (from startUpload useTransition)
  <>
    <Upload size={28} className="text-accent animate-pulse" />
    <p className="text-sm font-medium text-text-dark">Uploading...</p>
  </>
) : resumeFileName ? (
  // State 2: has a file — driven by resumeFileName (useState, set after successful upload)
  <>
    <CheckCircle size={28} className="text-success" />
    <p className="text-sm font-medium text-text-dark">{resumeFileName}</p>
    <p className="text-xs text-text-muted">Click to replace</p>
  </>
) : (
  // State 3: empty — neither uploading nor has a file
  <>
    <Upload size={28} className="text-text-muted" />
    <p className="text-sm font-medium text-text-dark">Click to upload or drag and drop</p>
    <p className="text-xs text-text-muted">PDF formatting only • Maximum file size 5MB</p>
  </>
)}
```

`isUploading` is the transition state — true only during the async upload. `resumeFileName`
is regular state — persists across renders after the upload succeeds.
</details>

---

## Part 7 — How `calculateCompletion` connects client and server

The key line in `ProfileForm` is the `useMemo` that replaced the inline logic from
Feature 05:

```tsx
// ProfileForm.tsx — client side
const { percentage: completionPercentage, missingFields } = useMemo(
  () =>
    calculateCompletion({
      full_name: form.full_name,
      email,                       // ← from props, not from form state
      phone: form.phone,
      location: form.location,
      current_title: form.current_title,
      experience_level: form.experience_level || null,
      years_experience: form.years_experience,
      skills,
      work_experience: workExperience,
      education,
    }),
  [form, email, skills, workExperience, education]
);
```

And in the Server Action:

```ts
// actions/profile.ts — server side
const { missingFields } = calculateCompletion({
  full_name: payload.full_name,
  email,                         // ← from session, not from payload
  phone: payload.phone,
  location: payload.location,
  current_title: payload.current_title,
  experience_level: payload.experience_level || null,
  years_experience: payload.years_experience,
  skills: payload.skills,
  work_experience: payload.work_experience,
  education: payload.education,
});
```

Same function. Same set of rules. The only difference is data source: the client passes
form state and the `email` prop; the server passes `payload` fields and the session
email. The computed result — which fields are missing, what percentage is complete — is
guaranteed to be identical for the same inputs.

This guarantee is the point. Without it, "100% in the UI but `is_complete = false` in
the database" is a real failure mode. With it, the UI ring and the database flag are
always derived from the same algorithm, making divergence impossible.

**Try it yourself:** Add a `console.log` call inside `calculateCompletion`:

```ts
export function calculateCompletion(p: CompletionInput): CompletionResult {
  console.log("[calculateCompletion] called");
  // ...
```

Run the dev server and open `/profile`. Open the browser console and watch for
`[calculateCompletion] called` as you type in the form — you'll see it fire on every
change (the client-side `useMemo`). Then click Save. In the terminal where `npm run dev`
is running, watch for `[calculateCompletion] called` there too — the Server Action
calling it on the server. One function, called in two runtimes. Remove the log before
committing.

---

## Full data flow: from form field to saved database row

Trace a single field — `full_name` — from user keypress to committed database write:

```
1. User types "Jesse James" into Full Name input
   → onChange → setField("full_name", "Jesse James") → re-render

2. useMemo dependency [form] changed
   → calculateCompletion({ full_name: "Jesse James", ... })
   → "FULL NAME" removed from missingFields → percentage increases
   → ring animates (CSS transition on strokeDashoffset)

3. User clicks "Save Profile"
   → handleSave() called
   → setSaveResult(null) clears previous result
   → startSave(async () => { ... }) — isPending = true → button shows "Saving..."

4. saveProfile({ full_name: "Jesse James", ... }) called as HTTP POST to server
   → Next.js routes it to actions/profile.ts
   → insforge.auth.getCurrentUser() reads session cookie → userId

5. Server: SELECT is_complete FROM profiles WHERE id = userId
   → wasComplete = false (first save or previous incomplete state)

6. Server: calculateCompletion({ full_name: "Jesse James", email: "jesse@...", ... })
   → same function, same result as step 2

7. Server: UPSERT profiles SET full_name = 'Jesse James', ..., is_complete = true
   → trigger fires: updated_at = NOW()
   → RLS WITH CHECK: id = auth.uid() ✓

8. if !wasComplete && is_complete: captureServerEvent("profile_completed")

9. revalidatePath("/profile") — Next.js drops the route cache

10. return { success: true }

11. Client: setSaveResult({ success: true }) → "Profile saved successfully" appears
    → transition ends → isSaving = false → button back to "Save Profile"

12. Browser navigates to /profile (next request)
    → ProfilePage re-runs → fresh SELECT → new props → ProfileForm re-initialises
```

---

## Self-check quiz

<details>
<summary><strong>1. Why does `saveProfile` read `is_complete` before the upsert, not after?</strong></summary>

The PostHog gate needs to compare "what was the old state" with "what is the new state."
Reading after the upsert would require a second SELECT to see the post-write value, which
adds a round trip and could theoretically see stale cached data. Reading before gives a
clean baseline. The new `is_complete` is computed from the incoming payload (not from the
database), so no post-write read is needed for the comparison.
</details>

<details>
<summary><strong>2. A user fills out all fields, saves (profile_completed fires), then clears their phone number and saves again. What does the gate produce on the second save?</strong></summary>

Second save: `wasComplete = true` (the previous state was complete), `is_complete =
false` (phone is now missing). The gate: `!wasComplete && is_complete` = `!true &&
false` = `false`. No event fires. The `profile_completed` event is not fired again.
If the user re-adds their phone and saves a third time: `wasComplete = false`,
`is_complete = true` → the gate fires again. This is technically correct (the profile
just became complete again), though the event name `profile_completed` implies a
one-time milestone. In practice, this is acceptable — the PostHog event schema tracks
when the profile is first fully completed, and multiple firings are handled by deduping
in analytics rather than in code.
</details>

<details>
<summary><strong>3. Why does `uploadResume` use `FormData` as its parameter type instead of a typed object like `ProfileSavePayload`?</strong></summary>

`File` objects contain binary data — they cannot be serialised to JSON. Next.js Server
Actions transport typed object parameters as JSON; `FormData` is the mechanism for
binary data (and is supported natively by the browser's `fetch` API and Next.js's action
serialisation). Every other action in this project uses typed objects because their data
is text-serialisable. `uploadResume` must use `FormData` because it transports a `File`.
</details>

<details>
<summary><strong>4. What's the difference between `resume_pdf_key` and `resume_pdf_url`, and why are both stored in the database?</strong></summary>

`resume_pdf_key` is the storage path — the identifier used to locate the file in the
storage bucket (e.g., `abc-123/resume.pdf`). It's needed for `remove()` (delete by key)
and for generating signed URLs (`createSignedUrl(key, seconds)`). `resume_pdf_url` is
the public or signed URL to access the file content. It's needed for display and linking.
You can't derive the key from the URL (the URL may be signed and time-limited), and you
can't derive a stable URL from the key without calling the storage API again. Both are
stored so each can be used independently without additional API calls.
</details>

<details>
<summary><strong>5. `calculateCompletion` is called on the client in a `useMemo` and on the server in a Server Action. The client has `email` from props; the server has `email` from the session. What could cause these to differ, and would it cause a bug?</strong></summary>

They differ if the user changes their auth email (via an InsForge account settings page)
between the time the profile page loaded (setting the `email` prop) and when they click
Save (the server reads the session email). The client's ring would be computed with the
old email; the server's `is_complete` would be computed with the new email. Since both
emails are non-empty, this wouldn't change the `EMAIL` check result either way. If the
new email were somehow empty (impossible in a real auth flow), the server would compute
a different `is_complete` than the client showed. This is an extremely narrow edge case
that the current code accepts as an acceptable race condition. Adding email to the
session-read prop at page load (which `page.tsx` already does) keeps them aligned for
the vast majority of cases.
</details>

---

## Extend it (challenges)

### Challenge 1 — Add phone to the save payload and verify the round trip

`phone` is already in `FormState` and sent via `ProfileSavePayload`, but trace it
manually end-to-end:

1. In `ProfileForm`, find where `phone` is included in the `handleSave` call.
2. In `actions/profile.ts`, find where `payload.phone` is written to the upsert.
3. In `calculateCompletion`, find the check that gates `PHONE` as a missing field.
4. In `page.tsx`, find where the saved `phone` value would come back as a prop.

Write, in plain prose, the complete round trip for `phone` from form input to DB to
re-rendered prop — analogous to the "full data flow" trace in Part 7 but just for one field.

### Challenge 2 — Add a new required field to `calculateCompletion`

Add `job_titles_seeking` as a 11th required field in `calculateCompletion`:

1. Add `'JOB TITLES SEEKING'` to the `MissingField` union in `types/index.ts`.
2. Add `job_titles_seeking?: string[] | null` to `CompletionInput` in `lib/profile-utils.ts`.
3. Add the check: `if (!p.job_titles_seeking || p.job_titles_seeking.length === 0) missingFields.push('JOB TITLES SEEKING')`.
4. Update `total = 11`.
5. Update both call sites: pass `job_titles_seeking: jobTitlesSeeking` in
   `ProfileForm`'s `useMemo`, and `job_titles_seeking: payload.job_titles_seeking` in
   `saveProfile`.
6. Run `npx tsc --noEmit` — it should be clean.

**What to notice:** adding a field to `MissingField` doesn't auto-update the callers —
TypeScript catches missing call-site updates only if the call sites use the union type
explicitly. The `calculateCompletion` function body is the canonical place; the callers
just pass data through.

### Challenge 3 — Implement a loading skeleton for the profile page

Currently, if `ProfilePage`'s data fetch is slow, the user sees a blank white page.
Use Next.js's `loading.tsx` convention to add a skeleton:

1. Create `app/profile/loading.tsx` that renders a `<Navbar />` and a loading card
   (a simple `animate-pulse` div matching the card dimensions).
2. Observe that Next.js automatically shows `loading.tsx` while `ProfilePage` suspends
   during its async data fetch.
3. Confirm: does the loading state require any changes to `ProfilePage` itself?

<details>
<summary>Hint</summary>

`app/profile/loading.tsx` is automatically picked up by Next.js as a `React.Suspense`
boundary for that route segment. No changes to `ProfilePage` are needed — Next.js wraps
it in Suspense automatically. The loading file just needs to export a default component.
</details>

---

For deeper exploration, `docs/plan/06-profile-save/ai-discussion-topics.md` has 12
prompts across Server Actions, shared utilities, storage design, PostHog gating, and
migration strategies. Feed them to an LLM *after* forming your own answer first — the
gap between what you thought and what you learn is where understanding lands.
