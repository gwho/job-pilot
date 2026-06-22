# AI Discussion Topics — Feature 07: AI Profile Extraction from Resume

---

## Group 1: PDF Text Extraction

1. Why does `pdf-parse` return empty text for some PDFs? What is the structural difference between a "text-based" PDF and an "image-based" PDF at the file format level?

2. The guard is `text.length < 100`. Why 100 characters rather than 0? What kinds of PDFs would pass a `length > 0` check but still be unusable for extraction?

3. `pdf-parse` is Node.js only and must never be imported in client components. What happens at the Next.js build level if you accidentally import it in a client component? How does Next.js detect the violation?

4. The raw text from `pdf-parse` has no formatting — no columns, no bullet points, no visual layout. How does Gemini reconstruct structure (e.g. "this block is a work history entry") from a flat character stream? What signals in the text does it rely on?

---

## Group 2: The OpenAI SDK for Non-OpenAI Models

5. We're using the `openai` npm package to call Google's Gemini API. What is the OpenAI-compatible REST API spec, and why can any model provider implement it? What would break if Google's endpoint diverged from the OpenAI spec?

6. The only config changes between calling OpenAI vs Gemini are `baseURL` and `apiKey`. What stays the same? What might behave differently even though the interface is identical (e.g. response format support, token counting, streaming)?

7. `response_format: { type: "json_object" }` is used for structured extraction. What does this setting actually do — does it change how the model generates tokens, or does it add post-processing, or both? What's the failure mode if you use it with a model that doesn't support it?

8. We set `max_tokens: 800` for profile extraction. What happens if the resume is very long and the extraction JSON exceeds 800 tokens? How would you detect this failure mode in production?

---

## Group 3: Architectural Invariants — API Route vs Server Action

9. This project has a hard rule: AI operations go through API routes, not Server Actions. What is the practical consequence of mixing AI calls into Server Actions in a large codebase over time? What signals would indicate the boundary is eroding?

10. Server Actions have a simpler call pattern from React components (`await action(formData)`) than API routes (`await fetch("/api/...")`). Why is "simpler to call" not the right criterion for deciding where logic lives?

11. Profile extraction does not write to the DB — it returns data to the client. It uses an API route anyway. Could you make an argument for a Server Action here? What's the counter-argument?

12. The `agent/` folder is described as "AI logic, no React." What specific imports would violate this rule? Why does it matter that agent functions never import from `components/` or `actions/`?

---

## Group 4: React State Ownership and Component Hierarchy

13. The Extract button lives in `ProfileForm` because ProfileForm owns all form state. Explain this constraint in terms of React's data flow model. What would you need to add to the architecture to allow a sibling `ResumeSection` component to update ProfileForm's state?

14. Why can't `page.tsx` (a Server Component) be used as the intermediary to wire a sibling ResumeSection to ProfileForm? What exactly is a Server Component incapable of doing that makes callbacks impossible?

15. "State ownership determines component hierarchy" — unpack this principle with a concrete example from this feature. If you violated it, what runtime behavior would you see?

16. `useTransition` is used for the extraction call (not `useState` + `async`). What problem does `useTransition` solve that plain async state management doesn't? What is the "pending state" that `isExtracting` gives you, and how is it different from a `loading` boolean?

---

## Group 5: Null-Safe Form Population

17. The `applyExtraction` function uses `...(condition && { key: value })` conditional spreading. Walk through what happens in JavaScript when you spread `false` into an object. Why does this work as a conditional field-inclusion pattern?

18. Why is `!= null` (catching both `null` and `undefined`) the right check for "Gemini didn't return this field", rather than a truthy check like `if (data.field)`? Give an example of a field value that would fail a truthy check but should still be applied to the form.

19. For arrays, the check is `if (data.skills?.length)` rather than `if (data.skills != null)`. Why the length check? What's the difference in behavior between an empty array (`[]`) and null from Gemini's perspective?

20. Gemini is instructed to return `null` for fields it "cannot confidently extract — never guess." How does this instruction change the interpretation of null in the response? What would happen to the population logic if Gemini ignored this instruction and guessed instead?

---

## Group 6: UX and Extraction Quality

21. The build plan specifies: user reviews extracted fields and saves manually — no auto-save. What specific class of errors does the manual review step catch that auto-save would miss? Give two concrete examples of Gemini extraction errors that a user would notice on review.

22. The success banner says "Profile filled in from your resume — review the fields below and save when ready." Why does the word "review" matter here? What mental model does it set for the user that "Profile updated" would not?

23. If Gemini returns a `years_experience` of `7` but the user's profile already has `5`, the form will update to `7`. Is this the right behavior? What would the argument be for preserving the existing value instead?

24. The extraction returns all fields in one response. An alternative would be to stream partial results field-by-field and update the form as each arrives. What are the trade-offs of streaming vs a single JSON response for this use case?
