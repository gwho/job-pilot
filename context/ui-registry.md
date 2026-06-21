# UI Registry

Living document. Updated after every component is built. Read this before building any new component — match existing patterns exactly before inventing new ones.

---

## How to Use

Before building any component:

1. Check if a similar component already exists here
2. If yes — match its exact classes
3. If no — build it following ui-rules.md and ui-tokens.md, then add it here

After building any component — run `/imprint` to capture patterns in this file.

---

## Components

---

### Navbar

File: `components/layout/Navbar.tsx`
Last updated: 2026-06-15

| Property         | Class                                              |
| ---------------- | -------------------------------------------------- |
| Background       | `bg-surface`                                       |
| Border           | `border-b border-border`                           |
| Border radius    | `rounded-md` (CTA button only)                     |
| Text — primary   | `text-text-darkest` (logo), `text-text-dark` (nav) |
| Text — secondary | n/a                                                |
| Spacing          | `h-16` height, `px-6` inner padding                |
| Hover state      | `hover:text-accent transition-colors` (nav links), `hover:bg-overlay-dark transition-colors` (CTA) |
| Shadow           | none                                               |
| Accent usage     | `hover:text-accent` (nav hover), `bg-overlay text-white` (CTA — uses dark overlay, not accent purple) |

**Pattern notes:**
The navbar CTA uses `bg-overlay` (near-black), not `bg-accent` (purple). This is intentional — the primary accent is reserved for in-page CTAs. Nav CTA should always be dark. Active nav state is handled by `NavLinks.tsx` (see below) — Navbar stays a Server Component; NavLinks is the thin client component that calls `usePathname()`.

---

### NavLinks

File: `components/layout/NavLinks.tsx`
Last updated: 2026-06-18

| Property         | Class                                               |
| ---------------- | --------------------------------------------------- |
| Active link      | `text-accent`                                       |
| Inactive link    | `text-text-dark hover:text-accent transition-colors` |
| Spacing          | `flex items-center gap-8`                           |
| Font             | `text-sm font-medium`                               |

**Pattern notes:**
Client-only component that renders the three nav links using `usePathname()` for active state detection. Kept separate from `Navbar` so the Navbar can remain an async Server Component. Active detection: `pathname === href || pathname.startsWith(href + '/')` — the `startsWith` catches sub-routes (e.g. `/find-jobs/123` activates "Find Jobs"). No underline on active state — color change only.

---

### Footer

File: `components/layout/Footer.tsx`
Last updated: 2026-06-15

| Property         | Class                            |
| ---------------- | -------------------------------- |
| Background       | `bg-surface`                     |
| Border           | `border-t border-border`         |
| Border radius    | none                             |
| Text — primary   | `text-text-darkest` (logo)       |
| Text — secondary | n/a                              |
| Text — muted     | `text-text-muted` (copyright)    |
| Spacing          | `py-8`, `px-6` inner             |
| Hover state      | none                             |
| Shadow           | none                             |
| Accent usage     | none                             |

**Pattern notes:**
Logo markup is identical to Navbar (Image 36×36 + `text-[19px] font-bold text-text-darkest`). Copy exactly from Navbar when building. The logo block is a candidate for extraction into a shared `<Logo />` component once reuse exceeds two locations.

---

### Hero

File: `components/homepage/Hero.tsx`
Last updated: 2026-06-15

| Property         | Class                                                           |
| ---------------- | --------------------------------------------------------------- |
| Background       | `bg-background` (section)                                       |
| Border           | `border-border` (image wrapper, secondary button)               |
| Border radius    | `rounded-full` (pill badge), `rounded-2xl` (image), `rounded-md` (buttons) |
| Text — primary   | `text-text-primary` (h1), `text-accent-foreground` (primary button) |
| Text — secondary | `text-text-secondary` (subheadline), `text-accent` (badge)      |
| Spacing          | `pt-20 pb-0` (section), `px-8` (inner), `px-6 py-3` (buttons), `px-3 py-1` (badge) |
| Hover state      | `hover:bg-accent-dark transition-colors` (primary button), `hover:bg-surface-secondary transition-colors` (secondary button) |
| Shadow           | `shadow-lg` (image wrapper)                                     |
| Accent usage     | `bg-accent text-accent-foreground` (primary button), `bg-accent-muted text-accent` (badge) |

**Pattern notes:**
Pill badge pattern: `bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full`. Use this pattern for any "category" or "label" badge on a light background. Hero image always gets `priority` — it is the LCP element. Secondary button uses `bg-surface` not `bg-transparent` to ensure it is visible on the `bg-background` page background.

