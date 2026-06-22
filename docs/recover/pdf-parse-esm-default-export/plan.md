# Plan — pdf-parse ESM Default Export Build Error

## Context

Feature 07 (AI Profile Extraction) was fully implemented but the build failed immediately
with:

```
Export default doesn't exist in target module
./agent/extractor.ts:2:1 — import pdf from "pdf-parse";
The export default was not found in module .../pdf-parse/dist/pdf-parse/esm/index.js
Did you mean to import Rectangle?
Next.js version: 16.2.9 (Turbopack)
```

**Root cause:** `pdf-parse@2.4.5` is ESM-first (`"type": "module"`). Turbopack resolves
the `import` condition in the exports map → `dist/pdf-parse/esm/index.js` → that file
re-exports from `pdfjs-dist` geometry types (hence "Rectangle"), not a PDF parsing
function. The import syntax is correct; the wrong entrypoint is being resolved.

## Fix

**One line added to `next.config.ts`:**

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],  // ← added
  async rewrites() { ... },
  skipTrailingSlashRedirect: true,
};
```

`serverExternalPackages` tells Turbopack not to bundle the package. Node.js resolves it
at runtime using the `require` condition → `dist/pdf-parse/cjs/index.cjs` (CJS entry),
which correctly exports the module. CJS interop wraps it for ESM `import` statements.

No changes to `agent/extractor.ts` or any other file.

## Verification

- `npm run build` → `✓ Compiled successfully in 6.7s` — pdf-parse error gone
- Separate pre-existing TypeScript error in `app/practice-01/page` remains (unrelated)
