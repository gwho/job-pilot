# Tutorial 09 — Project Review: Resume Preview — Private Buckets, Signed URLs, and React State vs Database

**After completing this tutorial you will understand:** why a private storage bucket
returns a 403 when you try to open its URLs directly and what signed URLs are, how
`createSignedUrl()` generates on-demand time-limited access without storing the token,
why React component state is not a reliable place to persist data across page reloads and
how to fix it, how a two-level `??` fallback chain handles users who existed before a
new column was added, and why signed URL generation must happen on the server rather than
the client.

This tutorial is based on the project-review findings in
[`docs/project-review/06-resume-preview/`](../../project-review/06-resume-preview/) —
two bugs discovered during the Feature 06 review cycle that required fixes across the DB
schema, types, Server Action, and component layers.

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 07 (`07-profile-save/README.md`) — the original `uploadResume` Server Action
>   and storage pattern that this review extends. This tutorial assumes you already
>   understand `resume_pdf_key`, the remove-then-upload sequence, and `useTransition`.
> - Tutorial 08 (`08-profile-save-architect-deep-dive/README.md`) — the distinction
>   between `resume_pdf_key` (storage object identifier) and `resume_pdf_url` (display
>   URL) is covered there and is the root cause of Bug 1 in this tutorial.
>
> Open [`actions/profile.ts`](../../../actions/profile.ts),
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx),
> and [`types/index.ts`](../../../types/index.ts) alongside this tutorial.

---

## How to use an LLM before this tutorial

Run these warm-up prompts in a separate AI session. Budget 20–30 minutes. Each prompt
targets one piece of the mental model. Do not paste project code — plain concepts first.

### Concept 1 — Public vs private storage buckets

> "Explain the difference between a public and private storage bucket in a backend-as-a-service
> like Supabase or Firebase. When should user-uploaded files be in a private bucket versus
> a public one? What are the security implications of each? Give me two concrete examples:
> one where private is correct and one where public is correct. Then quiz me with three
> short scenarios."

*What to listen for:* Public buckets serve files via URL to anyone, no authentication
required — correct for assets you want cached by CDNs (logos, public photos). Private
buckets require authentication to access — correct for user-private documents (resumes,
medical records, financial statements). The URL returned by the SDK after uploading to a
private bucket is *not* a working URL for the browser to fetch — it's a storage API path.
Opening it directly gives a 403.

*Practice question:* A user uploads a profile photo that appears on a public directory
listing. Should it be in a private or public bucket?

---

### Concept 2 — How signed URLs work

> "Explain signed URLs. How does time-limited access work — what information is typically
> embedded in the token? Who can access a file via a signed URL, and what happens when it
> expires? Give me a concrete example using a resume PDF. Then ask me: what's the
> difference between a signed URL and a session-authenticated URL?"

*What to listen for:* A signed URL embeds a cryptographic token (often an HMAC of the
file path + expiry timestamp) that the storage server can verify without any session.
Anyone with the link can access the file until it expires — this means a leaked signed
URL is a real risk, but a short expiry bounds that risk. When the URL expires, the server
rejects the token and returns 403. The key insight: the token is the authorization, not
the session.

*Practice question:* You set a signed URL to expire in 5 seconds. What happens if the
browser requests the file 6 seconds after you generated the URL?

---

### Concept 3 — React state vs database: what survives reload

> "In React, I'm storing a filename in useState. The user uploads a file, and I call
> setFilename(result.filename). It shows correctly. But when I reload the page, the
> filename shows 'Resume on file' instead of the actual filename. What is happening?
> Where should this data actually live? Walk me through the React component lifecycle
> when a page reloads. Then quiz me: name three pieces of data that should live in state
> and three that must be persisted to a database."

*What to listen for:* When a page reloads, React unmounts the entire component tree and
re-mounts it fresh. All `useState` values are re-initialized from their initial values.
If the initial value is hardcoded (`"Resume on file"`), that's what appears — no matter
what the user did before the reload. The fix requires two things: persist the value to
the database and initialize the state from the database-fetched value.

