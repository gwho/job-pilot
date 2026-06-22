# Explanation — Profile Page Polish: Project Review

---

## 1. Why the ring was invisible despite being an explicit requirement

This is the core question from the `/btw` note during the session, answered comprehensively.

### What the ring's visibility actually depends on

The SVG ring was built correctly. The `stroke-dashoffset` formula, the `-90deg` rotation,
the CSS transition — all of that worked. The ring was invisible for a completely different reason:
**it was conditionally rendered based on whether any required fields were missing**, and the mock
data was so complete that no fields were ever missing.

The render logic looked like this:

```tsx
{missingFields.length > 0 && (
  <div className="bg-surface ...">
    {/* AlertCircle, heading, pills, SVG ring */}
  </div>
)}
```

When `missingFields.length === 0` — which was always true with the fully-populated mock data —
the entire outer `<div>` was skipped. React never rendered the ring at all.

### The chain that caused it

1. `mockProfile` was typed as `Profile` and given all 10 required fields
2. `FormState` initialised from `mockProfile` — all fields populated
3. `completionPercentage` computed by `useMemo` → 100%
4. `missingFields` computed by `useMemo` → `[]` (empty array)
5. `missingFields.length === 0` → `false` in the conditional
6. The entire banner card (including the SVG ring) was never rendered

The SVG ring literally did not exist in the DOM on page load.

### Why was the mock data fully populated?

This was a deliberate choice made during the Feature 05 build: typed mock data is better for
catching TypeScript shape drift. If `mockProfile` is typed as `Profile`, TypeScript checks at
declaration time that every required field is present and has the right type. If `Profile` later
gains a new required field, the build fails and forces the mock to be updated.

Leaving fields `null` would have worked at the type level (most fields are `string | null`),
but the `null` values would have needed to be intentionally chosen for the *right* fields to
produce a meaningful partial completion state.

The problem was not the decision to fully populate the mock data — it was a verification gap:
**the verification checklist verified the ring worked (it did) but did not verify the default
page view was representative.**

### The verification gap

The Feature 05 verification checklist item was:
> "Banner shows SVG ring with correct percentage + missing field pills"

The check was performed by manually clearing the Full Name field. That proved the ring worked.
But it did not prove the ring was visible on first page load without any user interaction.

A complete verification would have included:
> "On fresh page load (no user interaction), is the ring visible?"

This is the principle of **representative default state**: when building a UI component with
conditional visibility, the mock data should represent the state where the component is visible.
If the component only shows when something is wrong, and the mock data represents everything
being right, the component never shows during development — and any visual divergence from the
reference design is undetectable until a real project review.

### The fix decision

Two approaches were considered:

**Option A: Null out three mock fields** — phone, location, and education — to produce 70%
completion and show three pills (PHONE, LOCATION, EDUCATION). This would match the reference
screenshot exactly.

**Option B: Always show the ring card** — remove the outer conditional entirely. Show a
"complete" state (green `CheckCircle`) when at 100%, and the "attention" state when incomplete.
No mock data changes needed.

The user chose Option B. The reasoning: simpler, no mock data surgery, and the ring is always
visible regardless of completeness — which is actually better UX anyway. A user who has
completed their profile still sees the 100% ring as confirmation. The ring is always visible,
always reactive, always meaningful.

---

## 2. How `missingFields.length === 0` hides the banner — conditional rendering explained

React uses short-circuit evaluation for conditional rendering:

```tsx
{condition && <Component />}
```

When `condition` is `false`, React evaluates to `false && <Component />` which is `false`.
React renders `false` as nothing — it produces no DOM output. This is not an error; it is
intentional. The component is not mounted, not in the DOM, not painted.

The key point: **"hidden" and "not rendered" are different.** CSS `opacity: 0` or
`visibility: hidden` hides an element but it still exists in the DOM. The `&&` pattern
removes it from the DOM entirely. The SVG ring was absent, not invisible.

This matters for animation too: when you toggle from "not rendered" to "rendered", there is
no initial DOM state for CSS transitions to interpolate from. The `transition: stroke-dashoffset
0.4s ease` would not animate on first appearance from a conditional render — it would snap to
the current value. This is another reason to always render the card: the ring can animate
smoothly every time the user changes a field.

---

## 3. Representative default state — why mock data completeness matters

When building a UI with conditional rendering, the mock data must put the component into a
state where the conditional renders the thing you're building.

This is the principle of **representative default state** for UI development. It applies
whenever:

1. You're building a component that only shows under certain conditions
2. You're using mock data that controls those conditions
3. The default state of the mock data satisfies the condition for hiding (not showing) the
   component

In this case: the banner shows when `missingFields.length > 0`. The mock data had all fields
filled, so the banner never showed. The developer could work on the banner's contents, test
the ring formula, verify the pill layout — all by manually triggering it — but the default
page view never matched the reference design.

**The rule to remember:** Before writing mock data, look at every `&&` or ternary in the
component. For each conditional: what mock data state would cause the conditional to show the
part you're building? Make sure the mock data is in that state, or write the mock to cover
both branches (two constants: one for each state).

For the completion ring: the "needs attention" branch is the visually rich one (ring + pills).
The mock data should have had `phone: null` (or similar) so this branch was always the default
visible state during development.

---

## 4. Token families and why `warning-light` was missing

The project's semantic color families follow a naming convention:

