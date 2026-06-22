---
title: Use Existing Tokens from globals.css @theme
impact: CRITICAL
impactDescription: Ensures visual consistency, enables global updates
tags: tokens, design-tokens, tailwind, colors, spacing, consistency
---

## Use Existing Tokens from globals.css @theme

Only use color, spacing, and other values that are defined in the `@theme` directive in `globals.css`. Tailwind v4 uses CSS-first configuration, not TypeScript token files.

**Token categories available:**

- **Colors**: `background`, `surface`, `surface-secondary`, `border`, `text-primary`, `text-secondary`, `accent`, `success`, `info`, `warning`, `error`
- **Spacings**: Standard Tailwind spacing scale (`0`, `px`, `0.5`, `1`, `1.5`, `2`, `2.5`, `3`, `4`, `5`, `6`, `8`, `10`, `12`, etc.)
- **Border radius**: `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`, `radius-full`

**Incorrect (using non-token values):**

```tsx
// DON'T: Using arbitrary hex colors
<div className="bg-[#1a1a1a] text-[#939393]">Content</div>

// DON'T: Using non-standard spacing
<div className="p-[13px] m-[7px]">Content</div>

// DON'T: Using arbitrary font sizes
<span className="text-[15px]">Text</span>
```

**Correct (using design tokens):**

```tsx
// DO: Use token-based colors
<div className="bg-surface text-text-primary">Content</div>

// DO: Use token-based spacing
<div className="p-3 m-2">Content</div>

// DO: Use token-based font sizes
<span className="text-sm">Text</span>
```

**Token reference location:**

- All tokens are defined in `app/globals.css` using the `@theme` directive
- Check `app/globals.css` for the complete list of available tokens
