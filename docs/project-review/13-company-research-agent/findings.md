# Findings — Feature 13: Company Research Agent

---

## Finding 1 — PostHog event missing a required property

**Severity: Important**

### What was wrong

`app/api/agent/research/route.ts` fired the `company_researched` event with:
```typescript
await captureServerEvent({
  distinctId: userId,
  event: "company_researched",
  properties: { userId, jobId },
});
```

`context/code-standards.md` defines this event as requiring `{ userId, jobId, company }`. The `company` property was missing.

### Why it violates the standard

`code-standards.md` is the authoritative list of PostHog events and their required properties. Properties documented there are needed for PostHog dashboard analysis — a missing `company` property means every `company_researched` event arrives with no company name attached, making the event useless for any company-level analysis (e.g., "which companies have been researched most", "which companies led to applications").

### Why `company` could not come from the client

The route accepts only `jobId` from the client body (validated as a string). Accepting `company` from the client would open a trust boundary: any client could send an arbitrary company name. The company name must be derived server-side — fetched from the job row, which is already scoped to `user_id`.

### The correct pattern

Instead of adding a second DB query in the route, `researchCompany()` already fetches the job row to get `external_apply_url` and `company`. The fix was to return both the dossier and the company from `researchCompany()`:

```typescript
// agent/research.ts
export async function researchCompany(
  jobId: string,
  userId: string,
): Promise<{ dossier: CompanyResearchDossier; company: string | null }> {
  // ...
  return { dossier, company: job.company };
}
```

The route destructures the result and passes `company` to the event. No additional query needed; no trust boundary crossed.

### How to recognise this in future code

Any PostHog `captureServerEvent()` call — compare the `properties` object against the `code-standards.md` table. Every defined property is required; missing one is a silent spec violation that only shows up in analytics.

---

## Finding 2 — PostHog capture inside the main try block

**Severity: Important**

### What was wrong

The PostHog capture was awaited inside the same `try/catch` that guards `researchCompany()`:

```typescript
try {
  const { dossier, company } = await researchCompany(jobId, userId);
  await captureServerEvent({ ... });  // ← inside the same try
  return NextResponse.json({ success: true, data: { companyResearch: dossier } });
} catch (error) {
  console.error("[api/agent/research]", error);
  return NextResponse.json({ success: false, error: "Failed to research company" }, { status: 500 });
}
```

### Why this is wrong

If `captureServerEvent()` throws (PostHog network timeout, quota exceeded, initialisation failure), the catch block runs and returns HTTP 500 with `success: false`. The client shows the error state: "Failed to research company." But the research succeeded — the dossier was already saved to the DB by the time PostHog was called.

This is a disproportionate failure: analytics tracking, a non-critical side effect, kills the user's research result.

### The correct pattern

Analytics calls that are not part of the core operation must be isolated in their own try/catch:

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

The PostHog failure is logged but does not affect the response.

### The general rule

Any call that is a side effect of the core operation — logging, analytics, audit trails — should be wrapped in its own try/catch. Failure of a side effect must never change the HTTP status returned to the client. The question to ask: "If this line throws, should the client see an error?" If no, it must be isolated.

### How to recognise this in future code

In any route handler, scan for `captureServerEvent()` calls. If they are inside the main try block alongside the core operation, they need to be extracted.

---

## Finding 3 & 4 — Stale model names in context files

**Severity: Important (both)**

### What was wrong

Both `context/architecture.md` and `context/library-docs.md` showed:
```typescript
modelName: "nvidia/nemotron-3-ultra-550b-a55b:free",
```

The actual working code in `lib/stagehand.ts` uses:
```typescript
modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
```

The stale form (`"nvidia/..."`) is the exact bug that caused the diagnosing-bugs session: Stagehand parses the first `/` as a provider separator, interprets `"nvidia"` as the sub-provider, finds it unsupported, and throws `UnsupportedAISDKModelProviderError`. This error was caught silently inside `conductBrowserResearch()`.

### Why this matters

Context files are the reference that future agent sessions read before writing code. If `context/architecture.md` shows the wrong model name, the next agent session that touches Stagehand configuration will copy the broken form. This creates a regression cycle: fix the bug, forget to update the docs, reproduce the bug in the next session.

### The rule

