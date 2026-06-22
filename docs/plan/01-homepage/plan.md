# Feature 01 — Homepage — Implementation Plan

## What Was Built

The complete public homepage for JobPilot — a static marketing page that converts visitors into sign-ups. No auth logic, no data fetching. All CTAs link to `/login`.

---

## Files Created

| File | Purpose |
|---|---|
| `components/layout/Navbar.tsx` | Sticky top navbar with logo, nav links, CTA |
| `components/layout/Footer.tsx` | Minimal footer with logo and copyright |
| `components/homepage/Hero.tsx` | Center-aligned hero with headline, CTAs, dashboard screenshot |
| `components/homepage/HowItWorks.tsx` | Two alternating image+text sections showing product flow |
| `components/homepage/Features.tsx` | Three value-prop cards with icons |
| `components/homepage/Testimonial.tsx` | Centered quote with avatar |
| `components/homepage/BottomCTA.tsx` | Dark gradient CTA block |
| `app/page.tsx` | Assembles all sections in order |

---

## Page Assembly Order

```
Navbar
main:
  Hero
  Features       ← three value-prop cards
  HowItWorks     ← two alternating image+text rows
  Testimonial    ← centered quote
  BottomCTA      ← dark gradient block
Footer
```

---

## Key Design Decisions

### All Server Components — no `"use client"`
The homepage has no interactivity (no state, no event handlers, no browser APIs). Every component is a React Server Component. This means the entire page is pre-rendered as HTML on the server — zero client JavaScript for the homepage.

### Token compliance — never hardcode hex
All colors use Tailwind utility classes generated from the `@theme` tokens in `globals.css`. The one exception is `BottomCTA`'s gradient, which uses `style={{ background: 'linear-gradient(...)' }}` with CSS variable references (`var(--color-accent)`) — not hex values.

### Named exports — never default exports
Every component uses `export function ComponentName()`. The only default export is `app/page.tsx` because Next.js requires it for page files.

### `priority` on Hero image
The dashboard screenshot is the page's Largest Contentful Paint (LCP) element. `priority` on `next/image` tells Next.js to preload it, which improves Core Web Vitals scores.

### Images from `public/`
All images (`/logo.png`, `/images/dashboard-demo.png`, etc.) live in `public/` and are referenced as absolute paths from the root. `next/image` handles resizing, WebP conversion, and lazy loading automatically.

### HowItWorks private `Section` component
The `HowItWorks` file contains a private `Section` component that handles the alternating layout. It is not exported — it only exists to avoid duplicating the two-column grid logic. The public export is `HowItWorks` only.

---

## Verification Checklist

- [ ] `npm run dev` — no TypeScript errors, no console errors
- [ ] Navbar: logo renders, three nav links, "Start for free" button visible
- [ ] Hero: badge, headline, both CTA buttons, dashboard screenshot with shadow
- [ ] Features: three cards in a grid
- [ ] HowItWorks: two sections with alternating layout (text+image, image+text)
- [ ] Testimonial: quote text, avatar, name, title
- [ ] BottomCTA: dark gradient background, white headline, two buttons
- [ ] Footer: logo, copyright text
- [ ] All CTAs (`/login`) do not 404 — they can 404 for now since auth isn't built yet
- [ ] No hex values or raw Tailwind color classes (`bg-purple-500`, etc.) in any file
