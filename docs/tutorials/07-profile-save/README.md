# Tutorial 07 — Profile Save: Server Actions, Shared Utilities, Storage, and One-Shot Analytics

**After completing this tutorial you will understand:** why shared logic between the client and server belongs in a standalone utility rather than being duplicated — and the specific failure mode that duplication causes, how a Server Action receives typed data from a Client Component and why it derives user identity from the session rather than the payload, the exact sequence of a safe file replace-then-upload pattern and what the storage SDK does without it, why `is_complete` is read from the DB before the upsert rather than after, how a PostHog event is gated to fire only on the false→true state transition, and why three separate `useTransition` instances serve the UI better than a single loading flag.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 02 (`../02-auth/README.md`) — `createInsforgeServer()`, `getCurrentUser()`, and the session-cookie model that every Server Action relies on.
> - Tutorial 05 (`../05-database-schema/README.md`) — the `profiles` table schema, `is_complete` column, and the RLS policy that scopes every DB write to the authenticated user.
> - Tutorial 06 (`../06-profile-page/README.md`) — `ProfileForm`'s state buckets, `useMemo`-derived completion percentage, and the `"use client"` boundary. This tutorial picks up exactly where that one ended: Feature 06 wires the inert Save button into a real Server Action.
>
> Open [`actions/profile.ts`](../../../actions/profile.ts),
> [`lib/profile-utils.ts`](../../../lib/profile-utils.ts),
> [`app/profile/page.tsx`](../../../app/profile/page.tsx), and
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
> alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these prompts before reading any code. Budget 25–35 minutes.

### Concept 1 — Server Actions: where they run and how they get the session

> "Explain Next.js Server Actions in plain terms. Where does the code actually execute? How does a Server Action know which user is logged in — does it read from a cookie, from a header, from a token passed by the client? What's the security risk of allowing the client to pass its own `userId` as a parameter instead of reading it from the session? Give me a minimal code example and quiz me."

*What to listen for:* Server Actions run on the server, invoked via a POST request the framework generates automatically. The session is read from cookies on the incoming request — the same cookies set by the OAuth callback in Tutorial 02. The client never passes a user ID explicitly; the server derives it from the cookie-bound session. Allowing the client to pass a `userId` would let any authenticated user overwrite another user's data by sending a different ID.

*Practice question:* A Server Action that saves a form calls `saveProfile(payload)`. If `payload.userId` exists but is the wrong user's ID, what happens if the Server Action trusts `payload.userId` instead of the session?

---

### Concept 2 — useTransition: non-blocking async UI

> "Explain React's `useTransition` hook. What does it return, and how is `[isPending, startTransition]` different from a `useState(false)` loading flag? Show me a button that fires an async operation with both approaches, and explain what `useTransition` handles that the manual flag doesn't. Quiz me at the end."

*What to listen for:* `useTransition` returns `[isPending, startTransition]`. The async work runs inside `startTransition(async () => {...})`. `isPending` is true until all state updates from inside the callback have settled. A `useState(false)` flag requires manual management — a forgotten `setLoading(false)` in an error path leaves the button permanently disabled. `useTransition` resets automatically.

*Practice question:* Two operations (save + upload) share one `isPending` flag. Uploading a resume sets `isPending = true`. What happens to the Save button?

---

### Concept 3 — Shared logic and the risk of duplication

> "I have a completion percentage that needs to show live in the browser as the user types, and also needs to be computed in a Server Action before writing to the database. If I write the logic twice, what can go wrong — specifically? What's the right abstraction and where does it live in a Next.js project? Quiz me with a scenario."

*What to listen for:* Duplicated logic drifts. The specific failure: one side gets a bug fix the other doesn't. For completion rules, the failure is silent: the UI shows 100% while the DB stores `is_complete = false`. Downstream systems that read `is_complete` (PostHog events, job matching) see the wrong state. The right abstraction is a plain function in `lib/` with no framework dependencies, importable by both the client component and the server action.

*Practice question:* A developer removes phone from required fields in the UI completion logic but forgets the Server Action copy. What does the user see vs what's in the DB? What downstream effects follow?

---

### Concept 4 — File storage: why remove-then-upload exists

> "I want to let users replace an uploaded file. If I just upload to the same path again, what happens? Explain the difference between an overwrite and an append-with-renamed-path behaviour. Why would a storage SDK auto-rename on collision instead of overwriting, and what's the correct pattern to replace a file safely? Quiz me."

