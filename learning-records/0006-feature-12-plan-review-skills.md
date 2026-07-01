# Feature 12 — Plan Review Skills Established

**Date:** 2026-07-01  
**Related lessons:** 0007, 0008, 0009, 0010  
**Related reference:** reference/0004-feature-12-cheat-sheet.html

---

## What was established this session

Through the Feature 12 teach series, the user now has a complete, grounded review methodology for Server Component detail page features.

### New durable review skills

**1. Next.js 16 params trap awareness**
The `params: Promise<{ id: string }>` shape must be awaited. TypeScript does not catch the missing await. The symptom is universal silent 404s. This is a specific class of bug that only appears at runtime — the review question is: "Does the plan show `await params` or the sync pre-16 pattern?"

**2. Two-filter security rule**
Any per-user resource query requires BOTH `.eq("id", id)` and `.eq("user_id", authData.user.id)`. A plan showing only the ID filter has a broken authorisation boundary. Return 404 (not 403) to avoid revealing existence of other users' records.

**3. Null-handling decision framework**
Three strategies — hide entirely, show "—", show empty state message — each has a decision rule:
- Hide when: element has no meaningful null state (badges, conditional cards)
- Show "—" when: element's position in a layout must be preserved (info grid cells)
- Show message when: users expect content in a named section (skills card, description)
- Never invent a default (null job_type → "—", not "Full-time")

**4. Stretched link vs onClick navigation**
Stretched `<Link>` gives native `<a>` semantics (right-click, middle-click, screen reader support). `onClick + router.push` is a wrong pattern for table rows. The `after:z-1` Tailwind v4 canonical class is required to win the stacking order over other cell content.

**5. source_url vs external_apply_url distinction**
`source_url` = the aggregator listing page. `external_apply_url` = the employer's ATS. Apply Now should use `external_apply_url ?? source_url`. A plan that uses only `source_url` for Apply Now adds an unnecessary extra click.

**6. C-E-C review frame**
For any plan decision: Claim (what did the plan decide?) → Evidence (what in the codebase supports or contradicts it?) → Consequence (what breaks if it's wrong?). Applied consistently across all 5 plan decisions reviewed this session.

**7. Verification limits**
Build proves type safety, not runtime correctness. Tests prove utilities and non-regression, not new components. Smoke tests prove golden path, not edge cases. A good verification plan names specific edge cases to test, not just "it builds and tests pass."

---

## What to revise or build on next

- The plan review checklist (reference/0004) covers Server Component + per-user data patterns. The next review extension should cover Client Component features (when `"use client"` is justified, when useState vs server state is correct) — likely needed for Feature 13 (Company Research Client Component).
- The fake-plan critique exercise (lesson 0010) showed 5 recurring failure modes. When reviewing future plans, use these as a quick scan before applying the full checklist.
