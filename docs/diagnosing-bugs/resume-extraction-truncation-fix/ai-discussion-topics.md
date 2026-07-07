# AI Discussion Topics — Resume Extraction Truncation Fix

1. What made the second failure distinct from the original `JSON.parse` failure?
2. Why is `finish_reason` a better diagnostic signal than the UI error text?
3. Why is a mocked extractor unit test the right seam for this bug?
4. How would an HTTP route test differ from the extractor test, and what would it miss?
5. Why should truncation be retried with compact instructions rather than only a larger token budget?
6. What residual risk remains if both attempts truncate?
7. How should a developer verify this manually with a real resume PDF?
8. What does the Vitest startup failure imply about project toolchain documentation?
