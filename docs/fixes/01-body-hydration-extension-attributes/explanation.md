# Fix 01 — Body Hydration Extension Attributes — Deep Explanation

This document explains the plan for fixing the reported hydration warning and the reasoning behind each decision.

## 1. What hydration means here

Next.js sends server-rendered HTML to the browser first. React then hydrates that HTML, which means it attaches event handling and reconciles the existing DOM with the React tree expected by the client.

Hydration assumes the DOM the browser has at hydration time still matches what the server rendered. If something changes the DOM before React hydrates, React can report a mismatch.

In this case, the server rendered:

```tsx
<body className="min-h-full bg-background">{children}</body>
```

But the browser DOM contained extra attributes:

```text
data-new-gr-c-s-check-loaded="14.1302.0"
data-gr-ext-installed=""
```

React sees those attributes on the client DOM but not in the server-rendered React tree.

## 2. Why this looks like a browser extension issue

The attribute names in the error are not JobPilot attributes. They are associated with Grammarly's browser extension:

- `data-new-gr-c-s-check-loaded`
- `data-gr-ext-installed`

The project search did not find those strings in app code. The layout also does not contain common app-side hydration hazards such as:

- `Date.now()`
- `Math.random()`
- locale-dependent date formatting
- `if (typeof window !== "undefined")`
- invalid document nesting

That makes the likely cause external DOM mutation before React hydration, not a bug in the homepage components.

## 3. Why the plan uses `suppressHydrationWarning`

React provides `suppressHydrationWarning` for cases where a specific element may legitimately differ between the server HTML and the browser DOM during hydration.

Next's local docs describe this as a way to tell React to accept an unavoidable DOM difference on a specific element. The important detail is scope: the prop should be placed only on the element where the unavoidable difference occurs.

The reported diff points directly at `<body>`, so the proposed change is:

```tsx
<body className="min-h-full bg-background" suppressHydrationWarning>
  {children}
</body>
```

This keeps the suppression at the document-shell boundary where the extension injects attributes.

## 4. Why not disable SSR or make the layout a Client Component

The root layout should stay a Server Component. Making it a Client Component would go against the project's Next.js standards and would be a much larger architectural change than the problem requires.

The current layout is doing the right things:

- imports Inter through `next/font/google`
- applies the font variable on `<html>`
- applies the page background on `<body>`
- renders deterministic document structure

The issue is not that SSR is wrong. The issue is that an extension mutates the root document before hydration.

## 5. Why not remove the Grammarly attributes with JavaScript

A cleanup script could remove the Grammarly attributes before hydration, but that creates extra moving parts:

- it adds client-side runtime work
- it mutates the document during the most sensitive hydration window
- it depends on extension-specific implementation details
- it can become stale if the extension changes attribute names

The proposed fix is smaller and more robust: tell React to tolerate unavoidable differences on the exact element where the extension mutation appears.

## 6. What this fix does not hide

The plan intentionally avoids putting `suppressHydrationWarning` on application components. Hydration warnings inside child UI should still surface.

Examples that should still be treated as real bugs:

- homepage text differs between server and client
- a component renders different markup after `typeof window` branching
- generated IDs differ between server and client
- invalid HTML nesting causes React to rebuild a subtree
- user-specific data is rendered without a stable server snapshot

This fix is only for root document attributes injected outside the app.

## 7. How to verify the diagnosis

The verification needs two browser states:

1. Browser with Grammarly enabled
2. Browser with extensions disabled

If the warning only appears with Grammarly enabled and points to the same `<body>` attributes, the diagnosis is confirmed.

After adding `suppressHydrationWarning` to `<body>`, the warning should disappear in the Grammarly-enabled browser. The clean browser should remain free of hydration warnings. That second check matters because it confirms the app itself is not creating another mismatch.

## 8. Future rule of thumb

Hydration warnings should not be blindly suppressed. First identify the mismatch location and determine whether the difference is app-owned or external.

Use suppression only when:

- the difference is unavoidable
- the difference is limited to one element
- the app still renders correct UI
- a cleaner deterministic render is not available

For app-owned mismatches, fix the render logic instead.
