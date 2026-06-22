# Fix 01 — Body Hydration Extension Attributes — Plan

## Problem

React reports a hydration attribute mismatch in `app/layout.tsx` on the root `<body>` element.

The mismatched attributes are:

```text
data-new-gr-c-s-check-loaded="14.1302.0"
data-gr-ext-installed=""
```

These attributes are commonly injected by the Grammarly browser extension before React hydrates the page. They are not rendered by the JobPilot server output and are not present in `app/layout.tsx`.

## Goal

Remove the noisy development console error for known extension-injected root document attributes without hiding real hydration bugs inside the application UI.

## Diagnosis

- `app/layout.tsx` renders deterministic HTML.
- The root layout does not use `Date.now()`, `Math.random()`, locale formatting, browser-only branches, or invalid nesting.
- A repo search found no app code that renders `data-new-gr-c-s-check-loaded` or `data-gr-ext-installed`.
- The mismatch occurs on `<body>`, before application components render.
- The safest project-side mitigation is a narrowly scoped `suppressHydrationWarning` on the root document element that receives extension mutations.

## Proposed Code Change

Update `app/layout.tsx` so the `<body>` accepts unavoidable first-level attribute differences:

```tsx
<body className="min-h-full bg-background" suppressHydrationWarning>
  {children}
</body>
```

Do not add `"use client"` to `app/layout.tsx`. The layout should remain a Server Component.

## Why This Scope

`suppressHydrationWarning` only suppresses warnings for the element where it is applied. Placing it on `<body>` targets the exact location shown in the error while preserving normal hydration warnings in child components.

This is preferable to adding client-side cleanup scripts because cleanup scripts mutate the document before React hydrates, add runtime work, and can create their own mismatch behavior.

## Verification Steps

1. Start the development server with `npm run dev`.
2. Open `/` in a browser with the Grammarly extension enabled.
3. Confirm the reported `<body>` hydration attribute warning no longer appears.
4. Open the same page in a private browser profile or with extensions disabled.
5. Confirm there are no hydration warnings in the clean browser profile.
6. Run the usual static checks for the project, likely `npm run lint` and `npm run build` if available.

## Guardrails

- Do not suppress hydration warnings on broad application containers such as `<main>` or homepage sections.
- Do not add browser-only conditionals to the layout.
- Do not add client scripts that remove extension attributes.
- If future hydration errors mention app-owned components or text content, investigate them normally instead of assuming they are extension related.

## Expected Result

The Grammarly-injected body attributes stop producing a distracting development warning, while real hydration mismatches in JobPilot components remain visible.
