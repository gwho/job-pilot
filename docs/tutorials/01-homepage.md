# Tutorial 01 — Building the JobPilot Homepage

**After completing this tutorial you will understand:** how App Router pages compose with layouts, why every component here is a Server Component, how the design token system turns CSS variables into Tailwind utility classes, and what the advanced patterns (private components, inline CSS variables, LCP optimization) look like in real working code.

> [!NOTE]
> **Prerequisites:** Familiarity with React JSX, basic TypeScript, and the ability to run `npm run dev`. You should have the project open in your editor so you can follow along in the real files.

---

## The Component Tree

Every section of this tutorial maps back to this tree. Refer to it whenever you feel lost.

```
app/layout.tsx (RootLayout)
  └─ app/page.tsx (Home)
       ├─ components/layout/Navbar.tsx
       ├─ components/homepage/Hero.tsx
       ├─ components/homepage/Features.tsx
       ├─ components/homepage/HowItWorks.tsx
       │    └─ Section (private — not exported)
       ├─ components/homepage/Testimonial.tsx
       ├─ components/homepage/BottomCTA.tsx
       └─ components/layout/Footer.tsx
```

---

## 1. App Router Page Hierarchy

Every Next.js App Router project has at least two layers: a **layout** and a **page**. The layout renders once and persists across navigations. The page swaps in when the route matches.

### `app/layout.tsx` — The outer shell

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "JobPilot — AI Job Hunting Assistant",
  description: "Find, score, and research jobs automatically with AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased font-sans`}>
      <body className="min-h-full bg-background" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
```

`RootLayout` owns the `<html>` and `<body>` tags — `page.tsx` never touches these. It also injects the Inter font as a CSS variable (`--font-sans`), applies `bg-background` to the body, and renders `{children}` — which is whatever page the user navigated to.

`suppressHydrationWarning` on `<body>` silences a common mismatch warning caused by browser extensions modifying the DOM before React hydrates. It does not mask real bugs.

### `app/page.tsx` — The homepage

```tsx
// app/page.tsx
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/homepage/Hero";
import { HowItWorks } from "@/components/homepage/HowItWorks";
import { Features } from "@/components/homepage/Features";
import { Testimonial } from "@/components/homepage/Testimonial";
import { BottomCTA } from "@/components/homepage/BottomCTA";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Testimonial />
        <BottomCTA />
      </main>
      <Footer />
    </>
  );
}
```

`Home` is a **default export** — Next.js requires this for all `page.tsx` files. Every other file in this project uses named exports. That distinction is intentional and comes up in Section 7.

> [!TIP]
> **Try This:** Look at the import for `Navbar`:
> ```tsx
> import { Navbar } from "@/components/layout/Navbar";
> ```
> Now open `components/layout/Navbar.tsx`. Find its export line. Why does `page.tsx` use `export default` while `Navbar.tsx` uses a named export? Write your answer in one sentence before checking below.

<details>
<summary>Reveal answer</summary>

Next.js enforces default exports for page files — it is a framework requirement, not a style choice. All other files in the project use named exports because they are easier to refactor (your editor can rename them automatically) and safer to import (named exports cause a compile error if the name is wrong; default exports silently accept any local name).

</details>

> [!TIP]
> **Check Your Understanding:** If you add a new file at `app/dashboard/page.tsx`, will `RootLayout` render again or stay in place?

<details>
<summary>Reveal answer</summary>

`RootLayout` stays in place. The `<html>` and `<body>` tags persist across navigations — only `{children}` swaps. This is the entire point of the layout/page split: shared chrome (nav, theme, fonts) renders once; route-specific content swaps efficiently.

</details>

- [ ] I can describe the difference between `layout.tsx` and `page.tsx` in one sentence
- [ ] I understand why `Home` uses a default export when all other components use named exports

---

## 2. Server Components First

Open `components/homepage/Hero.tsx`. The first two lines are:

```tsx
// components/homepage/Hero.tsx
import Image from "next/image";
import Link from "next/link";
```

No `"use client"`. That single missing directive is the whole story. Every component in this homepage is a **React Server Component** — it renders on the server, emits HTML, and ships **zero component JavaScript to the browser**.

Here is the comparison that matters:

```tsx
// Never — adds "use client" without a reason
"use client";
import { useState } from "react";
export function Hero() { /* ... */ }