*Practice question:* What's the difference between state that is "ephemeral" (only needed
during a session) and state that is "durable" (must survive reload)? Give one example of
each.

---

### Concept 4 — Null coalescing chains as migration fallbacks

> "I have existing database rows where `resume_pdf_filename` is NULL (the column didn't
> exist when those rows were written). I'm adding the column now and need to initialize
> UI state. I want: use the real filename if available, else fall back to 'resume.pdf' if
> the user has a resume key at all, else show null (no resume). Write this as a JavaScript
> expression and explain each level of the chain. Then quiz me: what happens to an existing
> user who uploaded before the column was added?"

*What to listen for:* The chain `a ?? (b ? c : null)` reads as: "use `a` if it exists,
otherwise evaluate the condition `b` and return `c` if true, else `null`." For migration
safety, the goal is never to silently downgrade an existing user's experience — they
already have a resume, so they should see the upload zone in the "has file" state even if
the exact filename isn't available yet.

*Practice question:* A user uploaded a resume before `resume_pdf_filename` was added to
the schema. Their row has `resume_pdf_key = "abc/resume.pdf"` and `resume_pdf_filename = NULL`.
What does `profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)`
evaluate to?

---

### Concept 5 — Why signed URL generation belongs on the server

> "I need to generate a signed URL for a private file. The signed URL requires access to
> a storage secret or service account. I could generate it in a Server Action or in a
> client-side fetch to an API route. What are the security implications of each approach?
> What would break if I generated the signed URL client-side? Give me the mental model
> for deciding which operations must be server-only."

*What to listen for:* Generating a signed URL requires either the storage SDK's admin
credentials or a service account key. These secrets cannot be sent to the client. If you
expose them, any visitor can generate unlimited signed URLs for any file in your storage
bucket. Operations that require secrets always belong on the server. The client receives
only the result (the time-limited URL), never the secret that created it.

*Practice question:* What is the minimum information the client needs to display a
private file, and what must stay on the server?

---

## What the review found: the full picture

```
Feature 06 build state (before review)
─────────────────────────────────────
profilesDB row after upload:
  resume_pdf_key:  "userId/resume.pdf"    ← storage object path
  resume_pdf_url:  "https://cdn.../..."   ← not a usable URL (private bucket)
  resume_pdf_filename: [column didn't exist]

UI after upload:
  Upload zone: shows filename from local state ← works until reload
  "View current resume": not wired up / no button

UI after reload:
  Upload zone: shows "Resume on file" (hardcoded) ← wrong
  filename lost from state

─────────────────────────────────────
After review fixes:
  DB: +resume_pdf_filename column (schema + types)
  Server Action: getResumeSignedUrl() on demand
  uploadResume: now saves filename to DB + returns it
  ProfileForm: state initialized from profile.resume_pdf_filename
  ProfileForm: "View current resume" button + handleViewResume
```

**Key invariant 1:** Signed URLs expire in 3600 seconds. They are generated on demand,
never stored. Each click on "View current resume" generates a fresh URL.

**Key invariant 2:** `getResumeSignedUrl()` always re-reads `resume_pdf_key` from the DB
— not from in-memory component state — so it reflects the current file even if a
replacement was uploaded in another tab.

**Key invariant 3:** "View current resume" only renders when `resumeFileName` is truthy.
No button visible = no resume to view.

---

## Part 1 — What project-review catches that feature-build misses

Open [`docs/project-review/06-resume-preview/plan.md`](../../project-review/06-resume-preview/plan.md).

The two issues share a pattern: both were invisible during the Feature 06 build session
because they only surface at runtime under specific conditions that weren't exercised:

