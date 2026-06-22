# Tutorial 12 — pdf-parse v2.x Migration: Two Recovery Sessions, One Root Cause

**After completing this tutorial you will understand:** how to read a Turbopack "exports
map" build error and determine which entrypoint was resolved and why, what
`serverExternalPackages` does at the bundling layer vs the runtime layer and why fixing
one layer can leave the other broken, where to find the real error when an API route
returns a generic "Internal server error", and how `pdf-parse@2.4.5`'s complete API
rewrite broke both the build and the runtime independently — requiring two sequential
recovery sessions to fully fix.

This tutorial covers two `/recover` sessions documented in:
- [`docs/recover/pdf-parse-esm-default-export/`](../../recover/pdf-parse-esm-default-export/) — the build error
- [`docs/recover/pdf-parse-v2-api-mismatch/`](../../recover/pdf-parse-v2-api-mismatch/) — the runtime error

---

> [!NOTE]
> **Prerequisites:**
> - Tutorial 10 (`10-profile-extraction/README.md`) — the feature these sessions were
>   fixing. You need to know what `agent/extractor.ts` and
>   `app/api/profile/extract/route.ts` are supposed to do before understanding how they
>   broke.
> - Tutorial 04 (`04-recover-start-for-free-404/README.md`) — introduces the three
>   failure-mode framework used to triage both sessions here. The classification reasoning
>   in this tutorial assumes you already know Mode 1 / Mode 2 / Mode 3.
>
> Open [`next.config.ts`](../../../next.config.ts),
> [`agent/extractor.ts`](../../../agent/extractor.ts), and
> [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts)
> alongside this tutorial. Also have
> [`node_modules/pdf-parse/package.json`](../../../node_modules/pdf-parse/package.json)
> ready to inspect.

---

## How to use an LLM before this tutorial

Run these four prompts before touching any code. Each one builds one piece of the mental
model required. Budget 25–30 minutes.

### Concept 1 — The npm package exports map

> "Explain the `exports` field in a Node.js `package.json`. What is it for, and how does
> it differ from the older `main` and `module` fields? Specifically: what are the
> `import`, `require`, and `default` conditions inside an exports map, and what
> circumstance determines which one a module resolver uses? Give me a concrete example
> with a package that has different ESM and CJS entrypoints. Then quiz me on which
> condition gets used in each scenario."

*What to listen for:* The exports map gives a package author control over which file is
served to which kind of consumer. The `import` condition is used for ESM `import`
statements; the `require` condition for CommonJS `require()` calls. The `default`
condition is a fallback. A bundler (Turbopack) and the Node.js runtime can choose
*different* conditions for the same import statement — this is the core tension in the
first recovery session.

*Practice question:* A package has `"exports": { ".": { "import": "./esm/index.js",
"require": "./cjs/index.js" } }`. I write `import foo from "that-package"` in a server
route. Which file does Turbopack resolve? Which file does Node.js resolve at runtime?
Are they the same?

---

### Concept 2 — Turbopack vs Node.js module resolution

> "In Next.js App Router, server routes are bundled by Turbopack before they run. Explain
> what 'bundling' means for module resolution: when Turbopack bundles a server route that
> imports a package, does it use Node.js's native resolution, or does it have its own
> logic? What is `serverExternalPackages` and what does it tell Turbopack to do instead
> of bundling? Give me a concrete before-and-after showing how the same import behaves
> differently with and without it. Then quiz me."

*What to listen for:* Turbopack is a bundler — it statically analyses import graphs and
packs them into a single output. When it resolves a package, it follows the `import`
condition in the exports map (ESM semantics). `serverExternalPackages` tells Turbopack
to skip a specific package — leave it as an external reference and let Node.js resolve it
at runtime. Node.js, in contrast, often uses the `require` condition even for packages
consumed via `import` statements, because of its CJS interop layer.

*Practice question:* Without `serverExternalPackages`, which condition in the exports map
does Turbopack use for `import foo from "package"`? With it, which condition does Node.js
use at runtime instead?

---

### Concept 3 — Why a server route returns "Internal server error"

> "In a Next.js API route, I have a try/catch that returns `{ error: 'Internal server
> error' }` when anything throws. Explain: when my browser shows this message, what does
> it tell me about which specific operation in the route threw the exception? How do I
> find the real error — where does it appear, and what information does it contain? Give
> me a concrete example of a route with three operations, one of which throws, and show me
> the complete flow from the throw to what the client receives."

*What to listen for:* The generic catch message tells you nothing about *where* in the
route the exception was thrown — only that something threw and the catch block ran. The
real error (including `TypeError: pdf is not a function`, the stack trace, and the exact
line) is in the terminal running `npm run dev` — not the browser console. This is the
primary diagnostic tool for 500 errors from server routes.

*Practice question:* A route has three `await` calls: auth check, DB query, external API.
The client shows "Internal server error". What's the fastest way to determine which of the
three threw — without adding any `console.log` statements?

---

### Concept 4 — What a major version bump usually signals

> "When an npm package publishes a new major version (1.x → 2.x), what does semantic
> versioning guarantee about API compatibility? Give me two examples of real npm packages
> that had breaking major-version API changes and describe the nature of the break. Then
> explain: if I have code written against version 1.x and I `npm install` without
> specifying a version, what version do I get? What is the risk, and what are two ways to
> guard against it before running the code?"

