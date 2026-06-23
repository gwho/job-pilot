# Explanation — Feature 06: Profile Save Logic

## 1. The full read → compute → write → revalidate loop

When the user clicks "Save Profile," `handleSave()` fires in `ProfileForm.tsx`. It clears any previous result banner, then calls `startSave(async () => { ... })` — a React `useTransition` that keeps the button responsive while the async work runs. Inside, it calls the `saveProfile` Server Action with the current form state assembled into a `ProfileSavePayload`.

The Server Action runs entirely on the server. It calls `createInsforgeServer()` and authenticates the user from the session cookie — the same cookie set by the OAuth callback in Feature 02. The user ID and email come from the session, never from the form payload. Then it executes three reads before the write: (1) the current `is_complete` flag from the DB as a baseline for the PostHog gate, (2) `calculateCompletion()` on the incoming payload to compute the new completion state, and (3) the upsert itself, which either creates the profile row (first save) or updates it (subsequent saves).

After the upsert succeeds, the Server Action fires the `profile_completed` PostHog event if `!wasComplete && is_complete` — the false→true transition — and calls `revalidatePath("/profile")`. That call tells Next.js to purge its route cache for that path. On the next request (which the client makes automatically after the Server Action returns), `ProfilePage` re-runs its `SELECT *` query, receives fresh profile data, and passes it as props to `ProfileForm`. The form re-renders with the saved state.

## 2. Why calculateCompletion lives in lib/, not inline

Feature 05 computed completion as a `useMemo` directly inside `ProfileForm`. The logic was embedded in the component. Feature 06 needs the exact same rules in a second location: `saveProfile` must compute `is_complete` before writing it to the database. That means the function has to be shared.

The naive approach is to write the logic twice — once in the component's `useMemo` and once in the Server Action:

```typescript
// ❌ Duplicated — these will drift
// ProfileForm (client):
const isComplete = skills.length > 0 && form.full_name.trim() !== "" && ...

// saveProfile (server):
const is_complete = payload.skills.length > 0 && payload.full_name.trim() !== "" && ...
```

One month from now, a developer decides phone is no longer a required field. They update `ProfileForm`'s logic. They don't notice the Server Action has its own copy of the same rules. The UI ring shows 100% — the server logic still requires phone — so `is_complete = false` gets written to the DB. The `profile_completed` PostHog event never fires. Job matching considers the profile incomplete. There is no error, no exception, no warning — just silently wrong state in the database.

`lib/profile-utils.ts` solves this at the source. The file has no `"use client"` or `"use server"` directive, no Next.js imports, no framework dependencies. It imports only a type from `types/index.ts`. That makes it importable anywhere in the codebase: Client Components, Server Actions, API routes, or test files. One function, one set of rules, one place to update.

The `CompletionInput` type uses optional/nullable fields (`field?: string | null`) so it accepts both call shapes — the Server Action's `ProfileSavePayload` (which uses empty strings for unset text fields) and `Profile | null` (which uses actual `null`). The function doesn't need to know which caller it's serving.

## 3. Why email is a separate prop, never from the form payload

`ProfilePage` passes two props to `ProfileForm`: `profile` (the DB row) and `email` (from `authData.user.email`). These are distinct data sources. `authData.user.email` is the session-verified email. `profile.email` is whatever was last written to the `profiles` table, which could be stale — a user could change their InsForge auth email after their profile was last saved.

More critically, `saveProfile` always writes `email: authData.user.email` (the session-derived value) to the upsert — not `payload.email`. The form payload never includes an email field that the server trusts. If it did, a malicious client could send `payload.email: "victim@example.com"` and overwrite another user's email in the profiles table. Reading email from the session is the same defense-in-depth pattern that reads `userId` from the session: the server never trusts identity information sent by the client.

Passing `email` as a separate prop from the page component makes this data-source distinction visible at the call site. Any developer reading `page.tsx` sees immediately that email comes from auth, not from the profiles row, and that this is an intentional separation.

## 4. Why is_complete is read before the upsert, not after

