# Fix Plan — Tailwind v4 Performance Reference

## Problem

`.claude/skills/tailwind-css-patterns/references/performance.md` still showed Tailwind v3-era configuration examples:

- `tailwind.config.js` with a `content` array
- `jit: true`
- `purge` / PurgeCSS configuration
- explicit `postcss.config.js` plugin wiring with `tailwindcss` and `autoprefixer`

Those patterns conflict with the project’s Tailwind v4 CSS-first guidance.

## Fix

Replace the v3 examples with Tailwind v4 examples that use:

- `@import "tailwindcss"`
- `@source` for external packages or dynamic safelists
- `@theme` for design tokens
- v4 auto-detection language instead of manual content/purge configuration

## Why this fix

The reference should teach the same approach the project uses. Tailwind v4 auto-detects template files and has JIT built in, so the old examples would lead agents toward obsolete configuration.

## Verification

- Searched the file for `content:`, `jit:`, `purge:`, `PurgeCSS`, `postcss.config`, and `require('tailwindcss')`.
- Ran `git diff --check`.
