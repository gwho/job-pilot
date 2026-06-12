# Plan 01 — globals.css Setup

## What This Plan Does

Sets up `app/globals.css` with the full Tailwind v4 design token system for JobPilot, and updates `app/layout.tsx` to use the Inter font. This is the foundation layer — every component in the project depends on these tokens being in place before any styling can be written.

---

## Files Changed

| File | What Changed |
|------|-------------|
| `app/globals.css` | Replaced malformed scaffold with full `@theme` token block |
| `app/layout.tsx` | Replaced Geist font with Inter, updated metadata, added `bg-background` to body |

---

## Core Concept: Tailwind v4 Is CSS-First

In Tailwind v3, you configured your design system in a JavaScript file:

```js
// tailwind.config.js (v3 — NOT used in this project)
module.exports = {
  theme: {
    extend: {
      colors: {
        accent: "#7c5cfc",
      },
    },
  },
};
```

In Tailwind v4, that entire approach is gone. Configuration lives in your CSS file using the `@theme` directive:

```css
/* globals.css (v4 — what this project uses) */
@import "tailwindcss";

@theme {
  --color-accent: #7c5cfc;
}
```

Tailwind v4 reads the CSS, finds your `@theme` variables, and automatically generates utility classes from them. No build config file. No JavaScript. Just CSS.

**Why this matters:** If you ever add a `tailwind.config.ts` to this project, your custom colors defined there will be silently ignored in v4. All tokens must live in `globals.css`.

---

## How `@theme` Works

`@theme` does two things simultaneously:

**1. Emits CSS custom properties on `:root`**

This declaration:
```css
@theme {
  --color-accent: #7c5cfc;
}
```

Causes Tailwind to output:
```css
:root {
  --color-accent: #7c5cfc;
}
```

So `var(--color-accent)` works anywhere in your CSS or inline styles.

**2. Generates utility classes**

The same declaration also causes Tailwind to generate these utility classes:
- `bg-accent` → `background-color: var(--color-accent)`
- `text-accent` → `color: var(--color-accent)`
- `border-accent` → `border-color: var(--color-accent)`
- `ring-accent` → `--tw-ring-color: var(--color-accent)`

The naming convention is: strip the `--color-` prefix, and the rest becomes the class suffix.

**The token naming rules for this project:**

| Prefix | What it generates |
|--------|------------------|
| `--color-*` | Color utilities (`bg-*`, `text-*`, `border-*`) |
| `--font-*` | Font family utilities (`font-sans`, `font-mono`) |
| `--radius-*` | Border radius utilities (`rounded-sm`, `rounded-md`) |

---

## How CSS Custom Properties Work

CSS custom properties (also called CSS variables) are defined with `--` prefix and referenced with `var()`:

```css
:root {
  --color-accent: #7c5cfc;
}

.button {
  background-color: var(--color-accent); /* resolves to #7c5cfc */
}
```

**The cascade rule:** CSS custom properties follow the normal CSS cascade. A variable defined on an element overrides one defined on a parent:

```css
:root {
  --color-text: #101828; /* default for entire page */
}

.card {
  --color-text: #6a7282; /* overrides just inside .card */
  color: var(--color-text); /* uses #6a7282 */
}
```

This is exactly how next/font interacts with the `@theme` font token (see next section).

---

## How next/font + @theme Work Together

This project uses two font declarations that might seem to conflict:

**In `@theme` (globals.css):**
```css
--font-sans: "Inter", sans-serif;
```

**In `layout.tsx`:**
```typescript
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Applied to <html> via inter.variable className
```

They don't conflict — they work in layers:

1. `@theme` emits `--font-sans: "Inter", sans-serif` on `:root` as a fallback
2. `next/font` generates a CSS class that sets `--font-sans` to an optimized local font stack (with proper fallbacks and `font-display: swap`)
3. Applying `inter.variable` to `<html>` means the next/font value is set on the `<html>` element
4. Because element-level variables override `:root` variables in the cascade, next/font wins for actual rendering

The result: the `font-sans` Tailwind class resolves to next/font's optimized Inter stack, not the literal `"Inter", sans-serif` string. You get performance-optimized font loading automatically.

**Why use `variable: "--font-sans"` specifically?** It matches the `@theme` token name exactly, so `font-sans` Tailwind class and `var(--font-sans)` in custom CSS both resolve to the next/font value without any extra configuration.

---

## The Token Catalog

All 40 tokens defined in this project's `globals.css`:

### Page Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `bg-background` | `#f6f7fb` | Page background (applied to `<body>`) |
| `bg-surface` | `#ffffff` | Cards, panels |
| `bg-surface-secondary` | `#f9fafb` | Table rows hover, secondary areas |
| `bg-surface-tertiary` | `#f2f5f7` | Input backgrounds, subtle fills |
| `bg-surface-muted` | `#f4f5fb` | Muted panel backgrounds |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border-border` | `#e7eaf3` | Default border (cards, inputs, table rows) |
| `border-border-light` | `#e5e7eb` | Lighter dividers |
| `border-border-muted` | `#dfe1e7` | Subtle separators |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `text-text-primary` | `#101828` | Headings, primary body text |
| `text-text-secondary` | `#6a7282` | Labels, secondary content |
| `text-text-muted` | `#99a1af` | Placeholders, timestamps, hints |
| `text-text-dark` | `#364153` | Nav items (inactive) |
| `text-text-darkest` | `#111827` | Logo text |

### Accent (Purple — Primary Brand Color)

| Token | Value | Usage |
|-------|-------|-------|
| `bg-accent` | `#7c5cfc` | Primary buttons, active nav items |
| `text-accent` | `#7c5cfc` | Active nav text, purple text |
| `bg-accent-light` | `#f3e8ff` | Badge backgrounds |
| `bg-accent-muted` | `#faf5ff` | Missing skills badges |
| `text-accent-foreground` | `#ffffff` | Text on purple backgrounds |

