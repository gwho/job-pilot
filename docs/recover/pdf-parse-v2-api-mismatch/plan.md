# Plan — pdf-parse v2.x Runtime API Mismatch

## Context

After the build error was fixed (`serverExternalPackages`), clicking "Extract from Resume"
returned `{ success: false, error: "Internal server error" }`. The build compiled cleanly.

**Root cause:** `pdf-parse@2.4.5` is a complete API rewrite from v1.x. It exports a named
class `PDFParse` with no default export. The code used v1.x calling convention:
`import pdf from "pdf-parse"` → `pdf` is `undefined` at runtime → `await pdf(buffer)`
throws `TypeError: pdf is not a function` → caught by route catch block → 500.

v2.x API:
```typescript
// Constructor takes { data: Buffer }
const parser = new PDFParse({ data: buffer });
// Method call
const result = await parser.getText();
result.text  // same field name as v1.x
```

## Fix

**Two changes in `agent/extractor.ts`:**

```typescript
// Import: default → named class
import { PDFParse } from "pdf-parse";

// Usage: function call → class instantiation + method
const parser = new PDFParse({ data: buffer });
const pdfData = await parser.getText();
const text = pdfData.text?.trim() ?? "";
```

Everything downstream (length guard, Gemini call, return shape) is unchanged — `pdfData.text`
is the same field name in both versions.

## Verification

- `npm run build` → `✓ Compiled successfully in 7.0s`
- Clicking "Extract from Resume" runs through `PDFParse` → Gemini → form fields populate
- Feature confirmed working end-to-end
