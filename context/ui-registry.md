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
The navbar CTA uses `bg-overlay` (near-black), not `bg-accent` (purple). This is intentional — the primary accent is reserved for in-page CTAs. Nav CTA should always be dark. Active nav items (future feature) use `text-accent` per ui-rules.md.

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