*What to listen for:* SDKs that auto-rename avoid silent data loss (overwriting someone's file they didn't intend to replace). The append behavior creates orphaned files. Correct pattern: read the existing key from DB → delete it → upload to the fixed path → save the new key+URL back to DB.

*Practice question:* Why store the key (storage path) separately from the URL (public/signed link)? When would the URL alone be insufficient?

---

### Concept 5 — One-shot analytics events

> "I want a 'profile_completed' event to fire exactly once — the first time a user fills all required fields and saves. It should never fire on subsequent saves, even if the user edits and saves again. How do I gate this in a server action without storing extra state? Quiz me with scenarios."

*What to listen for:* Read the `is_complete` flag from the DB *before* the upsert. Compare `wasComplete` (old state) against newly computed `is_complete` (new state). Fire only when `!wasComplete && is_complete` — the false→true transition. A post-upsert read cannot recover the "before" state.

*Practice question:* The user fills all fields and saves (event fires). They clear their phone number and save again. They re-add it and save a third time. How many times does the gate fire across all three saves?

---

## Architecture: what Feature 06 adds

Feature 05 left the Save button inert and the form initialized from mock data. Feature 06 wires up the full read–write loop:

```
[Server: app/profile/page.tsx]
  │  1. Read auth session → get userId + email
  │  2. SELECT * FROM profiles WHERE id = userId
  │  3. Pass profile + email as props to ProfileForm
  ▼
[Client: ProfileForm]
  │  4. Initialize all state from props (no more mock data)
  │  5. User edits the form
  │  6. useMemo calls calculateCompletion() → live ring updates
  │  7. User clicks Save
  │  8. startSave() — isPending = true, button shows "Saving..."
  ▼
[Server: actions/profile.ts → saveProfile()]
  │  9.  Authenticate from session cookie → userId, email
  │  10. SELECT is_complete (pre-upsert PostHog baseline)
  │  11. calculateCompletion(payload) → new is_complete
  │  12. UPSERT profiles row
  │  13. !wasComplete && is_complete → fire profile_completed
  │  14. revalidatePath("/profile") → Next.js drops cache
  ▼
[Server: app/profile/page.tsx re-runs]
  │  15. Fresh SELECT → updated profile data
  │  16. New props flow into ProfileForm
```

Two invariants govern the whole design:

1. `calculateCompletion()` is the only place completion logic lives. Client and server always use the same function.
2. `email` always comes from `authData.user.email` — never from the `profiles` row and never from the form payload.

---

## Part 1 — lib/profile-utils.ts: the shared completion utility

Open [`lib/profile-utils.ts`](../../../lib/profile-utils.ts) in full:

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

Feature 05 inlined this logic directly in `ProfileForm`'s `useMemo`. Feature 06 requires the same rules on the server — `saveProfile` must compute `is_complete` before writing it to the database. The function has to be shared, and the shared location has to be importable from both environments.

`lib/profile-utils.ts` has no `"use client"`, no `"use server"`, no Next.js imports — just a TypeScript function importing a type. That makes it importable anywhere: Client Components, Server Actions, API routes, or test files. The file has no environment-specific code that would prevent it from running in either runtime.

The `CompletionInput` type uses optional/nullable fields (`field?: string | null`) so both call shapes fit. The Server Action's `ProfileSavePayload` uses empty strings for unset text fields; `Profile | null` from the DB uses actual `null`. The function doesn't need to know which caller it serves — both pass valid `CompletionInput` shapes.

**Checkpoint:** The function counts `total = 10` as a hard-coded constant and computes `percentage = (total - missing.length) / total`. What's the advantage of this approach over incrementing a `filledCount` variable for each passing check?

<details>
<summary>Reveal answer</summary>

With `total - missing.length`, the total count is the single source of truth for how many fields exist. If you added a new check and forgot to update a `filledCount++` counter, the percentage would be wrong in a non-obvious way (percentage would be less than 100 when all fields are filled, but no assertion would fail).

With the subtraction approach: you push to `missingFields` for every failed check. If you add a new check and forget to update `total`, the percentage would exceed 100 when all fields are filled — an obvious error that immediately signals a bug. It's a slightly safer accounting pattern.

</details>

**Checkpoint:** The risk of writing completion logic twice is that the two copies diverge. Name a specific, concrete scenario where divergence causes a silent production bug — one where there is no error and no warning, just wrong state in the database.

