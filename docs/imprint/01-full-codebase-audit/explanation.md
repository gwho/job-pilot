# Why UI Consistency Matters — And How This Audit Enforced It

---

## The problem `/imprint audit` solves

When a UI is built across multiple sessions — especially with AI assistance — each component gets built in isolation. The agent has no memory of what it built three sessions ago. So over time:

- Border radius drifts: some cards are `rounded-xl`, others `rounded-2xl`, one is `rounded-lg` — no one decided this, it just accumulated.
- Text colors vary slightly: `text-text-primary` here, `text-gray-800` there, an inline `color: #101828` somewhere else.
- Button text tokens diverge: `text-accent-foreground` in one place, `text-white` in another — visually identical now, but one will break if the design system changes.

The damage from this is invisible until it's expensive to fix. The app looks fine. But the codebase is no longer a coherent system — it's a collection of one-off decisions that happen to look similar.

`/imprint audit` fixes this by scanning everything at once, surfacing every deviation, and establishing a written baseline before more components get built.

---

## Why semantics matter even when the rendered output is identical

The most instructive conflict found in this audit was conflict #1: the Extract from Resume button using `text-white` instead of `text-accent-foreground`.

Visually: identical. Both resolve to `#ffffff`. The user sees no difference.

But semantically they are completely different:

- `text-white` is a raw Tailwind class. It means "render this text in pure white, always."
- `text-accent-foreground` is a design token. It means "render this text in whatever color the design system says should appear on top of the accent color."

The difference becomes critical the moment the design evolves. If the team ever darkens the accent color — say from `#7c5cfc` to `#5e4cff` — or switches to a light-mode accent that needs dark text, every `text-accent-foreground` token updates automatically. Every `text-white` stays white. One button would now have illegible text. And it would be very hard to find, because it looks fine in the current theme.

The rule: whenever you place text on a token-defined background (`bg-accent`, `bg-overlay`, etc.), always use the corresponding foreground token. Never use a raw color.

---

## The on-accent token group — why it was created

BottomCTA is the only component in this project placed on a dark gradient surface. The gradient runs from `--color-accent` to `--color-overlay`. On that background, standard text tokens (`text-text-primary`, `text-text-secondary`) are unreadable — they're dark text designed for the light `bg-surface` context.

The previous solution was to use raw Tailwind white values:
- `text-white` — pure white text
- `text-white/70` — 70% opacity white for secondary text
- `border-white/30` — 30% opacity white for borders
- `hover:bg-white/10` — 10% opacity white for hover backgrounds

These worked visually, but they bypassed the design system entirely. If the gradient background ever changed — say to a lighter accent — every one of these would need to be found and updated manually. There's no way for the design system to propagate that change.

The solution was to name this context explicitly. Four new tokens were added to `globals.css`:

```css
--color-on-accent: #ffffff;
--color-on-accent-muted: rgb(255 255 255 / 0.7);
--color-on-accent-border: rgb(255 255 255 / 0.3);
--color-on-accent-subtle: rgb(255 255 255 / 0.1);
```

Now the intent is captured in the token name. `text-on-accent-muted` tells the next developer: "this text lives on the accent surface, and it's the secondary/muted variant." The token values can be updated in one place.

The naming convention follows the same pattern as `accent-foreground` — it names the surface the element is *on*, not what the element looks like. This is the correct mental model for design tokens: they express relationships, not appearances.

---

## Why `bg-white` is wrong but `bg-surface` is right

The Get Started button in BottomCTA used `bg-white`. The fix replaced it with `bg-surface`.

Both resolve to `#ffffff` in the current theme. But they mean different things:

- `bg-white` = "this element is pure white, forever, regardless of the design system"
- `bg-surface` = "this element uses whatever the design system defines as the surface color"

`bg-surface` is `--color-surface: #ffffff` — it happens to be white right now. But in a dark mode implementation, `--color-surface` would become a dark card color. Every `bg-surface` element would correctly become dark. Every `bg-white` element would stay blindingly white.

The rule: never use `bg-white` or `bg-black`. Use `bg-surface` (cards, inputs, white elements) or `bg-overlay` (near-black surfaces).

---

## The intentional variation principle

Not all variation is a mistake. The audit confirmed several cases where different values are correct:

**Border radius hierarchy:** `rounded-2xl` (top-level cards), `rounded-xl` (nested sub-cards like work experience entries), `rounded-md` (buttons, inputs). The decreasing radius as you nest deeper is a deliberate visual signal — nested elements feel "tighter" than their containers. This is a standard design pattern. It would be wrong to standardize everything to `rounded-2xl`.

**Shadow elevation:** `shadow-sm` for inline panel cards (they sit within a page layout, low elevation is correct), `shadow-lg` for standalone auth and coming-soon cards (they float alone on the page, higher elevation is correct). Flattening this to one value would remove visual information about the component's context.

**Label styles:** Form labels use `text-sm text-text-dark mb-1.5`. Table/filter column headers use `text-xs text-text-secondary uppercase tracking-wide`. These are different because they serve different functions — form labels guide input, column headers categorize data. Same label style everywhere would be visually monotonous and semantically unhelpful.

The skill of reading a UI audit is knowing the difference between drift (unintended variation) and hierarchy (intentional variation that encodes meaning).

---

## What the ui-registry.md baseline now provides

Before this audit, `ui-registry.md` had individual component entries but no cross-component baseline. A developer building a new component had to read through 15+ component entries to infer the common patterns.

After the audit, the baseline section at the bottom of `ui-registry.md` gives a single reference table: one row per visual property, one correct class per property. A developer building Feature 12 (Job Details Page) can:

1. Open `ui-registry.md`
2. Scroll to the baseline table
3. See exactly what class to use for card background, card border, primary button, text input, etc.
4. Build the component without guessing or checking examples

The baseline is also the thing that `/imprint` updates going forward. Each new component either matches the baseline (no conflict) or extends it (new component type added to the registry).
