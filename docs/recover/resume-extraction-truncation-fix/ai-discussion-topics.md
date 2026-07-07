# AI Discussion Topics — Resume Extraction Truncation Fix

1. Why did the first fix improve error handling but not restore the user-facing feature?
2. What evidence distinguishes a truncation failure from malformed JSON or PDF text extraction failure?
3. Why is a single retry appropriate here, but an unbounded retry loop unsafe?
4. What output fields make resume extraction especially vulnerable to token-budget failures?
5. Why should retry prompts change the shape or verbosity of the output?
6. How can logs be useful without exposing resume PII?
7. What should future agents check when they see `finish_reason === "length"`?
8. Which other agent functions parse model JSON and may need similar treatment?
