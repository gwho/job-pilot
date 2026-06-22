# Diagnosis — pdf-parse ESM Default Export Error

## What broke

Build failed immediately after Feature 07 (AI Profile Extraction) was implemented.
The error appeared on the first `next build` run — not after a series of failed fix
attempts.

```
./agent/extractor.ts:2:1
Export default doesn't exist in target module
> 2 | import pdf from "pdf-parse";

The export default was not found in module
[project]/node_modules/pdf-parse/dist/pdf-parse/esm/index.js [app-route] (ecmascript).
Did you mean to import Rectangle?

Next.js version: 16.2.9 (Turbopack)
```

## Failure mode

**Failure Mode 1 — A specific thing is broken (targeted fix).**

Signs that confirmed this:
- Isolated to one import statement in one file (`agent/extractor.ts` line 2)
- First occurrence — no prior fix attempts, no compounding damage
- Error message is specific and points directly to the broken line
- Rest of the build ("✓ Compiled successfully") confirmed everything else was fine
- No session pollution, no tangled patches

## Diagnostic path

### Step 1 — Read the package.json

The key diagnostic move was checking `node_modules/pdf-parse/package.json`. This
revealed the installed version was **2.4.5** — not the widely-known v1.1.1:

```json
{
  "name": "pdf-parse",
  "version": "2.4.5",
  "type": "module",
  "main": "dist/pdf-parse/cjs/index.cjs",
  "module": "dist/pdf-parse/esm/index.js",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/pdf-parse/esm/index.d.ts",
        "default": "./dist/pdf-parse/esm/index.js"
      },
      "require": {
        "default": "./dist/pdf-parse/cjs/index.cjs"
      }
    }
  }
}
```

### Step 2 — Understand the module resolution path

`pdf-parse@2.x` is a complete rewrite from v1.x:
- `"type": "module"` — ESM-first package
- Has dual entrypoints: ESM (`dist/pdf-parse/esm/index.js`) and CJS (`dist/pdf-parse/cjs/index.cjs`)
- The exports map sends `import` statements to the ESM entry

**Turbopack's behaviour:** When bundling a server route that imports `pdf-parse`,
Turbopack uses the `import` condition from the exports map → resolves to
`dist/pdf-parse/esm/index.js` → that ESM file does **not** export a default function.
It re-exports from `pdfjs-dist`, which exports geometry types like `Rectangle`.

### Step 3 — Confirm the CJS entry is correct

The `require` condition points to `dist/pdf-parse/cjs/index.cjs`, which does export
the parsing function correctly. The import statement `import pdf from "pdf-parse"` is
syntactically correct — the problem is solely which entrypoint Turbopack resolves.

### The "Did you mean to import Rectangle?" clue

This bizarre suggestion was the signal that confirmed the diagnosis: the ESM entry
is exposing `pdfjs-dist`'s exports (which include geometric types like `Rectangle`,
`Point`, etc.) rather than a PDF parsing function. Turbopack was correctly reading
the ESM file; that file just exports the wrong things for this use case.

## What was ruled out

- **Wrong import syntax** — `import pdf from "pdf-parse"` is correct for a package
  with a default export. The syntax is not the problem.
- **Missing installation** — the package was installed; `node_modules/pdf-parse/`
  exists. The error is about the wrong entrypoint, not a missing package.
- **TypeScript types issue** — `@types/pdf-parse` was installed separately; the
  error is a runtime bundling error, not a type error.
- **Failure Mode 2 (polluted session)** — first occurrence, no prior fix attempts.
- **Failure Mode 3 (wrong foundation)** — the approach (pdf-parse + Gemini pipeline)
  is correct. Only the module resolution path needs adjustment.
