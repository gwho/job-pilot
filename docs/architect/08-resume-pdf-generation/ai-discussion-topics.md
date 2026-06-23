# AI Discussion Topics — Feature 08: Resume PDF Generation

## Group 1: Architectural Boundaries

1. This project separates Server Actions (`actions/`) from API Routes (`app/api/`). Why does resume generation belong in an API route rather than a Server Action? What's the specific project invariant that makes this clear?

2. The architecture says "Server Actions never call agent functions — only API routes do." Why is this a useful rule? What would happen over time if Server Actions were allowed to call Gemini directly?

3. The existing resume *upload* uses a Server Action (`actions/profile.ts:uploadResume`), but the resume *generation* uses an API route. These are both "resume operations" — why should they be in different places?

4. How would you explain the "two sides of the boundary" rule to a new developer joining this project? What question can they ask about any new piece of code to know which side it belongs on?

---

## Group 2: Third-Party Package Bundling

5. What is `serverExternalPackages` in Next.js and when should you use it? What happens when you *don't* add a problematic package to this list?

6. `@react-pdf/renderer` and `pdf-parse` are both in `serverExternalPackages`. What do they have in common that makes them need this treatment? Is there a general class of packages that require it?

7. Feature 07 encountered the exact same bundling issue with `pdf-parse`. What should a developer look for in a new package's documentation that would hint they'll need `serverExternalPackages` before even trying to install it?

8. Why does `serverExternalPackages` only affect server-side rendering? Could a client-side component ever face the same issue, and if so, how would you handle it differently?

---

## Group 3: LLM Temperature and Task Design

9. This feature uses temperature 0.7 for resume writing, while the extraction feature (Feature 07) uses 0.3. What's the reasoning behind this difference? What would a resume generated at 0.3 tend to look like vs. 0.7?

10. Why does the project document Gemini configuration values in `context/library-docs.md` rather than leaving them as inline comments in the code? What problem does that solve?

11. The Gemini prompt instructs "concise output" to help the PDF fit on one page. What other prompt engineering techniques could you use to control output length for PDF rendering? What's the tradeoff between prompt constraints and output quality?

12. The `ResumeContent` interface defines exactly what Gemini must return (`summary`, `workExperience` with `bullets`). What breaks if Gemini returns a differently shaped JSON? How does the `response_format: { type: "json_object" }` setting help, and what doesn't it guarantee?

13. Why is `max_tokens: 1000` a reasonable limit for resume content? What would happen to the PDF if Gemini returned 3000 tokens? What would happen if it returned 200?

---

## Group 4: InsForge Storage Patterns

14. This project stores `"{userId}/resume.pdf"` in `resume_pdf_url` — the storage path, not a real URL. Why is persisting a path better than persisting a signed URL for a private bucket?

15. Both `resume_pdf_key` and `resume_pdf_url` hold the same value (`"{userId}/resume.pdf"`). What was the original intent of having two separate columns? When would they hold different values?

16. The storage write uses `remove` then `upload` rather than `{ upsert: true }`. In what scenarios would `upsert: true` and remove-then-upload produce different outcomes? Why is consistency with the existing pattern valuable even if upsert would work?

17. What happens if the `remove` step succeeds but the `upload` step fails? The file is deleted but the new one wasn't created. How would you handle this to avoid leaving the user with no resume file?

---

## Group 5: PDF Rendering Constraints

18. `@react-pdf/renderer` uses Yoga — the same layout engine as React Native — rather than browser CSS. What is Yoga, and why does it not support `flexWrap`? How is this different from what you'd expect in a browser?

19. The correct approach for rendering a list of skills in @react-pdf is `skills.join(" • ")` in a single `<Text>`. What would happen visually if you rendered individual `<Text>` elements in a `<View style={{ flexDirection: "row" }}>`?

20. A PDF is a fixed-size document, not a scrollable webpage. How does this constraint change how you design a layout compared to a responsive web UI? What happens when content exceeds the page boundary in @react-pdf?

21. The plan calls for "single-page PDF" as a target but with no hard cap on rendering. What specific Gemini prompt strategies could enforce one-page output? Is it better to constrain at the LLM level or the PDF rendering level?

---

## Group 6: UX Decisions and Completeness Gates

22. The Generate button is hard-disabled when `is_complete === false`. What specific form fields must be filled for `is_complete` to become true? Why were these particular fields chosen as the completeness bar rather than a higher or lower threshold?

23. The alternative to hard-disable was "soft warning" — allow the click but show a warning toast. What's the specific user experience failure mode of a soft warning for resume generation that doesn't apply to, say, a soft warning for an email newsletter signup?

24. The Generate button reads from the saved DB profile, not the current form state. A user with unsaved changes will get a PDF that doesn't match what they see in the form. The plan addresses this with static copy ("Generates a PDF from your saved profile"). What would dirty-state detection require to implement, and when would it be worth adding?

25. After generation succeeds, the `resumeFileName` in the UI updates to "AI Generated Resume.pdf." This replaces whatever filename was previously shown (including manually uploaded PDFs). Why is it important to update the displayed filename immediately in client state rather than waiting for a page reload?
