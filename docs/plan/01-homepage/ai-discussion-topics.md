# Feature 01 — Homepage — AI Discussion Topics

Use these prompts in a conversation with an AI to go deeper on the concepts behind this build. Each topic links directly to a decision made in this feature.

---

## React Server Components

- "Explain React Server Components like I'm new to them. What makes them different from regular React components? What can and can't they do?"
- "When should I use a Server Component vs a Client Component? Give me a decision framework with real examples."
- "Why does Next.js default everything to Server Components? What's the performance benefit for a marketing homepage specifically?"
- "What is the React Server Component Payload (RSC Payload)? How does it differ from HTML?"
- "Can a Server Component import a Client Component? Can a Client Component import a Server Component? What happens in each case?"

---

## Next.js App Router

- "Walk me through how `app/layout.tsx` and `app/page.tsx` relate to each other in the App Router. How does nesting work?"
- "What is a layout segment in the App Router? How do nested layouts work? Give me an example with /dashboard and /dashboard/settings."
- "What is the difference between the App Router and the Pages Router in Next.js? Why does the App Router exist?"
- "How does Next.js pre-render pages? What's the difference between static generation and server-side rendering in the App Router?"

---

## Tailwind CSS v4 and Design Tokens

- "What is the `@theme` directive in Tailwind CSS v4? How is it different from `tailwind.config.js`?"
- "Explain how Tailwind generates utility classes from CSS custom properties. How does `--color-accent` become `bg-accent`?"
- "What is the difference between using Tailwind utility classes vs writing CSS custom property values directly in `style={{}}`? When is each approach appropriate?"
- "What are design tokens? Why use them instead of hardcoding color values everywhere in the code?"

---

## `next/image` and Performance

- "What does the Next.js `<Image>` component do that a plain `<img>` tag doesn't? Explain each optimization."
- "What is Cumulative Layout Shift (CLS)? Why does it happen with images, and how does `next/image` prevent it?"
- "What is Largest Contentful Paint (LCP)? Why should you use `priority` on above-the-fold images?"
- "What is WebP and why does Next.js convert images to it automatically? What are the trade-offs?"

---

## Component Architecture

- "What is the rule 'one component per file'? Why is it a convention, and are there good reasons to break it?"
- "When should you extract a private helper component vs leaving the JSX inline? Walk me through the trade-offs."
- "Why use named exports instead of default exports for React components? What problems do default exports cause at scale?"
- "What is the `@/` import alias in TypeScript/Next.js? How is it configured and why is it preferred over relative paths?"

---

## SaaS Landing Page Design

- "What is the standard structure for a SaaS landing page? Why does the order Hero → Features → How It Works → Testimonial → CTA work psychologically?"
- "What is 'social proof' and why do testimonials work? How do you write a good testimonial for a B2B SaaS product?"
- "What makes a good hero section? Walk me through headline, subheadline, and CTA copy best practices."
- "What is a value proposition and how is it different from a feature list? How does the `Features` section in this build try to show value vs just listing features?"

---

## TypeScript Patterns Used

- "Explain the `type` keyword vs `interface` in TypeScript. When should you use each?"
- "What is a union type in TypeScript? Give me an example relevant to React props."
- "What does `optional chaining` mean in TypeScript? Show me examples."
- "Why do TypeScript projects use strict mode? What extra checks does it enable and what bugs does it catch?"
