# Tutorial 25 — Company Research Agent: Project Review, Analytics Isolation, and Context File Integrity

**After completing this tutorial you will understand:** why analytics side effects must never gate a successful API response; how to extend a function's return type to surface server-side data without an extra DB query; the exact security attributes required for external links; what context file drift is, how it re-introduces fixed bugs, and how to detect it; and how to estimate the correct `max_tokens` value for structured JSON synthesis.

---

> [!NOTE]
> **Prerequisites:** Tutorial 24 (`../24-company-research-agent/README.md`) — covers the full Feature 13 implementation: CDP sessions, Stagehand extraction, Nemotron synthesis, RAII cleanup. This tutorial reviews and fixes the code built there; you must understand that code before these fixes will make sense.
>
> Open [`agent/research.ts`](../../../agent/research.ts), [`app/api/agent/research/route.ts`](../../../app/api/agent/research/route.ts), [`components/job-details/CompanyResearch.tsx`](../../../components/job-details/CompanyResearch.tsx), [`context/library-docs.md`](../../../context/library-docs.md), and [`context/architecture.md`](../../../context/architecture.md) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| Side effect isolation | PostHog call extracted into own try/catch | System design |
| Algebraic return types | `researchCompany()` changed to `{ dossier, company }` | Type theory |
| Token budget estimation | max_tokens 800 → 2000 for 9-field JSON schema | System design |
| Tab-napping prevention | `rel="noopener noreferrer"` on external links | OS fundamentals |
| Documentation drift | Stale context files re-introduce fixed bugs | System design |

---

## How to use an LLM before this tutorial

Budget 20–25 minutes across these four concepts.

### Concept 1 — Side effects in HTTP handlers

> "In a web API handler, what is the difference between the 'core operation' and a 'side effect'? Give three examples of side effects that commonly run after a successful operation (analytics, email, webhook). Why is it a problem if a side effect failure causes the handler to return an HTTP error status to the client, even though the core operation succeeded? How do you structure try/catch blocks in a handler so that a side effect failure is isolated? Quiz me on identifying side effects vs. core operations in a given route handler."

*What to listen for:* The core operation is what the client requested — the thing that changes state on the server. Side effects are notifications, measurements, or audit records attached to that operation. They are not requested by the client and their failure is not the client's problem. If a side effect is inside the same try/catch as the core operation, any side effect failure returns an error to the client — even if the client's actual request succeeded. The fix: each side effect in its own try/catch, after the core operation completes.

*Practice question:* A route saves a new user to the database, then sends a welcome email, then tracks a `user_created` PostHog event, then returns `{ success: true }`. The PostHog call throws. What does the client receive if all three calls are inside the same try block? What does the client receive after applying isolation?

---

### Concept 2 — Extending function return types to avoid extra queries

> "In TypeScript, when you change a function's return type to include an additional field (for example, from `Promise<Dossier>` to `Promise<{ dossier: Dossier; company: string | null }>`), what changes do callers need to make? When is this pattern preferable to making the caller fetch the additional data itself? What is the cost of a second DB query compared to adding a field to an already-fetched row? Give a concrete example of this trade-off. Quiz me on when it's appropriate to extend a return type vs. when the caller should handle its own queries."

*What to listen for:* If a function already fetches a DB row and has access to a field, returning that field costs nothing — it is already in memory. Forcing the caller to query the same row again costs one additional round-trip to the DB per call. The return-type extension also keeps the data scoped to where it was fetched, rather than spreading the same query across two places. The pattern is appropriate when: the function owns the data, the caller only needs the data for a side effect (not for its core logic), and the additional field is a simple scalar.

*Practice question:* `researchCompany()` fetches the `job` row. It returns the dossier. The route needs the company name for a PostHog event. Option A: add `company: job.company` to the return value. Option B: query `jobs` again in the route. Which produces one DB query per research run, and which produces two?

---

### Concept 3 — Security attributes on external links

> "When HTML links open in a new tab using `target='_blank'`, two security attributes are recommended: `rel='noopener'` and `rel='noreferrer'`. Explain what each one prevents. What is 'tab-napping' — how does an attacker abuse a `target='_blank'` link without these attributes? What information does the `Referer` header expose, and why might you want to suppress it when linking to external sites? Are modern browsers safe without these attributes? Quiz me on what each attribute does in isolation."

