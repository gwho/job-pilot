# Diagnosis — pdf-parse v2.x Runtime API Mismatch

## What broke

After the previous recovery session fixed the build error (`serverExternalPackages`),
clicking "Extract from Resume" on `/profile` returned a user-visible error banner:

```
Internal server error
```

The build compiled cleanly. The route was reachable. The error appeared at runtime —
specifically when the extraction logic ran.

## Failure mode

**Failure Mode 1 — A specific thing is broken (targeted fix).**

Signs that confirmed this:
- First occurrence of this specific error — the prior session fixed the build error,
  not this runtime error
- Isolated to the extraction endpoint — the rest of the application worked correctly
- No prior fix attempts had been made on this symptom
- The error message is the literal string returned by the route's catch block:
  `{ success: false, error: "Internal server error" }` — meaning the route ran but
  threw an uncaught exception

## Diagnostic path

### Step 1 — Identify where the error originates

The client displays whatever the route returns. The route's catch block at line 49–53
of `app/api/profile/extract/route.ts`:

```typescript
} catch (error) {
  console.error("[api/profile/extract]", error);
  return NextResponse.json(
    { success: false, error: "Internal server error" },
    { status: 500 },
  );
}
```

Any unhandled exception anywhere in the route — or in `extractProfileFromResume` it calls
— lands here. The real error is in the server terminal log, not the client response.

### Step 2 — Identify the most likely throw site

The route has three operations that could throw:
1. InsForge auth check — unlikely; this would have also broken other authenticated routes
2. InsForge storage download — unlikely; the download path was working before the build error
3. `extractProfileFromResume(buffer)` in `agent/extractor.ts` — most likely

The previous session had established that `pdf-parse@2.4.5` was installed (not v1.x). The
build error was resolved by marking it as `serverExternalPackages` — but the API change
was not investigated at that point.

### Step 3 — Inspect the v2.x CJS exports

Reading `node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs` confirmed:

**v1.x export shape (what the code assumed):**
```javascript
module.exports = function pdf(dataBuffer, options) { ... }
// → import pdf from "pdf-parse" gives a callable function
// → await pdf(buffer) works
```

**v2.x export shape (what was actually installed):**
```javascript
// Named class export — no default function
exports.PDFParse = class PDFParse { ... }
// → import pdf from "pdf-parse" gives undefined (no default export in v2.x CJS)
// → await pdf(buffer) throws: TypeError: pdf is not a function
```

### Step 4 — Confirm the throw

In `agent/extractor.ts` line 59:
```typescript
const pdfData = await pdf(buffer);
```

At runtime with `pdf-parse@2.4.5`, `pdf` is `undefined` (the CJS module has no default
export). Calling `undefined(buffer)` throws `TypeError: pdf is not a function`. This is
caught by the route's catch block and returned as "Internal server error".

### The "Did you mean to import Rectangle?" retrospective

This clue from the *previous* session's build error was actually the full story: it
showed that the only exports in `pdf-parse@2.4.5`'s ESM entry were geometry types
re-exported from `pdfjs-dist`. There was never a default function export in v2.x at all.
The `serverExternalPackages` fix made the build compile but left the broken runtime call
untouched — both fixes were always needed, in sequence.

## What was ruled out

- **Auth or storage failure** — these would have produced different errors (401, 400, 500
  with different messages). The "Internal server error" response body matches only the
  generic catch, not the specific guards in the route.
- **Gemini API failure** — Gemini is called after pdf-parse. The exception was thrown
  before the Gemini call was ever reached.
- **Failure Mode 2 (polluted session)** — the previous session's fix was clean; this
  is a fresh, first-attempt problem on a different layer.
- **Failure Mode 3 (wrong foundation)** — the two-library pipeline (pdf-parse → Gemini)
  is correct. Only the call syntax needed to match v2.x's API.
