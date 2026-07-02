# Principles — Implement Session: Feature 13 Project-Review Fixes

---

## 1. Why the return type change is the right way to pass company to the route

The PostHog event for `company_researched` requires `{ userId, jobId, company }`. The `company` field comes from the job row — a DB value, not a value the client sends. The route already knew `userId` (from auth) and `jobId` (from the validated request body). It had no access to `company` without a query.

Two approaches:

**Option A — second DB query in the route:**
```typescript
const { dossier } = await researchCompany(jobId, userId);
const { data: jobData } = await insforge.from("jobs").select("company").eq("id", jobId).single();
await captureServerEvent({ ..., properties: { userId, jobId, company: jobData?.company ?? "" } });
```

This works but makes an additional query for a field that `researchCompany()` already fetched. Every research run requires one DB query for `job` fields in `agent/research.ts` and now a second query in the route for the same row.

**Option B — extend the return type:**
```typescript
// agent/research.ts
return { dossier, company: job.company };

// route.ts
const { dossier, company } = await researchCompany(jobId, userId);
```

The `job` row is already fetched inside `researchCompany()`. Returning `company` alongside `dossier` costs nothing — it is just adding a field to an object that is already in memory. No additional queries. No new trust boundary.

The principle: when a function already has access to a value that the caller needs, return it. Do not force the caller to re-fetch what the function already holds.

---

## 2. The PostHog isolation pattern and when to apply it

The original structure:
```typescript
try {
  const dossier = await researchCompany(jobId, userId);
  await captureServerEvent({ ... });  // side effect inside main operation
  return NextResponse.json({ success: true, data: { companyResearch: dossier } });
} catch (error) {
  return NextResponse.json({ success: false, error: "Failed to research company" }, { status: 500 });
}
```

If `captureServerEvent()` throws, the catch fires. The client gets `success: false`. But the research succeeded — the dossier is already in the DB.

The fix:
```typescript
const { dossier, company } = await researchCompany(jobId, userId);  // core operation

try {
  await captureServerEvent({ ... });
} catch {
  console.error("[api/agent/research] PostHog capture failed — analytics only, research succeeded");
}

return NextResponse.json({ success: true, data: { companyResearch: dossier } });  // always runs
```

The test for whether to isolate: "If this line throws, should the client receive an error?" For the PostHog call — no. A PostHog failure is an analytics side effect. It should be logged, not propagated.

This pattern applies wherever an operation has a non-critical side effect:
- Sending a notification email after creating a record
- Logging to a third-party audit service after an auth event
- Firing a webhook after a successful write

None of these failures should gate the core response. Each gets its own `try/catch`.

---

## 3. Context file drift and the two-phase update rule

Context files like `architecture.md` and `library-docs.md` are read by agent sessions as canonical documentation. When the diagnosing-bugs session fixed the Stagehand model name in `lib/stagehand.ts`, the same value appeared in both context files — but only the code was fixed.

The consequence: any future agent session that reads `context/library-docs.md` before writing Stagehand initialisation code will see `"nvidia/..."` (the broken form). That agent will produce code that reproduces a known, already-diagnosed bug.

The two-phase rule: whenever a bug fix changes a documented constant, configuration value, or API shape:
1. Fix the code.
2. Grep for the old value in `context/`. Update every occurrence.

Both phases must happen in the same session. Fixing one without the other leaves a trap for the next agent.

---

## 4. Detecting and removing corrupt editorial content

Lines 543–689 of `context/library-docs.md` contained a literal editor instruction ("Replace the existing Stagehand 'Company Research Pattern' section in library-docs.md with this:") followed by the intended replacement content. This was never applied — it was appended as document content instead.

The detection signal: self-referential text inside a documentation file. Any line that says "Replace...", "Update this section...", "This was supposed to be..." is editor commentary, not documentation content. These blocks can appear when an LLM generates both the instruction and the content in a single output, and only the content is committed.

The danger in this case was specific: the corrupt block included `stagehand.extract({ instruction, schema })` — the old object form of the extraction API. The correct form is positional: `stagehand.extract(instruction, schema)`. Any agent reading the corrupt block could generate extraction code using the wrong API shape, which fails silently at runtime (Stagehand ignores unknown properties in the object, runs with defaults, and returns empty results).

The fix was to delete lines 543–689 entirely using Python line-range arithmetic:
```python
new_lines = lines[:542] + lines[689:]
```
The correct content was already present earlier in the same file.

---

## 5. Token budget analysis for JSON responses

`max_tokens: 800` was the documented value for company research synthesis. The working code uses 2000. The difference was not arbitrary — 800 caused JSON truncation (see the diagnosing-bugs session). But the project-review caught that the context files still documented the wrong value.

The principle for setting `max_tokens` for JSON synthesis:

Estimate the maximum realistic output for each field in the schema:
- `companyOverview`: 3–5 sentences → ~100 tokens
- `whyThisRole`: 2–4 sentences → ~80 tokens
- `techStack`: 5–12 items × 3 tokens each → ~36 tokens
- `culture`: 3–6 items × 8 tokens each → ~48 tokens
- `yourEdge`: 3–5 items × 15 tokens each → ~75 tokens
- `gapsToAddress`: 3–5 items × 15 tokens each → ~75 tokens
- `smartQuestions`: 5–8 items × 20 tokens each → ~160 tokens
- `interviewPrep`: 5–8 items × 20 tokens each → ~160 tokens
- `sources`: 3–8 URLs × 20 tokens each → ~160 tokens
- `researchedAt`: ISO string → 10 tokens
- JSON structural overhead (keys, brackets, commas) → ~100 tokens

Total maximum: approximately 1004 tokens. Add 30–50% headroom: ~1400–1500 tokens. 2000 provides comfortable headroom for all realistic outputs.

The rule: for `response_format: { type: "json_object" }` calls, set `max_tokens` to cover the worst-case schema output plus at least 30% headroom. Never estimate from the "typical" output — JSON truncation errors only appear on edge cases (long arrays, verbose fields).

---

## 6. Conditional URL rendering and the security attributes

The `isUrl` guard before creating `<a>` tags:
```typescript
const isUrl = src.startsWith("http://") || src.startsWith("https://");
```

Why this check and not `new URL(src)`:
- `new URL(src)` throws on invalid input, requiring a try/catch just to check
- The prefix check is O(1), synchronous, and has no failure mode
- It correctly guards against the case where Nemotron includes a non-URL string (a page title, a description fragment) in the sources array — these are rendered as plain text, not broken links

Why `rel="noopener noreferrer"` is required for all `target="_blank"`:
- `noopener` — prevents the opened tab from accessing `window.opener`. Without it, a page opened via `target="_blank"` can access the JavaScript context of the parent tab and navigate it (tab-napping attack).
- `noreferrer` — prevents the `Referer` header from being sent to the destination. Stops the external site from knowing which page on this app linked to it.

Both are required together. Modern browsers set `noopener` automatically for cross-origin `_blank` links, but relying on browser behaviour rather than explicit attributes is fragile and not universal across all browsers/versions.
