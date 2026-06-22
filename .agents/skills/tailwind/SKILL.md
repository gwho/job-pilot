---
name: tailwind
description: Tailwind CSS v4 build-time patterns for Next.js using PostCSS. Use when working with Tailwind utility classes, adding CSS-first theme tokens via @theme in globals.css, debugging v3 vs v4 syntax, or configuring Tailwind in Next.js projects.
---

# Tailwind CSS for Next.js (Build-Time v4)

This project uses Tailwind v4 with build-time compilation via PostCSS in Next.js. All design tokens are defined in `app/globals.css` using the `@theme` directive.

## When To Use

- Working with Tailwind utility classes in React/Next.js components
- Adding or modifying design tokens in `app/globals.css`
- Debugging Tailwind v3 vs v4 syntax differences
- Configuring Tailwind build integration with PostCSS
- Understanding CSS-first token definition with `@theme`

## Build Integration

This project uses Tailwind v4 with Next.js and PostCSS:

- **PostCSS config:** `postcss.config.mjs` with `@tailwindcss/postcss` plugin
- **CSS entry:** `app/globals.css` with `@import "tailwindcss"`
- **Token definition:** All tokens defined in `@theme` directive in `app/globals.css`
- **Build-time compilation:** Tailwind processes during Next.js build, not at runtime

## Tailwind v4 CSS-First Configuration

Tailwind v4 uses CSS-first configuration in `app/globals.css`:

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  /* Colors */
  --color-accent: #7c5cfc;
  --color-background: #f6f7fb;

  /* Fonts */
  --font-sans: "Inter", sans-serif;

  /* Spacing */
  --spacing-custom: 32rem;

  /* Radius */
  --radius-md: 8px;
}

/* Custom utilities (optional) */
@utility headline-balance {
  text-wrap: balance;
  letter-spacing: 0;
}
```

**Important v4 differences from v3:**

1. Use `@import "tailwindcss"` instead of `@tailwind base/components/utilities`
2. Define tokens in `@theme` block, not in `tailwind.config.ts`
3. Custom tokens in `tailwind.config.ts` are IGNORED in v4 CSS-first projects
4. Tailwind v4 automatically generates utility classes from `@theme` variables

## Usage in Next.js Components

Use Tailwind utility classes directly in React components:

```tsx
// app/page.tsx
export default function Page() {
  return (
    <div className="bg-background text-text-primary">
      <h1 className="text-3xl font-semibold">
        Welcome to JobPilot
      </h1>
      <p className="text-text-secondary mt-2">
        Track your job applications
      </p>
    </div>
  );
}
```

**Best practices:**

1. Use project tokens from `@theme` instead of raw Tailwind color classes
2. Never use hardcoded hex values like `bg-[#F6F7FB]`
3. Use complete class names, not dynamically constructed strings
4. Prefer utility classes over custom CSS

## Dynamic Classes

Avoid dynamically constructing class names:

```tsx
// Bad: Tailwind cannot detect these classes at build time
<div className={`bg-${color}-500`} />

// Good: Use complete class names with conditional logic
<div className={color === 'red' ? 'bg-error' : 'bg-success'} />

// Good: Use data attributes with Tailwind variants
<div data-status={status} className="data-[status=error]:bg-error data-[status=success]:bg-success" />
```

## Common v4 Syntax Updates

Tailwind v4 introduces several syntax changes from v3:

- Opacity: Use `bg-blue-500/50` instead of `bg-blue-500 bg-opacity-50`
- Border colors: Explicit colors required, e.g., `border border-border` not just `border`
- Updated utility names: Check v4 docs for renamed utilities
- CSS variables: Direct support for `var()` in arbitrary values

## PostCSS Configuration

Minimal PostCSS setup required for Next.js:

```javascript
// postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

No additional configuration needed. Tailwind v4 Oxide engine automatically detects content and generates CSS.

## References

- Tailwind CSS v4 documentation: https://tailwindcss.com/docs
- Next.js Tailwind integration: https://nextjs.org/docs/app/building-your-application/styling/tailwind-css
- Project token reference: `app/globals.css`