// Correct — static markup needs no client boundary
import Image from "next/image";
import Link from "next/link";
export function Hero() { /* ... */ }
```

The rule is simple: only add `"use client"` when you need `useState`, `useEffect`, browser APIs, event listeners, or a library that only works in a browser. Static links, text, images, and layout require nothing from the client.

> [!TIP]
> **Modify This:** Imagine you need to add a mobile menu toggle to `Navbar.tsx`. Before you can write `const [open, setOpen] = useState(false)`, what single line must you add to the file, and where does it go?

<details>
<summary>Reveal answer</summary>

You must add `"use client"` as the **very first line** of the file — before any imports. React requires the directive to appear before any other code, including import statements. Without it, TypeScript will error the moment you use `useState`.

```tsx
// components/layout/Navbar.tsx
"use client";          // ← must be line 1
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
// ...
```

</details>

> [!TIP]
> **Check Your Understanding:** A Server Component can import a Client Component. Can a Client Component import a Server Component?

<details>
<summary>Reveal answer</summary>

**True** — a Server Component can import a Client Component (the boundary flows outward). A Client Component **cannot** import a Server Component directly, because Server Components must be rendered on the server and their output cannot be bundled into a client JavaScript file. The workaround is to pass a Server Component as a `children` prop into a Client Component — the server renders it first, then passes the result through.

</details>

- [ ] I know the single directive that turns a component into a Client Component
- [ ] I can name three reasons to add `"use client"` and three reasons not to

---

## 3. Assembling the Page

`app/page.tsx` does exactly one thing: it composes layout and content components into a page. There is no business logic here, no data fetching, no state.

The section order is a deliberate marketing funnel:

| Position | Component | Purpose |
|---|---|---|
| 1 | `Hero` | Hook — the promise, the CTA |
| 2 | `Features` | Value — what the product does |
| 3 | `HowItWorks` | Demo — show it in action |
| 4 | `Testimonial` | Proof — social credibility |
| 5 | `BottomCTA` | Conversion — final push to sign up |

The psychological logic: a visitor scans the value proposition before they trust the product demo. Features before HowItWorks means they know *what* it does before they see *how* it looks.

The `@/` prefix on every import maps to the project root — configured automatically by Next.js in `tsconfig.json`. It replaces fragile relative paths:

```tsx
// Never — breaks when you move the file
import { Navbar } from "../../../components/layout/Navbar";

// Correct — always resolves from the project root
import { Navbar } from "@/components/layout/Navbar";
```

> [!TIP]
> **Try This:** In `app/page.tsx`, swap the order of `<Features />` and `<HowItWorks />`. Run `npm run dev` and load the homepage. What changed visually? Which order makes more persuasive sense, and why? Then swap them back.

> [!TIP]
> **Modify This:** Write the import line and JSX line you would add to `page.tsx` to insert a new `<PricingTeaser />` component between `<Testimonial />` and `<BottomCTA />`. Follow the exact naming and import conventions you see in the existing file. (You don't need to build the component — just write the two lines.)

<details>
<summary>Reveal answer</summary>

```tsx
// Import (goes with the other homepage imports at the top):
import { PricingTeaser } from "@/components/homepage/PricingTeaser";

// JSX (between <Testimonial /> and <BottomCTA />):
<PricingTeaser />
```

</details>

- [ ] I understand the marketing funnel logic behind the section order
- [ ] I know what `@/` resolves to and where that configuration lives

---

## 4. The Design Token System

Open `app/globals.css`. The `@theme` block at the top is the entire color system:

```css
/* app/globals.css */
@theme {
  /* Page and surface backgrounds */
  --color-background: #f6f7fb;
  --color-surface: #ffffff;
  --color-surface-secondary: #f9fafb;

  /* Primary accent — purple */
  --color-accent: #7c5cfc;
  --color-accent-dark: #5e4cff;
  --color-accent-muted: #faf5ff;
  --color-accent-foreground: #ffffff;

  /* Text */
  --color-text-primary: #101828;
  --color-text-secondary: #6a7282;
  --color-text-muted: #99a1af;
  --color-text-darkest: #111827;

  /* Borders */
  --color-border: #e7eaf3;

  /* Dark overlays */
  --color-overlay: #111827;
}
```

Tailwind v4 reads this block and **automatically generates utility classes** for every variable. `--color-accent` becomes `bg-accent`, `text-accent`, and `border-accent`. You get all three from one definition.

Here is the rule that never changes in this project:

```tsx
// Never — raw Tailwind color scale (Tailwind's built-in purple, not your design)
className="bg-purple-100 text-purple-600"

