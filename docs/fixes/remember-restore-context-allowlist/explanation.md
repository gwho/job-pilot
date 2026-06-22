# Fix Explanation — Remember Restore Context Allowlist

## Context

The remember skill has two modes:

- `/remember save` writes a compact handoff to `memory.md`.
- `/remember restore` reads that handoff at the start of a later session.

Restore Mode also has a defensive allowlist so the agent does not wander through unrelated files while trying to reconstruct state.

## The gap

The allowlist included generic files like `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and `context.md`, but it did not include the project-specific context files under `context/`.

That meant a strict reading of the restore instruction would skip the same files that the workspace rules say must be read before implementation.

## The fix

The fix keeps the allowlist model and adds the nine required project context files as explicit allowed reads.

The order matches `AGENTS.md` so session restoration builds context from broad product intent through implementation rules and current progress.

## Behavior after the fix

When `/remember restore` runs, the agent should:

1. Read `memory.md`.
2. Read the nine `context/` files if present.
3. Read the existing generic agent instruction files if present.
4. Stop and summarize what was restored before building.

## Verification

The edited section was re-read after the change, and the diff showed only the added context-file allowlist entries.