<details>
<summary>Reveal answer</summary>

A developer decides phone is no longer required and removes `if (!p.phone?.trim()) missingFields.push("PHONE")` from the inline logic in `ProfileForm`. They forget the Server Action has its own copy. Now: the UI ring shows 100% for a user with no phone (because the client-side logic no longer requires it). But `saveProfile` still runs the old copy which requires phone, so it writes `is_complete = false` to the DB. The `profile_completed` PostHog event never fires. Job matching reads `is_complete = false` and treats the profile as incomplete. No error is thrown anywhere — the bug is invisible until someone notices the PostHog dashboard shows zero completions.

</details>

**Checkpoint:** `work_experience` is typed as `unknown[]` in `CompletionInput`. Why doesn't the function use the full `WorkExperienceEntry[]` type from `types/index.ts`?

<details>
<summary>Reveal answer</summary>

The function only cares whether the array is empty or not — it doesn't read any fields of the entries. Using `WorkExperienceEntry[]` would couple the utility to the full entry shape, meaning any change to `WorkExperienceEntry` would require updating `CompletionInput` even though the completion logic doesn't use those fields. `unknown[]` is more honest: "I accept any array and only check its length." It also means the function can be called with work experience arrays of different shapes across different call sites without TypeScript complaints.

</details>

**Try it yourself:** Add a temporary `console.log("[calculateCompletion] called from:", new Error().stack?.split('\n')[2])` at the top of the function. Run the dev server, open `/profile`, and type in a form field. In the browser console you'll see the client-side call (from the `useMemo`). Click Save — in the server terminal, you'll see the server-side call (from `saveProfile`). One function, called in two runtimes. Remove the log before committing.

---

## Part 2 — page.tsx: the two-prop pattern and maybeSingle

Open [`app/profile/page.tsx`](../../../app/profile/page.tsx):

```typescript
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

Two props, two different sources. `profile` comes from the `profiles` table. `email` comes from `authData.user.email` — the auth session. These are kept separate because they are not equivalent. `authData.user.email` is the session-verified email that InsForge's auth system trusts. `profile.email` is whatever was written to the `profiles` table by the last `saveProfile` call — it could be stale if the user changed their auth email since then.

More importantly, `saveProfile` always writes `email: authData.user.email` to the upsert — not `payload.email`. The form payload never includes an email that the server trusts. Passing email as a separate prop from the page makes this data-source decision explicit: any developer reading the page can see that email comes from auth, not from the profile row, and that the two are treated differently by design.

`.maybeSingle()` rather than `.single()` returns `null` when no row exists, rather than an error. A first-time user has no `profiles` row until `saveProfile` creates it on first save. `.single()` would throw an error for that user, causing the profile page to crash before they've had a chance to save anything.

**Checkpoint:** `proxy.ts` (Tutorial 02) already redirects unauthenticated requests away from `/profile`. Why does `ProfilePage` also check `if (authError || !authData.user) redirect("/login")`?

<details>
<summary>Reveal answer</summary>

Defence in depth. `proxy.ts` runs before the page renders and covers the common case. But if `proxy.ts` has a bug (misconfigured matcher, a Next.js upgrade that changes route-matching behavior), the page-level check is the second line of defence. If somehow an unauthenticated request reached `ProfilePage`, `createInsforgeServer()` and `getCurrentUser()` would return an error, and `!authData.user` would trigger `redirect("/login")`. No page renders with a null user regardless of what `proxy.ts` does.

</details>

**Try it yourself:** Confirm both layers with curl:

```bash
npm run dev
curl -i http://localhost:3000/profile
# Expect: 307 redirect → /login (from proxy.ts, before page renders)
```

Then search `proxy.ts` for the `/profile` route-matching logic and confirm the pattern that catches unauthenticated requests.

---

## Part 3 — saveProfile: authentication and the pre-upsert read

Open [`actions/profile.ts`](../../../actions/profile.ts), lines 43–81:

```typescript
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
    const email = authData.user.email;    // ← always from session, not payload

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
      email,
      phone: payload.phone,
      location: payload.location,
      current_title: payload.current_title,
      experience_level: payload.experience_level || null,
      years_experience: payload.years_experience,
      skills: payload.skills,
      work_experience: payload.work_experience,
      education: payload.education,
    });

    const is_complete = missingFields.length === 0;