// Never — hardcoded hex value
className="bg-[#faf5ff] text-[#7c5cfc]"

// Correct — generated utility classes from @theme tokens
className="bg-accent-muted text-accent"
```

You can see this in action on the Hero badge in `components/homepage/Hero.tsx`, line 8:

```tsx
// components/homepage/Hero.tsx
<span className="inline-flex items-center bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full mb-6">
  AI-Powered Job Search
</span>
```

`bg-accent-muted` resolves from `--color-accent-muted: #faf5ff`. `text-accent` resolves from `--color-accent: #7c5cfc`. Neither value is written in the component — they come through the token system.

The maintenance benefit: if you change `--color-accent` in `globals.css`, every component that uses `bg-accent`, `text-accent`, or `border-accent` updates automatically. No grep, no find-and-replace.

> [!TIP]
> **Check Your Understanding:** If you add this line to the `@theme` block in `globals.css`, what Tailwind utility classes become available automatically?
> ```css
> --color-cta-green: #22c55e;
> ```

<details>
<summary>Reveal answer</summary>

Three classes are generated automatically: `bg-cta-green`, `text-cta-green`, and `border-cta-green`. Tailwind v4 generates background, text, and border variants from every `--color-*` variable in the `@theme` block.

</details>

> [!TIP]
> **Try This:** Open DevTools on the running homepage. Inspect the "AI-Powered Job Search" badge in the Hero section. Find the computed `background-color` value. Now trace it backward: `bg-accent-muted` → `--color-accent-muted` → the hex value in `globals.css`. That three-step chain is the entire token system.

- [ ] I can explain how `--color-accent` in `globals.css` becomes `bg-accent` in a component
- [ ] I know why hardcoded hex values and raw Tailwind colors are both forbidden here

---

## 5. Component Deep Dives

### 5.1 Navbar — `components/layout/Navbar.tsx`

```tsx
// components/layout/Navbar.tsx
import Image from "next/image";
import Link from "next/link";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full bg-surface border-b border-border h-16">
      <div className="max-w-[1440px] mx-auto px-6 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="JobPilot logo" width={36} height={36} />
          <span className="text-[19px] font-bold leading-7 text-text-darkest">
            JobPilot
          </span>
        </Link>

        <nav className="flex items-center gap-8">
          <Link href="/dashboard" className="text-sm font-medium text-text-dark hover:text-accent transition-colors">
            Dashboard
          </Link>
          <Link href="/find-jobs" className="text-sm font-medium text-text-dark hover:text-accent transition-colors">
            Find Jobs
          </Link>
          <Link href="/profile" className="text-sm font-medium text-text-dark hover:text-accent transition-colors">
            Profile
          </Link>
        </nav>

        <Link href="/login" className="bg-overlay text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-overlay-dark transition-colors">
          Start for free
        </Link>
      </div>
    </header>
  );
}
```

**Three things to notice:**

- `sticky top-0 z-50` — the header sticks to the top of the viewport as the user scrolls. `z-50` ensures it renders above all other content.
- `max-w-[1440px]` — the square-bracket syntax is Tailwind's **arbitrary value** escape hatch. Tailwind's built-in `container` class does not match this design spec, so `max-w-[1440px]` sets the exact value. Used consistently on every section.
- `flex items-center justify-between` on the inner div creates the three-region layout: logo left, nav center, CTA right.

> [!TIP]
> **Modify This:** Add a fourth nav link for "Pricing" between "Find Jobs" and "Profile". Follow the exact same className pattern as the existing links.

---

### 5.2 Hero — `components/homepage/Hero.tsx`