---

### HowItWorks (alternating image+text section)

File: `components/homepage/HowItWorks.tsx`
Last updated: 2026-06-15

| Property         | Class                                                |
| ---------------- | ---------------------------------------------------- |
| Background       | `bg-background` (section)                            |
| Border           | `border-border` (image wrapper)                      |
| Border radius    | `rounded-2xl` (image wrapper), `rounded-full` (bullet dot) |
| Text — primary   | `text-text-primary` (heading, bullet title)          |
| Text — secondary | `text-text-secondary` (bullet description)           |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-24` (between rows), `gap-4` (between bullets) |
| Hover state      | none                                                 |
| Shadow           | `shadow-md` (image wrapper)                          |
| Accent usage     | `bg-accent` (bullet dot — 8×8px `rounded-full`)      |

**Pattern notes:**
Image wrapper uses `shadow-md` (one step lighter than Hero's `shadow-lg`). Heading is `text-3xl font-bold` (vs Hero's `text-5xl`) — this is the correct secondary heading size. Bullet dot: `w-2 h-2 rounded-full bg-accent mt-1.5 flex-shrink-0` — the `mt-1.5` aligns the dot to the first line of text. The private `Section` component handles the alternating layout via `imageLeft` boolean prop.

---

### Feature Card

File: `components/homepage/Features.tsx`
Last updated: 2026-06-15

| Property         | Class                              |
| ---------------- | ---------------------------------- |
| Background       | `bg-surface` (card), `bg-surface-secondary` (section) |
| Border           | `border border-border`             |
| Border radius    | `rounded-2xl`                      |
| Text — primary   | `text-text-primary`                |
| Text — secondary | `text-text-secondary leading-relaxed` |
| Spacing          | `p-6` (card padding), `py-16 px-8` (section), `gap-6` (grid) |
| Hover state      | none                               |
| Shadow           | `shadow-sm`                        |
| Accent usage     | none (icons are emoji)             |

**Pattern notes:**
Card uses `rounded-2xl` — this is the standard card radius for all content cards across the project (matches ui-tokens.md `--radius-xl: 16px`). Section background is `bg-surface-secondary` to visually separate from adjacent `bg-background` sections. Card heading is `text-base font-semibold` (not `font-bold`) — one weight lighter than section headings.

---

### Testimonial

File: `components/homepage/Testimonial.tsx`
Last updated: 2026-06-15

| Property         | Class                               |
| ---------------- | ----------------------------------- |
| Background       | `bg-background`                     |
| Border           | none                                |
| Border radius    | `rounded-full` (avatar image)       |
| Text — primary   | `text-text-primary` (quote, name)   |
| Text — secondary | n/a                                 |
| Text — muted     | `text-text-muted` (attribution title) |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-8` (between quote and attribution) |
| Hover state      | none                                |
| Shadow           | none                                |
| Accent usage     | none                                |

**Pattern notes:**
Quote text is `text-2xl font-medium` — larger than body text but not a heading weight. Attribution name is `text-sm font-medium text-text-primary`. Attribution title is `text-sm text-text-muted` (no font-medium). Avatar is 48×48 with `rounded-full`. No card/border wrapping — testimonial sits directly on `bg-background`.

---

### BottomCTA

File: `components/homepage/BottomCTA.tsx`
Last updated: 2026-06-15

| Property         | Class                                                        |
| ---------------- | ------------------------------------------------------------ |
| Background       | `linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)` via inline `style` — CSS variables only, no hex |
| Border           | `border-white/30` (secondary button)                         |
| Border radius    | `rounded-md` (buttons)                                       |
| Text — primary   | `text-white` (heading, secondary button), `text-text-primary` (primary button — on white bg) |
| Text — secondary | `text-white/70` (subheadline)                                |
| Spacing          | `py-24` (section), `px-8` (inner), `gap-6` (vertical), `px-6 py-3` (buttons) |
| Hover state      | `hover:bg-surface-secondary transition-colors` (primary), `hover:bg-white/10 transition-colors` (secondary) |
| Shadow           | none                                                         |
| Accent usage     | accent is the gradient start color via CSS variable ref      |

**Pattern notes:**
The only component in this project using an inline `style` prop. This is the approved exception for gradients: use `var(--color-name)` CSS variable references, never hex values. Text opacity (`text-white/70`) and background opacity (`border-white/30`, `hover:bg-white/10`) use Tailwind's `/` opacity modifier against white — this is correct for dark/gradient backgrounds. Button padding `px-6 py-3` matches Hero CTAs exactly.

