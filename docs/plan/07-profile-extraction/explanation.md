# Explanation — Feature 07-profile-extraction: AI Profile Extraction from Resume

## Why does extraction live in an API route + `agent/`, not a Server Action?

The project's invariant separates UI mutations (Server Actions → DB writes) from agent/AI operations (API routes → `agent/` functions). Profile extraction calls `pdf-parse` and Gemini — it is an AI operation regardless of the fact that it returns data rather than writing to the DB.

Putting it in `actions/profile.ts` would mix AI calls with DB upserts in the same file, breaking the mental model for every future developer who opens that file. It would also break the `agent/` folder's purpose as the single location where AI logic lives.

If this were a Server Action, the next AI feature (job matching, company research) would have a precedent to also be a Server Action — and the architecture would collapse over time.

## Why does the API route download the PDF from storage rather than the client sending the file?

The resume was already uploaded to InsForge Storage in a prior step. Re-sending it from the browser would require the file to still be in the user's memory (it may not be — they might have uploaded days ago and returned to the page) and would double the network transfer unnecessarily.

The server has `resume_pdf_key` in the profile and the credentials to fetch from the private bucket directly. Server-side download is stateless: it works at any time, not just immediately after upload.

## Why is the text length guard `< 100` characters rather than `=== ""`?

Some PDFs technically contain embedded text but it is sparse — a few characters of metadata, a form field label, or a font rendering artifact. A PDF that returns 20 characters of junk text is not a readable resume. The 100-character threshold filters out image-based PDFs (zero text) and near-empty PDFs while letting real resumes through. Calling Gemini on 20 characters of noise would waste a token call and produce garbage output.

## Why does `applyExtraction` use `!= null` per-field rather than spreading the whole object?

A naive `setForm({ ...prev, ...data })` would overwrite every field with whatever Gemini returned — including `null` for fields it couldn't extract. If a user had manually entered their phone number and the resume didn't contain it, their phone would be wiped.

`!= null` (which catches both `null` and `undefined`) is used rather than a truthy check because truthy would incorrectly skip valid falsy values. Example: `years_experience: 0` would fail a truthy check but is a valid (if unusual) value that should be applied.

The Gemini system prompt explicitly instructs `null` to mean "I couldn't find this" — so the client honours that signal and preserves existing data.

## Why are arrays guarded with `.length` rather than `!= null`?

`skills: []` from Gemini means "I found no skills in this resume." Applying an empty array would wipe the user's manually-entered skill tags. A non-empty array means Gemini found something real and worth replacing with.

The same applies to `work_experience` — an empty array should not overwrite existing work history entries the user entered.

## Why is `ProfileExtraction` exported from `agent/extractor.ts` rather than `types/index.ts`?

`ProfileExtraction` is the return type of `extractProfileFromResume`. It is tightly coupled to the shape of the Gemini response and the fields the extractor knows how to handle. Putting it in `types/index.ts` would imply it belongs to the domain model — but it is an implementation detail of the extraction pipeline.

`ProfileForm` imports it with `import type`, which means it is erased at compile time and adds no runtime dependency. The boundary stays clean: the type is defined where the logic lives.

## Why is there no auto-save after extraction?

Gemini can misparse dates, misidentify experience level, hallucinate skills from context, or pick up a previous employer's name as the user's current company. If extraction auto-saved, the user would need to find and fix incorrect values in the DB.

The review step (populate form → user reads → user clicks Save) is a forced quality gate. The success banner explicitly uses the word "review" to cue the user that their action is next. This is intentional UX, not an oversight.
