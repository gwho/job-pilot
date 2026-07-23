# Diagnosis — Company Research Synthesis Recovery (Issue #38)

## Starting point

The session did not start from a live crash — it started from `docs/debug/debug-ideas.md`, a pre-written debug brief already containing the failure site, two real production error strings, and a suggested skill order. The diagnosis work was to turn that brief into a red, deterministic, agent-runnable loop before touching any implementation — not to rediscover the bug from scratch.

Evidence handed in:

```text
[api/agent/research] SyntaxError: Unterminated string in JSON
    at JSON.parse
    at synthesizeDossier (agent/research.ts:266:20)
```

```text
[api/agent/research] SyntaxError: Unexpected token 'T',
"The user w"... is not valid JSON
    at JSON.parse
    at synthesizeDossier (agent/research.ts:266:20)
```

Failure site: `synthesizeDossier()` in `agent/research.ts`, called `JSON.parse(rawContent) as Record<string, unknown>` with no try/catch, no `finish_reason` check, and no runtime shape validation. The error propagates uncaught through `researchCompany()` to `app/api/agent/research/route.ts`'s outer `catch`, which turns it into a generic 500 ("Failed to research company").

## Feedback loop

```bash
npm run test:run -- __tests__/agent/research-synthesis.test.ts
```

The file did not exist. Built new, targeting `researchCompany()` (the public export) rather than `synthesizeDossier()` (unexported, would have required exporting an internal function just for tests). External boundaries mocked: `openai` (module-level, matching the `agent/extractor.ts` test precedent), `@/lib/hyperbrowser`, `@/lib/stagehand`, `@/lib/insforge-server`.

**Minimisation decision**: the test job fixture has no `company`, `source_url`, or `external_apply_url`. This makes `deriveHomepageUrl()` return `""`, which makes `researchCompany()`'s `if (homepageUrl)` guard skip browser research entirely — reaching `synthesizeDossier()` directly with default empty `content`, the same path production already takes whenever browser research legitimately finds nothing. This cut Hyperbrowser/Stagehand interaction simulation out of the loop entirely while still exercising the real bug's call chain. `lib/hyperbrowser`/`lib/stagehand` were still mocked (not left real) specifically so the suite would fail loudly, not silently make a network call, if that assumption ever broke.

First run (before any fix): **7 of 8 tests red**, at `agent/research.ts:266:20` in every case. Two of the seven reproduced the **exact production error text**:

```
SyntaxError: Expected ',' or ']' after array element in JSON at position 54
SyntaxError: Unexpected token 'T', "The user w"... is not valid JSON
```

The second one is a byte-for-byte match to the brief's captured production log line. Runtime: 1.3s.

### A false lead inside the loop itself

The first attempt at the test file produced misleading results — a test expected to fail on "prose input" instead failed on "wrong call count," and a "wrong shape" test threw the *previous* test's prose error instead of a shape-validation error. Root cause: `vi.clearAllMocks()` in `beforeEach` resets call history but **not queued `mockResolvedValueOnce()` values**. A test where the buggy code only calls `create()` once (because it throws before reaching a would-be second call) leaves that second queued response sitting in the mock's queue, where it gets consumed by the *next* test's first call instead. Fixed by adding `mocks.create.mockReset()` (which does clear the queue) alongside `vi.clearAllMocks()`, without resetting the `openai` module's constructor mock (a separate `vi.fn()` set via `mockImplementation` inside the `vi.mock()` factory, unaffected by resetting a different mock object). See `resolution.md` for why this is a generalisable lesson, not just a one-off fix.

## Hypotheses (ranked, evidence-based — not diagnosed blind)

1. **Output hits `max_tokens: 2000` mid-object, `finish_reason: "length"`.** High confidence — the dossier prompt requests 9 fields including 6 free-text arrays; production's truncation positions (3679, 4001 chars) are consistent with a verbose response cut off around a 2000-token budget.
2. **Provider doesn't reliably honor `response_format: { type: "json_object" }`.** High confidence, directly evidenced — the literal fragment `"The user w..."` reads like model reasoning/preamble leaking through despite JSON-mode being requested (a known behavior on some OpenRouter free-tier routes).
3. **Prompt too verbose for the current output budget.** Same underlying pressure as #1, not a separate cause.
4. **Valid JSON, wrong shape.** Not seen in the two production log lines, but the pre-fix code had zero runtime shape validation at all (`as Record<string, unknown>`), so it was a real latent risk even though unconfirmed by production evidence.
5. **Non-length stop reason (e.g. content filter).** No evidence either way in the logs; lowest priority, cheap to handle generically regardless.

No additional `[DEBUG-...]` instrumentation was added (Phase 4 of `/diagnosing-bugs`) — the red loop already reproduced the literal production error text, which is stronger confirmation than metadata logging would have added. See `resolution.md` for the reasoning behind skipping that phase.