---

### ComingSoonCard

File: `components/layout/ComingSoonCard.tsx`
Last updated: 2026-06-16

| Property         | Class                               |
| ---------------- | ------------------------------------ |
| Background       | `bg-surface`                        |
| Border           | `border border-border`              |
| Border radius    | `rounded-2xl`                       |
| Text — primary   | `text-text-primary` (title, `font-semibold`) |
| Text — secondary | n/a                                 |
| Text — muted     | `text-text-muted` (description)     |
| Spacing          | `p-6` (card), `mb-1` (title), `mb-6` (description) |
| Hover state      | none                                |
| Shadow           | `shadow-lg`                         |
| Accent usage     | none                                |

**Pattern notes:**
Empty-state card per `ui-rules.md` — title is `text-base font-semibold` (matches Features card heading weight), description is muted per the Empty States rule, and a `SignOutButton` serves as the rule's "CTA button if there's a logical next action." Used identically by `/dashboard`, `/profile`, `/find-jobs` placeholder pages — these are throwaway stubs, fully replaced when Features 05/09/14 build the real pages.

---

### SignOutButton

File: `components/layout/SignOutButton.tsx`
Last updated: 2026-06-17

| Property         | Class                                |
| ---------------- | ------------------------------------- |
| Background       | `bg-surface`                         |
| Border           | `border border-border`               |
| Border radius    | `rounded-md`                         |
| Text — primary   | `text-text-primary`                  |
| Spacing          | `px-4 py-2`                          |
| Hover state      | `hover:bg-surface-secondary transition-colors` |
| Shadow           | none                                  |
| Accent usage     | none — secondary button styling, not a primary action |

**Pattern notes:**
Plain `<form action={signOut}>` wrapping `SignOutPostHogResetButton`, a client-only submit button that calls `posthog.reset()` before the server action clears the session. Visual classes are unchanged from the original button and continue to match the secondary-button token combination (`bg-surface border border-border rounded-md`).

---

### PostHogIdentity

File: `components/analytics/PostHogIdentity.tsx`
Last updated: 2026-06-17

| Property         | Class |
| ---------------- | ----- |
| Background       | n/a   |
| Border           | n/a   |
| Border radius    | n/a   |
| Text — primary   | n/a   |
| Text — secondary | n/a   |
| Spacing          | n/a   |
| Hover state      | n/a   |
| Shadow           | n/a   |
| Accent usage     | n/a   |

**Pattern notes:**
Behavior-only client component mounted in `app/layout.tsx`. It renders `null`, identifies authenticated users with PostHog when `userId` is present, and resets PostHog identity when the app renders without a user.

---

### SignOutPostHogResetButton

File: `components/layout/SignOutPostHogResetButton.tsx`
Last updated: 2026-06-17

| Property         | Class |
| ---------------- | ----- |
| Background       | `bg-surface` |
| Border           | `border border-border` |
| Border radius    | `rounded-md` |
| Text — primary   | `text-text-primary` |
| Text — secondary | n/a |
| Spacing          | `px-4 py-2` |
| Hover state      | `hover:bg-surface-secondary transition-colors` |
| Shadow           | none |
| Accent usage     | none — secondary button styling, not a primary action |

**Pattern notes:**
Same visual contract as `SignOutButton`; split into a client component solely because PostHog browser identity reset requires a click handler.

---

### ProfileForm

File: `components/profile/ProfileForm.tsx`
Last updated: 2026-06-18

| Property                    | Class / Value                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Page wrapper                | `max-w-[800px] mx-auto py-8 px-6 space-y-6`                                          |
| Card                        | `bg-surface border border-border rounded-2xl p-6 shadow-sm`                          |
| Section divider             | `<hr className="border-border" />`                                                   |
| Section heading             | `text-sm font-semibold text-text-dark mb-4`                                          |
| Card heading                | `text-base font-semibold text-text-primary mb-1`                                     |
| Card subtext                | `text-sm text-text-secondary mb-4` or `mb-6`                                        |
| Banner icon (complete)      | `CheckCircle size={18} className="text-success flex-shrink-0"`                       |
| Banner icon (incomplete)    | `AlertCircle size={18} className="text-warning flex-shrink-0"`                       |
| Ring percentage label       | `text-lg font-semibold text-text-primary` (absolute-centered over SVG)               |
| Input (standard)            | `w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent` |
| Input (disabled)            | `w-full bg-surface-secondary border border-border rounded-md px-3 py-2 text-sm text-text-muted cursor-not-allowed` |
| Upload zone                 | `border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-2 bg-surface-secondary` |
| Tag chip                    | `bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1` |
| Missing field pill          | `bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full` (no × button) |
| Work entry card             | `border border-border rounded-xl p-4 space-y-4`                                      |
| Save button (primary)       | `w-full bg-accent text-accent-foreground font-medium rounded-md px-4 py-2.5 text-sm hover:bg-accent-dark transition-colors` |
| Secondary button            | `bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors` |

