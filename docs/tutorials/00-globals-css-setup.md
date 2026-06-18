# Tutorial 00 — Tailwind v4 CSS & Design Tokens Setup

**After completing this tutorial you will understand:** how Tailwind v4 uses a CSS-First paradigm to manage configuration, how CSS Custom Properties are registered on `:root` and parsed into utility classes, how `next/font` loads and overlays fonts in the cascade, and how to correctly apply these tokens in components while avoiding common styling anti-patterns.

> [!NOTE]
> **Prerequisites:** Familiarity with Next.js, basic React, and running `npm run dev`. You should have the project open in your editor so you can look at [app/globals.css](file:///Users/jessejames/Desktop/job-pilot/app/globals.css) and [app/layout.tsx](file:///Users/jessejames/Desktop/job-pilot/app/layout.tsx).

---

## How To Use An LLM Before This Tutorial

Use a separate LLM session as a 10-minute warm-up before reading the real files. Ask for
small isolated examples first, then come back to `app/globals.css` and `app/layout.tsx`
to map those ideas onto JobPilot.

Prompt 1:

```text
Teach me Tailwind v4 CSS-first configuration from scratch.
Compare @theme in CSS with a Tailwind v3 tailwind.config.js file.
Give me one tiny example where --color-accent generates bg-accent and text-accent.
Then quiz me with 3 short questions.
```

Prompt 2:

```text
Explain CSS custom properties and the cascade using a font variable.
Use this example: :root defines --font-sans, then an html class overrides --font-sans.
Ask me to predict which value wins and why.
```

Practice before continuing:

- Explain why JobPilot uses `bg-accent` instead of `bg-purple-500`.
- Predict what happens if `inter.variable` is removed from `<html>`.
- Say why design tokens belong in `app/globals.css`, not component class strings.

---

## The Concept Architecture

This diagram shows how design tokens are defined in the CSS layer, translated by the compiler, and combined with Next.js optimized fonts:

```
globals.css (@theme block)
  ├─ Emits native CSS Custom Properties on :root (e.g., --color-accent)
  ├─ Generates Tailwind Utility Classes (e.g., bg-accent, text-accent)
  └─ Declares font fallback: --font-sans: "Inter", sans-serif;
  
layout.tsx (React layout shell)
  ├─ Imports next/font/google Inter Loader
  ├─ Sets inter.variable class name on <html> (e.g., --font-sans: 'Inter_Variable', ...)
  └─ Sets bg-background class name on <body>
  
Cascade Resolution:
  Element-level --font-sans (from layout.tsx) overrides :root fallback (from globals.css)
```

---

## 1. Tailwind v4's CSS-First Configuration

In Tailwind v3, configuration lived in `tailwind.config.js` or `tailwind.config.ts`. In Tailwind v4, **that configuration is gone**. The design system is configured directly in your CSS file using the `@theme` directive.

Here is the comparison:

```js
// Tailwind v3 config file (Deprecated / NOT used in this project)
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

```css
/* Tailwind v4 globals.css (Used in this project) */
@import "tailwindcss";

@theme {
  --color-accent: #7c5cfc;
}
```

### Why This Matters
Tailwind v4 reads the CSS file at build time, finds the `@theme` block, and generates the styling utility classes directly from it. 

> [!WARNING]
> If you add a `tailwind.config.ts` to this project, it will be silently ignored by the `@tailwindcss/postcss` compiler. Every design token must live in `globals.css`.

---

## 2. Inside the Token Catalog

Let's study the tokens defined in [app/globals.css](file:///Users/jessejames/Desktop/job-pilot/app/globals.css):

### 2.1 Backgrounds and Surfaces
These tokens control panels, cards, and page backdrops:

| Token Variable | Hex Value | Generated Class | Intended Use Case |
|---|---|---|---|
| `--color-background` | `#f6f7fb` | `bg-background` | Main page background (on `<body>`) |
| `--color-surface` | `#ffffff` | `bg-surface` | White cards, headers, panels |
| `--color-surface-secondary` | `#f9fafb` | `bg-surface-secondary` | Table row hover, secondary containers |
| `--color-surface-tertiary` | `#f2f5f7` | `bg-surface-tertiary` | Input backdrops, search bars |
| `--color-surface-muted` | `#f4f5fb` | `bg-surface-muted` | Greyed out status panels |

### 2.2 Typography Colors
Contrast is critical. We use semantic names to ensure accessibility:

| Token Variable | Hex Value | Generated Class | Intended Use Case |
|---|---|---|---|
| `--color-text-primary` | `#101828` | `text-text-primary` | Headings, main body paragraphs |
| `--color-text-secondary` | `#6a7282` | `text-text-secondary` | Labels, subtitles, hints |
| `--color-text-muted` | `#99a1af` | `text-text-muted` | Placeholders, disabled states |
| `--color-text-dark` | `#364153` | `text-text-dark` | Inactive nav links |
| `--color-text-darkest` | `#111827` | `text-text-darkest` | Bold brand elements / logos |

### 2.3 Borders
These tokens create subtle dividers without cluttering layout:

| Token Variable | Hex Value | Generated Class | Intended Use Case |
|---|---|---|---|
| `--color-border` | `#e7eaf3` | `border-border` | Default outline on cards and tables |
| `--color-border-light` | `#e5e7eb` | `border-border-light` | Very faint inner separators |
| `--color-border-muted` | `#dfe1e7` | `border-border-muted` | Input boxes outlines |

### 2.4 Brand Colors (Accent & Success / Info / Warning)
Purple is our primary brand accent. Success uses emerald green, info uses blue, and warning uses orange:

| Token Variable | Hex Value | Generated Class | Intended Use Case |
|---|---|---|---|
| `--color-accent` | `#7c5cfc` | `bg-accent` / `text-accent` | Primary buttons, active routes |
| `--color-accent-dark` | `#5e4cff` | `hover:bg-accent-dark` | Accent hover states |
| `--color-accent-light` | `#f3e8ff` | `bg-accent-light` | Selected items / pills backdrops |
| `--color-accent-muted` | `#faf5ff` | `bg-accent-muted` | Faint accent alerts |
| `--color-success` | `#10b981` | `text-success` | High match scores, status checks |
| `--color-success-light` | `#d0fae5` | `bg-success-light` | Match pill background |
| `--color-info` | `#61a8ff` | `text-info` | System alerts, info charts |
| `--color-warning` | `#ff8904` | `text-warning` | Medium match scores |

### 2.5 Border Radii
Rounded corners follow a strict pattern:

* `--radius-sm`: `4px` (`rounded-sm`) - small badges and indicators
* `--radius-md`: `8px` (`rounded-md`) - standard buttons and inputs
* `--radius-lg`: `12px` (`rounded-lg`) - images or small dashboards previews
* `--radius-xl`: `16px` (`rounded-xl`) - large cards
* `--radius-full`: `9999px` (`rounded-full`) - pills, avatars, and search buttons

---

## 3. How next/font + CSS Variables Work Together

Look at how [app/layout.tsx](file:///Users/jessejames/Desktop/job-pilot/app/layout.tsx) configures the Google Inter font:

```tsx
// app/layout.tsx
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased font-sans`}>
      <body className="min-h-full bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
```

### The Font Variable Overlap
Why do we define `--font-sans: "Inter", sans-serif;` in `globals.css` and also define `variable: "--font-sans"` in `layout.tsx`?

1. **The Fallback**: The `@theme` directive in CSS outputs a fallback rule:
   ```css
   :root {
     --font-sans: "Inter", sans-serif;
   }
   ```
2. **The Loader**: Next.js download scripts fetch the font files from Google Fonts, package them into optimized files, and generate a class (stored in `inter.variable`) that maps `--font-sans` to this local optimization.
3. **The Specifier**: We apply `className={inter.variable}` to `<html>`. Since `<html>` is a child element of `:root` in CSS terms, the element-level variables override the `:root` variables:
   ```css
   /* Next.js output on the html element overrides root */
   .className-from-inter-variable {
     --font-sans: '__Inter_123456', '__Inter_Fallback_123456';
   }
   ```
4. **The Class**: The `font-sans` Tailwind class uses `var(--font-sans)`. Because of the cascade, it resolves to Next.js's optimized, zero-layout-shift font.

> [!TIP]
> **Check Your Understanding:** If you removed `${inter.variable}` from the `<html>` tag, would the website fall back to a system sans-serif or still render the Google Fonts stack?
>
> <details>
> <summary>Reveal answer</summary>
>
> It would fall back to `"Inter", sans-serif` as a web font loaded by the browser (if installed on the user's system) or the browser's default sans-serif font. The optimized preload stack created by Next.js would not be loaded, resulting in slower font loading and potentially Layout Shift (CLS).
>
> </details>

---

## 4. Real Code Showcase: How Tokens Are Applied

Let's trace how the JobPilot codebase consumes these tokens in the components folder.

### 4.1 Navbar — [Navbar.tsx](file:///Users/jessejames/Desktop/job-pilot/components/layout/Navbar.tsx)
```tsx
export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full bg-surface border-b border-border h-16">
      ...
          <Link
            href="/dashboard"
            className="text-sm font-medium text-text-dark hover:text-accent transition-colors"
          >
            Dashboard
          </Link>
      ...
  );
}
```
* **`bg-surface`**: Resolves to `#ffffff`.
* **`border-border`**: Resolves to `#e7eaf3`.
* **`text-text-dark`**: Resolves to `#364153`.
* **`hover:text-accent`**: Uses our brand purple (`#7c5cfc`) on hover.

