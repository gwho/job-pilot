# Architect Session — Feature 06: Profile Save Logic

## The Question Coming In

Feature 05 built a complete ProfileForm with mock data and an inert Save button. Feature 06 wires it to the database. The architect session was used to compare two plans (ours and a Cursor-generated plan) and consolidate the best ideas from both.

---

## Plan Comparison

### Our Original Plan

- Bundle resume upload inside `saveProfile` — one action does everything
- Keep completion logic inline in both the form (useMemo) and the Server Action
- Use typed object for the action parameter

**Problem identified**: If the client-side `missingFields` useMemo and the server-side `is_complete` calculation ever diverged (even slightly — a typo, a missing check), users would see wrong completion state with no error. Single source of truth was missing.

### Cursor's Plan

Introduced three structural improvements:

1. `MissingField` type in `types/index.ts` — explicit type contract instead of raw `string[]`
2. `lib/profile-utils.ts` with `calculateCompletion()` — shared by form display AND Server Action; eliminates divergence risk
3. `uploadResume` as a separate Server Action — fires on file pick, gives immediate feedback
4. `ProfileAttentionBanner` extracted as own component — nice refactor, not essential for Feature 06

---

## Decisions Made

### 1. Shared calculateCompletion utility

**Decision**: Extract to `lib/profile-utils.ts`.

**Why**: The form's `missingFields` useMemo and the server's `is_complete` calculation both implement the same logic. Keeping them separate means a future edit to one can silently break the other. A shared utility is the only way to guarantee they stay in sync.

**How it works**: `calculateCompletion(input)` accepts a partial profile shape and returns `{ percentage, missingFields: MissingField[] }`. ProfileForm replaces its useMemo with a call to this. The Server Action calls the same function to determine `is_complete` before upsert.

### 2. Resume upload UX

**Decision**: Separate `uploadResume` Server Action, fires on file pick.

**Why**: The user chose this explicitly. Upload fires when a PDF is selected — the user sees immediate feedback (spinner → checkmark). Save Profile only handles text fields and is fast. Two distinct operations with distinct feedback.

**Trade-off**: The resume URL is in the DB before the profile is saved. If the user uploads a resume and then closes the browser without saving, they have a resume key but incomplete profile fields. Acceptable for this use case.

### 3. Storage: remove-then-upload pattern

**Decision**: `remove(existingKey)` before uploading new file.

**Why**: InsForge `storage.upload()` does NOT support `upsert`. If a file exists at the same path, the SDK auto-renames the new upload (appending a timestamp). This would pile up old resume files. The correct pattern is to read `resume_pdf_key` from DB, call `remove()`, then upload to get the new key. Save both `resume_pdf_key` and `resume_pdf_url` to DB.

**Note**: `library-docs.md` was updated to correct the wrong `upsert: true` documentation.

### 4. Email sourced from auth session

**Decision**: Email comes from `authData.user.email` in the Server Action, not from form input.

**Why**: Email is a required completion field but should not be user-editable (auth-owned). If we let the form send `email`, a client could pass any value. Reading it from the session is the only safe approach.

### 5. DB API: insforge.database.from()

**Decision**: Use `insforge.database.from(...)` — NOT `insforge.from(...)`.

**Why**: The SDK type definition confirms the database lives at `client.database`. The `library-docs.md` pattern showing `insforge.from(...)` directly was wrong. Verified against actual `node_modules/@insforge/sdk/dist/client-BR9o-WUm.d.ts`.

### 6. ProfileAttentionBanner extraction

**Decision**: Deferred — not built in Feature 06.

**Why**: The completion banner is already functional inline in ProfileForm. Extraction is a nice refactor but provides no Feature 06 value. The banner can be extracted when ProfileForm is next significantly modified.

---

## What the Session Caught

- The `library-docs.md` storage pattern was wrong (`upsert: true` doesn't exist in the SDK)
- The `insforge.from()` DB pattern in library-docs was wrong (should be `insforge.database.from()`)
- Completion logic divergence was a real risk — the shared utility eliminates it
