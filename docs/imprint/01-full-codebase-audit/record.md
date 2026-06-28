# Imprint Audit — Full Codebase Scan

Session: `/imprint audit`
Date: 2026-06-28
Scope: All 18 component and page files across `components/` and `app/`

---

## What Was Audited

Every TSX file with UI classes:

- `components/layout/` — Navbar, NavLinks, Footer, ComingSoonCard, SignOutButton, SignOutPostHogResetButton
- `components/homepage/` — Hero, Features, HowItWorks, Testimonial, BottomCTA
- `components/find-jobs/` — FindJobsClient, SearchControls, JobFilters, JobsTable, JobsPagination
- `components/profile/` — ProfileForm (including TagInput sub-component)
- `components/analytics/` — PostHogIdentity
- `app/(auth)/login/page.tsx`
- `app/layout.tsx`

---

## Conflicts Found (3)

### 1. Primary button text token mismatch

`bg-accent` buttons must pair with `text-accent-foreground`. One button was wrong:

| Component | Button | Was | Fixed to |
|---|---|---|---|
| `ProfileForm.tsx:668` | Extract from Resume | `text-white` | `text-accent-foreground` |

Note: `--color-accent-foreground` resolves to `#ffffff` — the fix is semantic, not visual. But it means future token changes (e.g. switching to a dark accent color) propagate correctly.

### 2. Hardcoded `bg-white` in BottomCTA

`BottomCTA.tsx` used `bg-white` for the Get Started button on the gradient section. `bg-white` is a raw Tailwind class, not a design token. Fixed to `bg-surface`.

### 3. Raw white opacity values throughout BottomCTA

`text-white`, `text-white/70`, `border-white/30`, and `hover:bg-white/10` were all raw Tailwind classes. BottomCTA is the only component placed on a dark gradient surface — no tokens existed for this context.

**Resolution:** Added four new tokens to `globals.css`:

```css
--color-on-accent: #ffffff;
--color-on-accent-muted: rgb(255 255 255 / 0.7);
--color-on-accent-border: rgb(255 255 255 / 0.3);
--color-on-accent-subtle: rgb(255 255 255 / 0.1);
```

Updated BottomCTA to use: `text-on-accent`, `text-on-accent-muted`, `border-on-accent-border`, `hover:bg-on-accent-subtle`.

---

## No-conflict Properties (intentional variation confirmed)

| Property | Variation | Verdict |
|---|---|---|
| Border radius | `rounded-2xl` cards, `rounded-xl` nested sub-cards, `rounded-md` buttons/inputs | Intentional hierarchy |
| Card shadow | `shadow-sm` panels, `shadow-lg` standalone auth/coming-soon cards | Intentional elevation |
| Label style | `text-text-dark mb-1.5` for form labels, `text-text-secondary uppercase tracking-wide` for table headers | Contextually correct |
| Hover states | Per button type — `accent-dark`, `surface-secondary`, `overlay-dark` | Consistent per type |
| All borders | `border border-border` everywhere | Perfectly consistent |

---

## Files Changed

| File | Change |
|---|---|
| `components/profile/ProfileForm.tsx` | Extract button: `text-white` → `text-accent-foreground` |
| `app/globals.css` | Added `on-accent` token group (4 new tokens) |
| `components/homepage/BottomCTA.tsx` | Replaced all raw white values with `on-accent` tokens; `bg-white` → `bg-surface` |
| `context/ui-registry.md` | BottomCTA entry updated; audit baseline section appended |

---

## Baseline Written To

`context/ui-registry.md` — "Baseline — Established 2026-06-28" section at the bottom of the file. Contains the correct class for every repeating visual property in the codebase.
