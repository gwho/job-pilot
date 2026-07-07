# Resolution — Resume Extraction Truncation Fix

The extractor now treats `finish_reason === "length"` as recoverable once.

Changes:

- Initial extraction budget increased to 2500 tokens.
- Prompt now caps work experience entries, responsibilities length, skills, industries, and target roles.
- Resume text sent to the model is bounded to avoid oversized prompt input.
- A truncated first response triggers one retry with compact instructions and a 3000-token budget.
- Repeated truncation returns the existing human-readable extraction error.
- OpenAI calls are typed as non-streaming chat completions with `stream: false`.

The route and UI were left unchanged because they already forward and render `{ success, error }` results correctly.