The `profile_completed` PostHog event should fire exactly once: the first time a user's profile transitions from incomplete to complete. That requires comparing two states: the `is_complete` value before the save, and the `is_complete` value after. Both must be known at the same time to check the `!wasComplete && is_complete` condition.

Reading `is_complete` after the upsert would require a second SELECT. More importantly, the post-upsert SELECT would tell you what the current state is — but it can't tell you what the state was before the write, because that information is now gone. You'd be comparing `isNow` against itself, not against `wasBefore`.

The sequence:

```typescript
// Read current state first
const { data: existing } = await insforge.database
  .from("profiles")
  .select("is_complete")
  .eq("id", userId)
  .maybeSingle();

const wasComplete = existing?.is_complete ?? false;

// Compute the new state from the incoming payload
const { missingFields } = calculateCompletion({ ... });
const is_complete = missingFields.length === 0;

// UPSERT — now we have both states simultaneously
```

Using `.maybeSingle()` rather than `.single()` is deliberate. A first-time user has no `profiles` row yet — the upsert in `saveProfile` creates it on first save. `.single()` would throw an error when zero rows are returned. `.maybeSingle()` returns `null`, and `existing?.is_complete ?? false` correctly defaults to `false` for a new user. If that first save also completes the profile, `!false && true` fires the event — the correct behavior for a user who fills in everything on their first attempt.

## 5. The `'' → null` coercion: what FormState allows vs what the DB accepts

`FormState` declares enum fields as `ExperienceLevel | ''` (for example). The empty string is the value a `<select>` element holds when nothing is selected — HTML's "no selection" representation. A controlled React `<select>` needs a string value; `null` and `undefined` are not valid.

The database, however, stores unset optional fields as `NULL`, not as empty strings. Storing `''` in a `TEXT` column would be semantically wrong: the DB would treat the field as "set to an empty string" rather than "not set." Every downstream query that filters on `experience_level IS NOT NULL` would find a row with `experience_level = ''` — an unexpected result. The Gemini system prompt in Feature 07 also uses `null` to mean "not set"; a stored empty string would be a different sentinel that the extraction code doesn't expect.

The coercion in the upsert:

```typescript
experience_level: payload.experience_level || null,  // '' → null
years_experience: payload.years_experience ? Number(payload.years_experience) : null,
```