*What to listen for:* Semantic versioning allows breaking changes in major versions —
the `^` prefix in `package.json` (which `npm install` adds by default) allows patch and
minor updates but NOT major. However, if you run `npm install package-name` from scratch
with no version in `package.json`, npm installs the latest major — which could be v2.x
when all your code was written against v1.x. The risk is a code base written against
tutorials and examples that predate the major version rewrite.

*Practice question:* My `package.json` shows `"pdf-parse": "^1.1.1"`. If I `npm install`
fresh, which version do I get? If I have no `package.json` entry and run `npm install
pdf-parse`, which version do I get?

---

## The one root cause, two failure layers

Both recovery sessions had the same root cause: `pdf-parse@2.4.5` was installed when
all code assumed v1.x semantics. But the single root cause manifested in two separate
layers — build time and runtime — each requiring a different fix:

```
npm install pdf-parse
  └── installs 2.4.5 (ESM-first, class-based API)
        │
        ├── Layer 1: Build (Turbopack bundling)
        │     Turbopack resolves ESM entry → no default export
        │     Error: "Export default doesn't exist in target module"
        │     Fix: serverExternalPackages: ["pdf-parse"] in next.config.ts
        │     Result: ✓ Compiled successfully
        │
        └── Layer 2: Runtime (Node.js execution)
              pdf is undefined → await pdf(buffer) throws TypeError
              Error: "Internal server error" in UI
              Fix: import { PDFParse } + new PDFParse({ data: buffer })
              Result: Extraction works end-to-end ✓
```

**The key lesson of these two sessions:** Layer 1's fix was correct and complete for
Layer 1. It couldn't fix Layer 2 because Layer 2 is a logic problem, not a bundling
problem. Two distinct problems at two distinct layers require two distinct fixes — in
the right order.

**Invariants for this tutorial:**
- The exports map is consulted at resolution time — by Turbopack during bundling, by
  Node.js at runtime. They use different conditions.
- `serverExternalPackages` changes *who* resolves the package, not *how the package is
  written*. It cannot fix an API mismatch.
- "Internal server error" is a client-visible symptom. The diagnostic artifact is in
  the server terminal.

---

## Part 1 — The build fails: reading the exports map error

After Feature 07 was implemented and `npm run build` ran for the first time:

```
./agent/extractor.ts:2:1
Export default doesn't exist in target module
> 2 | import pdf from "pdf-parse";

The export default was not found in module
[project]/node_modules/pdf-parse/dist/pdf-parse/esm/index.js [app-route] (ecmascript).
Did you mean to import Rectangle?

Next.js version: 16.2.9 (Turbopack)
```

The build output before this error showed `✓ Compiled successfully`. This matters.

**Checkpoint:** What does "✓ Compiled successfully" appearing immediately before the error
tell you about the scope of the problem? Which phase of the build is failing, and what
does that rule out?

<details>
<summary>Reveal answer</summary>

"✓ Compiled successfully" means the JavaScript bundling phase completed without errors —
all the TypeScript, imports, and module graphs were processed. The failure happened in
the **TypeScript type-checking phase** that runs after bundling. This rules out syntax
errors, missing files, or broken module graphs. It means the specific problem is narrow:
one import statement resolves to a module whose exports don't match what the code expects.
The rest of the build — every other file, every other import — is fine.

</details>

### Why a correct-looking import is failing

The import statement on line 2 of [`agent/extractor.ts`](../../../agent/extractor.ts):

```typescript
import pdf from "pdf-parse";
```

is syntactically correct. `import X from "package"` is the standard syntax for importing
a package's default export. The error is not about syntax — it's about what Turbopack
found when it went to resolve `"pdf-parse"`.

**Checkpoint:** What distinguishes a *syntax error* from a *module resolution error*?
If the error is a syntax error, what would the error message look like? If it's a
resolution error, what does that mean about the file Turbopack actually read?

<details>
<summary>Reveal answer</summary>

A syntax error means the code itself is malformed — `import from "package"` (missing
binding), or `importt pdf from "pdf-parse"` (typo). These are caught by the parser before
any file is read. A module resolution error means the syntax is valid but the resolved
file doesn't satisfy what the import expects. Here, Turbopack successfully resolved
`"pdf-parse"` to a real file (`dist/pdf-parse/esm/index.js`) and read it — it just
discovered that file contains no default export. The import syntax is fine; the package's
contents don't match it.

</details>

### The exports map

Open [`node_modules/pdf-parse/package.json`](../../../node_modules/pdf-parse/package.json).
The relevant section:

```json
{
  "name": "pdf-parse",
  "version": "2.4.5",
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/pdf-parse/esm/index.d.ts",
        "default": "./dist/pdf-parse/esm/index.js"
      },
      "require": {
        "types": "./dist/pdf-parse/cjs/index.d.cts",
        "default": "./dist/pdf-parse/cjs/index.cjs"
      }
    }
  }
}
```

Turbopack, bundling a server route that uses `import pdf from "pdf-parse"`, follows the
`import` condition → resolves `dist/pdf-parse/esm/index.js`. That file re-exports from
`pdfjs-dist`, which contains PDF rendering primitives like `Rectangle`, `Point`, and
`Line` — geometry types, not a PDF parsing function. There is no default export.

**Checkpoint:** Walk through Turbopack's resolution path for `import pdf from "pdf-parse"`
step by step. Which field in `package.json` does it look at first? Which condition does
it choose and why? What file does it end up reading, and what does that file contain?

<details>
<summary>Reveal answer</summary>

