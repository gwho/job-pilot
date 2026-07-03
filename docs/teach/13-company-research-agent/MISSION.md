# Mission — Feature 13: Company Research Agent

## Why you're learning this

You built Feature 13 — an agent that browses a company's website, extracts structured data, and synthesises a personalised dossier. You want to understand *why* it's built the way it is: why three separate tools, why Nemotron appears twice, why some errors are swallowed and some propagate, and why the cleanup order in `finally` matters.

The goal is not to memorise the code. The goal is to be able to read any future agent feature and immediately understand its structure — what each layer owns, how data flows between layers, and where failures are contained vs. surfaced.

## What success looks like

You can:
- Trace the complete path from "Research Company" button click to dossier render without reading the code
- Explain why Hyperbrowser, Stagehand, and Nemotron each do their specific job and not someone else's
- Predict what breaks and what survives when any single component fails
- Write a new extraction layer or synthesis step that fits naturally into the existing architecture

## Lesson plan

| # | Topic | Exercise |
|---|-------|----------|
| 1 | Why three tools for one job | Explain the cleanup path |
| 2 | The fallback chain — deriving a homepage URL | Build a fallback-chain table |
| 3 | Stagehand extraction — Zod schemas as contracts | Predict a schema failure |
| 4 | Nemotron synthesis — JSON mode and token budgets | Trace the request path |
| 5 | PostHog isolation — side effects that must not fail | Write a regression test idea |
| 6 | The full picture — one click to one dossier | Add a safe source-link helper |
