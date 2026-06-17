# Diff Audit Template

Use this folder as a model for future audits.

Recommended structure:

```text
docs/diff/<feature-slug>/
├── README.md
├── ai-discussion-topics.md
└── deeper-review-inputs.md
```

## README.md

Include:

- Date.
- Verdict.
- Checklist of claimed changes.
- Layer 1 — Plan alignment.
- Layer 2 — System integrity.
- Layer 3 — Production readiness.
- Beginner-friendly explanation.
- Verification run.
- Final assessment.

## ai-discussion-topics.md

Include prompts that help the developer learn concepts connected to the audit.

## deeper-review-inputs.md

Include the extra evidence that would make the next audit more precise:

- Runtime logs.
- Screenshots.
- Network traces.
- Backend configuration.
- Acceptance criteria.
- Manual QA notes.