### 4.2 Hero Banner — [Hero.tsx](file:///Users/jessejames/Desktop/job-pilot/components/homepage/Hero.tsx)
```tsx
export function Hero() {
  return (
    <section className="w-full bg-background pt-20 pb-0">
      ...
        <span className="inline-flex items-center bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full mb-6">
          AI-Powered Job Search
        </span>
      ...
  );
}
```
* **`bg-background`**: The page backdrop (`#f6f7fb`).
* **`bg-accent-muted`**: Light lavender background (`#faf5ff`).
* **`text-accent`**: Purple text (`#7c5cfc`).
* **`rounded-full`**: Fully rounded pill badge.

### 4.3 Mixed Layouts & Custom Gradients — [BottomCTA.tsx](file:///Users/jessejames/Desktop/job-pilot/components/homepage/BottomCTA.tsx)
Sometimes, Tailwind utilities cannot represent complex CSS styles.
```tsx
export function BottomCTA() {
  return (
    <section
      className="w-full py-24"
      style={{
        background:
          "linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)",
      }}
    >
```
* Since Tailwind's `@theme` compiler registers variables on `:root` as native CSS variables, standard inline style blocks can safely reference `var(--color-accent)` and `var(--color-overlay)`. This keeps the design system connected even for non-Tailwind properties.