```
Bug 1: No "View current resume"
  Condition that reveals it: user uploads a resume and tries to open it
  Why it wasn't caught during build: the button wasn't wired up; the build session
  verified upload succeeds, not that the file could be retrieved

Bug 2: Filename lost on reload
  Condition that reveals it: page reload after upload
  Why it wasn't caught during build: the build session tested upload,
  saw the filename appear, and moved on without reloading
```

This is the core value of a project-review pass: it tests the feature from a *user*
perspective (what can a user actually do with this?) rather than a *build* perspective
(did the code execute without errors?). Build verification confirms the happy path
executes. Project-review confirms the user experience is complete and durable.

Both bugs required fixes across multiple layers: DB schema, TypeScript types, Server
Action, and component state. Neither was a single-file fix. This is typical of bugs that
involve data persistence — they require you to think through the full vertical slice from
DB column to UI state initialization.

**Checkpoint:** Why do bugs that involve state initialization tend to require multi-layer
fixes?

<details>
<summary>Reveal answer</summary>

Because state initialization traces from the DB column (schema) → TypeScript type
(compile-time shape) → Server Action or page fetch (what data is queried) → component
props (what's passed down) → `useState` initial value (what the component starts with).
Missing a column means the data is never written. Missing a type means the column can't
be accessed in TypeScript. Missing a fetch means the data isn't available to initialize
state. Each layer is a required link in the chain.

</details>

**Try it yourself:** Open `docs/project-review/06-resume-preview/plan.md` and for each
issue, trace which layers needed to change. Count how many files were involved in each
fix. Note which fix required a DB schema change versus which was purely application code.

---

## Part 2 — Private bucket reality: why `resume_pdf_url` is a 403

Open [`actions/profile.ts`](../../../actions/profile.ts) line 196:

```typescript
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

The `uploadData.url` returned by `insforge.storage.from("resumes").upload(...)` looks
like a regular HTTPS URL. It is not. For a private bucket, this URL routes through the
storage API and requires authentication. When a browser navigates directly to this URL,
it has no session cookie attached to the storage service — the request lands without auth
and gets a 403 Forbidden response.

The `explanation.md` states this directly:

> *"The URL returned by `storage.upload()` is not publicly accessible — the browser will
> get a 403 if you try to open it. `getPublicUrl()` is only valid for buckets marked
> as public."*

The stored `resume_pdf_url` is useful only for contexts where the storage SDK handles
auth automatically — such as server-side reads. For browser-initiated access (opening a
PDF in a new tab), a signed URL is required.

### Why `resume_pdf_url` is still stored

Storing it is not wrong — it could be useful for server-side reads that go through the
SDK (which attaches auth automatically) or for future features that process the file
server-side. But it is the wrong thing to give to the browser directly. The column stays;
what changes is that we never pass `resume_pdf_url` to `window.open()`.

**Checkpoint:** Why doesn't the SDK return a signed URL from `upload()` instead of the
storage API URL, since private files always need signing for browser access?

<details>
<summary>Reveal answer</summary>

Because signed URLs expire. A URL returned at upload time would be dead in 3600 seconds.
The SDK correctly separates "upload and get a durable reference" (the key + API URL) from
"generate a time-limited access link for a specific user session" (signed URL). The
signed URL is an on-demand operation, not a side effect of upload.

</details>

**Try it yourself:** Open your browser's network inspector. If you have a resume uploaded,
temporarily change `handleViewResume` to open `profile?.resume_pdf_url` directly instead
of calling `getResumeSignedUrl()`. Reload the page and click the button. Observe the
network request and the 403 response. Then revert the change.

---

## Part 3 — `getResumeSignedUrl()`: generated on demand, never stored

Open [`actions/profile.ts`](../../../actions/profile.ts) lines 221–258:

```typescript
export async function getResumeSignedUrl(): Promise<{
  url?: string;
  error?: string;
}> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } =
      await insforge.auth.getCurrentUser();

    if (authError || !authData.user) {
      return { error: "Not authenticated" };
    }

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

    if (error || !data?.signedUrl) {
      console.error("[actions/profile] getResumeSignedUrl error:", error);
      return { error: "Could not generate preview link" };
    }

    return { url: data.signedUrl };
  } catch (err) {
    console.error("[actions/profile] getResumeSignedUrl unexpected error:", err);
    return { error: "An unexpected error occurred" };
  }
}
```

Three design decisions are embedded in this function:

**1. Re-reads `resume_pdf_key` from the DB, not from component state.**

The function takes no parameters — it derives everything from the server-side session.
The `explanation.md` explains why:

> *"Avoids stale state bugs (e.g., user uploads a replacement resume in another tab). The
> DB is always the source of truth for which file is current."*

If `handleViewResume` passed the current `resumeFileName` or a cached key from React
state, a multi-tab user could generate a signed URL for a file that was already replaced.
The extra round-trip to the DB (one SELECT on a single row) is cheap; stale state is
not.

**2. The signed URL is returned, not stored.**

The function returns `{ url: data.signedUrl }` and the client opens it immediately. It
is never written to the DB, never put in React state, never cached. The `explanation.md`
records why:

> *"If we stored one at upload time, it would be dead within an hour."*

Storing a signed URL trades false reliability for real reliability. A stored URL that
expired before the user clicks it is worse than generating a fresh one — at least the
fresh one is guaranteed valid.

**3. 3600 seconds (1 hour) expiry.**

This is a judgment call. Long enough to read a multi-page PDF, short enough that a
leaked URL has a bounded impact window. The `explanation.md` words it as: *"long enough
to read a PDF, short enough that a leaked URL is low-risk."*

**Checkpoint:** What would happen if a user clicks "View current resume," the PDF opens,
and then 61 minutes later they click the browser's reload button on the PDF tab?

<details>
<summary>Reveal answer</summary>

The signed URL embedded in the tab's URL has expired (3601 seconds since generation > 3600
second TTL). The storage server rejects the token and returns 403. The user sees an error
or a blank page. The fix is to click "View current resume" again, which calls
`getResumeSignedUrl()` and generates a fresh URL. This is expected behavior, not a bug —
the 1-hour expiry is an explicit design trade-off between usability and security.

</details>

**Try it yourself:** In `actions/profile.ts` line 246, change `3600` to `5` (5 seconds).
Upload a resume, click "View current resume" — it opens. Wait 6 seconds, then reload the
PDF tab. Observe the result. Revert to `3600` when done.

---

## Part 4 — The filename loss: React state vs database

This bug is a clean illustration of a common React misconception. Look at the original
`resumeFileName` state initialization (before the fix):

```typescript
// BEFORE: hardcoded initial value
const [resumeFileName, setResumeFileName] = useState<string | null>("Resume on file");
```

After upload, `setResumeFileName("Fake-Resume.pdf")` is called — it works. The UI shows
the real filename. But React state is memory. It lives inside the browser tab, in the
JavaScript heap. When the user reloads the page:

```
Browser navigates to /profile
React re-mounts ProfileForm
useState<string | null> initializes to... "Resume on file"
```

The `setResumeFileName` call from the upload is gone. It never reached the DB. The
component simply starts fresh.

The fix requires two changes working together:

**DB layer:** `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_pdf_filename TEXT;`

**Action layer** (in `uploadResume`):
```typescript
resume_pdf_filename: file.name,
```

And the return value:
```typescript
return { success: true, key: uploadData.key, url: uploadData.url, filename: file.name };
```

**Component layer** — now the state initializes from the profile prop:

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx) lines 192–194:

```typescript
const [resumeFileName, setResumeFileName] = useState<string | null>(
  profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)
);
```

The initial value is now derived from the database-fetched `profile` prop, not
hardcoded. After a page reload, `page.tsx` fetches the profile row from the DB, passes
it as a prop, and `ProfileForm` initializes `resumeFileName` from `profile.resume_pdf_filename`.

And after a new upload, the component correctly updates state from the server response:

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx) line 318:

```typescript
if (result.success) {
  setResumeFileName(result.filename ?? file.name);
}
```

`result.filename` is the filename that was saved to the DB by `uploadResume`. Setting
state from the server response (rather than from the local `file.name`) keeps the local
state in sync with what was actually persisted.

**Checkpoint:** Why is `setResumeFileName(result.filename ?? file.name)` preferable to
just `setResumeFileName(file.name)`, even though `result.filename` will be the same as
`file.name` in most cases?

<details>
<summary>Reveal answer</summary>

`result.filename` is the filename the Server Action actually saved to the DB and returned
as confirmation. `file.name` is the local file object's name. In most cases they're
identical — but if the Server Action transformed the filename (e.g., sanitized it,
truncated it), using `result.filename` keeps the UI in sync with what was persisted.
Using `file.name` in that case would show one thing in the UI and store another in the
DB. The `??` fallback to `file.name` is for the edge case where the server response
doesn't include `filename` for some reason — an unusual defensive measure.

</details>

**Try it yourself:** Upload a resume and verify the filename appears. Then reload the
page and verify the filename still appears. Then open the browser's developer tools,
go to Application → Local Storage — the filename is not there. It survives reload because
it's in the *database*, not in the browser's storage. The data flow is: reload → page.tsx
fetches profile from DB → passes as prop → `useState` initializes from prop.

---

## Part 5 — The two-level `??` fallback chain as migration safety

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx) lines 192–194:

```typescript
const [resumeFileName, setResumeFileName] = useState<string | null>(
  profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)
);
```

This expression handles three distinct user states:

```
State A — new user, no resume:
  profile?.resume_pdf_filename  = null/undefined
  profile?.resume_pdf_key       = null/undefined
  → null
  → upload zone shows "empty" state (no file uploaded)