```

`userId` and `email` come from the session, not from `payload`. Even if a malicious client sent `payload` with someone else's data, the Server Action ignores any user-identity information in the payload and derives it from the cookie-bound session. The `ProfileSavePayload` type is intentionally designed to exclude `id`, `email`, and `is_complete` — those are all derived server-side.

The pre-upsert `is_complete` read exists for one purpose: the PostHog event gate needs to know the state before the write. There is no way to recover that information after the upsert. Reading before gives a clean "what was true before this save" baseline. `wasComplete` defaults to `false` via `?? false` if the profile row doesn't exist yet (new user). On a new user's first complete save: `!false && true` → the event fires correctly.

**Checkpoint:** Walk me through exactly what a Server Action call looks like at the HTTP level. Where is the payload? Where is the session cookie? What does the client actually send?

<details>
<summary>Reveal answer</summary>

Next.js Server Actions are HTTP POST requests to a generated endpoint (the page's URL or a special `/_next/action/...` path). The payload is serialized as the request body — typed objects as JSON, `FormData` as `multipart/form-data`. The session cookie (`insforge_access_token`, `insforge_refresh_token`) is automatically included by the browser as a request header — the same cookies the browser has for this origin, sent with every request. The Server Action reads the session via `insforge.auth.getCurrentUser()`, which processes the cookie headers from the incoming request. The client never explicitly sends a user ID.

</details>

**Checkpoint:** Why is `is_complete` read from the DB before the upsert rather than after? What information would be lost if you read it after?

<details>
<summary>Reveal answer</summary>

The PostHog event gate needs to compare two states: `wasComplete` (the old state) and `is_complete` (the new state). After the upsert, you only have the new state. To check the old state you'd need a second SELECT, and that SELECT can only tell you what the current (post-write) state is — the pre-write state is gone. You'd be comparing "current" against "current," which cannot detect a transition.

Reading before: you have both states simultaneously. `wasComplete = old value before this save`, `is_complete = new value based on this payload`. The comparison `!wasComplete && is_complete` detects the exact false→true transition the event requires. One read, clean comparison, no race condition.

</details>

---

## Part 4 — saveProfile: the upsert, the event gate, and cache invalidation

Open [`actions/profile.ts`](../../../actions/profile.ts), lines 83–138:

```typescript
const { error: upsertError } = await insforge.database
  .from("profiles")
  .upsert([
    {
      id: userId,
      email,
      full_name: payload.full_name || null,
      phone: payload.phone || null,
      location: payload.location || null,
      current_title: payload.current_title || null,
      experience_level: payload.experience_level || null,   // '' → null
      years_experience: payload.years_experience
        ? Number(payload.years_experience)                  // string → number
        : null,
      // ... all other fields
      is_complete,                                          // computed, not from payload
    },
  ]);

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

`FormState` uses `ExperienceLevel | ''` for enum fields — HTML `<select>` elements need a string value for "no selection," and `null` is not a valid string. The database expects `NULL` for unset optional fields, not empty strings. The `|| null` coercion converts any falsy value (empty string, zero, undefined) to `null` at the upsert boundary, ensuring the DB always has semantically correct nulls rather than empty-string pseudo-nulls. `years_experience` also converts from string (React input) to number (DB `INTEGER`).

`is_complete` is computed server-side — it is never taken from `payload`. Even if a client crafted a payload with `is_complete: true`, it would be ignored.

**Checkpoint:** The PostHog call is wrapped in `try/catch` with an empty catch. Why doesn't the `saveProfile` function return `{ success: false }` when the analytics call fails? What principle decides which failures propagate and which are silenced?

<details>
<summary>Reveal answer</summary>

Data integrity failures (the upsert) propagate — the caller needs to know the save failed so it can show the user an error. Analytics failures are "best effort" — PostHog being down should never prevent a user from saving their work. The general principle: failures in the path-to-value (the operation the user actually requested) propagate; failures in observability or side effects are silenced so they never become user-visible blockers. If PostHog fails silently, the save still succeeds and the user loses nothing. If the upsert fails silently, the user thinks they saved but their data was lost.

</details>

**Checkpoint:** `captureServerEvent` (in `lib/posthog-server.ts`) calls `posthog.shutdown()` in a `finally` block immediately after every event. Why does a serverless analytics helper need to call `shutdown()` — what happens to queued events if it's omitted?

<details>
<summary>Reveal answer</summary>