1. Turbopack looks at `package.json`'s `exports` field (the modern resolution standard,
   takes priority over `main` and `module`).
2. It resolves the `"."` entry (the package root).
3. Because the import statement uses ESM syntax (`import`), it uses the `"import"`
   condition → `dist/pdf-parse/esm/index.js`.
4. That file re-exports from `pdfjs-dist`, a PDF rendering library. Its exports include
   geometric types (`Rectangle`, `Point`, `Line`, etc.) and exception classes — the raw
   internals of a PDF renderer. There is no default export, because `pdfjs-dist` never
   had one.
5. Turbopack sees an import requesting a default export from a module with none → build
   error.

</details>

**Checkpoint:** The exports map has three conditions: `import`, `require`, and `default`.
Under what specific circumstances does each condition apply? If someone writes
`const pdf = require("pdf-parse")` in a CJS file instead of `import`, which condition
would be chosen — and which file would that resolve to?

<details>
<summary>Reveal answer</summary>

- `"import"` — used when an ESM `import` statement resolves the package (bundlers like
  Turbopack use this by default, since App Router is ESM)
- `"require"` — used when a CommonJS `require()` call resolves the package (Node.js CJS
  modules, or when `serverExternalPackages` hands resolution to Node.js)
- `"default"` — fallback condition used when neither `import` nor `require` matched; not
  all resolvers implement it

For `const pdf = require("pdf-parse")`: the `require` condition → `dist/pdf-parse/cjs/index.cjs`.
That CJS entry *does* export the `PDFParse` class correctly. This is exactly why
`serverExternalPackages` works — it routes resolution through `require` at runtime.

</details>

**Checkpoint:** `pdf-parse@2.4.5` has `"type": "module"` in its `package.json`. What
does this flag do, and how does it interact with the exports field? Would the resolution
path be different if `"type": "module"` were absent?

<details>
<summary>Reveal answer</summary>

`"type": "module"` declares that `.js` files in this package should be treated as ESM
modules rather than CommonJS. Without it, `.js` files default to CJS. This matters for
how the files within the package interpret `import`/`export` syntax.

However, the exports field *overrides* `"type": "module"` for specific entrypoints — the
`"require"` condition explicitly points at `.cjs` files, which are always CommonJS
regardless of the package-level `type`. If `"type": "module"` were absent, the ESM
entry might not be parsed as ESM at all, potentially causing different errors. But in
practice, the key resolution path (Turbopack → `import` condition → ESM entry) is
determined by the `exports` map, not by `"type": "module"` alone.

</details>

### The "Did you mean to import Rectangle?" clue

The Turbopack error message suggested `Rectangle` as the thing to import instead of a
default. This is not a generic suggestion — it is Turbopack reading the *actual exports*
of `dist/pdf-parse/esm/index.js` and telling you what it found there.

**Checkpoint:** Explain exactly why Turbopack suggested `Rectangle`. What file was it
reading, what did that file contain, and why would a PDF *parser* library expose a
geometric type as one of its exports?

<details>
<summary>Reveal answer</summary>