State B — existing user, uploaded before the fix:
  profile?.resume_pdf_filename  = null  (column didn't exist when they uploaded)
  profile?.resume_pdf_key       = "userId/resume.pdf"  (key exists)
  → null ?? ("userId/resume.pdf" ? "resume.pdf" : null)
  → "resume.pdf"
  → upload zone shows "has file" state with generic name

State C — user who uploaded after the fix:
  profile?.resume_pdf_filename  = "My-Resume-2026.pdf"
  profile?.resume_pdf_key       = "userId/resume.pdf"
  → "My-Resume-2026.pdf"
  → upload zone shows "has file" state with real filename
```

The two-level fallback is a migration pattern. When a new column is added to a table,
existing rows have `NULL` for that column. If the UI only used `profile?.resume_pdf_filename`,
existing users (State B) would see the empty upload state — even though they have a resume.
This is a worse experience than showing "resume.pdf": the user would think their upload
was lost.

The `explanation.md` phrases it precisely:

> *"The fallback ensures they still see the upload zone in the 'has resume' state rather
> than the empty state. The generic 'resume.pdf' is accurate enough — they do have a
> resume on file."*

**Checkpoint:** Why is the inner ternary `(profile?.resume_pdf_key ? "resume.pdf" : null)`
necessary — couldn't we just use `profile?.resume_pdf_filename ?? "resume.pdf"`?

<details>
<summary>Reveal answer</summary>

`profile?.resume_pdf_filename ?? "resume.pdf"` would always fall back to `"resume.pdf"`
when the filename is null, even for users who have never uploaded anything (State A).
Those users would see the upload zone in the "has file" state with label "resume.pdf" —
and a "View current resume" button that would fail because there's no key. The inner
ternary checks `resume_pdf_key` to distinguish "has a file but missing filename metadata"
(State B) from "has never uploaded" (State A). Only State B gets the generic fallback.

</details>

**Try it yourself:** Temporarily change the initialization to
`profile?.resume_pdf_filename ?? "resume.pdf"` and reload with a profile that has
`resume_pdf_key = null` (a new user). Observe that the upload zone incorrectly shows
"resume.pdf" and a View button appears. Then click the View button and observe the error.
Revert to the original chain.

---

## Part 6 — `handleViewResume` and the conditional "View current resume" button

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx) lines 325–331:

```typescript
function handleViewResume() {
  startViewResume(async () => {
    const result = await getResumeSignedUrl();
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  });
}
```

And lines 573–582 for the button render:

```typescript
{resumeFileName && (
  <button
    type="button"
    onClick={handleViewResume}
    disabled={isViewingResume}
    className="text-sm text-accent underline-offset-2 hover:underline disabled:opacity-50 transition-opacity"
  >
    {isViewingResume ? "Opening..." : "View current resume"}
  </button>
)}
```

Four decisions are visible here:

**1. The third `useTransition`.**

This tutorial's feature adds a third independent transition alongside `startSave` and
`startUpload` (covered in Tutorial 07). `isViewingResume` is its pending flag:

```typescript
const [isViewingResume, startViewResume] = useTransition();
```

The button shows "Opening..." while the Server Action runs (typically 200–500ms for a
DB read + signed URL generation). Using a third transition keeps the three operations
independent — a user can't accidentally trigger save while a signed URL is being fetched.

**2. `window.open` with `noopener,noreferrer`.**

The signed URL opens in a new tab. `noopener` prevents the new tab from accessing
`window.opener` (a security hardening for external links). `noreferrer` prevents the HTTP
`Referer` header from being sent, which stops the storage server from logging the originating
URL. Both flags are standard security hygiene for any `window.open` that leaves your
domain.

**3. Silent failure when there's no URL.**

```typescript
if (result.url) {
  window.open(result.url, "_blank", "noopener,noreferrer");
}
```

If `getResumeSignedUrl()` returns `{ error: "..." }` instead of `{ url: "..." }`, the
handler does nothing visible to the user. There's no error shown. This is intentional
for a "View" button — if it fails, the file still exists on disk, the save still worked.
A future improvement would surface the error, but for Feature 06 scope, silent failure
is acceptable since the upload zone error message covers the unhappy upload path.

**4. The button only renders when `resumeFileName` is truthy.**

```typescript
{resumeFileName && (
  <button ...>
```

`resumeFileName` is the local state value — initialized from the DB, updated on upload.
Its truthiness represents "the user has a resume on file." This gate prevents the button
from appearing for users with no resume (who would get an unhelpful error from
`getResumeSignedUrl` returning "No resume on file"). The button's presence is itself a
signal — it communicates "you have a file" to the user.

**Checkpoint:** Why is the `resumeFileName` guard on the button better than checking
`profile?.resume_pdf_key` directly in the JSX?

<details>
<summary>Reveal answer</summary>

`profile?.resume_pdf_key` is a prop — it reflects the state at the time the page loaded.
`resumeFileName` is local state — it updates immediately when a new file is uploaded
in the current session (via `setResumeFileName(result.filename ?? file.name)` in
`handleFileChange`). Using the prop would mean the "View current resume" button doesn't
appear immediately after uploading a first-ever resume in the current session, because
`profile.resume_pdf_key` is still `null` from before the upload. Local state reflects
the current truth; the prop reflects the loaded truth.

</details>

**Try it yourself:** Open `ProfileForm.tsx` and find the full button group around line
563. Notice the "Replace Resume" / "Select Resume" button and the "View current resume"
button sit in the same `<div>`. Trace what `resumeFileName` controls: which button label
("Replace Resume" vs "Select Resume"), whether the View button appears, and what the
upload zone shows. Map each UI state to the three states from Part 5 (no file, file with
old schema, file with new schema).

---

## Full data flow: user clicks "View current resume"

```
1. User clicks "View current resume" button
   └─ components/profile/ProfileForm.tsx:576 — onClick={handleViewResume}

2. handleViewResume() called
   └─ ProfileForm.tsx:325 — startViewResume(async () => { ... })
   └─ isViewingResume becomes true → button shows "Opening..."

3. getResumeSignedUrl() Server Action invoked (HTTP POST, server-side)
   └─ actions/profile.ts:221

4. createInsforgeServer() — reads session cookie
   └─ actions/profile.ts:226 → lib/insforge-server.ts

5. getCurrentUser() — validates session, gets userId
   └─ actions/profile.ts:227–232

6. DB SELECT — reads resume_pdf_key only (minimal data)
   └─ actions/profile.ts:234–238
   └─ insforge.database.from("profiles")
        .select("resume_pdf_key")
        .eq("id", authData.user.id)
        .maybeSingle()

7. Guard: no key → return { error: "No resume on file" }
   └─ actions/profile.ts:240–242

8. createSignedUrl(key, 3600) — generates time-limited token
   └─ actions/profile.ts:244–246
   └─ insforge.storage.from("resumes").createSignedUrl(profile.resume_pdf_key, 3600)

9. Return { url: data.signedUrl }
   └─ actions/profile.ts:253

10. Client receives result.url
    └─ ProfileForm.tsx:328 — if (result.url)

11. window.open(result.url, "_blank", "noopener,noreferrer")
    └─ ProfileForm.tsx:329 — PDF opens in new browser tab

12. isViewingResume becomes false → button returns to "View current resume"
    └─ useTransition resolves
```

**What is NOT in this flow:**
- No signed URL written to the DB
- No signed URL put in React state
- No `resume_pdf_url` column involved
- No `resumeFileName` state changed

The entire flow is stateless from the application's perspective: request comes in, DB
gives back the key, storage signs a URL, URL goes out. Nothing persists.

---

## Self-check quiz

<details>
<summary><strong>1. Why can't the browser open `resume_pdf_url` stored in the database directly?</strong></summary>

The `resumes` storage bucket is configured as private. The `resume_pdf_url` returned by
`storage.upload()` routes through the storage API and requires authentication. When a
browser navigates to this URL directly, it has no session cookie — the request is
unauthenticated and gets a 403 Forbidden response. Only signed URLs (which embed auth
in the token itself) allow unauthenticated browser access to private bucket files.

</details>

<details>
<summary><strong>2. Why is the signed URL generated on every "View current resume" click instead of being generated at upload time and stored?</strong></summary>

Signed URLs expire — in this implementation, after 3600 seconds (1 hour). A URL stored
at upload time would be dead the next time the user visits the profile page or returns
after an hour. Generating on demand means the URL is always fresh and valid at the moment
of use. The cost is one extra Server Action call per click; the benefit is that the URL
is guaranteed valid.

</details>

<details>
<summary><strong>3. Why does React state lose the uploaded filename on page reload, and how was it fixed?</strong></summary>

React `useState` lives in the JavaScript heap. When a page reloads, the component
unmounts and remounts fresh, re-running all `useState` initializations from their initial
values. The original code initialized `resumeFileName` with a hardcoded string, so the
upload-time `setResumeFileName` call was lost. The fix has two parts: persist
`resume_pdf_filename` to the database in `uploadResume`, and initialize the state from
`profile?.resume_pdf_filename` (the DB-fetched prop) instead of a hardcoded value.

</details>

<details>
<summary><strong>4. What does `profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)` return for a user who uploaded a resume before `resume_pdf_filename` was added to the schema?</strong></summary>

That user has `resume_pdf_filename = null` (column didn't exist) and `resume_pdf_key =
"userId/resume.pdf"` (key exists from the old upload). The expression evaluates as:
`null ?? ("userId/resume.pdf" ? "resume.pdf" : null)` → `"resume.pdf"`. This puts the
upload zone into the "has file" state with a generic filename, correctly reflecting that
the user does have a resume on file. Without this fallback, the upload zone would show
the empty state and the user might think their file was lost.

</details>

<details>
<summary><strong>5. Why must `getResumeSignedUrl()` be a Server Action rather than a client-side fetch to a storage API?</strong></summary>

Generating a signed URL requires authenticating against the storage service using server-
side credentials (the InsForge server client, initialized with a service key). These
credentials cannot be sent to the browser — any user could then generate signed URLs for
any file in the bucket. Server Actions run on the server, keeping the credentials private.
The client receives only the output (the time-limited URL), never the secrets used to
create it.

</details>

---

## Extend it (challenges)

**Challenge 1 — Trace the `resume_pdf_filename` column through all layers (15–20 min)**

Starting from the DB schema, trace `resume_pdf_filename` through every layer it appears
in. Document each occurrence: which file, what line range, what value is read/written/used.
Answer these questions from your trace:

- At which point does the filename first enter the system (user action)?
- At which point is it written to the DB?
- At which point is it read back?
- At which point does it reach React state?
- What is the type of the value at each layer (SQL `TEXT`, TypeScript `string | null`, etc.)?

<details>
<summary>Hint</summary>

Start from `scripts/schema.sql` (the ADD COLUMN), then `types/index.ts` (the type
definition), then `actions/profile.ts` `uploadResume` (where it's written), then
`app/profile/page.tsx` (where the profile including filename is fetched), then
`ProfileForm.tsx` (where it initializes state).

</details>

---

**Challenge 2 — Add a "download resume" button (20–30 min)**

The "View current resume" button opens the file in a new tab. Add a companion "Download
resume" button that downloads the file instead of previewing it.

The signed URL approach works for this too — the difference is in how you use the URL.
`window.open(url, "_blank")` opens in a tab. To download programmatically, you can
create an `<a>` element, set `href` to the signed URL, set `download` to the filename,
and call `.click()`.

What you need to touch:
- `actions/profile.ts` — you may reuse `getResumeSignedUrl()` as-is
- `ProfileForm.tsx` — add a `handleDownloadResume` handler and a Download button

<details>
<summary>Hint</summary>

```typescript
function handleDownloadResume() {
  startDownloadResume(async () => {
    const result = await getResumeSignedUrl();
    if (result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = resumeFileName ?? "resume.pdf";
      a.click();
    }
  });
}
```

You'll need a fourth `useTransition` for `isDownloading`. The button should render
alongside the View button, inside the same `{resumeFileName && (...)}` guard.

</details>

---

**Challenge 3 — Design a signed URL caching strategy and reason about its trade-offs (30–45 min)**

Currently, every click on "View current resume" makes a DB read + a signed URL
generation call. For a user who wants to preview their resume repeatedly in one session,
this is three round-trips per click (auth + DB + storage API).

Design (in writing, no code required) a caching strategy that reduces this overhead while
remaining correct. Your design should address:

1. Where would you cache the signed URL? (React state, `useRef`, sessionStorage, React Query cache?)
2. How would you implement expiry? (The URL is valid for 3600s — how do you know when to regenerate?)
3. What happens if the user uploads a replacement resume while a cached signed URL for
   the old file is in the cache? How would you invalidate it?
4. Is the complexity of caching worth the round-trip savings for this use case?

<details>
<summary>Hint for thinking about the trade-offs</summary>

Consider: how often does a user click "View current resume" more than once per session?
How long does `getResumeSignedUrl()` actually take (a DB read + SDK call — likely 200ms
total)? Is 200ms on each click actually painful enough to warrant a cache? Sometimes the
right answer to "should I cache this?" is "no, the round-trip is fast enough and the
cache adds complexity with risk of serving stale data." Write out your reasoning.

</details>

---

For deeper exploration, `docs/project-review/06-resume-preview/ai-discussion-topics.md`
has 10 prompts covering private vs public storage buckets, signed URL security
implications, React state vs database state mental models, and server vs client
boundaries for secret-dependent operations. Feed them to an LLM *after* forming your own
answer first — the gap between what you thought and what you learn is where understanding
lands.