*What to listen for:* Without `noopener`, the opened tab receives a reference to `window.opener` — the JavaScript context of the originating tab. A malicious page can use this to navigate the parent tab to a phishing page while the user is not watching (tab-napping). `noopener` removes this reference. `noreferrer` suppresses the `Referer` HTTP header, preventing the external site from knowing which URL on your app sent the user. Modern browsers set `noopener` automatically for cross-origin `_blank` links since around 2020, but explicit attributes are more reliable across all browsers and older versions.

*Practice question:* A link has `target="_blank" rel="noopener"` but NOT `rel="noreferrer"`. The user is on `/jobs/123`. They click a link to an external company homepage. What does the company's server receive in the `Referer` header?

---

### Concept 4 — Token budget arithmetic for JSON schema outputs

> "When calling an LLM API with `max_tokens` and `response_format: { type: 'json_object' }`, explain why you must set `max_tokens` based on the schema, not just intuition. What happens when the model reaches the token limit mid-response? Is a truncated JSON response parseable? Walk me through how to estimate the max token count for a schema with 9 fields, some of which are arrays of 3-8 items. What is a reasonable safety margin? Quiz me on what a truncated JSON.parse error looks like."

*What to listen for:* When `max_tokens` is reached, the model stops generating — mid-word, mid-field, mid-array. The result is a valid partial JSON string that fails `JSON.parse` with `SyntaxError: Unexpected end of JSON input`. To estimate the budget: enumerate each field, estimate maximum content per field in tokens (roughly 0.75 tokens per character, or ~4 characters per token for English prose), add JSON structural overhead (keys, quotes, brackets, commas), and add 30–50% headroom. The safety margin exists because estimates are averages — actual outputs vary.

*Practice question:* A schema has 9 fields. Maximum realistic output: 1000 tokens. If `max_tokens` is set to 800, what is the probability that at least one research call will fail with a JSON parse error? How often would you expect it in practice?

---

## Architecture overview

```
┌─────────────────────────────── Browser ──────────────────────────────┐
│  "Research Company" button click → POST /api/agent/research { jobId } │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │
┌─────────────────────────────── Route ────────────────────────────────┐
│  1. Auth check (createInsforgeServer → getCurrentUser)               │
│  2. Validate jobId from body                                          │
│  3. researchCompany(jobId, userId)          ◄── CORE OPERATION       │
│     └─ returns { dossier, company }                                  │
│  4. captureServerEvent("company_researched") ◄── ISOLATED SIDE EFFECT│
│     └─ own try/catch — failure logs, never propagates                │
│  5. return { success: true, data: { companyResearch: dossier } }     │
└──────────────────────────────────────────────────────────────────────┘
                         │                    │
               ┌─────────┴────────┐  ┌────────┴────────┐
               │  agent/research  │  │  PostHog server  │
               │  researchCompany │  │  captureServerEvent│
               │  returns dossier │  │  (non-fatal)      │
               │  + company name  │  └─────────────────-─┘
               └──────────────────┘
```

**Key invariants governing this session's fixes:**
1. A PostHog failure must never change the HTTP status returned to the client.
2. A value already in memory inside `researchCompany()` must not be re-queried in the route.
3. Any context file that documents a configuration value must be updated in the same session as the code change it describes.

---

## Part 1 — The analytics isolation fix

The original `app/api/agent/research/route.ts` POST handler looked like this before the fix:

```typescript
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } = await insforge.auth.getCurrentUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { jobId?: unknown };
    if (!body.jobId || typeof body.jobId !== "string") {
      return NextResponse.json({ success: false, error: "jobId is required" }, { status: 400 });
    }

    const { jobId } = body;
    const userId = authData.user.id;

    const dossier = await researchCompany(jobId, userId);

    await captureServerEvent({  // ← inside main try
      distinctId: userId,
      event: "company_researched",
      properties: { userId, jobId },
    });

    return NextResponse.json({ success: true, data: { companyResearch: dossier } });
  } catch (error) {
    console.error("[api/agent/research]", error);
    return NextResponse.json(
      { success: false, error: "Failed to research company" },
      { status: 500 },
    );
  }
}
```

The PostHog call is on the same try/catch level as `researchCompany()`. If `captureServerEvent()` throws — network timeout, PostHog quota exceeded, initialisation failure — the catch block fires. The client receives:
```json
{ "success": false, "error": "Failed to research company" }
```

