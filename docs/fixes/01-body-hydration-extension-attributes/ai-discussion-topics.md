# Fix 01 — Body Hydration Extension Attributes — AI Discussion Topics

Use these prompts to understand the concepts behind the plan more deeply.

## React Hydration

- "Explain React hydration in Next.js App Router. What exactly is React comparing when it reports a hydration mismatch?"
- "What is the difference between a text hydration mismatch and an attribute hydration mismatch?"
- "Why does React say some hydration mismatches will not be patched up?"
- "What kinds of bugs can hydration warnings reveal in real applications?"

## Browser Extensions and DOM Mutation

- "How can browser extensions mutate server-rendered HTML before React hydrates it?"
- "Why do extensions like Grammarly add attributes to the body element?"
- "How can I confirm whether a hydration warning is caused by a browser extension or by my own code?"
- "What is the best debugging workflow for reproducing extension-related frontend issues?"

## `suppressHydrationWarning`

- "What does `suppressHydrationWarning` do in React, and what does it not do?"
- "Why should `suppressHydrationWarning` be applied narrowly instead of broadly?"
- "When is `suppressHydrationWarning` appropriate, and when is it a code smell?"
- "Does `suppressHydrationWarning` fix a mismatch or only silence the warning? Explain with examples."

## Next.js Root Layout

- "How does `app/layout.tsx` work in the Next.js App Router?"
- "Why must the root layout include `<html>` and `<body>` tags?"
- "Why should a root layout usually remain a Server Component?"
- "How does `next/font/google` integrate with the root layout and hydration?"

## Debugging Practice

- "Given a hydration mismatch stack trace, walk me through a systematic debugging checklist."
- "How do I search a codebase for common hydration hazards like `Date.now()`, `Math.random()`, and `typeof window`?"
- "How should I verify a hydration fix in both extension-enabled and clean browser profiles?"
- "What follow-up checks should I run after changing a Next.js root layout?"