When a bug fix changes a configuration value that is also documented in context files, both the code and the context files must be updated in the same session. Fixing one without the other leaves a trap.

### Recognising this in future code

After any bug fix that changes a constant, model name, API shape, or configuration parameter: grep for the old value in `context/`. If it appears, update it.

---

## Finding 5 — Corrupt editorial note in library-docs.md

**Severity: Important**

### What was wrong

Lines 543–689 of `context/library-docs.md` contained:
```
## Company Research Section

Replace the existing Stagehand 'Company Research Pattern' section in library-docs.md with this:

[...new section content...]
```

This was an instruction to the file author — meant to be acted upon and then deleted — that was instead appended verbatim to the file and committed. The document now contained its own edit instructions as content. It also included the old `stagehand.extract({ instruction, schema })` object form, which was already superseded elsewhere in the same file.

### Why this is a serious problem

Any agent reading `library-docs.md` would see both the correct pattern (in the pre-543 content) and the old pattern (in the corrupt block), plus the editorial note "Replace the existing section with this." An agent might reasonably interpret this as an instruction to apply and execute the replacement — introducing the wrong API shape into production code.

The corrupt block specifically promoted `stagehand.extract({ instruction, schema })` (object form). The actual working Stagehand API takes positional arguments: `stagehand.extract(instruction, schema)`. The object form throws at runtime.

### How this happens

During a session where an LLM generates documentation updates, the output includes both the instruction framing ("Replace X with Y") and the replacement content. If the agent applies only the content and not the instruction context, the framing text gets written to the file alongside the content. Careful review of context file changes before committing would catch this.

### Recognising this in future code

Before reading `context/library-docs.md` as authoritative, scan for self-referential phrases: "Replace...", "Update this section...", "This section needs to be changed...". These indicate uncommitted edit instructions, not document content.

---

## Finding 6 — Wrong max_tokens and temperature in library-docs.md

**Severity: Important**

### What was wrong

`context/library-docs.md` documented:
- Company research synthesis max_tokens: 800
- Temperature: a single `0.3` value for all Nemotron calls

The working code:
- Company research synthesis max_tokens: 2000 (changed in the diagnosing-bugs session)
- Temperature: 0.3 for matching/scoring/extraction; 0.4 for company research synthesis

### Why 800 was wrong

The dossier schema has 9 fields: two are multi-sentence strings, four are arrays of 3–8 items. Even the minimum-viable output (short sentences, three items per array) exceeds 800 tokens in JSON-encoded form. The original value was set by intuition rather than schema analysis.

### Why temperature is split

0.3 (low) is used for deterministic tasks: match scoring, data extraction, resume analysis. Variation hurts reproducibility here. 0.4 is used for synthesis tasks like company research where the output needs to be grounded but must make real connections between scraped content and the candidate's profile. Slightly higher variation produces more useful insight.

### Why docs must match working code

Future agent sessions use the documented values as the canonical source when writing or regenerating code. If `library-docs.md` says max_tokens is 800, an agent will write 800. That agent will produce code that reproduces a known bug.

---

## Finding 7 — Source URLs as plain text

**Severity: Minor**

### What was wrong

In `CompanyResearch.tsx`, `research.sources` was rendered as:
```tsx
{research.sources.map((src, i) => (
  <li key={i} className="text-xs text-text-muted truncate">{src}</li>
))}
```

Sources are expected to be URLs. Plain text means the user cannot click to open a source — they must copy and paste.

### The correct pattern

Sources are conditionally rendered as links based on whether the string starts with `http://` or `https://`:
```tsx
const isUrl = src.startsWith("http://") || src.startsWith("https://");
return isUrl ? (
  <a href={src} target="_blank" rel="noopener noreferrer" className="...">
    {src}
  </a>
) : (
  <li className="...">{src}</li>
);
```

The prefix check is the correct guard: it is fast, explicit, and safe. `new URL(src)` would also work but throws on invalid input and is slower. The `rel="noopener noreferrer"` pair is required for all `target="_blank"` links to prevent tab-napping and referrer leakage.

### Recognising this in future code

Any time a DB-sourced string is rendered in JSX and could be a URL, check whether it should be a link. If it should, apply the `http://`/`https://` prefix guard before creating an `<a>` tag.