The UI shows the error state. But the research succeeded. The dossier was already written to the DB by `researchCompany()`. The client is shown an error for a successful operation because of an analytics tracking failure.

Open the fixed [`app/api/agent/research/route.ts`](../../../app/api/agent/research/route.ts):

```typescript
const { dossier, company } = await researchCompany(jobId, userId);

try {
  await captureServerEvent({
    distinctId: userId,
    event: "company_researched",
    properties: { userId, jobId, company: company ?? "" },
  });
} catch {
  console.error("[api/agent/research] PostHog capture failed — analytics only, research succeeded");
}

return NextResponse.json({ success: true, data: { companyResearch: dossier } });
```

`researchCompany()` is called outside any `try/catch`. If it throws, it propagates to the outer try/catch and returns the error (correct — research failure is a real error). PostHog is in its own isolated `try/catch`. If it throws, the catch logs a console error and control falls through to the `return NextResponse.json(...)` line — which always runs.

> **System design — Side effect isolation:** PostHog tracking is a side effect: it doesn't change the state the client cares about, and its failure shouldn't change what the client receives. This pattern — isolating non-critical operations in their own try/catch after the core operation — appears wherever a handler has effects of unequal importance. The general form is: core operation (can throw; caller should know), then isolated side effects (can throw; caller should not know).

**Checkpoint:** The outer `try/catch` in the route still exists (wrapping auth and body validation). Why does the main try block remain, and what exactly does it still guard?

<details>
<summary>Reveal answer</summary>

The outer try/catch still guards auth (`getCurrentUser()`), body validation (`req.json()`), and the core operation (`researchCompany()`). These can all fail in ways that are meaningful errors from the client's perspective:
- Auth failure → return 401 Unauthorized
- Missing jobId → return 400 Bad Request
- `researchCompany()` throws → return 500 Failed to research company

The outer catch is appropriate for these cases because the client should know about them. PostHog is excluded because a PostHog failure is not an error the client should know about.

</details>

**Try it yourself:** Open the route file. Mentally trace what happens when `captureServerEvent()` throws `Error("PostHog unavailable")`. Which line handles it? Which line does NOT run? Which line is the last line that does run before the response is returned?

---

## Part 2 — The return type change: surfacing company without a second query

The `company_researched` event specification in `context/code-standards.md` requires `{ userId, jobId, company }`. The original route had `{ userId, jobId }` — `company` was missing.

The obvious fix: query the `jobs` table in the route to get the company name. But `researchCompany()` already queries the `jobs` table at line 1 of its execution — to get `external_apply_url`, `source_url`, `company`, and other fields used for URL derivation and synthesis. Making the route query the same row adds a second round-trip for a field that is already in memory.

Open [`agent/research.ts`](../../../agent/research.ts) — the top of `researchCompany()`:

```typescript
export async function researchCompany(
  jobId: string,
  userId: string,
): Promise<{ dossier: CompanyResearchDossier; company: string | null }> {
  const insforge = await createInsforgeServer();

  const { data: job, error: jobError } = await insforge
    .from("jobs")
    .select("id, user_id, company, title, external_apply_url, source_url, about_company")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (jobError || !job) throw new Error(`Job ${jobId} not found for user ${userId}`);

  // ... all the research logic ...

  return { dossier, company: job.company };
}
```

The `job.company` field is already fetched. Returning it costs nothing — no additional query, no additional code in `researchCompany()` beyond adding the field to the return object. The caller destructures it:

```typescript
const { dossier, company } = await researchCompany(jobId, userId);
```

> **Type theory — Algebraic return types:** Changing a function from returning `T` to returning `{ data: T; metadata: M }` is a common TypeScript pattern for surfacing co-located data without breaking the caller's type safety. TypeScript enforces that all callers update their destructuring. The pattern is sometimes called an "output bag" — when a function naturally produces multiple values during its execution, returning them in a named object is cleaner than making callers query for them independently.

**Checkpoint:** Why is `company` typed as `string | null` rather than `string`? What would happen at the DB level if a job had no company name set?

<details>
<summary>Reveal answer</summary>

The `jobs` table column `company` is nullable — it was not required when the job was ingested. When `company` is `null` in the DB, `job.company` is `null` in TypeScript. The return type reflects this. At the call site, `company ?? ""` converts `null` to an empty string for PostHog (PostHog does not accept `null` as a property value). The `??` operator handles this without throwing.

