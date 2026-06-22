# Explanation — Resume Preview Fix

## Why can't we use resume_pdf_url directly?

The InsForge `resumes` bucket is configured as **private**. This means the URL returned by `storage.upload()` is not publicly accessible — the browser will get a 403 if you try to open it. `getPublicUrl()` is only valid for buckets marked as public.

For private buckets, access is granted via **signed URLs**: time-limited tokens that embed auth into the URL itself. Anyone with the link can access the file, but only until it expires. This is the correct pattern for private user documents.

`createSignedUrl(key, expiresInSeconds)` generates one on demand. We set 3600 seconds (1 hour) — long enough to read a PDF, short enough that a leaked URL is low-risk.

## Why not store the signed URL in the DB?

Signed URLs expire. If we stored one at upload time, it would be dead within an hour. The right approach is to generate one on demand (when the user clicks "View current resume") and never persist it. Each click generates a fresh URL.

## Why did filename disappear on reload?

`resumeFileName` was local React state. State only lives as long as the component is mounted. After a page reload, the component re-mounts fresh — and `resumeFileName` was initialized to `"Resume on file"` (a hardcoded string), not the actual filename from the database.

The fix has two parts:
1. Persist the actual filename to the DB (`resume_pdf_filename` column)
2. Initialize `resumeFileName` state from `profile?.resume_pdf_filename` so it survives page reloads

## Why the ?? fallback to "resume.pdf"?

A user might have uploaded a resume before this fix was deployed — their `resume_pdf_key` exists but `resume_pdf_filename` is NULL (the column didn't exist yet). The fallback ensures they still see the upload zone in the "has resume" state rather than the empty state. The generic "resume.pdf" is accurate enough — they do have a resume on file.

## Why call getResumeSignedUrl from the DB rather than using a cached key?

`handleViewResume` calls the Server Action which re-reads `resume_pdf_key` from the database. This is deliberate:
- Avoids stale state bugs (e.g., user uploads a replacement resume in another tab)
- The DB is always the source of truth for which file is current
- `resume_pdf_key` is not sensitive so the extra round trip is fine
