# AI Discussion Topics — Feature resume-extraction-json-parse-fix: Resume Extraction JSON and Truncation Recovery

## Structured Output

1. What does `response_format: { type: "json_object" }` guarantee, and what does it not guarantee?
2. Why can `JSON.parse(raw) as ProfileExtraction` pass TypeScript while still being unsafe at runtime?
3. What failure modes does zod catch that a try/catch around `JSON.parse` cannot catch?

## Truncation Recovery

4. Why is `finish_reason === "length"` different from non-JSON prose output?
5. Why does the retry use a more compact prompt instead of repeating the same request with only more tokens?
6. What would break if the retry loop were unbounded?
7. Which parts of the profile extraction output are most likely to cause oversized JSON?

## Privacy And Logging

8. Why is logging `raw.slice(0, 200)` unsafe for resume extraction?
9. What metadata is still useful for debugging malformed AI output without logging PII?
10. Where else in the codebase should the same logging standard be checked?

## Architecture Boundaries

11. Why does the fix belong in `agent/extractor.ts` instead of `app/api/profile/extract/route.ts`?
12. Why should `ProfileForm` not know whether a failure came from malformed JSON, truncation, or model unavailability?
13. What similar risks exist in other agent files that parse model JSON?

## Testing

14. Why is mocking OpenAI and `pdf-parse` the correct seam for this regression test?
15. What does the truncation retry test prove that the original safe-failure test did not prove?
