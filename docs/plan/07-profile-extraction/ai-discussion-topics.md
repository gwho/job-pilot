# AI Discussion Topics — Feature 07-profile-extraction: AI Profile Extraction from Resume

## Group 1: PDF Text Extraction

1. Walk me through exactly what happens when a user uploads a scanned-paper resume (an image PDF). At which line in `agent/extractor.ts` does the failure get caught, and what does the user see?

2. `pdf-parse` returns `pdfData.text` — what does this string actually look like for a typical resume? Why is it unstructured, and why does that make raw text search (like regex) unreliable for field extraction?

3. Why is `pdf-parse` a Node.js-only library? What in its implementation makes it incompatible with the browser bundle, and what error would you see at runtime if it were accidentally imported in a client component?

4. The text length threshold is 100 characters. What kind of PDF would produce between 1 and 99 characters of text — not zero, but not enough to be a real resume?

## Group 2: Gemini via OpenAI SDK

5. The `openai` package is being used to call Google's API. What are the two config values that redirect it to Gemini instead of OpenAI? What stays identical between the two calls?

6. `response_format: { type: "json_object" }` is set on the Gemini call. What does this parameter actually do — does it constrain the model's generation, add post-processing, or both? What's the risk of omitting it?

7. The system prompt lists exact enum values for `experience_level` and `work_authorization`. What would happen if Gemini returned `"Senior"` instead of `"senior"` for experience_level? Where would the type mismatch surface — at the TypeScript level, the runtime level, or the UI level?

8. `max_tokens: 800` is set. What happens if a resume is very long and the structured JSON response would exceed 800 tokens? How would you detect this in production?

## Group 3: API Route Design

9. The route handler is `export async function POST()` with no parameters. In Next.js App Router, what is the full function signature for a route handler that also reads the request body? Why is the parameter optional here?

10. The route fetches `resume_pdf_key` from `profiles` with `.single()`. What does `.single()` return if the user has no profile row yet (hasn't saved their profile)? How does the existing error guard handle this case?

11. `insforge.storage.from("resumes").download(key)` returns `{ data: Blob, error }`. Why use a direct storage download here instead of generating a signed URL and using `fetch()`? What's the practical difference?

## Group 4: Form Population and State

12. `applyExtraction` spreads `...(data.full_name != null && { full_name: data.full_name })` into the form state. What does JavaScript evaluate `...(false)` to inside an object literal? Why does this work as a conditional field-inclusion pattern?

13. Why is `!= null` used instead of a strict `!== null` check? What is the difference, and which case does the double-equals version additionally catch?

14. `if (data.education?.degree) setEducation(data.education)` — this check is on `degree` rather than checking the entire `education` object for non-null. What would break if you changed it to `if (data.education != null) setEducation(data.education)`?

15. `useTransition` is used for the extract fetch call. What does `isExtracting` actually represent — is it true during the fetch, during state updates, or both? How does this differ from a `useState(false)` loading flag?