</details>

---

## Part 3 — Context file drift: the two-phase update rule

The project-review found that both `context/architecture.md` and `context/library-docs.md` still showed:
```typescript
modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",
```
after the diagnosing-bugs session had fixed `lib/stagehand.ts` to use:
```typescript
modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
```

This is context file drift: a bug was fixed in code, but the documentation describing that code was not updated in the same session.

The consequence: any future agent session reads `context/architecture.md` before writing Stagehand initialisation code. It sees the broken model name. It copies the broken model name. This reproduces a known, already-diagnosed bug without any new mistake — the agent followed the documentation faithfully.

Open the corrected [`context/architecture.md`](../../../context/architecture.md) — the Company Research Pattern section now shows:
```typescript
model: {
  // "openai/" prefix tells Stagehand to route via its OpenAI provider to https://openrouter.ai/api/v1
  modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
},
```

The same correction was made in `context/library-docs.md`.

> **System design — Documentation drift:** Context files are the authoritative reference for agent sessions. Code and documentation must be kept in sync on every change. The two-phase rule: (1) fix the code, (2) grep for the old value in all context files and update every occurrence. Both phases in the same session. Fixing one without the other leaves a trap.

**Checkpoint:** The diagnosing-bugs session fixed `lib/stagehand.ts` but not the context files. What exactly would a future agent session do differently if it read the stale docs?

<details>
<summary>Reveal answer</summary>

A future agent session tasked with any Stagehand-related work (adding a new page type to extract, changing the model, adding a timeout) would read `context/architecture.md` and `context/library-docs.md` as part of its pre-work. Both files showed `"nvidia/..."`. The agent would write new code with `"nvidia/..."` as the model name. This code would throw `UnsupportedAISDKModelProviderError` inside `conductBrowserResearch()`'s try/catch — silently, exactly as it did before the diagnosing-bugs session. The bug would be present again, with no indication of why, and the diagnosing-bugs session would need to be repeated.

</details>

---

## Part 4 — Corrupt editorial content in documentation

Lines 543–689 of `context/library-docs.md` before the fix:

```
## Company Research Section

Replace the existing Stagehand 'Company Research Pattern' section in library-docs.md with this:

### Stagehand Initialisation

```typescript
model: {
  modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",  // ← old broken form
  ...
}
\`\`\`

Usage: stagehand.extract({ instruction, schema })  // ← old object form (wrong)
```

This block was an instruction to update the file — written by an LLM as part of a content generation task — that was accidentally committed as document content rather than applied and deleted. The file now contained its own edit instructions.

Two specific dangers:
1. The block showed the broken model name (`"nvidia/..."`) — the same name fixed in the diagnosing-bugs session. An agent reading the corrupt block would regenerate the broken name.
2. The block showed `stagehand.extract({ instruction, schema })` — the old object form. The correct form is positional: `stagehand.extract(instruction, schema)`. The object form does not throw a TypeScript error; it runs at runtime but Stagehand ignores unknown object properties and returns empty results. This is a particularly dangerous bug because it silently fails.

The fix was line-range deletion:
```python
new_lines = lines[:542] + lines[689:]
```
The correct content (added earlier in the file) was already present. The corrupt block was pure noise.

> **System design — Self-referential documentation:** Editorial instructions ("Replace this section with...", "Update the following...") must never be present in committed documentation. When an LLM generates both the instruction and the replacement content in a single output, the committing agent must apply the replacement and delete the instruction framing before writing the file. Any documentation file containing self-referential text is corrupt.

**Checkpoint:** Why doesn't TypeScript catch `stagehand.extract({ instruction, schema })` if that form is wrong?

<details>
<summary>Reveal answer</summary>

Stagehand's `extract()` type signature accepts an object with `instruction` and `schema` properties as one of its overloads — the library supports both the object form and the positional form for compatibility. TypeScript sees a valid object argument and accepts the call. The bug only surfaces at runtime when Stagehand parses the arguments: in the version installed in this project, the positional form is required and the object form's properties are silently ignored, causing extraction to return empty results. TypeScript cannot catch runtime argument handling differences between overloads.

</details>

---

## Part 5 — Token budget analysis for JSON synthesis