PostHog's Node.js SDK batches events and sends them asynchronously. In a long-running server process (like an Express.js app), events flush in the background and the process stays alive long enough for them to be sent. In a serverless function (Next.js Server Actions, Vercel Edge, AWS Lambda), the function can terminate as soon as it returns a response. Queued events that haven't been sent are discarded with the process. `posthog.shutdown()` forces an immediate flush before the function returns, ensuring the event reaches PostHog's servers before the process exits. The `finally` block guarantees `shutdown()` runs even if the event capture threw an error.

</details>

**Checkpoint:** A user fills all fields and saves (`profile_completed` fires). They clear their phone and save again. They re-add it and save a third time. Fill in this table:

| save | wasComplete | is_complete | event fires? |
|---|---|---|---|
| 1st | ? | ? | ? |
| 2nd | ? | ? | ? |
| 3rd | ? | ? | ? |

<details>
<summary>Reveal answer</summary>

| save | wasComplete | is_complete | event fires? | reason |
|---|---|---|---|---|
| 1st | `false` | `true` | **yes** | first completion |
| 2nd | `true` | `false` | no | was complete, now incomplete |
| 3rd | `false` | `true` | **yes** | complete again |

On the 3rd save, the gate fires again. This is technically correct — the profile just became complete again. In production, PostHog can deduplicate events or the analytics dashboard can filter to first-occurrence. Preventing this in code would require a `has_ever_been_complete` flag or a more complex event history query, which adds complexity for an edge case that doesn't affect actual product decisions.

</details>

**Try it yourself:** Add `console.log("[saveProfile] wasComplete:", wasComplete, "is_complete:", is_complete)` after both computations. Save the profile with missing fields, then with all fields filled. Watch the server terminal for the log lines and confirm the transition.

---

## Part 5 — uploadResume: FormData, file validation, and remove-then-upload

Open [`actions/profile.ts`](../../../actions/profile.ts), lines 145–215:

```typescript
export async function uploadResume(
  formData: FormData,
): Promise<{ success: boolean; key?: string; url?: string; filename?: string; error?: string }> {
  // ...auth...

  const file = formData.get("resume");

  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "No file provided" };
  }
  if (file.type !== "application/pdf") {
    return { success: false, error: "Only PDF files are accepted" };
  }

  // Remove existing file if one exists
  const { data: existing } = await insforge.database
    .from("profiles")
    .select("resume_pdf_key")
    .eq("id", userId)
    .maybeSingle();

  if (existing?.resume_pdf_key) {
    await insforge.storage.from("resumes").remove(existing.resume_pdf_key);
  }

  // Upload new file
  const { data: uploadData, error: uploadError } = await insforge.storage
    .from("resumes")
    .upload(`${userId}/resume.pdf`, file);

  // Save key, URL, and original filename back to profile row
  const { error: updateError } = await insforge.database
    .from("profiles")
    .upsert([
      {
        id: userId,
        resume_pdf_key: uploadData.key,
        resume_pdf_url: uploadData.url,
        resume_pdf_filename: file.name,
      },
    ]);
```

`uploadResume` takes `FormData`, not a typed object. Every other action in this project uses a typed object (`ProfileSavePayload`), transported as JSON. A `File` contains binary data — bytes, not characters — and JSON cannot represent binary data. `FormData` is the web-standard container for mixed binary+text payloads. Browsers encode it as `multipart/form-data`, which Next.js Server Actions support natively for exactly this use case.

The remove-then-upload sequence exists because InsForge Storage's `upload()` does not overwrite files. If a file already exists at the target path, the SDK auto-renames the incoming file: `{userId}/resume.pdf` becomes `{userId}/resume-1705315200000.pdf`. That timestamped key gets returned as `uploadData.key`. If saved to the DB, the user now has a timestamped key and an orphaned original file. A second upload creates another orphan. After a few uploads, the bucket contains files with no DB references.

The `remove()` call's return value is not checked. If it fails (the file was already deleted manually), execution continues to `upload()`. The worst case is one orphaned file in storage — acceptable, since the new upload still succeeds and no data integrity is lost for the user.

**Checkpoint:** `uploadResume` uses `FormData` as its parameter type but `saveProfile` uses `ProfileSavePayload`. What is the serialization rule that determines which parameter type a Server Action should use?

<details>
<summary>Reveal answer</summary>

