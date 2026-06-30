# 0003 — Lesson Depth Preference

**Date:** 2026-06-29

## Key insight

The user explicitly asked for lesson 0004 to not be abridged compared to the tutorial file. This means:
- Full coverage of all six concepts in the tutorial (not summaries)
- Real code traces for each concept, not just one overview snippet
- Exercise files as separate HTML documents (not inline activities only)
- External resource links organised by concept, not listed at the end as an afterthought
- Retrieval checks per concept section, not just one or two at the end

## What to avoid in future lessons

The first version of lesson 0001 covered six concepts in ~500 words with a single quiz question. The user flagged this as "much too abridged." Future comprehensive lessons should match the depth of the tutorial files they are based on — one concept per section, code + explanation + retrieval check in each section.

## When a "short lesson" is appropriate

Short single-concept lessons (like lesson 0001's revised form covering URL state + the guard pattern) remain appropriate for focused topics. The length should match the scope, not a default length preference.

## Exercise files

The user asked for "extra exercise files" — separate HTML files in an `exercises/` directory. These are distinct from inline quiz questions. Exercises should require the user to work with the actual codebase (open files, run commands, make predictions) rather than reading-only quizzes.