Before the fix, `agent/research.ts` `synthesizeDossier()` had:
```typescript
max_tokens: 800,
```

The dossier schema has 9 fields. Consider a minimum-viable dossier response:
- `companyOverview` — 2 sentences: ~60 tokens
- `techStack` — 4 items × 3 tokens: ~12 tokens
- `culture` — 3 items × 8 tokens: ~24 tokens
- `whyThisRole` — 2 sentences: ~50 tokens
- `yourEdge` — 3 items × 15 tokens: ~45 tokens
- `gapsToAddress` — 3 items × 15 tokens: ~45 tokens
- `smartQuestions` — 4 items × 20 tokens: ~80 tokens
- `interviewPrep` — 4 items × 20 tokens: ~80 tokens
- `sources` — 3 URLs × 20 tokens: ~60 tokens
- `researchedAt` — ISO timestamp: ~10 tokens
- JSON structural overhead (keys, brackets, quotes, commas): ~80 tokens

**Minimum total: ~546 tokens.** Realistic maximums (longer arrays, more verbose fields) reach 1000–1400 tokens. 800 was between the minimum and the realistic maximum — it worked sometimes and failed other times, making the bug intermittent rather than consistent.

The fix: `max_tokens: 2000`. This provides comfortable headroom (1.5–2x the realistic maximum) without approaching model context limits.

> **System design — Token budget estimation:** Setting `max_tokens` by feel or convention (800 sounds reasonable) is unreliable for structured JSON responses. The correct process: enumerate every field, estimate maximum realistic content in tokens, add JSON structural overhead, then add 30–50% headroom. The headroom exists because token estimates are averages — actual outputs vary based on how verbose the model is on any given run.

**Checkpoint:** The `?? "{}"` fallback in the original code (`JSON.parse(content ?? "{}")`) was removed and replaced with an explicit throw. What was wrong with producing an empty object as a silent fallback?

<details>
<summary>Reveal answer</summary>

`JSON.parse("{}")` produces an empty object. Every field accessed from it returns `undefined`. The dossier would be saved to the DB with all string fields as `""` (or `null`) and all array fields as `[]`. The UI would render successfully — no error — but every section would show empty content. The user would see a blank dossier with no indication that anything went wrong. The explicit throw makes the failure visible in the server log and triggers the route's catch block to return a proper error. Empty content from Nemotron signals a real problem (API key issue, rate limiting, model unavailability) that should not be silently swallowed.

</details>

---

## Part 6 — Conditional URL rendering and external link security

Before the fix, `CompanyResearch.tsx` rendered sources as plain text:
```tsx
{research.sources.map((src, i) => (
  <li key={i} className="text-xs text-text-muted truncate">{src}</li>
))}
```

Open [`components/job-details/CompanyResearch.tsx`](../../../components/job-details/CompanyResearch.tsx) at the sources section:

```tsx
{research.sources.map((src, i) => {
  const isUrl = src.startsWith("http://") || src.startsWith("https://");
  return isUrl ? (
    <li key={i}>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-muted hover:text-text-secondary underline-offset-2 hover:underline transition-colors block truncate"
      >
        {src}
      </a>
    </li>
  ) : (
    <li key={i} className="text-xs text-text-muted truncate">{src}</li>
  );
})}
```

The `isUrl` guard: `src.startsWith("http://") || src.startsWith("https://")`. This is a prefix check, not URL parsing. Why:
- `new URL(src)` throws on invalid input — you need a try/catch just to check
- The prefix check is synchronous, O(1), and has no failure mode
- It correctly handles the case where Nemotron includes a non-URL string in the sources array (a page title, a fragment, a description)

The security attributes:
- `rel="noopener"` — removes `window.opener` reference from the new tab. Without it, the external page can navigate the original tab (tab-napping attack).
- `rel="noreferrer"` — suppresses the `Referer` HTTP header. Without it, the external site receives the full URL of the page that linked to it.

Both are combined as `rel="noopener noreferrer"`. While modern browsers (Chrome 88+, Firefox 79+) set `noopener` automatically on cross-origin `_blank` links, the explicit attribute is the reliable cross-browser guarantee.

> **OS fundamentals — Browser security model:** The browser's opener/referrer model exists to share context between tabs for legitimate use cases (OAuth flows, popups). `noopener` and `noreferrer` opt out of this sharing for external links where that context sharing is a liability, not a feature. Every `target="_blank"` to an external origin should carry both attributes.