Server Action parameters are serialized over the network between the client component and the server. Next.js uses JSON serialization for plain typed objects — strings, numbers, arrays, nested objects. `File` objects are binary — they cannot be serialized to JSON. Next.js supports `FormData` specifically for payloads that include files, using `multipart/form-data` HTTP encoding which browsers handle natively. The rule: if all your data is JSON-serializable, use a typed object. If you need to send binary data (files, blobs), use `FormData`.

</details>

**Checkpoint:** What happens if `upload()` is called to a path where a file already exists and no prior `remove()` was called? Walk through the consequence for `uploadData.key`, the DB write, and the user experience on the next upload.

<details>
<summary>Reveal answer</summary>

InsForge auto-renames: `{userId}/resume.pdf` → `{userId}/resume-1705315200000.pdf`. `uploadData.key` is `"{userId}/resume-1705315200000.pdf"`. This gets written to `resume_pdf_key` in the DB. The original `{userId}/resume.pdf` is now an orphan — it exists in storage but nothing references it.

On the next upload: the DB lookup finds `resume_pdf_key: "{userId}/resume-1705315200000.pdf"`, so `remove()` deletes that one. But `upload()` now collides with `{userId}/resume.pdf` (still in storage from the first upload, still orphaned). It auto-renames to `{userId}/resume-1705315200001.pdf`. After three uploads: two orphans in storage, `resume_pdf_key` tracking a third timestamped file. `getResumeSignedUrl()` works correctly for the most recent file, but storage fills with unreachable orphans indefinitely.

</details>

**Checkpoint:** `file.type !== "application/pdf"` validates the MIME type. A user renames `resume.docx` to `resume.pdf` and tries to upload it. Does this validation catch that? What does it actually guarantee?

<details>
<summary>Reveal answer</summary>

No — it doesn't catch a renamed file. `file.type` is the MIME type the browser derives from the file extension, not from inspecting the binary content. A `.docx` renamed to `.pdf` would be reported by the browser as `application/pdf` (or possibly `application/vnd.openxmlformats-officedocument.wordprocessingml.document` depending on the OS). The validation catches honest mistakes and wrong format submissions, not intentional spoofing.

For actual content-type verification, you'd need to read the first few bytes of the file and check the magic bytes (PDF files start with `%PDF-`). This is a deeper validation that the current code accepts is unnecessary for the use case — the extraction in Feature 07 would fail gracefully if `pdf-parse` can't read a non-PDF file.

</details>

---

## Part 6 — getResumeSignedUrl: private buckets and time-limited access

Open [`actions/profile.ts`](../../../actions/profile.ts), lines 221–258:

```typescript
export async function getResumeSignedUrl(): Promise<{
  url?: string;
  error?: string;
}> {
  // ...auth...

  const { data: profile } = await insforge.database
    .from("profiles")
    .select("resume_pdf_key")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (!profile?.resume_pdf_key) {
    return { error: "No resume on file" };
  }

  const { data, error } = await insforge.storage
    .from("resumes")
    .createSignedUrl(profile.resume_pdf_key, 3600);

  return { url: data.signedUrl };
}
```

The `resumes` bucket is private. Files in private buckets have no public URLs — they are not accessible via a static URL and won't be indexed by search engines or accessible to anyone without a time-limited cryptographic signature. `createSignedUrl(key, seconds)` generates that signature, producing a URL valid for 3600 seconds (1 hour).

`resume_pdf_key` (the storage path) and `resume_pdf_url` (returned by `upload()`) serve different purposes. The key is the identifier used by the storage API for operations: `remove(key)`, `download(key)`, `createSignedUrl(key)`. The URL from `upload()` may be a static URL or a base URL without a signature — it's not sufficient for accessing private buckets and doesn't support the `remove()` operation. Both are stored in the DB so each can be used independently without additional API calls.

The signed URL is generated fresh on each "View current resume" click. There is no long-lived link stored anywhere that could be leaked or shared. The signing key never leaves the server — the browser receives only the final time-limited URL.

**Checkpoint:** Why are signed URLs generated on demand rather than stored in the DB alongside `resume_pdf_key`?

<details>
<summary>Reveal answer</summary>

Signed URLs expire (after 3600 seconds in this case). A URL stored in the DB would be invalid after 1 hour — any code reading `resume_pdf_url` expecting to use it for browser access would fail with a signature expiry error after that window. Storing a URL that becomes invalid is worse than storing no URL: it looks like data exists but silently fails when used.

The correct persistence is the storage *key* (a permanent path that never expires) plus generating signed URLs on demand when browser access is needed. This also means the expiry window is always a fresh 3600 seconds from the moment the user clicks, not from the moment the file was uploaded.

