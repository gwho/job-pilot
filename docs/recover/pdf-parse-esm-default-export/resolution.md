# Resolution — pdf-parse ESM Default Export Error

## Root cause

`pdf-parse@2.4.5` is installed. This version is a complete rewrite from the widely-known
v1.1.1 and is ESM-first (`"type": "module"`). Its exports map sends `import` resolution
to an ESM entrypoint that does not export a default parsing function — it re-exports from
`pdfjs-dist` (which provides PDF rendering primitives, not a simple parse function).

Turbopack, when bundling `app/api/profile/extract/route.ts`, follows the `import`
condition in `pdf-parse`'s exports map and resolves the ESM entry. It finds no default
export. The CJS entry (`dist/pdf-parse/cjs/index.cjs`) would work correctly but Turbopack
never reaches it because the `import` condition takes priority.

## What was changed

**One line added to `next.config.ts`:**

```typescript
// next.config.ts (before)
const nextConfig: NextConfig = {
  async rewrites() { ... },
  skipTrailingSlashRedirect: true,
};

// next.config.ts (after)
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],   // ← added
  async rewrites() { ... },
  skipTrailingSlashRedirect: true,
};
```

No changes to `agent/extractor.ts`, `app/api/profile/extract/route.ts`, or any other file.

## Why this fix works

`serverExternalPackages` tells Next.js/Turbopack: **do not bundle this package**. Instead,
leave it as an external module and let Node.js resolve it at runtime.

When Node.js resolves `pdf-parse` at runtime (for a server route):
- It uses the `require` condition from the exports map → `dist/pdf-parse/cjs/index.cjs`
- The CJS entry exports the parsing function as `module.exports`
- Node.js's CJS interop wraps `module.exports` as the default export for ESM `import` statements
- `import pdf from "pdf-parse"` resolves correctly → `pdf` is the parsing function

The import statement in `agent/extractor.ts` requires no change — it was always correct.
The only problem was Turbopack's bundling path choosing the wrong entrypoint.

## What was discarded

A fallback was planned but not needed:

```typescript
// Fallback (would have been used if serverExternalPackages wasn't enough)
import * as pdfModule from "pdf-parse";
const pdf = (pdfModule as unknown as { default: typeof pdfModule }).default ?? pdfModule;
```

This was prepared in case the v2.x API had also changed (the call signature `pdf(buffer)`
might not match v2.x). Since `serverExternalPackages` resolved the build error and the
extraction endpoint functioned correctly, the fallback was unnecessary.

## What this session learned about the codebase

### pdf-parse v2.x is a different package

The `npm install pdf-parse` command installs the latest version, which is 2.x — a
complete rewrite. The original v1.1.1 (CJS, `module.exports = function(buffer, opts)`)
is what most tutorials and documentation describe. Anyone copying a pdf-parse usage
example from a tutorial is likely seeing v1.x patterns.

**For future reference:** If a `pdf-parse` example shows `import pdf from "pdf-parse"` and
calls `const result = await pdf(buffer)`, check which version is installed. v1.x and v2.x
may have different call signatures.

### `serverExternalPackages` is the right pattern for Node.js-only libraries

Any package that:
- Uses Node.js APIs (fs, Buffer, native addons, worker threads)
- Or is ESM-first with an entrypoint that Turbopack can't resolve correctly
- And is only used in server routes or Server Components

...should be listed in `serverExternalPackages`. This bypasses Turbopack bundling and
lets Node.js handle resolution natively. Current entry in this project:

```typescript
serverExternalPackages: ["pdf-parse"]
```

**If future packages have similar issues** (PDF generation, file system utilities, native
addons), add them to this array rather than changing import syntax.

### The "Did you mean to import X?" clue pattern

When Turbopack suggests an import that makes no sense (e.g., `Rectangle` in a PDF parser
context), it means Turbopack is resolving the wrong file. The suggestion comes from the
actual exports of whatever file it did resolve. Working backwards: "Rectangle" is a
`pdfjs-dist` export → `pdf-parse` re-exports from `pdfjs-dist` in its ESM entry → the
ESM entry is the wrong entrypoint.

This pattern — "suggestion is from a completely unrelated domain" — is a reliable signal
that the bundler is resolving a transitive dependency's exports instead of the package's
own API.

## Verification

After the fix:
```
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully in 6.7s
```

The pdf-parse build error was eliminated. A separate pre-existing TypeScript error in
`app/practice-01/page` (missing default export) appeared in the TypeScript check phase —
this is unrelated to the recovery and was present before Feature 07.