| Family   | Base        | Dark             | Light              | Lightest              | Foreground              |
|----------|-------------|------------------|--------------------|-----------------------|-------------------------|
| Accent   | `--color-accent` | `--color-accent-dark` | `--color-accent-light` | `--color-accent-muted` | `--color-accent-foreground` |
| Success  | `--color-success` | `--color-success-dark` | `--color-success-light` | `--color-success-lightest` | `--color-success-foreground` |
| Info     | `--color-info` | `--color-info-dark` | `--color-info-light` | `--color-info-lightest` | `--color-info-foreground` |
| Warning  | `--color-warning` | _(missing)_ | _(missing until now)_ | _(missing)_ | `--color-warning-foreground` |
| Error    | `--color-error` | _(missing)_ | _(missing)_ | _(missing)_ | `--color-error-foreground` |

Warning and Error are the thinnest families — they were only given a base color and foreground
(for text on solid warning/error backgrounds). This is fine if warning is only used for solid
backgrounds. But the reference design uses a soft orange pill — light background, orange text
— which requires a `warning-light` token.

The fix added `--color-warning-light: #fff3e0` — a light warm yellow-orange that works as a
badge/pill background against `text-warning` (#ff8904). The value `#fff3e0` is the standard
"50-level" orange from design systems (equivalent to Tailwind's `orange-50`).

**The principle:** When you need `bg-X-light text-X` for a badge pattern, you need a `light`
token in the color family. If it's missing, add it. Don't reach for an approximation from
another family (`bg-accent-light` is purple-light, not orange-light).

---

## 5. The Connected Accounts card — scope, the inert UI contract, and project reviews

### Why it was deferred in Feature 05

The Feature 05 plan was explicit: build the profile form UI with mock data. The reference design
includes a Connected Accounts card, but the scope was "profile information form" — not all
cards on the page. The inert UI contract (Feature 05 buttons do nothing) makes it safe to add
UI components without backend plumbing. But the plan simply didn't include it.

This is a scope miss, not a technical miss. The feature worked as specced. The project review
caught the visual gap.

### Why project reviews are the right time to add inert UI

The inert UI contract makes scope expansion low-cost during reviews. "Connect LinkedIn" does
nothing — there is no API call to write, no Browserbase session to start, no state to manage.
The entire Connected Accounts card is pure HTML + CSS. Adding it in a project review (before
real data is wired in) is correct because:

1. The cost is low (one static JSX block)
2. The visual match to the reference is measurable immediately
3. Adding it later (after Feature 06 wires data) would require testing that the inert button
   didn't accidentally break anything around it

The inert UI contract also documents future work clearly: "Connect LinkedIn" button exists,
renders correctly, does nothing → Feature NN wires the OAuth flow.

### LinkedIn brand tokens

The Connected Accounts card uses `bg-linkedin` and `text-linkedin-foreground` for the logo
badge. These tokens exist in `globals.css` and were set up when the LinkedIn source badge
pattern was documented. The principle: third-party brand colors never come from guesses or
design-system approximations — they come from the brand's official palette, stored as named
tokens so the value can never drift.

---

## 6. `bg-surface-muted` vs `bg-surface-secondary` — semantic intent of surface variants

| Token                   | Value     | Tint                        | Intent                              |
|-------------------------|-----------|-----------------------------|-------------------------------------|
| `bg-surface`            | #ffffff   | None (pure white)           | Card surfaces, modal backgrounds    |
| `bg-surface-secondary`  | #f9fafb   | Neutral grey (no hue)       | Disabled inputs, upload zones, subtle fills |
| `bg-surface-tertiary`   | #f2f5f7   | Slight cool-grey            | Deeper nested surfaces              |
| `bg-surface-muted`      | #f4f5fb   | Blue-purple (accent tint)   | Muted accent fills, hover states on accent elements |

`bg-surface-muted` exists to create subtle blue-purple tinted backgrounds — consistent with the
`accent` (#7c5cfc, purple) color family. It's correct for things like the inside of an active
badge or a hover state on a purple button's ghost variant.

An upload zone is not an accent element. It has no purple relationship. Using `bg-surface-muted`
made it faintly blue-purple, which diverged from the reference's neutral grey. `bg-surface-secondary`
is the right choice: neutral, no color association, standard for secondary/muted UI areas.

**The rule:** `surface-muted` = accent-tinted. `surface-secondary` = neutral grey. When in
doubt, look at the hex value. If it has a visible blue-purple cast in a color picker, it's muted.

---

## 7. What a project review is for — and when to run one

A project review catches divergence between the implementation and the reference design before
the feature gets wired to real data.

The cost of fixing visual bugs increases as a feature progresses:

| Stage | Cost to fix visual bug |
|-------|------------------------|
| Feature 05 (mock data, inert UI) | Low — change JSX, no state or data concerns |
| Feature 06 (Server Actions, real data) | Medium — changes must not break form submission |
| Feature 07 (AI extraction, PDF) | High — multiple layers involved |
| Post-launch | Very high — user-facing changes need regression testing |

Running a project review at the end of Feature 05 (before Feature 06 starts) is the lowest-cost
moment to fix these gaps. All five gaps in this review took less than 30 minutes to fix. The
same fixes after Feature 06 would have required verifying that data loading, form state, and
save logic all still worked correctly around the visual changes.

**The rule:** Run `/project-review` at the end of every major UI feature before the next feature
starts wiring real data. The moment the branch is "done but not yet integrated" is the cheapest
time to catch visual divergence.

A secondary benefit: project reviews build a documented record of intentional scope decisions.
The Connected Accounts card was not a bug — it was a scoped omission. The project review doc
makes that explicit. Future sessions reading `docs/project-review/05-profile-page-polish/` will
understand why the card was added and when.