```tsx
// components/homepage/Hero.tsx
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="w-full bg-background pt-20 pb-0">
      <div className="max-w-[1440px] mx-auto px-8 flex flex-col items-center text-center">
        <span className="inline-flex items-center bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full mb-6">
          AI-Powered Job Search
        </span>

        <h1 className="text-5xl font-bold text-text-primary leading-tight max-w-2xl mb-5">
          Job hunting is hard.
          <br />
          Your tools shouldn&apos;t be.
        </h1>

        <p className="text-base text-text-secondary max-w-xl leading-relaxed mb-8">
          Set up your profile once. JobPilot automatically discovers relevant
          jobs, scores them against your skills, and researches every company —
          so you arrive fully prepared.
        </p>

        <div className="flex items-center gap-4 mb-14">
          <Link href="/login" className="bg-accent text-accent-foreground text-sm font-medium px-6 py-3 rounded-md hover:bg-accent-dark transition-colors">
            Get Started
          </Link>
          <Link href="/login" className="bg-surface border border-border text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors">
            Find Your First Match
          </Link>
        </div>

        <div className="w-full max-w-5xl rounded-2xl border border-border shadow-lg overflow-hidden">
          <Image
            src="/images/dashboard-demo.png"
            alt="JobPilot dashboard showing job matches and analytics"
            width={1200}
            height={700}
            className="w-full h-auto"
            priority
          />
        </div>
      </div>
    </section>
  );
}
```

**Three things to notice:**

- `&apos;` on line 15 is an HTML entity for the apostrophe character. JSX does not allow bare `'` inside attribute strings without escaping, and linters flag it in text content too. The curly-brace alternative `{'t'}` also works but is more verbose.
- `next/image` requires explicit `width` and `height` props. These do not set the rendered size — `className="w-full h-auto"` does that — but they tell the browser the image's intrinsic dimensions so it can reserve the right amount of space before the image loads, preventing layout shift.
- `priority` on the dashboard screenshot tells Next.js to **preload this image** rather than lazy-load it. The Hero image is the Largest Contentful Paint (LCP) element — the biggest visible thing on screen when the page loads. Preloading it directly improves your LCP score. See Section 6.3 for the full explanation.

> [!TIP]
> **Modify This:** Change the badge text from "AI-Powered Job Search" to "Free to Start · No Credit Card". Run `npm run dev` and verify it renders correctly.

---

### 5.3 Features — `components/homepage/Features.tsx`

```tsx
// components/homepage/Features.tsx
type Feature = {
  icon: string;
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    icon: "🔍",
    title: "AI Job Discovery",
    description: "Finds relevant tech jobs from Adzuna automatically. No manual searching — just enter a title and location and let the agent do the work.",
  },
  {
    icon: "⚡",
    title: "Smart Scoring",
    description: "GPT-4o scores every job 0–100 against your actual skills profile. See matched skills in green and gaps in orange before you even open the listing.",
  },
  {
    icon: "🏢",
    title: "Company Research",
    description: "One click opens a Browserbase session that browses the company's real website and builds a structured dossier — culture, tech stack, and interview prep.",
  },
];

export function Features() {
  return (
    <section className="bg-surface-secondary py-16">
      <div className="max-w-[1440px] mx-auto px-8">
        <div className="grid grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-surface border border-border rounded-2xl p-6 shadow-sm"
            >
              <div className="text-2xl mb-4">{feature.icon}</div>
              <h3 className="text-base font-semibold text-text-primary mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

**Three things to notice:**

- The `Feature` type and `features` array are defined **above** the component, not inside it. Data constants do not need to live inside the function — keeping them outside makes the component body cleaner and means the array is not re-created on every render.
- `.map()` uses `key={feature.title}` — not the array index. Using the index as a key causes issues if the array is ever reordered: React uses the key to match old elements to new ones, so an index key would cause React to think the wrong items changed. A stable, unique value like `title` gives React a reliable identity.
- The card className is `bg-surface border border-border rounded-2xl p-6 shadow-sm` — this is the standard card pattern used throughout the project. If you add any new card-style UI, use this exact set of classes.

> [!TIP]
> **Modify This:** Add a fourth feature to the `features` array:
> ```
> icon: "🤖"
> title: "Resume Tailoring"
> description: "One click generates a tailored resume PDF from your profile and the job description."
> ```
> Run the dev server. Does a 4-column layout look correct, or does it need adjustment? Why might the grid need to change from `grid-cols-3`?

---

### 5.4 HowItWorks — `components/homepage/HowItWorks.tsx`

This is the most instructive file in the codebase. Open it in your editor and read it fully. You will see a `Section` function defined above the exported `HowItWorks` function — that is a **private component** and the subject of Section 6.1 below.

> [!TIP]
> **Check Your Understanding:** How many components does `HowItWorks.tsx` export? Name them.

<details>
<summary>Reveal answer</summary>

One. Only `HowItWorks` is exported (`export function HowItWorks()`). The `Section` function has no `export` keyword — it is private to this file. No other file in the project can import it.

</details>

---

### 5.5 Testimonial — `components/homepage/Testimonial.tsx`

```tsx
// components/homepage/Testimonial.tsx
import Image from "next/image";

