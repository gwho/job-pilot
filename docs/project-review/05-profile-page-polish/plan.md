# Project Review — Profile Page Polish

## Context

Feature 05 (Profile Page Full UI) was built with mock data covering all 10 required fields,
causing `completionPercentage = 100` and hiding the completion banner entirely. This was a
verification gap — the ring worked correctly when manually triggered (by clearing Full Name),
but the default page load never showed it.

A design review comparing the running app to `context/designs/profile.png` revealed five gaps
between the implementation and the reference design.

---

## Gaps Found and Fixes Applied

### Gap 1 — Ring/banner never visible on page load (PRIMARY)

**Root cause:** All 10 required fields populated in `mockProfile` → `completionPercentage = 100`
→ `missingFields.length === 0` → the outer conditional `{missingFields.length > 0 && (...)}` was
false → the entire banner card (including the SVG ring) never rendered.

**Fix:** Removed the outer conditional. The banner card always renders. When
`missingFields.length === 0`, it shows a green "Profile complete" state with `CheckCircle` icon.
When `missingFields.length > 0`, it shows the original "Profile needs attention" state with
`AlertCircle` icon and missing field pills. No mock data changes needed.

**Why simplified:** An alternative approach was to null out three mock fields to produce 70%
(showing PHONE / LOCATION / EDUCATION pills matching the reference). The user chose the simpler
path: always show the ring, switch content based on completion state. This keeps mock data intact
and makes the ring immediately visible on every page load.

---

### Gap 2 — Missing field pills were purple, reference is orange

**Root cause:** Pills used `bg-accent-light text-accent` — the project's purple accent color.
The reference design shows warning-orange pills for missing fields.

**Fix:** Changed pill classes to `bg-warning-light text-warning`. Also required adding the
`--color-warning-light: #fff3e0` token to `globals.css` and `context/ui-tokens.md` — the
warning color family was missing its `light` variant (all other semantic families had one).

---

### Gap 3 — No Connected Accounts card

**Root cause:** The Connected Accounts card was out of scope in the original Feature 05 plan.
The reference design shows it between the completion banner and the Resume card.

**Fix:** Added a static Connected Accounts card (inert UI — "Connect LinkedIn" button does
nothing, consistent with the Feature 05 inert UI contract). Uses existing `bg-linkedin`,
`text-linkedin-foreground` tokens for the LinkedIn logo badge.

---

### Gap 4 — Upload zone had a blue-tinted background

**Root cause:** Upload zone used `bg-surface-muted` (#f4f5fb), which has a subtle blue-purple
tint inherited from the accent color family. The reference shows a neutral-grey upload zone.

**Fix:** Changed to `bg-surface-secondary` (#f9fafb — neutral grey, no color tint).

---

### Gap 5 — Banner subtext wording diverged from reference

**Root cause:** Subtext was written independently of the reference screenshot.

**Fix:** Updated to match reference verbatim:
"Complete the following fields to improve your chances of getting quality resumes."

---

## Files Changed

| File | Action |
|------|--------|
| `app/globals.css` | Add `--color-warning-light: #fff3e0` |
| `context/ui-tokens.md` | Document new token + Warning/Attention Pills table |
| `components/profile/ProfileForm.tsx` | 5 changes: ring always visible, CheckCircle import, pill colors, subtext, Connected Accounts card, upload zone bg |
| `context/ui-registry.md` | Update ProfileForm entry |

---

## Verification

1. On load: ring card visible with green "Profile complete" state, ring at 100%
2. Clear Phone Number field → ring drops to 90%, "Profile needs attention" state, PHONE pill orange
3. Clear Location field → ring drops to 80%, LOCATION pill appears
4. Restore fields → ring returns to 100%, switches back to "Profile complete" state
5. Connected Accounts card visible between banner and Resume
6. "Connect LinkedIn" button renders, no console errors
7. Upload zone neutral grey (not blue-tinted)
8. `npx tsc --noEmit` — clean
9. `npm run lint` — clean
