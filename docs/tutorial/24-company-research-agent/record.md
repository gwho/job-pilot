# Tutorial Session Record — Tutorial 24: Company Research Agent

## Session scope

Converted the Feature 13 documentation into Tutorial 24 of the project's tutorial series. The `/tutorial` skill was invoked with the following sources:

- `docs/plan/13-company-research-agent/` (plan.md, explanation.md, ai-discussion-topics.md)
- `docs/architect/13-company-research-agent/` (architect-plan.md, decisions.md, discussion.md, ai-discussion-topics.md)
- The Feature 13 codebase (all implementation files)

## Output

**Written:** `docs/tutorials/24-company-research-agent/README.md`

---

## Source files read

| File | Read for |
|------|----------|
| `docs/plan/13-company-research-agent/plan.md` | File inventory, key invariants |
| `docs/plan/13-company-research-agent/explanation.md` | Deep technical decisions to convert into Parts |
| `docs/plan/13-company-research-agent/ai-discussion-topics.md` | 18 questions woven as Checkpoints |
| `docs/tutorials/23-job-details-page/README.md` | Most recent tutorial — style reference, prerequisite chain |
| `docs/tutorials/22-find-jobs-repeated-search/README.md` | Second most recent — style reference |
| `lib/hyperbrowser.ts` | Part 1 verbatim code |
| `lib/stagehand.ts` | Part 2 verbatim code |
| `agent/research.ts` | Parts 3, 4, 5, 6, 7 verbatim code |
| `app/api/agent/research/route.ts` | Part 7 PostHog pattern |
| `components/job-details/CompanyResearch.tsx` | Part 8 verbatim code |
| `types/index.ts` | Type references |

---

## Tutorial structure

**Number:** 24  
**Slug:** `24-company-research-agent`  
**Title:** Company Research Agent: Cloud Browsers, Fallback Chains, and Graceful Degradation  
**Prerequisites:** Tutorial 23 (job details page), Tutorial 17 (Adzuna job discovery / agent architecture)

**8 Parts:**

| Part | Title | Primary file |
|------|-------|-------------|
| 1 | Remote browser sessions: what Hyperbrowser provides | `lib/hyperbrowser.ts` |
| 2 | Connecting Stagehand to an external browser: the `env: "LOCAL"` pattern | `lib/stagehand.ts` |
| 3 | Deriving a homepage URL: the three-step fallback chain | `agent/research.ts` (deriveHomepageUrl) |
| 4 | Nullable cleanup in `finally`: safe resource teardown | `agent/research.ts` (researchCompany cleanup) |
| 5 | The "never empty" invariant: synthesis always runs | `agent/research.ts` (researchCompany body) |
| 6 | AI extraction with Zod: schemas, optional fields, and sub-page selection | `agent/research.ts` (conductBrowserResearch) |
| 7 | Synthesis, source deduplication, and the PostHog null error | `agent/research.ts` (synthesizeDossier) + route.ts |
| 8 | Client state update: `useState(initialResearch)` vs `router.refresh()` | `components/job-details/CompanyResearch.tsx` |

**CS concepts table (6 entries):**

| Concept | Category |
|---------|----------|
| RAII — Resource Acquisition Is Initialization | Design patterns |
| Fallback chain / multi-step graceful degradation | Algorithms |
| Set for O(1) deduplication | Data structures |
| Graceful degradation invariant | System design |
| CDP — Chrome DevTools Protocol | OS fundamentals |
| Zod schema as extraction contract | Type theory |

**Questions mapped:** All 18 questions from `ai-discussion-topics.md` were placed as Checkpoint blocks inside the relevant Parts. No standalone quiz section — all questions embedded inline.

**LLM pre-study topics (5):**
1. Remote browser control and WebSockets (CDP fundamentals)
2. RAII and resource cleanup in finally blocks
3. Fallback chains and defensive URL resolution
4. AI-powered structured extraction from web pages
5. useState initialized from a server-fetched prop

**Challenges:**
1. Trace Stagehand model routing through `LLMProvider.getClient()` (15–20 min)
2. Add a `confidence: "high" | "medium" | "low"` field to the dossier (20–30 min)
3. Design a "Re-research" strategy that protects against overwriting a better dossier (30–45 min)

---

## Series context

Tutorial 24 is the first in the series to cover cloud browser sessions and CDP. No prior tutorial has explained WebSocket-based browser control, Stagehand, or remote page extraction. These concepts are fully introduced here. All prior tutorials on the agent layer (17 — Adzuna discovery) are referenced for the `logAgentError` pattern and InsForge server client, but not recapped.