### Success (Green)

| Token | Value | Usage |
|-------|-------|-------|
| `text-success` | `#10b981` | Match score bars (high), positive states |
| `bg-success-light` | `#d0fae5` | Matched skill badge backgrounds |
| `bg-success-lightest` | `#ecfdf5` | High match status backgrounds |
| `text-success-foreground` | `#007a55` | Text on success backgrounds |
| `text-success-darker` | `#009966` | Trend badge text |

### Info (Blue)

| Token | Value | Usage |
|-------|-------|-------|
| `text-info` | `#61a8ff` | Info states, resume tailoring chart |
| `bg-info-light` | `#dbeafe` | Info badge backgrounds |
| `text-info-foreground` | `#155dfc` | Text on info backgrounds |

### Warning / Error / Brand

| Token | Value | Usage |
|-------|-------|-------|
| `text-warning` | `#ff8904` | Match score bars (medium), warnings |
| `text-error` | `#ef4444` | Destructive states |
| `text-linkedin` | `#0a66c2` | LinkedIn badge text |
| `bg-linkedin-light` | `#dce6f1` | LinkedIn badge background |

### Border Radius

| Token | Value | Tailwind class |
|-------|-------|---------------|
| `--radius-sm` | `4px` | `rounded-sm` |
| `--radius-md` | `8px` | `rounded-md` |
| `--radius-lg` | `12px` | `rounded-lg` |
| `--radius-xl` | `16px` | `rounded-xl` |
| `--radius-full` | `9999px` | `rounded-full` (pill shapes) |

---

## Common Mistakes to Avoid

**Never use hardcoded hex values in className:**
```tsx
// Wrong
<div className="bg-[#7c5cfc]">

// Correct
<div className="bg-accent">
```

**Never use raw Tailwind color classes:**
```tsx
// Wrong — these are Tailwind's built-in colors, not project tokens
<div className="bg-purple-500 text-gray-600">

// Correct — project tokens only
<div className="bg-accent text-text-secondary">
```

**Never define colors in tailwind.config.ts:**
```typescript
// Wrong — ignored in Tailwind v4
// tailwind.config.ts
theme: { extend: { colors: { accent: "#7c5cfc" } } }

// Correct — define in globals.css @theme only
```

**Never use `@theme inline` for the main theme block:**

The `@theme inline` variant is a different directive that makes variables available as inline styles rather than CSS custom properties. The standard `@theme {}` is what this project uses for token generation.

---

## Verification Checklist

After this setup, verify in browser DevTools:

1. **`:root` has all CSS vars** — Open Elements → Computed → search `--color-accent` → should be `#7c5cfc`
2. **Page background is gray** — `<body>` background should be `#f6f7fb`, not white
3. **Inter font loads** — Network tab → Fonts → should see Inter requests from `fonts.gstatic.com`
4. **Token classes work** — Add `<div className="bg-accent text-accent-foreground p-4">test</div>` to a page → should render purple with white text

---

## AI Discussion Topics

These questions will deepen your understanding of what was built. Take them to Claude one at a time — each one opens a full conceptual area.

### 1. The CSS Cascade and Custom Properties
> "How does the CSS cascade work with CSS custom properties, and why does next/font's `--font-sans` override the `@theme` one?"

What you'll learn: CSS specificity, why element-level variables beat `:root` variables, how inheritance works for custom properties, why `initial` and `inherit` behave differently for custom properties vs regular properties.

### 2. Tailwind v4 Directives
> "What is the difference between `@theme`, `@layer`, and `@utility` in Tailwind v4, and when do I use each?"

What you'll learn: `@theme` for design tokens, `@layer` for organizing your own CSS without specificity conflicts, `@utility` for creating new utility classes, how they interact with Tailwind's generated output.

### 3. Why Tailwind Went CSS-First
> "Why did Tailwind move from a JavaScript config file to a CSS-first approach in v4?"

What you'll learn: Build performance (scanning JS config is slow), the PostCSS compilation model, native CSS features that made JS config unnecessary, toolchain simplification, why the ecosystem is moving toward CSS-native solutions.

### 4. CSS Cascade Layers
> "What are CSS cascade layers (`@layer`) and how does Tailwind v4 use them internally?"

What you'll learn: `@layer base`, `@layer components`, `@layer utilities` — how they flatten specificity within each layer, why a utility class beats a component class without needing `!important`, how you can inject your own styles between Tailwind's layers.

### 5. PostCSS and the Build Pipeline
> "How does PostCSS fit into the build pipeline, and what does `@tailwindcss/postcss` actually do?"

What you'll learn: PostCSS as a CSS transformation framework, how `@tailwindcss/postcss` scans your JSX/TSX files for class names at build time, how it generates only the CSS you actually use (tree-shaking for CSS), why no `tailwind.config.ts` is needed in v4.

### 6. Design Token Systems
> "What is a design token system, and why does this project forbid hardcoded hex values?"

What you'll learn: Design tokens as a single source of truth, how tokens create a contract between design and engineering, what happens to a codebase when hex values are scattered everywhere (token drift), how tokens enable theming (dark mode, brand variants) without touching component code.

### 7. next/font Performance
> "How does next/font/google improve performance compared to importing fonts from Google Fonts in CSS?"

What you'll learn: The Google Fonts CDN roundtrip cost, how next/font downloads the font at build time and self-hosts it, `font-display: swap` and its effect on layout shift (CLS), font subsetting to reduce file size, the `size-adjust` property for preventing layout shift during font swap.
