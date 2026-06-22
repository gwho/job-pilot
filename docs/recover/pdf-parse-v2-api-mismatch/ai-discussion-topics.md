# AI Discussion Topics — pdf-parse v2.x Runtime API Mismatch

## Group 1: Reading Runtime Errors in Next.js App Router

1. The client received `{ success: false, error: "Internal server error" }`. This string
   came from the route's catch block. Explain the difference between this error and the
   specific error guards earlier in the route (e.g., `{ error: "No resume uploaded" }`).
   What does seeing the generic catch response tell you about where in the route the
   exception was thrown?

2. When a Next.js API route throws an uncaught exception, where does the real error
   appear? Walk through exactly what happens: which code catches it, what gets logged,
   and what the client receives. How does this differ from a browser-side error?

3. The route has three operations that could throw: auth check, storage download, and
   `extractProfileFromResume`. How would you narrow down which one threw without
   reading the server terminal? What would the symptom look like for each?

## Group 2: Package Version API Breaks

4. `pdf-parse` jumped from v1.1.1 (the version described in all tutorials) to v2.x with
   a complete API rewrite. What are the signals in `package.json` that would alert you
   to a likely API change before writing any code — before even running the app?

5. The v1.x API (`await pdf(buffer)`) and the v2.x API (`new PDFParse({ data: buffer })
   then await parser.getText()`) produce the same `text` field in their output. Why does
   this matter for the recovery — what had to change, and what didn't?

6. `import pdf from "pdf-parse"` compiles without a TypeScript error even though v2.x has
   no default export. Why doesn't TypeScript catch this mismatch at compile time? At what
   point does the error become visible?

## Group 3: The Two-Fix Sequence

7. The previous session added `serverExternalPackages: ["pdf-parse"]` to fix a build
   error. That fix was correct — but it left a runtime error in place. Explain why one
   fix can be correct without being complete. What would need to be true for a single fix
   to have resolved both problems?

8. After `serverExternalPackages` was added and the build compiled, what would you expect
   to happen if you ran the dev server and clicked "Extract from Resume" — without reading
   the v2.x API? Would you know the runtime error was there? Why or why not?

9. The two fixes had to be applied in a specific order (build fix first, then runtime fix).
   Could the runtime fix have been applied first without the build fix in place? What would
   have happened if you tried `import { PDFParse } from "pdf-parse"` before adding
   `serverExternalPackages`?

## Group 4: Prevention Patterns

10. Name two checks you could add to the recovery flow for any new library install that
    would have caught this API mismatch before shipping Feature 07. Neither check requires
    reading the library's source code.

11. When `npm install pdf-parse` installed v2.4.5 instead of v1.1.1, no warning appeared.
    How would you pin a package to a specific version range in `package.json` to prevent
    unexpected major-version upgrades in the future? What's the trade-off?

12. The server terminal log showed the real error (`TypeError: pdf is not a function`).
    In a production deployment (not local dev), how would you see this error? What
    observability setup would you need — and is anything already in place in this project
    for logging agent operation failures?