</details>

**Checkpoint:** `resume_pdf_key` and `resume_pdf_url` are both stored in the `profiles` table. Name a specific operation that requires `key` but couldn't use `url`, and another that requires `url` but couldn't use `key`.

<details>
<summary>Reveal answer</summary>

`key` is required for: `storage.remove(key)` (deleting the file before re-upload — `remove()` takes a storage path, not a URL), `storage.download(key)` (server-side download in Feature 07's extraction route — takes a storage path), `storage.createSignedUrl(key, seconds)` (the key is the argument).

`url` is required for: directly embedding in a browser `<img src>` or `<a href>` when the bucket is public (not applicable here since the bucket is private). In this project, `resume_pdf_url` is less critical — the signed URL is generated from the key — but it's preserved for potential future use (displaying a cached URL if the bucket policy changes, or for InsForge-specific features that use the URL).

</details>

---

## Part 7 — useTransition: three independent pending states

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx), lines 207–213:

```typescript
const [isSaving, startSave] = useTransition();
const [isUploading, startUpload] = useTransition();
const [isViewingResume, startViewResume] = useTransition();
const [isExtracting, startExtract] = useTransition();
const [isGenerating, startGenerate] = useTransition();
```

(The last two were added by Features 07 and 08. Feature 06 introduced the first three.)

And the handlers:

```typescript
function handleSave() {
  setSaveResult(null);
  startSave(async () => {
    const result = await saveProfile({ ... });
    setSaveResult(result);
  });
}

function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  startUpload(async () => {
    const fd = new FormData();
    fd.append("resume", file);
    const result = await uploadResume(fd);
    if (result.success) setResumeFileName(result.filename ?? file.name);
  });
}

function handleViewResume() {
  startViewResume(async () => {
    const result = await getResumeSignedUrl();
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  });
}
```

Three separate transitions rather than one shared `isPending` means each operation has its own loading state. Uploading a resume sets `isUploading = true` but leaves `isSaving` and `isViewingResume` false — the Save button stays active. Saving sets `isSaving = true` but the upload zone and view-resume button remain responsive. A single `isPending` flag would create false coupling: uploading would disable saving; saving would make the upload zone look busy.

The `useTransition` benefit over `useState(false)` is automatic cleanup. `isSaving` automatically resets to `false` when the transition's callback completes, regardless of whether it succeeded or threw. A `useState(false)` flag requires manual `setIsSaving(false)` in every success and error branch — a single forgotten call leaves the button permanently disabled with no visible error.

**Checkpoint:** What's the benefit of having separate `isExtracting` and `isGenerating` transitions (added in Features 07 and 08) rather than reusing `isSaving` for those operations too?

<details>
<summary>Reveal answer</summary>

Extraction and generation are semantically different operations from saving — they call different API routes and produce different user-facing feedback (different result banners, different button labels). Using `isSaving` for all three would: (1) show "Saving..." on the Save button while extraction runs; (2) make the extraction button appear to be in the wrong state if the save operation is simultaneously running. Separate transitions give each operation accurate, isolated pending state. The user always knows exactly which operation is in flight.

</details>

**Checkpoint:** `setSaveResult(null)` is called at the top of `handleSave`, before `startSave`. Why isn't this call inside `startSave`?

<details>
<summary>Reveal answer</summary>

`startSave` schedules its callback as a non-urgent React transition — React may not run it synchronously. If `setSaveResult(null)` were inside `startSave`, the previous result banner (success or error from a prior save) would remain visible for a brief moment at the start of the new operation. By calling it before `startSave`, the banner clears synchronously as part of the click handler, before the transition begins. The UI is clean immediately on click.

</details>

**Try it yourself:** Add a `console.log("isSaving:", isSaving, "isUploading:", isUploading)` inside the component's render (just before the return). Click "Save Profile" and watch the console — you'll see the component re-render with `isSaving: true`, then again with `isSaving: false`. Click the upload zone simultaneously (if possible) and observe that `isUploading` changes independently.

---

## Full data flow: from form field to saved database row

Trace a single field — `full_name` — from keypress to committed DB row:

