# Fix Plan — Remember Restore Context Allowlist

## Problem

`/remember restore` told agents to read `memory.md` and then only a short allowlist of generic agent files.

That blocked the nine required project context files in `context/`, even though `AGENTS.md` requires those files to be read before implementation work.

## Fix

Update `.claude/skills/remember/SKILL.md` so Restore Mode explicitly allows these files in order:

1. `context/project-overview.md`
2. `context/architecture.md`
3. `context/ui-tokens.md`
4. `context/ui-rules.md`
5. `context/ui-registry.md`
6. `context/code-standards.md`
7. `context/library-docs.md`
8. `context/build-plan.md`
9. `context/progress-tracker.md`

## Why this fix

The restore skill should rebuild enough session context to continue safely. These files are the project's canonical context set, so they need to be explicit exceptions to the "do not scan other files" rule.

## Verification

- Confirmed all nine context files exist.
- Re-read the edited allowlist and verified the order.
- Checked the diff was limited to the restore allowlist.