**Checkpoint:** A source string is `"Check their blog at engineering.stripe.com"`. What does the code render for it — a link or plain text?

<details>
<summary>Reveal answer</summary>

Plain text. The string does not start with `http://` or `https://`. `isUrl` is `false`. The code renders the plain `<li>` branch. This is the correct behaviour — rendering it as `<a href="Check their blog at engineering.stripe.com">` would create a broken relative link on the current page. Non-URL strings from Nemotron are common when the model includes contextual notes alongside actual URLs in the sources array.

</details>

---

## Full data flow: what happens when PostHog fails

```
User clicks "Research Company"
  │
  ▼
POST /api/agent/research { jobId }
  │
  ├─ Auth check (outer try) ────────────────── fails → 401 Unauthorized
  │
  ├─ Body validation (outer try) ───────────── fails → 400 jobId is required
  │
  ├─ researchCompany(jobId, userId) ─────────────────────────────────────┐
  │   ├─ DB query for job row                                            │
  │   ├─ Hyperbrowser session + Stagehand init                           │
  │   ├─ conductBrowserResearch() [has own try/catch — never throws]     │
  │   ├─ synthesizeDossier() → dossier                                   │
  │   ├─ DB write: jobs.company_research = dossier                       │
  │   └─ return { dossier, company: job.company }          ◄────────────┘
  │                              │
  │    IF researchCompany throws → outer catch → 500 "Failed to research company"
  │
  ├─ captureServerEvent() [own isolated try/catch]
  │   └─ IF throws → console.error (logged, NOT propagated)
  │
  └─ return { success: true, data: { companyResearch: dossier } }
       │
       ▼
  Client: setResearch(dossier) → dossier sections rendered
```

The key: `researchCompany()` completing successfully moves control past the main try block entirely. PostHog's own catch does not affect `return NextResponse.json(...)`. The client always receives the dossier if research succeeded, regardless of whether PostHog succeeded.

---

## Extend it (challenges)

**Challenge 1 — Trace the PostHog isolation** (15–20 min)

Open `app/api/agent/research/route.ts`. Trace the exact JavaScript execution path when `captureServerEvent()` throws `Error("PostHog quota exceeded")`. Write out each line that executes, in order, and the value of the HTTP response returned. Then trace the path when `researchCompany()` throws the same error. How do the two paths differ?

<details>
<summary>Hint</summary>

Start at the `const { dossier, company } = await researchCompany(...)` line. Map which try/catch each subsequent line is inside, and which catch handler fires in each scenario.

</details>

---

**Challenge 2 — Add `jobTitle` to the PostHog event** (20–30 min)

`code-standards.md` adds a hypothetical new required property: `company_researched` now requires `{ userId, jobId, company, jobTitle }`. Apply the return-type extension pattern from Part 2 to surface `job.title` from `researchCompany()` without an additional DB query. Update the return type, the return statement, the route destructuring, and the PostHog call. Run `npm run build` to confirm TypeScript is satisfied.

<details>
<summary>Hint</summary>

The `job` row in `researchCompany()` already selects `title` in the `.select()` call. You only need to add `jobTitle: job.title` to the return object and update the return type accordingly.

</details>

---

**Challenge 3 — Design a context file validation check** (30–45 min)

The review found stale model names in two context files after the diagnosing-bugs session. Design a simple bash or Node script that: (1) reads the current `modelName` value from `lib/stagehand.ts`, (2) greps for any occurrence of a Nemotron model name in `context/` files, (3) flags any occurrence that doesn't match the canonical value from the code. This is a "docs drift detector" for the specific pattern of model name mismatches.

What are the edge cases? What happens if the model name changes format? Would this script be worth running as part of `npm run lint`?

<details>
<summary>Hint</summary>

Start with `grep -r "nemotron" context/` to see all occurrences. Then write a script that extracts the `modelName` from `lib/stagehand.ts` using `grep` or `sed`, and compares it against the occurrences in context files. The main edge case is model name format changes — a regex might be more robust than exact string matching.

</details>

---

For deeper exploration, `docs/project-review/13-company-research-agent/ai-discussion-topics.md` has 15 questions covering PostHog event contracts, analytics isolation, context file integrity, and URL rendering security. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