**Pattern notes:**
Single `"use client"` component; all state lives here. Uses `useMemo` for `completionPercentage` and `missingFields` — never store these in `useState`. The completion banner card is **always rendered** — not conditional. When `missingFields.length === 0` it shows a "Profile complete" state (`CheckCircle`, `text-success`); when incomplete it shows "Profile needs attention" (`AlertCircle`, `text-warning`) with orange pills. Dropdown `FormState` fields use `ExperienceLevel | ''` etc. (not `null`) because HTML select value must be a string. The SVG ring uses `r=40` on a `100×100` viewBox with `style={{ stroke: 'var(--color-accent)' }}` (not a Tailwind class). `TagInput` is declared at module scope outside the component function — never define a React component inside another component's render path. Upload zone uses `bg-surface-secondary` (neutral grey) — not `bg-surface-muted` (blue-tinted). Missing field pills use `bg-warning-light text-warning` (orange) — not `bg-accent-light text-accent` (purple).

---

### ConnectedAccounts (inert)

File: `components/profile/ProfileForm.tsx` (inline JSX block, not extracted)
Last updated: 2026-06-18

| Property             | Class / Value                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| Card                 | `bg-surface border border-border rounded-2xl p-6 shadow-sm`                  |
| LinkedIn logo badge  | `w-10 h-10 rounded-lg bg-linkedin flex items-center justify-center flex-shrink-0` |
| LinkedIn logo text   | `text-linkedin-foreground text-sm font-bold`                                  |
| Account name         | `text-sm font-medium text-text-primary`                                       |
| Connection status    | `text-xs text-text-muted`                                                     |
| Connect button       | `bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors` |

**Pattern notes:**
Inert UI — "Connect LinkedIn" button does nothing in Feature 05. LinkedIn logo badge uses `bg-linkedin` + `text-linkedin-foreground` brand tokens (never generic blue). The `in` text is a placeholder for the actual LinkedIn SVG icon that will be wired in a future feature. Positioned between the completion banner and Resume card.

---

### TagInput

File: `components/profile/ProfileForm.tsx` (module-level, not exported)
Last updated: 2026-06-18

| Property      | Class                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Label         | `text-sm font-medium text-text-dark mb-1.5`                                 |
| Optional hint | `text-text-muted font-normal ml-1` (inline span inside label)               |
| Chip list     | `flex flex-wrap gap-2 mb-2`                                                 |
| Chip          | `bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1` |
| × button      | `hover:text-accent-dark leading-none` + `aria-label="Remove {item}"`        |
| Input row     | `flex gap-2`                                                                |
| Add button    | `bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors whitespace-nowrap` |

**Pattern notes:**
Defined at module scope (not inside any component) to ensure React treats it as a stable component reference — see explanation.md §8. Accepts all data and handlers as props; no internal state. `onKeyDown` should call `e.preventDefault()` when Enter is pressed to prevent form submission.

---

### Login OAuth Error Message

File: `app/(auth)/login/page.tsx`
Last updated: 2026-06-17

| Property         | Class                                      |
| ---------------- | ------------------------------------------ |
| Background       | `bg-surface`                               |
| Border           | `border border-error`                      |
| Border radius    | `rounded-md`                               |
| Text — primary   | `text-error`                               |
| Text — secondary | n/a                                        |
| Text — muted     | n/a                                        |
| Spacing          | `mb-4`, `px-3 py-2`                        |
| Hover state      | none                                       |
| Shadow           | none                                       |
| Accent usage     | `border-error text-error` for failure only |

**Pattern notes:**
Small inline auth failure message rendered inside the existing login card when `/login?error=oauth` is present. It intentionally keeps the card white (`bg-surface`) and uses error color only for the border/text so it follows the rule that color goes inside cards, not on the card surface. Reuse this compact `rounded-md border border-error bg-surface px-3 py-2 text-sm font-medium text-error` pattern for future form-level auth errors.
