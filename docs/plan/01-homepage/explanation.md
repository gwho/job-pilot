# Feature 01 — Homepage — Deep Explanation

This document explains the reasoning behind every significant decision in the homepage build. It is written for learning — the goal is to understand not just *what* was built, but *why* each choice was made.

---

## 1. Why is the homepage all Server Components?

In Next.js 16 with the App Router, every component is a **React Server Component (RSC)** by default. You have to opt *into* client-side rendering with `"use client"` — not out of it.

Server Components:
- Render on the server and send plain HTML to the browser
- Ship zero JavaScript to the client (for the component itself)
- Can be async and fetch data directly without `useEffect`
- Cannot use `useState`, `useEffect`, browser APIs, or event handlers

The homepage has no interactivity — every element is a static link or static text. There is no reason to add `"use client"` anywhere. This means the entire page is pre-rendered as HTML, which is faster to load and better for SEO.

**The mental model:** Think of Server Components as the server equivalent of static HTML templates. They run once on the server and produce HTML. Client Components are interactive islands that run in the browser.

---

## 2. Why named exports everywhere (except `page.tsx`)?

`code-standards.md` requires named exports for all components. This means:

```tsx
// Correct
export function Navbar() { ... }

// Not used in this project
export default function Navbar() { ... }
```

**Why named exports?**
- They make imports explicit: `import { Navbar } from "@/components/layout/Navbar"` tells you exactly what you're importing
- Refactoring tools (rename, find references) work more reliably with named exports
- No accidental "I imported the wrong default export" bugs
- The component name is always clear, not aliased at the import site

The one exception is `app/page.tsx` — Next.js *requires* a default export for page files. That's a framework constraint, not a project choice.

---

## 3. Why Tailwind utility classes instead of raw CSS?

This project uses **Tailwind CSS v4** with the `@theme` directive. All design tokens (colors, radii) are defined once in `globals.css` and Tailwind automatically generates utility classes from them.

```css
/* globals.css */
@theme {
  --color-accent: #7c5cfc;
}
```

This makes `bg-accent`, `text-accent`, `border-accent` all valid utility classes.

**Why not write `background-color: var(--color-accent)` in a CSS file?**

1. Tailwind utility classes are composable in JSX — you see the styles right next to the markup
2. Tailwind's purging removes unused styles from the production bundle
3. Consistency — the tokens file is the single source of truth, not scattered CSS files

**Why never use `bg-purple-500` (Tailwind's built-in colors)?**

Those are Tailwind's default color palette, which don't match the design. Using `bg-accent` instead means if the design system ever changes the purple, you update one line in `globals.css` and every component updates automatically.

---

## 4. How does `next/image` work and why is it required?

The `<Image>` component from `next/image` is not the same as a plain `<img>` tag. It does four things automatically:

1. **Serves modern formats** — converts images to WebP (smaller file size)
2. **Resizes for device** — serves a smaller image on mobile, larger on desktop
3. **Prevents layout shift** — reserves space for the image before it loads (uses the `width`/`height` props to calculate aspect ratio)
4. **Lazy loads** — only loads images when they scroll into view

The `priority` prop on the Hero image disables lazy loading for that specific image. Why? Because it's at the top of the page and will definitely be visible immediately — lazy loading it would actually make it *slower* since the browser has to wait to start loading it.

**Why must you always provide `width` and `height`?**

Without them, the browser doesn't know how much space to reserve for the image before it loads, causing layout shift (CLS — Cumulative Layout Shift), which hurts Core Web Vitals scores.

---

## 5. Why is there a private `Section` component inside `HowItWorks.tsx`?

`HowItWorks` has two sections that share the exact same grid+column layout — they only differ in which side the image is on and what the text content is.

Instead of duplicating the JSX twice, a private `Section` component was created inside the same file:

```tsx
function Section({ heading, points, imageSrc, imageAlt, imageLeft }) { ... }
```

It is *not* exported — `export` is only on `HowItWorks`. This follows the "one public export per file" rule while still avoiding repetition.

This is a key pattern: **extract into a private helper component when the same JSX structure appears more than once in a file, but don't export it unless another file needs it.**

---

## 6. Why does `BottomCTA` use an inline `style` for the gradient?

The gradient background (`linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)`) cannot be expressed as a Tailwind utility class — Tailwind doesn't know how to generate gradient utilities for custom CSS variables at this complexity level.

The rules say: "No inline styles — all styling via Tailwind classes using CSS variables from ui-tokens.md."

But the spirit of the rule is "never hardcode hex values." The inline style here uses `var(--color-accent)` and `var(--color-overlay)` — CSS variable references, not hex values. So this is compliant: the colors still come from the design token system.

This distinction matters:

```tsx
// Compliant — references CSS variables (the values can change in one place)
style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)' }}

// Not compliant — hardcoded hex (if the design changes, you have to find every instance)
style={{ background: 'linear-gradient(135deg, #7c5cfc 0%, #111827 100%)' }}
```

---

## 7. Why does `Features` come before `HowItWorks` in `page.tsx`?

Looking at the design, the feature cards appear higher on the page than the alternating image+text sections. The three value-prop cards give visitors a quick scannable summary before they dive into the product demo screenshots in HowItWorks.

The design hierarchy is:
1. **Hero** — "what is this?" + visual proof (screenshot)
2. **Features** — "what does it do?" in 3 bullet points
3. **HowItWorks** — "show me how" with real product screenshots
4. **Testimonial** — social proof
5. **BottomCTA** — conversion

This is a standard SaaS landing page structure: hook → value props → demo → proof → action.

---

## 8. Why is the max-width `1440px` and not `container` from Tailwind?

The design specifies a 1440px maximum page width. The project defined this as a rule in `ui-rules.md`:

> Page max-width: 1440px, centered

Tailwind's built-in `container` class uses breakpoint-based widths (`max-w-screen-xl` etc.) which don't map to 1440px. Using `max-w-[1440px]` sets it exactly. This is an acceptable use of Tailwind's arbitrary value syntax because it's specifying a layout constraint, not a color.

---

## 9. What is the `@/` import alias and why is it used?

`@/` maps to the root of the project. Instead of:

```tsx
import { Navbar } from "../../../components/layout/Navbar"
```

You write:

```tsx
import { Navbar } from "@/components/layout/Navbar"
```

The `@/` path is always absolute from the project root, so it's the same from any file regardless of directory depth. This is configured in `tsconfig.json` (Next.js sets it up automatically).

The code standards require using `@/` for any import that would go more than one level up with relative paths.

---

## 10. How does the page hierarchy work in Next.js App Router?

```
app/
  layout.tsx    ← wraps everything (html, body, Inter font, bg-background)
  page.tsx      ← the "/" route
```

`layout.tsx` renders once and wraps all routes. It sets:
- The `<html lang="en">` with Inter font variable
- The `<body>` with `min-h-full bg-background`

`page.tsx` for the "/" route renders inside the `<body>` automatically. That's why `page.tsx` doesn't need to include `<html>` or `<body>` — they're already there from `layout.tsx`.

When you navigate to `/dashboard`, the `layout.tsx` wrapper stays in place (no re-render) and only the inner `page.tsx` changes. This is the App Router's layout nesting system.
