# Teaching Decisions — Tutorial 24: Company Research Agent

This file documents the structural and pedagogical decisions made while writing Tutorial 24, for future reference when writing tutorials in this series or when revising Tutorial 24.

---

## 1. Why 8 Parts instead of fewer

Feature 13 has an unusually high density of independent technical concepts — each with its own learning objective, CS connection, and failure mode. Compressing them into 5 Parts would force the reader through multiple distinct concepts per Part, reducing checkpoint opportunities and making the tutorial harder to use as a reference.

The 8 Parts map directly to 8 teachable decisions documented in `explanation.md`:
- Part 1: CDP + Hyperbrowser client/session (what the cloud browser provides)
- Part 2: Stagehand configuration (the `env: "LOCAL"` trap)
- Part 3: URL derivation (fallback chain algorithm)
- Part 4: Nullable cleanup (RAII pattern)
- Part 5: Synthesis unconditional (graceful degradation invariant)
- Part 6: Zod extraction (schema-as-contract)
- Part 7: Source deduplication + PostHog null (Set, captureServerEvent pattern)
- Part 8: useState init from prop (React data update pattern)

Each Part has exactly one primary concept and one primary CS callout block. Eight Parts is the right number for eight separable concepts — not a formatting choice.

---

## 2. Why CDP is explained before Stagehand

Part 1 (Hyperbrowser) establishes what a `wsEndpoint` is and why it is a CDP URL before Part 2 (Stagehand) uses it. A reader who hits `cdpUrl: session.wsEndpoint` in Part 2 without the CDP context would not understand why connecting Stagehand to a WebSocket URL makes it control a remote browser. The dependency is conceptual: Part 1 is prerequisite to Part 2.

This differs from the code's declaration order — `lib/hyperbrowser.ts` and `lib/stagehand.ts` are siblings at the `lib/` level, neither imports the other. The tutorial's ordering is pedagogical, not structural.

---

## 3. Why the URL fallback chain is its own Part (not merged with browser research)

`deriveHomepageUrl()` is called before the browser block and has no dependency on Stagehand or Hyperbrowser. Teaching it as part of browser research would blur the distinction between "what URL do we go to" and "how do we navigate there." The fallback chain exercises a distinct algorithm pattern (try-catch waterfall) that deserves its own treatment and CS callout (Algorithms — Fallback chain).

Keeping Part 3 separate also makes Challenge 1 more focused: a reader can trace `deriveHomepageUrl()` without needing to understand Stagehand.

---

## 4. Why the RAII Part (4) precedes the invariant Part (5)

Part 4 establishes the cleanup pattern (nullable variables, finally block, cleanup order). Part 5 then explains why browser research is inside a try/catch while synthesis is outside one. A reader who doesn't understand the cleanup pattern first would not understand why the finally block matters to the invariant.

The conceptual dependency: "how to clean up" (Part 4) → "why the cleanup is inside a boundary that synthesis is outside" (Part 5).

---

## 5. Question placement — all 18 woven into Parts, none in a quiz section

All 18 questions from `ai-discussion-topics.md` were placed as `**Checkpoint:**` blocks inside the Part that covers the concept they test. The tutorial skill's rules prohibit a standalone quiz section — questions must follow immediately after the concept explanation they probe.

The mapping required grouping the 18 questions across 8 Parts unevenly: some Parts have 2 checkpoints, some have 3. This follows the concept density, not an even distribution.

Questions from Group 3 (URL derivation) and Group 4 (error handling) were split across multiple Parts:
- URL derivation questions → Parts 3 and 4 (redirect resolution in Part 3, partial init in Part 4)
- PostHog null error question → Part 7 (synthesis + PostHog)
- useState question → Part 8

---

## 6. Why Part 2 documents the model name fix explicitly

The `"openai/"` prefix on `modelName` is a non-obvious implementation detail that is easy to lose when the file is read months later. It looks like a prefix on the provider name rather than a routing instruction to Stagehand's provider system. Part 2 explains the parsing logic and documents the original bug (`"nvidia/"` subProvider) and fix (`"openai/"` subProvider + OpenRouter routing).

This is the only Part that documents a bug fix rather than a design choice. Including it is justified because:
1. It is directly relevant to understanding why the code looks the way it does
2. It is a trap anyone touching `lib/stagehand.ts` could fall into again
3. It connects to the broader lesson from `explanation.md`: read installed `.d.ts` types, not docs

---

## 7. Why Challenge 3 is a design exercise, not a code exercise

Challenge 3 (Re-research overwriting a better dossier) has no "correct" implementation — it depends on product requirements. Framing it as a coding exercise would push the reader toward an implementation before they have thought through the trade-offs. The challenge is structured as:

1. Answer four design questions first
2. Implement only if you have time

This follows the pattern established by Challenge 3 in Tutorial 23 (job details page), which also had a design component. Challenges at difficulty level 3 in this series are expected to require reasoning, not just execution.

---

## 8. The LLM pre-study primer covers CDP before any tutorial code

The five LLM pre-study topics are ordered so the reader builds mental models before reading code, not alongside it:

1. CDP + WebSockets (the protocol underlying everything in Parts 1 and 2)
2. RAII in JavaScript (the pattern in Part 4)
3. Fallback chains (the algorithm in Part 3)
4. AI extraction with Zod (the API in Part 6)
5. useState init from prop (the React pattern in Part 8)

This ordering roughly follows the tutorial's Part sequence. A reader who completes the five pre-study topics in order before opening the tutorial will arrive at each Part with the relevant mental model already established.

The pre-study topics do not reveal the implementation — they only build the underlying concepts. The reader must discover the application in the tutorial itself.

---

## 9. The end-to-end trace uses Stripe as the example company

The full data flow trace in "Section 6 — Full data flow" uses `Stripe` as the example company because:
- `stripe.com` is a real, well-known homepage that anyone can visualise
- `jobs.stripe.com` is a realistic `external_apply_url` format
- The subdomain stripping (`jobs.stripe.com` → `stripe.com`) is a concrete, verifiable example of `normalizeToRootDomain()` removing the `jobs` subdomain
- Stripe uses multiple backend languages (Ruby, Scala, Go) which produces a realistic multi-item `technologies` array

The trace was written to exercise all three URL derivation steps (Step 1 succeeds — removes the `jobs` subdomain), the full Hyperbrowser and Stagehand flow, the Set deduplication (Stripe homepage appears in both `raw.sources` and `visitedUrls`), and the `setResearch()` call in the component.
