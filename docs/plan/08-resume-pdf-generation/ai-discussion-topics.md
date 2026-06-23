# AI Discussion Topics — Feature 08: Resume PDF Generation from Profile

## Group 1: The End-to-End Data Flow

1. Walk me through exactly what happens from the moment the user clicks "Generate Resume from Profile" to the moment the PDF appears in the storage bucket. Name every function, file, and network call in order.

2. The Generate button reads from the *saved* profile in the DB, not the current form state. What does this mean for a user who has edited fields but not yet saved? Is there any UX handling for this, and what would "good" handling look like?

3. The route fetches the profile with `.select("*")`. What would happen if a field was added to the `profiles` table later but the `Profile` TypeScript type wasn't updated? Where in the feature's code would that discrepancy first cause a problem?

4. After a successful generation, `resumeFileName` is updated in local state to "AI Generated Resume.pdf". Why is this a local state update rather than a page revalidation (`revalidatePath("/profile")`)? What would be different if `revalidatePath` was used instead?

---

## Group 2: PDF Rendering Constraints and @react-pdf

5. Why does `@react-pdf/renderer` need to be added to `serverExternalPackages`? What would the error look like if it were removed from that list? What other packages in this project have the same requirement and why?

6. `@react-pdf/renderer` uses the Yoga layout engine instead of browser CSS. What does this mean for the supported CSS properties? Why can't skills be rendered as a row of individual tag elements, and what would the symptom look like in the generated PDF?

7. The PDF template uses `profile.skills.join(" • ")` in a single `<Text>` element. What CSS property would you reach for in a normal React component to achieve a wrapping tag layout? Why doesn't that property work in Yoga?

8. `pdf-generator.tsx` is a `.tsx` file, but `extractor.ts` (the Feature 07 agent) is a `.ts` file. Why the difference? Could `pdf-generator` have been written as `.ts` and if so, what would the `renderToBuffer` call look like?

---

## Group 3: Type Errors and the Buffer → Blob Conversion

9. Walk me through the exact TypeScript error that occurs when you pass a `Buffer` directly to InsForge's `storage.upload()`. What is `ArrayBufferLike`, and why does `Blob` reject it?

10. Three approaches were attempted for the Buffer → Blob conversion: passing the Buffer directly, wrapping it in `new Blob([buffer])`, and wrapping it in `new Blob([new Uint8Array(buffer)])`. Why did the first two fail and the third succeed? What does `new Uint8Array(typedArray)` do differently from the others?

11. The `signOut()` method in `app/actions/auth.ts` returned `{ error }` only — no `data`. Why was `data` being destructured in the first place? What pattern does this look like it was copied from? How would you prevent this kind of copy-paste type error in the future?

---

## Group 4: Storage Patterns and the Remove-Then-Upload Rule

12. What happens if you call InsForge `storage.upload()` when a file already exists at the target path and there is no upsert option? Walk through the consequence: what does `uploadData.key` look like, what gets saved to the DB, and what would the user see on subsequent generations?

13. The `@react-pdf/renderer` snippet in `context/library-docs.md` shows `upsert: true` in the upload options. This is incorrect. How would you detect this discrepancy if you were relying only on that doc? What sources are more authoritative for verifying the actual SDK behaviour?

14. After the file is uploaded, the route runs `upsert([{ id: userId, resume_pdf_key: uploadData.key, ... }])`. Why is the full profile not re-fetched and re-saved? What would be wrong with doing a full profile upsert at this step?

---

## Group 5: Architectural Decisions and Invariants

15. Why is `is_complete` checked in the route even though the button is disabled on the client? Describe a concrete scenario where the client-side check is bypassed and what the server-side check prevents.

16. The `ResumeContent` interface is defined in `agent/pdf-generator.tsx` and imported by `agent/resume-template.tsx`. Why is this the right direction for the import (generator imports template, not the other way around)? What would break if the type was defined in `resume-template.tsx` and imported by `pdf-generator.tsx`?

17. The feature adds no new PostHog event, even though resume generation is a significant user action. What rule prevents adding a new event? How would you go about adding one if it was decided this feature should track it?

18. Gemini generation uses temperature 0.7 and 1000 max tokens. Where are these values documented in the project? What would happen to the generated PDF if max_tokens was set to 300? What would happen to the prose quality if temperature was lowered to 0.1?