`|| null` converts any falsy value (empty string, zero, undefined) to `null`. For `years_experience`, the additional step converts the string (React's `<input>` always produces strings) to a number for the DB's `INTEGER` column — or `null` if no value was entered. These coercions happen at exactly one location: the upsert in `saveProfile`. The client never has to worry about them; the form can use the HTML-native representations throughout.

## 6. Remove-then-upload: the storage collision the pattern prevents

InsForge Storage's `upload()` function does not overwrite files. If a file already exists at the target path, the SDK auto-renames the incoming file to avoid collision: `{userId}/resume.pdf` becomes `{userId}/resume-1705315200000.pdf` (a timestamp appended). This renamed key gets returned as `uploadData.key`. If that key is then saved to the `profiles` table, the user now has `resume_pdf_key: "{userId}/resume-1705315200000.pdf"` in the DB and an orphaned `{userId}/resume.pdf` in storage.

A second upload repeats the pattern: `{userId}/resume-1705315200001.pdf` is saved, another orphan is created. After a few uploads, the user has accumulated files with no way to know which is current. The `getResumeSignedUrl()` action — used in Feature 09 to preview the resume — generates a URL from `resume_pdf_key`. If the key is the timestamped variant, it resolves correctly; but the original `resume.pdf` is now an orphan that costs storage space indefinitely.

The correct pattern, used in both `uploadResume` and Feature 08's resume generation route:

```typescript
// 1. Read the existing key from the DB
const { data: existing } = await insforge.database
  .from("profiles")
  .select("resume_pdf_key")
  .eq("id", userId)
  .maybeSingle();

// 2. Remove the old file if it exists
if (existing?.resume_pdf_key) {
  await insforge.storage.from("resumes").remove(existing.resume_pdf_key);
}

// 3. Upload to the deterministic path — no collision possible
const { data: uploadData } = await insforge.storage
  .from("resumes")
  .upload(`${userId}/resume.pdf`, file);

// 4. Save the new key and URL back to the DB
```

The `remove()` call's return value is not checked. If it fails (the old file was already gone), execution continues to `upload()`. The worst case is one extra file in storage with no DB reference — acceptable, since the new upload still succeeds and the user's experience is not blocked.

## 7. Why uploadResume uses FormData, not a typed object

Every other Server Action in this project uses a typed object parameter: `saveProfile(payload: ProfileSavePayload)`, `deleteResume()`, etc. These are serialized as JSON by Next.js. File objects are binary data — they cannot be serialized to JSON. A `File` is not a string, number, or plain object; it contains raw bytes and metadata that JSON cannot represent.

`FormData` is the web-standard container for mixed binary+text payloads. Browsers know how to encode a `FormData` that includes a `File` as a `multipart/form-data` HTTP request — the same encoding used by traditional HTML form uploads. Next.js Server Actions support `FormData` natively for exactly this reason.

The receiving code in the Server Action:

```typescript
const file = formData.get("resume");

if (!(file instanceof File) || file.size === 0) {
  return { success: false, error: "No file provided" };
}
```

`formData.get("resume")` returns `FormDataEntryValue | null` — a union of `File | string | null`. The `instanceof File` check narrows it. `file.size === 0` catches an edge case where a file input is present but the file is empty. `file.type !== "application/pdf"` validates the MIME type sent by the browser — not a cryptographic guarantee (a user could rename a `.txt` to `.pdf`), but sufficient for this use case.

## 8. The one-shot PostHog event: four states of the boolean transition gate

```typescript
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
```

The `!wasComplete && is_complete` condition is the transition gate. There are four possible combinations:

| wasComplete | is_complete | fires? | scenario |
|---|---|---|---|
| `false` | `false` | no | still incomplete — fields still missing |
| `false` | `true` | **yes** | just completed for the first time |
| `true` | `false` | no | was complete, user removed data |
| `true` | `true` | no | already complete — event already fired |

The analytics call is wrapped in `try/catch` with an empty catch body. If PostHog's servers are down, rate-limiting, or return an error, the save still succeeds and returns `{ success: true }` to the user. This is the "best effort" pattern: observability and analytics are side effects of the user's intent (saving data). Failures in the side effects must never become blockers for the primary operation.

The `captureServerEvent` helper (from `lib/posthog-server.ts`) creates a fresh PostHog server client with `flushAt: 1` and `flushInterval: 0`, then calls `posthog.shutdown()` in a `finally` block. Serverless functions — including Next.js Server Actions running in an edge/serverless environment — can terminate before queued analytics events are flushed to PostHog's servers. Creating a client per-event with immediate flush ensures the event is sent before the function exits, even if the function is short-lived.

## 9. Three separate useTransition instances: why not one shared flag

`ProfileForm` declares three independent transitions:

```typescript
const [isSaving, startSave] = useTransition();
const [isUploading, startUpload] = useTransition();
const [isViewingResume, startViewResume] = useTransition();
```

A single shared `isPending` flag would mean uploading a resume disables the Save button, and saving disables the upload zone. These operations are independent — a user reviewing their resume in a new tab (from `getResumeSignedUrl`) should not see the Save button as loading. A user saving their form should not see the upload zone as busy.

Each transition tracks its own pending state: `isSaving` is true only during `saveProfile`, `isUploading` only during `uploadResume`, `isViewingResume` only during `getResumeSignedUrl`. Buttons are disabled only for their own operation. This gives the UI accurate loading states rather than a coarser "something is happening" indicator.

The benefit of `useTransition` over a `useState(false)` flag is automatic cleanup: `isSaving` resets to `false` when the transition completes, regardless of whether the callback succeeded or threw. A `useState` flag requires manual `setIsSaving(false)` calls in every success and error branch — a forgotten reset leaves the Save button permanently disabled without any error message.