export function Testimonial() {
  return (
    <section className="bg-background py-24">
      <div className="max-w-2xl mx-auto px-8 flex flex-col items-center text-center gap-8">
        <blockquote className="text-2xl font-medium text-text-primary leading-relaxed">
          &ldquo;I used to spend my evenings copy-pasting resumes. Now I open
          my dashboard to see interviews waiting. It feels like cheating. Had 3
          offers on the table simultaneously.&rdquo;
        </blockquote>

        <div className="flex flex-col items-center gap-3">
          <Image
            src="/images/user-icon.png"
            alt="Alex Rivera"
            width={48}
            height={48}
            className="rounded-full"
          />
          <div>
            <p className="text-sm font-medium text-text-primary">Alex Rivera</p>
            <p className="text-sm text-text-muted">Senior Frontend Engineer</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Three things to notice:**

- `<blockquote>` is the correct semantic HTML element for a quotation. Using `<p>` or `<div>` here would be structurally wrong — screen readers announce `blockquote` elements differently.
- `&ldquo;` and `&rdquo;` are HTML entities for **curly quotes** (typographic open and close quotation marks). Plain `"` characters are straight quotes and look less polished in display text.
- `rounded-full` on the avatar `<Image>` creates a perfect circle. This works because `width={48}` and `height={48}` produce a square image, and `rounded-full` sets `border-radius: 9999px`.

> [!TIP]
> **Modify This:** Change the testimonial to a second user. Use the name "Priya Sharma", title "Data Engineer at Stripe", and write a short two-sentence quote of your own. Keep all classes and HTML structure identical — only change the text content.

---

### 5.6 BottomCTA — `components/homepage/BottomCTA.tsx`

```tsx
// components/homepage/BottomCTA.tsx
import Link from "next/link";

export function BottomCTA() {
  return (
    <section
      className="w-full py-24"
      style={{
        background:
          "linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)",
      }}
    >
      <div className="max-w-[1440px] mx-auto px-8 flex flex-col items-center text-center gap-6">
        <h2 className="text-4xl font-bold text-white leading-tight max-w-xl">
          Your next job search can feel a lot less overwhelming
        </h2>
        <p className="text-base text-white/70 max-w-lg leading-relaxed">
          Set up your profile once. JobPilot handles the discovery, scoring, and
          research — you just decide where to apply.
        </p>
        <div className="flex items-center gap-4 mt-2">
          <Link href="/login" className="bg-white text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors">
            Get Started
          </Link>
          <Link href="/login" className="border border-white/30 text-white text-sm font-medium px-6 py-3 rounded-md hover:bg-white/10 transition-colors">
            See How It Works
          </Link>
        </div>
      </div>
    </section>
  );
}
```

The `style` prop here is the one place in the homepage where an inline style is used. The reason and why it is still rule-compliant is covered in Section 6.2.

> [!TIP]
> **Check Your Understanding:** The `style` prop references `var(--color-accent)`. Where is that variable defined?

<details>
<summary>Reveal answer</summary>

In `app/globals.css`, inside the `@theme` block: `--color-accent: #7c5cfc;`. The CSS custom property is defined once there and referenced everywhere else — including in this inline style.

</details>

---

### 5.7 Footer — `components/layout/Footer.tsx`

```tsx
// components/layout/Footer.tsx
import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-surface border-t border-border py-8">
      <div className="max-w-[1440px] mx-auto px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="JobPilot logo" width={36} height={36} />
          <span className="text-[19px] font-bold leading-7 text-text-darkest">
            JobPilot
          </span>
        </Link>

        <p className="text-sm text-text-muted">
          © {new Date().getFullYear()} JobPilot. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
```

`new Date().getFullYear()` computes the current year. Because this is a Server Component, that expression runs **on the server at render time** — not in the browser. The HTML that reaches the browser already contains the correct year as a static number. No JavaScript runs in the browser for this computation.

> [!TIP]
> **Try This:** Right-click the footer copyright in your browser and select "Inspect". You will see the year rendered as plain text in the HTML — not a script tag, not a placeholder. This is proof that the server evaluated `new Date().getFullYear()` before sending the response.

- [ ] I have read all seven component files and understand the pattern each introduces
- [ ] I can reproduce the standard card pattern (`bg-surface border border-border rounded-2xl p-6 shadow-sm`) from memory

---

## 6. Advanced Patterns

### 6.1 The Private `Section` Component in HowItWorks

Open `components/homepage/HowItWorks.tsx`. Near the top is a function called `Section` with no `export` keyword:

```tsx
// components/homepage/HowItWorks.tsx (lines 8–71)
type FeaturePoint = {
  title: string;
  description: string;
};

type SectionProps = {
  heading: string;
  points: FeaturePoint[];
  imageSrc: string;
  imageAlt: string;
  imageLeft?: boolean;
};

function Section({
  heading,
  points,
  imageSrc,
  imageAlt,
  imageLeft = false,
}: SectionProps) {
  // ... renders a two-column grid of text + image
}
```

`Section` is called twice inside `HowItWorks`:

```tsx
// First call — text left, image right (imageLeft defaults to false)
<Section
  heading="Manage Your Job Search With Ease"
  points={[ /* ... */ ]}
  imageSrc="/images/jobs-lists.png"
  imageAlt="JobPilot jobs list showing match scores and company details"
/>

// Second call — image left, text right
<Section
  heading="Apply With More Confidence, Every Time"
  points={[ /* ... */ ]}
  imageSrc="/images/agnet-log.png"
  imageAlt="JobPilot company research dossier showing tech stack and culture"
  imageLeft
/>
```

Without `Section`, the two-column grid JSX would be copy-pasted twice — identical structure, different content. The extraction rule is: **if the same JSX structure appears more than once in a file, extract it as a private component**. Do not export it unless another file actually needs it.

> [!TIP]
> **Modify This:** `Section` has `imageLeft?: boolean` with a default of `imageLeft = false`. Remove the `= false` default so it reads `imageLeft`: boolean without the optional `?` either. What happens in TypeScript? Does the first `<Section />` call site now error? Try it, then revert.

> [!TIP]
> **Check Your Understanding:** If you needed to reuse this same two-column layout in a new `components/pricing/PricingSection.tsx` file, what would you need to change?

<details>
<summary>Reveal answer</summary>

You would need to either move `Section` to its own file and add `export`, or re-implement the layout in the new file. As it stands, `Section` is private — no other file can import it. The decision to keep it private was correct when only `HowItWorks` needed it. The moment a second file needs it, the right move is to promote it to a shared exported component.

</details>

---

### 6.2 Inline CSS Variables for the Gradient (BottomCTA)

The project rule is: never use hardcoded hex values or raw Tailwind colors. The *spirit* of that rule is: all color values must flow through the token system. An inline `style` prop is not a rule violation as long as it references CSS variables rather than literal values.

```tsx
// Compliant — CSS variable reference; value controlled by token system
style={{
  background: "linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)"
}}

// Not compliant — hardcoded hex; disconnected from the token system
style={{
  background: "linear-gradient(135deg, #7c5cfc 0%, #111827 100%)"
}}
```

Why use an inline style here at all? Tailwind cannot generate a utility class for an arbitrary multi-stop gradient that references design tokens. There is no `bg-gradient-accent-to-overlay` class. The inline style is the only way to express this gradient while staying inside the token system.

> [!TIP]
> **Try This:** In `app/globals.css`, temporarily change `--color-accent: #7c5cfc` to `--color-accent: #e63946` (a red). Run `npm run dev`. Does the BottomCTA gradient update? Does the Hero badge update? Does the Navbar CTA button color change? What does this confirm about the token system?

---

### 6.3 LCP Optimization with `next/image priority`

**LCP** (Largest Contentful Paint) is the browser's measure of when the biggest visible element on screen finishes loading. On a marketing homepage, the Hero screenshot is almost always the LCP element — it is large, above the fold, and takes longer to load than text.

By default, `next/image` **lazy-loads** every image — it waits until the image is near the viewport before starting the download. That is the correct behavior for images below the fold. But for the Hero image, lazy loading is the *wrong* choice: it means the browser starts downloading the biggest image on the page only after it finishes everything else.

```tsx
// components/homepage/Hero.tsx
<Image
  src="/images/dashboard-demo.png"
  alt="JobPilot dashboard showing job matches and analytics"
  width={1200}
  height={700}
  className="w-full h-auto"
  priority              // ← disables lazy loading; triggers preload
/>
```

The `priority` prop does two things: it disables lazy loading for this specific image, and it injects a `<link rel="preload">` tag in the document `<head>` so the browser starts fetching the image as early as possible — before it even finishes parsing the HTML.

The HowItWorks images correctly **omit** `priority`:

```tsx
// components/homepage/HowItWorks.tsx — Section component
<Image
  src={imageSrc}
  alt={imageAlt}
  width={640}
  height={420}
  className="w-full h-auto"
  // no priority — these images are below the fold
/>
```

> [!TIP]
> **Check Your Understanding:** Why is it correct that the HowItWorks images do NOT have the `priority` prop?

<details>
<summary>Reveal answer</summary>

HowItWorks images are below the fold — the user must scroll to see them. Lazy loading is the right behavior: the browser only starts downloading them when they are about to enter the viewport. If every image on the page had `priority`, you would be preloading images the user may never scroll to, wasting bandwidth and slowing the initial page load. Use `priority` only on the single most important above-the-fold image.

</details>

- [ ] I can explain the LCP concept in one sentence and identify the LCP element on this page
- [ ] I know why `priority` is on the Hero image but not the HowItWorks images
- [ ] I understand why the BottomCTA gradient uses an inline style instead of a Tailwind class

---

## 7. Self-Check Quiz

Answer each question before revealing the answer.

**1. What is the only file in the homepage codebase that uses a default export, and why?**

<details>
<summary>Reveal answer</summary>

`app/page.tsx`. Next.js requires default exports for page files — it is a framework requirement. All other files use named exports per project convention, because named exports are safer (a typo causes a compile error) and easier to refactor.

</details>

---

**2. A component file contains `"use client"` at the top. Name two things it can no longer do that a Server Component can.**

<details>
<summary>Reveal answer</summary>

(1) It cannot be declared `async` and fetch data directly with `await`. (2) It cannot be rendered purely on the server — its JavaScript must be included in the client bundle, increasing the amount of JS shipped to the browser.

</details>

---

**3. What does `bg-accent-muted` resolve to, and where is the underlying value defined?**

<details>
<summary>Reveal answer</summary>

`bg-accent-muted` → `background-color: #faf5ff`. Defined as `--color-accent-muted: #faf5ff` in the `@theme` block of `app/globals.css`.

</details>

---

**4. You want to add a green success banner. Which class is correct: `bg-green-100`, `bg-[#d0fae5]`, or `bg-success-light`?**

<details>
<summary>Reveal answer</summary>

`bg-success-light`. `bg-green-100` violates the no-raw-Tailwind-colors rule. `bg-[#d0fae5]` violates the no-hardcoded-hex rule. `bg-success-light` resolves from `--color-success-light: #d0fae5` in `globals.css` — same value, but connected to the token system.

</details>

---

**5. What does the `priority` prop on the Hero `<Image>` do, and what would happen if you removed it?**

<details>
<summary>Reveal answer</summary>

It disables lazy loading and injects a `<link rel="preload">` in the document head, causing the browser to start fetching the image as early as possible. Without it, the browser would wait until the image is near the viewport — making the LCP slower and hurting Core Web Vitals scores.

</details>

---

**6. Why does `HowItWorks.tsx` contain a function called `Section` that is not exported?**

<details>
<summary>Reveal answer</summary>

`Section` is a private helper that avoids repeating the same two-column grid JSX structure twice. It is not exported because no other file in the project needs it. Keeping it private signals to other developers that it is scoped to this file and should not be imported elsewhere.

</details>

---

**7. What is `app/layout.tsx` responsible for that `app/page.tsx` is not?**

<details>
<summary>Reveal answer</summary>

`app/layout.tsx` owns the `<html>` and `<body>` tags, loads and applies the Inter font, sets `bg-background` on the body, and wraps every route in the application. `app/page.tsx` only renders the homepage — it does not set any global HTML structure.

</details>

---

**8. In `Features.tsx`, the `.map()` uses `key={feature.title}`. Why `title` and not the array index?**

<details>
<summary>Reveal answer</summary>

Using the array index as a key causes bugs if the array is ever reordered — React uses the key to match old elements to new ones, so an index key would cause React to think the wrong items changed (incorrect diffs, lost state, animation glitches). A stable, unique value like `title` gives React a reliable identity for each element that does not change when items are reordered.

</details>

---

**9. The BottomCTA uses an inline `style` prop with `var(--color-accent)`. Is this a rule violation?**

<details>
<summary>Reveal answer</summary>

No. The rule's purpose is "all color values must flow through the token system." The inline style references `var(--color-accent)` — a CSS variable that resolves through the token system. If `--color-accent` changes in `globals.css`, the gradient updates automatically. Using a literal hex value in the style prop *would* be a violation. Using a CSS variable reference is compliant.

</details>

---

**10. What is the `@/` import alias and where is it configured?**

<details>
<summary>Reveal answer</summary>

`@/` maps to the project root directory. It is configured automatically by Next.js in `tsconfig.json` under `compilerOptions.paths`. It lets you write `@/components/layout/Navbar` instead of a relative path like `../../components/layout/Navbar` — and it never breaks when you move a file.

</details>

---

## 8. Extend It

These three challenges have no provided answers. Build them.

---

### Challenge 1 — Add a Pricing Section

Create `components/homepage/PricingTeaser.tsx`. It should display three pricing tiers (Free, Pro, Enterprise) in a three-column grid. Each card should have a plan name, a price (or "Contact us"), and a list of three bullet points. Insert it into `app/page.tsx` between `<HowItWorks />` and `<Testimonial />`.

**Constraints:**
- Named export
- No `"use client"`
- No hardcoded hex values — use only token classes
- Card structure matches the standard pattern: `bg-surface border border-border rounded-2xl p-6 shadow-sm`
- Data defined as a typed constant above the component, not inline in JSX

---

### Challenge 2 — Refactor Testimonial to Accept Multiple Quotes

The `Testimonial` component currently hardcodes one quote. Refactor it to:
1. Define a `Testimonial` type with `quote`, `name`, `title`, and `avatar` fields
2. Define a `testimonials` array above the component with at least two entries
3. Render the first entry (or render them all in a row — your choice)

**Constraints:**
- Keep it a Server Component
- Do not hardcode JSX for each testimonial — render from the array
- The component should still accept no props (data lives in the file)

---

### Challenge 3 — Make the Hero Badge Configurable

The badge in `Hero.tsx` currently has hardcoded text: "AI-Powered Job Search". Refactor it so the text comes from a prop.

**Two options — pick one:**
- Add a `badge?: string` prop to `Hero` and pass it from `page.tsx`
- Extract a private `Badge` component inside `Hero.tsx` that accepts `text: string` as a prop

**Constraints:**
- `Hero` must remain a Server Component
- Default the badge text to `"AI-Powered Job Search"` so existing callers require no changes
- Test by passing a different badge string from `page.tsx`: `"Now live in the US · UK · Canada"`