Turbopack successfully resolved `dist/pdf-parse/esm/index.js` and read all its named
exports. That file re-exports from `pdfjs-dist` — a PDF *rendering* engine (the engine
behind Firefox's built-in PDF viewer). `pdfjs-dist` exports low-level rendering
primitives, including `Rectangle` (a bounding-box type used to describe page regions),
`Point`, `Line`, and similar geometric types. `pdf-parse@2.4.5` internally uses
`pdfjs-dist` for PDF processing and exposes some of its types.

"Did you mean to import Rectangle?" means: "the file I resolved contains `Rectangle` as
one of its known named exports — I thought I'd mention it since you asked for a default
and got nothing." Working backwards from this clue: Rectangle is from `pdfjs-dist` →
`pdf-parse`'s ESM entry re-exports from `pdfjs-dist` → the ESM entry is not the parsing
API, it's a thin wrapper over a rendering engine's internals.

</details>

**Try it yourself:** Run this to see the actual exports in the ESM entry:

```bash
node -e "import('/Users/jessejames/Desktop/job-pilot/node_modules/pdf-parse/dist/pdf-parse/esm/index.js').then(m => console.log(Object.keys(m)))"
```

You should see `Rectangle`, `Point`, and similar geometric types — no parsing function,
no default. This is what Turbopack found.

---

## Part 2 — The fix: `serverExternalPackages` and what it actually does

Open [`next.config.ts`](../../../next.config.ts):

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
```

One line: `serverExternalPackages: ["pdf-parse"]`. This tells Turbopack: **do not bundle
this package at all**. Leave it as an external reference in the output, and let Node.js
resolve it at runtime when the server route is invoked.

**Checkpoint:** What actually happens at runtime when a server route imports a package
listed in `serverExternalPackages`? Walk through the sequence: what does Turbopack emit,
what does Node.js do when the route runs, and which condition in the exports map does
Node.js use?

<details>
<summary>Reveal answer</summary>

1. **At build time:** Turbopack sees `import { PDFParse } from "pdf-parse"` (or any import
   of this package) and, because it's listed in `serverExternalPackages`, emits it as a
   native `require("pdf-parse")` in the bundled output rather than inlining the module's
   code.
2. **At runtime:** When the route is invoked, Node.js executes `require("pdf-parse")`.
   Node.js uses the `"require"` condition in the exports map → resolves
   `dist/pdf-parse/cjs/index.cjs`.
3. **CJS interop:** The CJS entry exports named exports via `module.exports`. Node.js's
   CJS/ESM interop layer wraps these as named exports accessible via `import { PDFParse }`.

The key shift: Turbopack was using the `"import"` condition (ESM → wrong entry). Node.js
at runtime uses `require()` semantics → `"require"` condition → CJS entry → correct exports.

</details>

**Checkpoint:** For a package with dual CJS/ESM exports, why does marking it as
`serverExternalPackages` specifically cause Node.js to use the CJS entry (via the
`require` condition) rather than the ESM entry (via `import`)? What determines which
condition Node.js uses?

<details>
<summary>Reveal answer</summary>

When Turbopack emits an external reference, it emits a CommonJS `require()` call — not
an ESM dynamic `import()`. This is because server bundles in Next.js use CJS at the
output layer for compatibility with Node.js's module system. So at runtime, Node.js
sees `require("pdf-parse")` → matches the `"require"` condition → CJS entry.

If the route used a dynamic `import()` (which Turbopack might preserve as-is for some
async imports), Node.js would use the `"import"` condition. But the static
`serverExternalPackages` externalization path produces `require()` calls, not `import()`.
This is why `serverExternalPackages` specifically reaches the CJS entry.

</details>

**Checkpoint:** What is the trade-off between using `serverExternalPackages` vs changing
the import syntax to work with the ESM entry directly (e.g., using named imports from
the ESM entry)? When is each approach preferable?

<details>
<summary>Reveal answer</summary>

**`serverExternalPackages` approach:**
- Bypasses Turbopack bundling entirely — no analysis of the package's internals
- Works even if the package has Node.js-specific APIs (`fs`, `Buffer`, native addons)
  that can't be bundled for a different runtime
- The import syntax in your code doesn't need to change
- Trade-off: the package is not tree-shaken; you get the whole thing at runtime

**Changing import syntax for the ESM entry:**
- Keeps the package in the bundle — potentially smaller output if tree-shaking works
- Requires knowing what the ESM entry actually exports and adapting your code to it
- May not work if the ESM entry re-exports from a third-party library with incompatible
  Node.js runtime assumptions
- Trade-off: more code changes, more knowledge of the package's internals required

For Node.js-only packages (like `pdf-parse`, which processes files using Node.js Buffer),
`serverExternalPackages` is always the right approach — the package was never intended
to be bundled for a browser-like environment anyway.

</details>

**Checkpoint:** Name three categories of npm packages that commonly need
`serverExternalPackages` in a Next.js App Router project. What characteristic do they
share that makes Turbopack unable to bundle them correctly?

<details>
<summary>Reveal answer</summary>

1. **Native addons** — packages with `.node` binary files (`bcrypt`, `canvas`, `sharp`).
   Turbopack can't bundle binary files; they must be loaded by Node.js natively.
2. **File-system utilities** — packages that use `fs`, `path`, or `__dirname` in a way
   that assumes a specific filesystem layout (`pdf-parse`, `pdfkit`, file processors).
   Bundling relocates files; `fs` calls that assume relative paths break.
3. **ESM-first packages with broken ESM entries** (as in this case) — packages whose
   `"import"` condition resolves to an entry that doesn't export a usable default or
   the expected named exports, because the ESM entry is a thin wrapper over internals not
   designed for direct consumption.

The shared characteristic: they are designed to run in Node.js's native module system,
not inside a bundled artifact where file paths, binary loading, and module identity
behave differently.

</details>

**Checkpoint:** If a future package causes a similar Turbopack build error, what are the
two things you would check in its `package.json` to determine if `serverExternalPackages`
is the right fix?

<details>
<summary>Reveal answer</summary>

1. **Does it have an `exports` map with an `import` condition?** If yes, Turbopack will
   follow that condition — and if that ESM entry doesn't export what you need, you'll get
   this error. Check what the `import` condition resolves to.
2. **Does the `require` condition resolve to a CJS entry that has the correct exports?**
   If yes, `serverExternalPackages` will work — it routes to the `require` condition at
   runtime. If the CJS entry is also broken or missing the expected API, you have a deeper
   problem (the package itself is broken, or you're using v2.x with v1.x expectations).

Bonus check: **Is the package Node.js-only?** (`"type": "module"` + uses `fs`/`Buffer`/
native APIs). If yes, `serverExternalPackages` is appropriate regardless of the exports
map — it should never be bundled.

</details>

**Try it yourself:** Run `npm run build` without `serverExternalPackages` to see the
original error, then add it back and run again. To temporarily remove it:

```typescript
// next.config.ts — temporarily comment out:
// serverExternalPackages: ["pdf-parse"],
```

Run `npm run build`. You should see the Rectangle error. Restore the line and run again —
`✓ Compiled successfully`.

---

## Part 3 — "Correct without complete": why the build fix left a runtime error

After `serverExternalPackages` was added, the build compiled cleanly:

```
▲ Next.js 16.2.9 (Turbopack)
✓ Compiled successfully in 6.7s
```

The natural next step was to start the dev server and click "Extract from Resume". The
UI showed:

```
Internal server error
```

The build fix was correct. It was not complete.

**Checkpoint:** Explain why a fix can be correct at one layer without being complete for
the feature to work. What would need to be true about the two layers for a single fix to
have resolved both problems simultaneously?

<details>
<summary>Reveal answer</summary>

The build error and the runtime error are at different layers of the system and have
different root causes — they just share the same origin (pdf-parse v2.x being a
rewrite).

The `serverExternalPackages` fix correctly addressed the build error: Turbopack was
choosing the wrong entrypoint, so we told Turbopack not to bundle the package at all.
That fix has nothing to say about whether the *call site* in `agent/extractor.ts` matches
v2.x's API — that's a logic question about what function or class the package exports and
how to call it.

For a single fix to have resolved both problems, the v2.x CJS entry would need to export
a default function callable as `pdf(buffer)` — the same API as v1.x. Then
`serverExternalPackages` would have routed to the CJS entry, Node.js would have found
the default function, and `await pdf(buffer)` would have worked. But v2.x exported a
class instead, so the API mismatch was always there, waiting at runtime.

</details>

**Checkpoint:** After `serverExternalPackages` was added and the build compiled, would you
know a runtime error was waiting — without reading the v2.x API documentation or source
code? What information was available at the time of the build fix that pointed to a
potential second problem?

<details>
<summary>Reveal answer</summary>

With hindsight: yes. The "Did you mean to import Rectangle?" clue from the build error
revealed that the ESM entry exposed no parsing function — only geometry types. If the
ESM entry has no default export and no parsing function, and we're routing to the CJS
entry via `serverExternalPackages`, the question "what does the CJS entry actually
export?" should have been investigated before declaring the fix complete.

At the time: the `serverExternalPackages` fix resolved the error reported by the build.
Without reading `dist/pdf-parse/cjs/index.cjs` or the v2.x changelog, the reasonable
assumption was that the CJS entry exported a compatible API. This assumption was wrong —
but it was a reasonable stopping point for the build-layer fix. The runtime test was the
only way to discover the second problem.

This is why the two-fix sequence is a *recoverable* pattern rather than a mistake: each
fix addressed the specific thing that was broken at that moment. Neither fix was wrong.

</details>

**Checkpoint:** The two fixes had to be applied in order: `serverExternalPackages` first,
then the API mismatch fix. Could the API mismatch fix have been applied first — before
the build fix — and worked? What would have happened if you tried
`import { PDFParse } from "pdf-parse"` without `serverExternalPackages`?

<details>
<summary>Reveal answer</summary>

No. Without `serverExternalPackages`, changing `import pdf from "pdf-parse"` to
`import { PDFParse } from "pdf-parse"` would not fix the build error. Turbopack would
still follow the `"import"` condition → ESM entry → read that file → find `Rectangle`
and other types, but no `PDFParse` class. The build would still fail with a similar
"export 'PDFParse' doesn't exist in target module" error.

The order is required: fix the bundler's resolution path first (`serverExternalPackages`),
then fix the call site to match v2.x's API. The first fix changes *which file is
resolved*; the second fix changes *how that file's exports are used*. Neither works
without the other in place.

</details>

---

## Part 4 — Reading "Internal server error": where the real error lives

After the build fix, the feature was tested by clicking "Extract from Resume". The client
displayed the error string from the route's catch block.

Open [`app/api/profile/extract/route.ts`](../../../app/api/profile/extract/route.ts)
lines 48–55:

```typescript
  } catch (error) {
    console.error("[api/profile/extract]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
```

**Checkpoint:** The client receives `{ success: false, error: "Internal server error" }`.
What does this string tell you about *which specific operation* in the route threw the
exception? Compare this to the specific guards earlier in the route — e.g., `{ error:
"No resume uploaded" }`. What distinguishes what you can learn from each?

<details>
<summary>Reveal answer</summary>

The generic catch response tells you *nothing* about which operation threw — only that
something unhandled was thrown anywhere in the route body. It's the fallback for every
exception the specific guards didn't catch.

The specific guards (`"No resume uploaded"`, `"Could not retrieve resume from storage"`)
are *expected* failure states — conditions the route explicitly checks for. When you see
one of these, you know exactly which guard fired and what it detected.

When you see the generic catch message, it means an *unexpected* exception reached the
catch block. The real information — the exception type, the message, the stack trace,
the exact line — is in `console.error("[api/profile/extract]", error)`, which writes to
the server terminal where `npm run dev` is running.

</details>

**Checkpoint:** When a Next.js API route throws an uncaught exception, walk through
exactly what happens — from the throw to what appears in the browser. Which code catches
the error? What gets logged? What does the client receive? How does this differ from
a browser-side JavaScript error?

<details>
<summary>Reveal answer</summary>

1. An exception is thrown inside the `try` block (e.g., `TypeError: pdf is not a
   function`).
2. JavaScript's `catch (error)` clause intercepts it — `error` is the thrown exception
   object.
3. `console.error("[api/profile/extract]", error)` writes the full exception — including
   type, message, and stack trace — to the process's stderr, which appears in the terminal
   running `npm run dev` (or in the log stream of a deployed server).
4. `return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })`
   sends the response back to the client — only the generic string, nothing from the
   actual exception.
5. The browser receives a JSON body with `{ success: false, error: "Internal server
   error" }`. The `fetch` call in `handleExtract` reads this and passes it to
   `setExtractResult({ success: false, error: "Internal server error" })` — which renders
   the error banner.

For a browser-side error, the full error would appear in the browser's DevTools console
with a stack trace. For a server-side route error, the browser console shows nothing
useful — only the response body. The server terminal is always the authoritative source.

</details>

**Checkpoint:** The route has three operations that could throw: the InsForge auth check,
the storage download, and `extractProfileFromResume`. How would you narrow down which one
threw — without adding any `console.log` statements and without reading the server
terminal?

<details>
<summary>Reveal answer</summary>

Use lateral reasoning from what you already know:

1. **Auth check** — if this threw, every other authenticated route in the app would also
   be broken (it uses the same `createInsforgeServer()` + `getCurrentUser()` pattern). If
   the profile page loads and the upload button works, auth is fine. Rule out.

2. **Storage download** — this path (`insforge.storage.from("resumes").download(key)`)
   hasn't changed since Feature 06. If resume upload was still working, the same bucket
   and key format would still be valid. The download had no reason to start failing.
   Rule out.

3. **`extractProfileFromResume`** — this was the newly added code. The previous recovery
   session established that `pdf-parse@2.4.5` was installed. The fix (`serverExternalPackages`)
   changed module resolution but didn't change what the CJS entry exports. Any call to the
   v2.x API using v1.x conventions would throw here. Most likely.

This is the diagnostic value of reasoning from *what changed*: the auth and storage paths
existed before Feature 07. Only `extractProfileFromResume` (and by extension, the
`pdf-parse` call inside it) was new.

</details>

**Try it yourself:** Reproduce the error and read the real exception. Start the dev server
and click "Extract from Resume". Then check the terminal where `npm run dev` is running.
You should see something like:

```
[api/profile/extract] TypeError: pdf is not a function
    at extractProfileFromResume (.../agent/extractor.ts:59:22)
    ...
```

The prefix `[api/profile/extract]` is the tag from `console.error("[api/profile/extract]", error)`.
It marks every error from this route — making them easy to grep in a production log stream.

---

## Part 5 — The API break: v1.x default function vs v2.x named class

Open [`agent/extractor.ts`](../../../agent/extractor.ts), the relevant section before
and after the fix:

**Before (v1.x convention):**
```typescript
import pdf from "pdf-parse";

// Inside extractProfileFromResume:
const pdfData = await pdf(buffer);
const text = pdfData.text?.trim() ?? "";
```

**After (v2.x API):**
```typescript
import { PDFParse } from "pdf-parse";

// Inside extractProfileFromResume:
const parser = new PDFParse({ data: buffer });
const pdfData = await parser.getText();
const text = pdfData.text?.trim() ?? "";
```

The complete API difference between versions:

| | v1.x | v2.x |
|--|------|------|
| Export style | Default function | Named class (`PDFParse`) |
| Import | `import pdf from "pdf-parse"` | `import { PDFParse } from "pdf-parse"` |
| Usage | `await pdf(buffer)` | `new PDFParse({ data: buffer })` then `await parser.getText()` |
| Input | `Buffer` as positional argument | `{ data: Buffer }` options object |
| Output | `{ text, numpages, info, metadata }` | `{ text, pages, total }` |

**Checkpoint:** The v1.x output and the v2.x output both have a `text` field. What does
this mean for the recovery — which parts of the code had to change, and which parts were
untouched? Why is preserving the `text` field significant for the downstream code?

<details>
<summary>Reveal answer</summary>

Only the import and the call site in `agent/extractor.ts` had to change. Everything
downstream — the length guard (`text.length < 100`), the Gemini call, the response
shape, `applyExtraction` in `ProfileForm.tsx` — was untouched. The recovery was contained
to two lines in one file.

The `text` field being preserved matters because the downstream code reads
`pdfData.text?.trim() ?? ""` immediately after the parse call. If v2.x had renamed this
field (e.g., to `fullText` or `content`), the extraction would silently return an empty
string — passing the length guard (because `undefined?.trim()` returns `undefined`, and
`undefined ?? ""` gives `""`, which has length 0 and would trip the `< 100` guard) and
returning a user-facing error. The shared field name meant the two-line fix was complete.

</details>

**Checkpoint:** `import pdf from "pdf-parse"` compiled without a TypeScript error even
though v2.x's CJS entry has no default export. Why didn't TypeScript catch this mismatch
at compile time? At what point in the system did the error finally become visible?

<details>
<summary>Reveal answer</summary>

TypeScript only knows what the type declarations (`@types/pdf-parse` or the package's
bundled `.d.ts` files) say. If those type declarations define a default export (either
because `@types/pdf-parse` was written for v1.x, or because the package's own `index.d.ts`
declares `export default`), TypeScript accepts the import without complaint — it has no
mechanism to check whether the actual runtime export matches the declared type.

`@types/pdf-parse` in npm describes v1.x's API. Even though v2.4.5 is installed, if the
type declarations still describe a default export, TypeScript will compile the v1.x-style
import. The error only becomes visible at runtime, when Node.js actually evaluates
`require("pdf-parse")` → sees no default export in the CJS module → returns `undefined`
for `pdf` → `await undefined(buffer)` throws `TypeError: pdf is not a function`.

This is the fundamental risk of using stale type declarations: TypeScript's safety net
has a hole exactly where major version API breaks occur.

</details>

**Checkpoint:** What are the signals in `package.json` that would alert you to a likely
API change — ideally before writing any code against the package?

<details>
<summary>Reveal answer</summary>

1. **Major version significantly higher than what tutorials describe.** If every example
   online shows v1.1.1 but the installed version is v2.4.5, a major API rewrite is likely.
   Semantic versioning permits breaking changes across major versions.

2. **`"type": "module"` in a package that historically was CJS.** The original `pdf-parse`
   was a pure CJS package. Adding `"type": "module"` signals a fundamental restructuring
   of how the package is published — often coinciding with an API overhaul.

3. **Multiple entrypoints in the exports map.** A package that previously had only a
   `main` field and now has a full exports map with `import`/`require`/`browser` conditions
   has been significantly rearchitected.

4. **New `exports` map conditions pointing to new file extensions** (`.cjs`, `.mjs`,
   `.cts`, `.mts`). These didn't exist in the older publish conventions — their presence
   signals a modern ESM/CJS dual-publish rewrite.

</details>

**Try it yourself:** Compare the type declarations to the actual runtime export:

```bash
# What TypeScript thinks the default export is:
cat node_modules/@types/pdf-parse/index.d.ts 2>/dev/null || echo "No @types/pdf-parse"

# What the CJS entry actually exports at runtime:
node -e "const m = require('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs'); console.log(typeof m, Object.keys(m))"
```

The first command shows what TypeScript's type check allows. The second shows what's
actually there at runtime. If they disagree, TypeScript would compile code that fails
at runtime — exactly what happened here.

---

## Part 6 — Prevention: pinning, pre-flight checks, and production observability

These three recovery sessions (Tutorial 04, this tutorial's Session 1, this tutorial's
Session 2) were all resolved cleanly. But each could have been caught earlier.

**Checkpoint:** Name two checks you could run for any new library install that would have
caught the `pdf-parse` API mismatch *before shipping Feature 07*. Neither check requires
reading the library's source code.

<details>
<summary>Reveal answer</summary>

1. **Check the installed version against the version referenced in your plan/docs.**
   `cat node_modules/pdf-parse/package.json | grep version` — takes five seconds. If the
   plan says "use pdf-parse for text extraction" and every example in that plan shows
   `import pdf from "pdf-parse"; await pdf(buffer)`, and the installed version is 2.4.5,
   the mismatch is visible before a single line is written.

2. **Smoke-test the import in isolation before wiring it into the route.** A two-line
   Node.js script: `const { PDFParse } = require("pdf-parse"); console.log(typeof PDFParse)`
   would confirm what the package exports in 10 seconds. If it logs `"function"` or
   `"undefined"` instead of `"function"` (class), the API shape is wrong. This is a
   pre-flight check, not a full test — it just confirms the import resolves as expected.

</details>

**Checkpoint:** `npm install pdf-parse` installed v2.4.5 without any warning. How would
you pin the package to prevent unexpected major-version upgrades in future fresh installs?
What is the trade-off of pinning?

<details>
<summary>Reveal answer</summary>

In `package.json`, specify the version exactly:
```json
"pdf-parse": "2.4.5"
```
Or with a tight range:
```json
"pdf-parse": ">=2.4.5 <3.0.0"
```

The `^` prefix (which npm adds by default: `"^2.4.5"`) allows minor and patch updates
but not the next major. To prevent *any* update: use the exact version without a prefix.

**Trade-off of pinning:** You opt out of receiving automatic security patches, bug fixes,
and performance improvements. If `pdf-parse@2.4.6` fixes a security vulnerability in
the PDF parsing engine, a pinned `2.4.5` won't receive it unless you manually update.
The trade-off is stability vs maintenance cost — pinning is appropriate when a library's
API is critical to a feature's correctness and the version has been tested.

</details>

**Checkpoint:** The server terminal showed `TypeError: pdf is not a function` in local
development. In a production deployment (not local dev), how would you see this error?
Is there already something in this project that would help?

<details>
<summary>Reveal answer</summary>

In production, there is no terminal to read. The error would need to go to an
observability platform. In this project:

1. **`console.error("[api/profile/extract]", error)`** — the `[api/profile/extract]`
   tag prefix means this error is identifiable in structured log output. In most
   deployment platforms (Vercel, Railway, Fly.io), server-side `console.error` appears
   in the platform's log dashboard, often filterable by prefix.

2. **PostHog** — this project already has PostHog for event tracking. However, the four
   current PostHog events (`job_search_started`, `job_found`, `profile_completed`,
   `company_researched`) don't include error events. A `extraction_failed` event with an
   error reason property would make this visible in the PostHog dashboard without
   requiring access to server logs.

3. **What's missing:** a structured error monitoring service (Sentry, Highlight, Axiom)
   that captures server-side exceptions with stack traces. `console.error` is the
   manual equivalent — it requires a human to check the log stream rather than being
   alerted automatically.

</details>

---

## Full data flow: the two-fix sequence from first error to working extraction

**Session 1 — Build layer:**

1. `npm run build` runs
2. Turbopack analyzes `agent/extractor.ts` → sees `import pdf from "pdf-parse"`
3. Turbopack reads `node_modules/pdf-parse/package.json` → exports map → `"import"` condition → `dist/pdf-parse/esm/index.js`
4. Turbopack reads `dist/pdf-parse/esm/index.js` → finds `Rectangle`, `Point`, etc. from `pdfjs-dist` — no default export
5. **Build error:** "Export default doesn't exist in target module. Did you mean to import Rectangle?"
6. **Diagnosis:** Turbopack following wrong exports condition — `"import"` → ESM entry (wrong); `"require"` → CJS entry (correct)
7. **Fix:** `serverExternalPackages: ["pdf-parse"]` in `next.config.ts` — tells Turbopack to leave this package as a Node.js external
8. `npm run build` → `✓ Compiled successfully` — Turbopack no longer resolves `pdf-parse` at all

**Session 2 — Runtime layer:**

9. `npm run dev` starts; user clicks "Extract from Resume"
10. `handleExtract()` fires → `fetch("POST /api/profile/extract")`
11. Route runs → auth check ✓ → storage download ✓ → `extractProfileFromResume(buffer)` called
12. `agent/extractor.ts` line (before fix): `const pdfData = await pdf(buffer)`
13. Node.js resolves `require("pdf-parse")` → `dist/pdf-parse/cjs/index.cjs` → exports `{ PDFParse }` — no default
14. `pdf` is `undefined`; `undefined(buffer)` → **`TypeError: pdf is not a function`**
15. Exception propagates to route's catch block → `console.error("[api/profile/extract]", error)` → terminal log
16. Route returns `{ success: false, error: "Internal server error" }` → UI shows error banner
17. **Diagnosis:** v2.x CJS entry exports `PDFParse` class, not a default function — v1.x API assumed
18. **Fix:** `import { PDFParse }` + `new PDFParse({ data: buffer })` + `await parser.getText()` in `agent/extractor.ts`
19. Click "Extract from Resume" → `PDFParse` instantiated → `getText()` returns `{ text }` → length guard ✓ → Gemini call → form populated ✓

---

## Extend it (challenges)

### Challenge 1 — Trace: map the exports map to the two resolution paths (15–20 min)

Open `node_modules/pdf-parse/package.json`. Write a trace — one numbered list for each
resolution path — answering: for each path, which condition is used, which file is
resolved, and what does that file export?

Then write a third trace for a hypothetical: what would happen if you added a `"node"`
condition to the exports map pointing at the CJS entry, and the bundler respected it?

<details>
<summary>Hint</summary>

The three conditions in the map are `import`, `require`, and `default`. Turbopack uses
`import`. Node.js (via `require()`) uses `require`. The hypothetical `"node"` condition
is recognized by some bundlers (esbuild, Rollup) as a signal for Node.js-specific
resolution — it would let `serverExternalPackages` become unnecessary if properly
implemented by the bundler.

</details>

---

### Challenge 2 — Extend: add extraction error telemetry (25–35 min)

Currently, when extraction fails with "Internal server error", the only diagnostic
artifact is the `console.error` in the server terminal. Add a structured error event so
failures are visible without server log access.

In `app/api/profile/extract/route.ts`, add a response code to the error return:

```typescript
return NextResponse.json(
  { success: false, error: "Internal server error", code: "EXTRACTION_FAILED" },
  { status: 500 },
);
```

In `components/profile/ProfileForm.tsx`, when `result.success === false`, log the error
reason to the browser console with context:

```typescript
console.error("[extract]", result.error, result.code ?? "");
```

This makes extraction failures visible in browser DevTools without requiring server
terminal access. Consider: is this sufficient for production observability? What's still
missing compared to a server-side error monitoring service?

<details>
<summary>Hint</summary>

The `code` field lets the client distinguish between user-facing errors ("No resume
uploaded") and unexpected failures ("Internal server error") without string matching.
The browser `console.error` surfaces it in DevTools for debugging. What's missing:
stack traces, the original exception message, and automatic alerting — all of which
would require a service like Sentry or Axiom capturing server-side errors.

</details>

---

### Challenge 3 — Design: a pre-flight check for new library installs (30–40 min)

Write a Node.js script (`scripts/check-deps.js`) that, when run after `npm install`,
validates that key library entry points match what the project expects. For `pdf-parse`,
it should verify that:

1. The installed version is >= 2.0.0 (the v2.x API that's now wired in)
2. `require("pdf-parse").PDFParse` is a function (the class is exported correctly)
3. `require("pdf-parse").default` is `undefined` (confirming no v1.x default export
   that would indicate a downgrade)

Design the script as a fast sanity check, not a full test suite — it should run in
under 1 second and print a clear pass/fail for each check.

Consider: what other packages in this project (OpenAI SDK, InsForge, PostHog) would
benefit from similar checks, and what would you verify for each?

<details>
<summary>Hint</summary>

```javascript
// scripts/check-deps.js
const pdfParse = require("pdf-parse");
const pkg = require("pdf-parse/package.json");

const checks = [
  {
    name: "pdf-parse version >= 2.0.0",
    pass: parseInt(pkg.version) >= 2,
  },
  {
    name: "PDFParse class exported",
    pass: typeof pdfParse.PDFParse === "function",
  },
  {
    name: "No v1.x default export",
    pass: pdfParse.default === undefined,
  },
];

checks.forEach(({ name, pass }) =>
  console.log(`${pass ? "✓" : "✗"} ${name}`)
);
process.exit(checks.every(c => c.pass) ? 0 : 1);
```

Run with `node scripts/check-deps.js`. For the OpenAI SDK: verify `openai` has no
default class with a specific call signature; for InsForge: verify `createBrowserClient`
and `createServerClient` are exported from `@insforge/ssr`.

</details>

---

For deeper exploration, both discussion files contain questions this tutorial adapted
from:
- [`docs/recover/pdf-parse-esm-default-export/ai-discussion-topics.md`](../../recover/pdf-parse-esm-default-export/ai-discussion-topics.md) — 13 questions on the exports map, `serverExternalPackages`, and Turbopack vs Node.js resolution
- [`docs/recover/pdf-parse-v2-api-mismatch/ai-discussion-topics.md`](../../recover/pdf-parse-v2-api-mismatch/ai-discussion-topics.md) — 12 questions on runtime error diagnosis, the two-fix sequence, and prevention patterns

Feed any question you found ambiguous to an LLM *after* forming your own answer — the
gap between what you thought and what you learn is where understanding lands.
