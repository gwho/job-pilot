# Memory — Feature 01: Homepage

Last updated: 2026-06-15

## What was built

**Feature 01 — Homepage — Complete**

Components created:
- `components/layout/Navbar.tsx` — sticky top navbar, logo (`/logo.png`), Dashboard / Find Jobs / Profile nav links, "Start for free" button → `/login`
- `components/layout/Footer.tsx` — logo + dynamic copyright year
- `components/homepage/Hero.tsx` — AI-Powered Job Search badge, headline, two CTA buttons, `dashboard-demo.png` with `priority`
- `components/homepage/HowItWorks.tsx` — two alternating image+text rows: "Manage Your Job Search" (jobs-lists.png right) and "Apply With More Confidence" (agnet-log.png left). Private `Section` sub-component handles alternating layout
- `components/homepage/Features.tsx` — three value-prop cards (AI Job Discovery, Smart Scoring, Company Research) on `bg-surface-secondary`
- `components/homepage/Testimonial.tsx` — centered quote, `user-icon.png` avatar, Alex Rivera attribution
- `components/homepage/BottomCTA.tsx` — dark gradient using CSS variable refs (`var(--color-accent)` → `var(--color-overlay)`), two white/outline buttons
- `app/page.tsx` — assembles: Navbar → Hero → Features → HowItWorks → Testimonial → BottomCTA → Footer

Context files updated:
- `context/progress-tracker.md` — 01 Homepage marked ✅, Next = 02 Auth
- `context/ui-registry.md` — all 6 components registered with exact class patterns

Learning docs created:
- `docs/plan/01-homepage/plan.md`
- `docs/plan/01-homepage/explanation.md`
- `docs/plan/01-homepage/ai-discussion-topics.md`

AGENTS.md updated — added rule: after every feature create `docs/plan/<feature-slug>/` with plan.md, explanation.md, ai-discussion-topics.md

Also: there is a `docs/fixes/01-body-hydration-extension-attributes/` folder the user opened — indicates a fix was applied for a browser extension hydration attribute mismatch (likely the standard Next.js body hydration error caused by browser extensions injecting attributes). Not built in this session but worth knowing it exists.

## Decisions made

- **All homepage components are Server Components** — no interactivity needed, ships zero client JS for the page
- **Named exports everywhere** — only `app/page.tsx` uses default export (required by Next.js)
- **`BottomCTA` gradient** uses inline `style` with CSS variable refs only — not hex values. This is the only acceptable exception to the "no inline styles" rule
- **`HowItWorks` private `Section` component** — not exported, only exists to avoid duplicating the two-column grid layout
- **`Features` section before `HowItWorks`** in page order — cards give quick scannable overview before the detailed product screenshots
- **No shadcn/ui used yet** — not installed. All components use raw Tailwind. shadcn will be added when interactive components are needed (Feature 05 Profile Page or earlier)
- **Tailwind v4 `@theme` in globals.css** — no `tailwind.config.ts` for color tokens. Any new tokens go in `@theme` only

## Problems solved

- `app/page.tsx` required a Read before Write (Write tool enforces this) — always read the file first even if you know its content
- `HowItWorks.tsx` exported only `HowItWorks` (not `Section`) — keeps "one public export per file" rule intact while avoiding JSX duplication

## Current state

- Feature 01 Homepage: **complete and TypeScript clean** (`tsc --noEmit` passes with zero errors)
- All CTAs point to `/login` — that route does not exist yet (expected — Feature 02)
- No auth, no DB, no agents wired up yet
- The project has zero installed dependencies beyond Next.js 16 + React 19 + Tailwind v4 + TypeScript

## Next session starts with

**Feature 02 — Auth**

Per `context/build-plan.md`:
- Login page UI — Google OAuth button, GitHub OAuth button
- InsForge authentication (Google + GitHub OAuth)
- OAuth callback handler at `app/(auth)/callback/page.tsx`
- Session management via InsForge
- Middleware (`middleware.ts`) protecting `/dashboard`, `/profile`, `/find-jobs`, `/find-jobs/[id]`
- After login → redirect to `/dashboard`

Before starting: load the InsForge skill if one exists, check `context/library-docs.md` InsForge section, read Next.js middleware docs at `node_modules/next/dist/docs/01-app/`.

## Open questions

- Which InsForge skill is installed? Check `.agents/skills/` before writing any InsForge auth code
- Is shadcn/ui needed for the login page? If the design shows styled OAuth buttons, may need to install it or build raw
- Does the hydration fix in `docs/fixes/01-body-hydration-extension-attributes/` require any ongoing code change, or was it a one-time fix?
