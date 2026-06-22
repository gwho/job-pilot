# Resolution — pdf-parse v2.x Runtime API Mismatch

## Root cause

`pdf-parse@2.4.5` exports a class (`PDFParse`) with no default export. The code used
the v1.x calling convention: `import pdf from "pdf-parse"` (gets `undefined` in v2.x)
followed by `await pdf(buffer)` (throws `TypeError: pdf is not a function`).

This is a **major API break** between v1.x and v2.x — not a subtle change:

| | v1.x | v2.x |
|--|------|------|
| Export style | Default function | Named class |
| Import | `import pdf from "pdf-parse"` | `import { PDFParse } from "pdf-parse"` |
| Usage | `await pdf(buffer)` | `new PDFParse({ data: buffer })` then `await parser.getText()` |
| Input | `Buffer` positional arg | `{ data: Buffer }` options object |
| Output | `{ text, numpages, info, metadata }` | `{ text, pages, total }` |

## What was changed

**`agent/extractor.ts` — two changes:**

```typescript
// Before (v1.x convention)
import pdf from "pdf-parse";

// After (v2.x API)
import { PDFParse } from "pdf-parse";
```

```typescript
// Before
const pdfData = await pdf(buffer);
const text = pdfData.text?.trim() ?? "";

// After
const parser = new PDFParse({ data: buffer });
const pdfData = await parser.getText();
const text = pdfData.text?.trim() ?? "";
```

The `pdfData.text` field name is the same in both versions, so the length guard
(`text.length < 100`), the Gemini call, and everything downstream required no changes.

## Why two recoveries were needed

Both the build error (prior session) and this runtime error stem from the same root:
`pdf-parse@2.4.5`'s complete rewrite. But they manifest at different stages:

```
Stage 1 — Build (Turbopack bundling)
  Problem:  ESM entry has no default export → build error
  Fix:      serverExternalPackages — bypasses Turbopack, lets Node.js resolve CJS entry
  Result:   Build compiles ✓

Stage 2 — Runtime (Node.js execution)
  Problem:  CJS entry also has no default export → pdf is undefined → TypeError
  Fix:      Use named import { PDFParse } and class API
  Result:   Extraction runs ✓
```

The first fix made the code compile; it couldn't resolve the API mismatch because that's
a logic change, not a bundling change. Both fixes are necessary for the feature to work.

## What was learned

### v1.x patterns are the default in all documentation

The `pdf-parse` package has been at v1.1.1 for years. Nearly every tutorial, Stack
Overflow answer, blog post, and AI training example uses the v1.x API
(`const pdf = require('pdf-parse'); const data = await pdf(buffer)`). When `npm install
pdf-parse` installs v2.x, the code looks identical to working examples — but fails
at runtime.

**Pattern to watch for:** If a library install produces a version with `"type": "module"`
in its `package.json` and the version is significantly higher than what tutorials describe,
check the changelog or README for API changes before writing any calls.

### "Internal server error" means look at the server terminal

The client sees only the generic catch response. The real error — `TypeError: pdf is not
a function`, the stack trace, the exact line — is in the terminal where `npm run dev`
is running. For all 500 errors from app routes, the server terminal is the primary
diagnostic tool, not the browser console.

### The two-fix sequence is a recoverable pattern

Neither fix on its own was wrong. `serverExternalPackages` was the correct response to
a Turbopack bundling issue. The API mismatch fix was the correct response to a runtime
failure. Running both recoveries in sequence, each with a clean diagnosis, produced a
working feature without any code regression.

## Verification

After both fixes:
1. Build: `✓ Compiled successfully in 7.0s` (no pdf-parse errors)
2. Runtime: clicking "Extract from Resume" runs through `PDFParse` → Gemini → returns
   `{ success: true, data: ProfileExtraction }` → form fields populate
3. Feature confirmed working end-to-end
