# Fix Plan — Resume Preview (Feature 06 Review)

## Issues Found

### Issue 1: No "View current resume" link [Critical]
The `resumes` storage bucket is private. The `resume_pdf_url` written to the DB by `uploadResume` is not a public URL — it cannot be opened by the browser. No signed URL generation was implemented. Users had no way to preview their uploaded PDF.

### Issue 2: Filename lost on page reload [Important]
`resume_pdf_filename` was never persisted to the DB. On reload, the upload zone showed the hardcoded string "Resume on file" instead of the actual filename ("Fake-Resume.pdf"). The `Profile` type and DB schema were both missing the column.

---

## What Was Fixed

### DB schema
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS resume_pdf_filename TEXT;
```

### `types/index.ts`
Added `resume_pdf_filename: string | null` to the `Profile` interface (after `resume_pdf_key`).

### `actions/profile.ts`
- `uploadResume`: now saves `resume_pdf_filename: file.name` in the upsert; returns `filename` in the success response
- New `getResumeSignedUrl()` action: reads `resume_pdf_key` from the profile row, calls `insforge.storage.from("resumes").createSignedUrl(key, 3600)`, returns the time-limited URL

### `components/profile/ProfileForm.tsx`
- `resumeFileName` state now initializes from `profile?.resume_pdf_filename ?? (profile?.resume_pdf_key ? "resume.pdf" : null)` instead of hardcoded `"Resume on file"`
- After upload, sets filename from `result.filename ?? file.name`
- Added `isViewingResume`/`startViewResume` transition and `handleViewResume` handler
- Added "View current resume" button that appears only when `resumeFileName` is truthy; opens signed URL in new tab

---

## Key Invariants
- Signed URLs expire in 1 hour — they are generated on demand, never stored
- `getResumeSignedUrl` always re-reads `resume_pdf_key` from DB (not cached state) so it works across sessions
- "View current resume" button is only rendered when `resumeFileName` is truthy — no button = no resume