```
1.  User types "Jesse James" in Full Name
    onChange → setField("full_name", "Jesse James") → re-render

2.  useMemo dependency [form] changed
    calculateCompletion({ full_name: "Jesse James", ... })
    → "FULL NAME" removed from missingFields
    → ring animates (CSS transition on strokeDashoffset)

3.  User clicks "Save Profile"
    handleSave() fires
    setSaveResult(null) — clears previous banner synchronously
    startSave(async () => {...}) — isSaving = true, "Saving..." button

4.  saveProfile({ full_name: "Jesse James", ... }) fires as HTTP POST
    Next.js routes it to actions/profile.ts
    createInsforgeServer() reads session cookie → userId, email

5.  SELECT is_complete FROM profiles WHERE id = userId
    → wasComplete = false (first save or prior incomplete state)

6.  calculateCompletion({ full_name: "Jesse James", email: "jesse@...", ... })
    → same function as step 2, same rules, same result

7.  UPSERT profiles SET full_name = 'Jesse James', ..., is_complete = true
    → DB trigger fires: updated_at = NOW()
    → RLS WITH CHECK (id = auth.uid()) passes

8.  !wasComplete && is_complete → captureServerEvent("profile_completed")
    try/catch ensures PostHog failure never blocks the return

9.  revalidatePath("/profile") — Next.js purges route cache

10. return { success: true }

11. Client: setSaveResult({ success: true })
    "Profile saved successfully" banner renders
    isSaving = false → button returns to "Save Profile"

12. Browser next request to /profile
    ProfilePage re-runs → fresh SELECT → new props
    ProfileForm re-initializes full_name from DB value
```

---

## Extend it (challenges)

### Challenge 1 — Trace a field end-to-end (15–20 min)

Choose `location` and trace it manually:

1. In `ProfileForm`, find where `location` is included in the `handleSave` payload
2. In `ProfileSavePayload`, find its declared type
3. In `saveProfile`, find where `payload.location` is written to the upsert
4. In `calculateCompletion`, find the check that gates `LOCATION` as a missing field
5. In `page.tsx`, confirm where the saved `location` value comes back as a prop

Write the full round trip in plain prose — form input → DB → re-rendered prop.

---

### Challenge 2 — Add a new required field (20–30 min)

Add `job_titles_seeking` as an 11th required field in `calculateCompletion`:

1. Add `'JOB TITLES SEEKING'` to the `MissingField` union in `types/index.ts`
2. Add `job_titles_seeking?: string[] | null` to `CompletionInput` in `lib/profile-utils.ts`
3. Add the check: `if (!p.job_titles_seeking || p.job_titles_seeking.length === 0) missingFields.push('JOB TITLES SEEKING')`
4. Update `total = 11`
5. Update both call sites: pass `job_titles_seeking: jobTitlesSeeking` in `ProfileForm`'s `useMemo`, and `job_titles_seeking: payload.job_titles_seeking` in `saveProfile`
6. Run `npx tsc --noEmit` — should be clean

What to notice: adding a field to `MissingField` doesn't automatically update the callers — TypeScript only catches call-site updates if the callers explicitly use the union type. The `calculateCompletion` body is the canonical place; the callers just pass data through.

---

### Challenge 3 — Design: auto-save with debounce (30–45 min)

Currently, saving requires an explicit button click. Design (but don't implement) an auto-save feature that saves the profile 2 seconds after the user stops typing.

Answer these design questions before writing any code:

1. Where would the debounce timer live — in `ProfileForm`, in a custom hook, in `page.tsx`?
2. Which fields would trigger the auto-save? All of them, or only "stable" fields (not skills/work experience which are edited mid-entry)?
3. What would the UI show during an auto-save — a spinner, a subtle "Saving..." chip, nothing?
4. How would you handle the race condition where the user clicks "Save" manually while an auto-save timer is pending?
5. Should `is_complete` gating and the PostHog event still work the same way with auto-save?

<details>
<summary>Hint</summary>

Auto-save with debounce is a `useEffect` + `useRef` pattern. The effect runs when form state changes, sets a timer, and cancels any previous timer in its cleanup function. The `saveProfile` call inside the effect can use the same `startSave` transition. The race condition (manual save + auto-save timer): the manual save clears the timer (`clearTimeout`) so the auto-save doesn't fire redundantly. The PostHog gate works identically because `saveProfile` re-reads `is_complete` from the DB every call — it doesn't matter whether the call was triggered manually or by the debounce timer.

</details>

---

For deeper exploration, `docs/plan/06-profile-save/ai-discussion-topics.md` has 12 prompts across Server Actions, shared utilities, InsForge Storage design, PostHog event gating, and `useTransition` semantics. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