---

## 5. Styling Anti-Patterns (Common Mistakes to Avoid)

Always review your styling code against these project standards:

### Anti-Pattern 1: Hardcoded Hex Codes in className
❌ **Never do this:**
```tsx
<div className="bg-[#7c5cfc] text-[#101828] border-[#e7eaf3]" />
```
✅ **Correct:**
```tsx
<div className="bg-accent text-text-primary border-border" />
```

### Anti-Pattern 2: Default Tailwind Color Palettes
❌ **Never do this (violates JobPilot color identity):**
```tsx
<div className="bg-purple-100 text-purple-600 border-gray-200" />
```
✅ **Correct:**
```tsx
<div className="bg-accent-muted text-accent border-border" />
```

### Anti-Pattern 3: Defining Tokens in tailwind.config.ts
❌ **Never do this:**
```ts
// tailwind.config.ts
export default {
  theme: { extend: { colors: { accent: '#7c5cfc' } } }
}
```
✅ **Correct:** Put it in [app/globals.css](file:///Users/jessejames/Desktop/job-pilot/app/globals.css) inside `@theme`.

---

## 6. Verification Checklist

When you are adding or editing CSS theme tokens, verify them in Chrome DevTools:

1. **Verify Root Custom Properties**:
   Open Elements -> Styles -> click on the `:root` element. Verify that `--color-accent` is listed and matches `#7c5cfc`.
2. **Verify font-sans resolution**:
   Right-click text, select **Inspect**, and view the **Computed** styles panel. Scroll to `font-family`. Verify it resolves to your Next.js font stack rather than system fallbacks.
3. **Verify the compiler output**:
   Check if the classes compile properly by using them in a component. If you build `bg-cta-brand` and it outputs a white background, check that you prefixed it with `--color-cta-brand:` in the CSS file.

---

## 7. Self-Check Quiz

Answer each question before expanding the answer.

**1. If you add `--color-match-emerald: #059669;` to the `@theme` block in `globals.css`, which Tailwind utility classes are generated automatically?**

<details>
<summary>Reveal answer</summary>

Tailwind compiles the `--color-` prefix into three primary utility groups:
1. `bg-match-emerald` (sets background-color)
2. `text-match-emerald` (sets text color)
3. `border-match-emerald` (sets border-color)

</details>

---

**2. Why will creating a `tailwind.config.ts` fail to update colors in our codebase?**

<details>
<summary>Reveal answer</summary>

Tailwind v4 is "CSS-First". The compiler reads design configurations directly from `@theme` blocks inside CSS files. It does not read `tailwind.config.ts`. If you write custom colors there, the compiler will ignore them completely.

</details>

---

**3. In `layout.tsx`, the `RootLayout` applies the class `bg-background` to the `<body>` element. What is the hex code value of this background color, and where is it configured?**

<details>
<summary>Reveal answer</summary>

The background color evaluates to `#f6f7fb`. It is defined as `--color-background: #f6f7fb;` inside the `@theme` directive of `app/globals.css`.

</details>

---

**4. How does an element-level CSS variable override a `:root` CSS variable?**

<details>
<summary>Reveal answer</summary>

CSS Custom Properties follow standard cascade specificity rules. If a variable (like `--font-sans`) is defined on `:root` and re-defined on the `<html>` element (via `inter.variable`), any child element resolving `var(--font-sans)` will inherit the value from the nearest selector (`<html>`), overriding the parent selector (`:root`).

</details>

---

**5. What is the difference between `@theme` and `@theme inline` in Tailwind v4?**

<details>
<summary>Reveal answer</summary>

`@theme` register tokens as CSS variables on `:root` and generates classes for tailwind utility generation. `@theme inline` behaves differently by generating utilities directly with the raw values rather than creating reusable custom properties, which is not recommended for global design systems.

</details>

---

**6. Why is `<section style={{ background: "linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)" }}>` compliant with our style rules?**

<details>
<summary>Reveal answer</summary>

Because it does not hardcode any raw hex values (like `#7c5cfc`). Instead, it references the custom CSS properties (`var(--color-accent)` and `var(--color-overlay)`) registered via our `@theme` block. This keeps the layout connected to our global design system.

</details>

---

**7. How do you convert standard border-radius classes like `rounded-md` back into the raw pixel value used in our design token system?**

<details>
<summary>Reveal answer</summary>

Check the border-radius keys in `globals.css`. Under the `@theme` block, look for `--radius-md`. The value defined there is `8px`. So `rounded-md` maps to `8px` of border radius.

</details>

---

**8. Why is `font-sans` applied directly on the `<html>` element in `app/layout.tsx`?**

<details>
<summary>Reveal answer</summary>

By applying `font-sans` to `<html>`, we ensure that the sans-serif font is inherited globally by all text elements, input boxes, and components throughout the application without needing to redefine it in sub-layouts.

</details>

---

**9. Can we use built-in Tailwind colors (e.g. `bg-emerald-500`) to highlight active match tags?**

<details>
<summary>Reveal answer</summary>

No. The project style rules explicitly forbid using raw Tailwind color scales. You must use semantic success variables (like `text-success` or `bg-success-light`) to maintain design system consistency.

</details>

---

**10. What PostCSS plugin compiles these Tailwind v4 CSS variables?**

<details>
<summary>Reveal answer</summary>

The compilation is performed by `@tailwindcss/postcss`, configured in `postcss.config.mjs`. It scans components for utility classes and compiles the `@theme` block into standard CSS custom properties.

</details>

---

## 8. Extend It (Challenges)

Try these challenges to build your confidence with our CSS design tokens!

---

### Challenge 1 — Build a Match score status badge
Create a component `components/homepage/MatchBadge.tsx` that displays a job match score. The component should take a `score` prop (number between 0 and 100) and render a badge.
* **If score >= 70**: Background should be success-light, text color should be success, reading: `[score]% Match`.
* **If score is between 40 and 69**: Background should be warning-light (you may need to add it to `globals.css`!), text color should be warning.
* **If score < 40**: Background should be error-light (needs configuring), text color should be error.

---

### Challenge 2 — Register and Use a LinkedIn Badge
Add custom styling for social indicators:
1. Register `--color-linkedin: #0a66c2;` and a light background variant in [globals.css](file:///Users/jessejames/Desktop/job-pilot/app/globals.css) inside `@theme`.
2. Build a small LinkedIn button component that uses `bg-linkedin`, `hover:bg-linkedin-dark` (ensure you register it!), and `text-white` with the LinkedIn icon.
