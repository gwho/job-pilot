# Explanation — Feature 05: Profile Page Full UI

Deep explanations of every technical decision made during this feature.

---

## 1. Single "use client" boundary — why one component owns all state

The entire form lives in a single `ProfileForm` component marked `"use client"`. No child
components are split off into their own client components. This is a deliberate choice.

The general Next.js principle is to push the client boundary as deep (as leaf-level) as possible —
because Server Components generate zero client-side JavaScript, so the smaller the client
subtree, the smaller the bundle. But that principle applies when the page has a meaningful
amount of server-rendered content that benefits from staying off the client.

For Feature 05, the entire page *is* the interactive form. There is no static server-rendered
content to protect. Splitting `ProfileForm` into a server wrapper + leaf client components would
add file structure complexity with no bundle-size benefit.

More importantly, all state lives together. The `completionPercentage` ring in Card 1 reacts to
changes in form fields that live in Card 3. If those were separate components, either:
- State would need to be lifted to a context/provider, adding indirection
- Or each component would manage its own slice of state, making the ring impossible to compute

Single component, single state owner, zero lift needed. The simplicity is the point.

Feature 06 will add a server `initialProfile` prop fetched in `page.tsx` — at that point the
client boundary pattern remains the same; only the data source changes.

---

## 2. SVG ring mechanics — dasharray/dashoffset and the -90deg rotation

The ring is an SVG `<circle>` element. Two circles are stacked: a "track" (always fully drawn,
no dash logic) and an "arc" (the progress segment).

**Why SVG and not CSS conic-gradient?**
`conic-gradient` can draw a ring visually, but it cannot have rounded arc ends
(`stroke-linecap="round"` is an SVG-only concept). The design has a rounded arc tip.
SVG is the only option.

**stroke-dasharray and stroke-dashoffset:**
`stroke-dasharray` defines the repeating dash+gap pattern. When you set it to a single value —
the circumference of the circle — you get one "dash" exactly as long as the full circle.
By default, that dash starts at the right (the 3 o'clock position in SVG's coordinate system).

`stroke-dashoffset` shifts the starting point of the dash pattern backwards (towards the
beginning). By setting it to `circumference × (1 - percentage/100)`, you are saying: "move
the dash pattern back by the *incomplete* portion." The net effect is that only the *completed*
portion is visible.

```
circumference = 2πr = 2 × π × 40 ≈ 251.3

At 90%: offset = 251.3 × (1 - 0.9) = 25.1
        → the arc covers 90% of the circle
At 0%:  offset = 251.3 × 1 = 251.3
        → the entire dash is offset away, nothing visible
At 100%: offset = 0
         → the dash starts exactly at the beginning, full circle visible
```

**Why rotate(-90deg)?**
SVG's coordinate system starts at the 3 o'clock position. Our design wants the arc to start
at the top (12 o'clock). `transform: rotate(-90deg)` with `transform-origin: center` rotates
the drawing context so the starting point moves to the top.

**CSS transition:**
`transition: stroke-dashoffset 0.4s ease` is placed in the `style` prop of the arc circle.
When `completionPercentage` changes (recomputed by `useMemo`), React updates the
`strokeDashoffset` attribute. The browser interpolates between the old and new offset values
over 0.4s, producing a smooth fill/drain animation with zero external library.

---

## 3. Tag inputs as controlled compound components

Each tag input (Skills, Industries, Job Titles Seeking, Preferred Locations) is a two-part
UI: a text input for entering new tags, and a list of chips for existing tags.

**Why controlled and not uncontrolled?**

Uncontrolled inputs read their value directly from the DOM when needed (via a `ref`). The
input value would live in the DOM, not in React state. This fails for tag inputs for three
reasons:

1. **Programmatic clear after add**: When the user clicks "Add", the input needs to be cleared.
   With uncontrolled, you'd call `ref.current.value = ''` — you're writing to the DOM directly,
   bypassing React's render cycle. With controlled, `setSkillInput('')` triggers a re-render
   and the input value comes from React state; clearing is automatic.

2. **The chip list *is* the state**: The array of accepted tags must be in React state — it
   drives both the rendered chips and the eventual form submission. If the cursor input were
   uncontrolled, you'd have a split: chips in state, input in the DOM. A controlled input keeps
   everything in one system.

3. **Feature 06 handoff**: The Server Action will receive the tag arrays directly from React
   state — no DOM reading required. Uncontrolled inputs make this handoff awkward.

**React's single-direction data flow:**
State → render → DOM. The DOM is the output of React's render cycle, not a store. When the
user types, the `onChange` event fires, `setSkillInput` updates state, React re-renders, and
the input's `value` prop reflects the new state. The DOM is always derived from state, never
ahead of it. This is why `.clear()` / `.value = ''` on a controlled input does nothing — React
will overwrite it on the next render.

---

## 4. FormState type — why `ExperienceLevel | ''` instead of `ExperienceLevel | null`

HTML `<select>` elements render a `value` prop. React requires that a controlled `<select>`
always has a string `value`. `null` is not a valid string — React would warn and the input
would become uncontrolled.

The empty string `''` is the idiomatic "no selection" value for HTML selects. By widening the
FormState type to `ExperienceLevel | ''`, TypeScript understands that the field can legally
hold `''` during editing, even though the final saved value will be a proper `ExperienceLevel`.

The explicit type annotation `type FormState = { ... }` is required because TypeScript would
infer the type from the `useState` initializer as `{ experience_level: string, ... }` — losing
the union precision entirely. The annotation constrains the type to exactly what we intend.

When Feature 06 saves the form, it will validate that these fields are non-empty before calling
the Server Action, converting the `| ''` wide types back to their strict unions.

---

## 5. Mock data typed as `Profile` — structural typing at declaration site

```typescript
const mockProfile: Profile = { ... }
```

TypeScript checks that `mockProfile` satisfies the `Profile` interface at the *declaration
site* — the exact line where `mockProfile` is defined. This is "declaration-site type checking."

Why is this better than not annotating the constant?

Without the annotation, TypeScript infers the narrowest possible type from the literal object.
Missing fields would never be caught — TypeScript only knows what was provided, not what was
expected. If `Profile` later gains a new required field, the annotation ensures the build
breaks and the mock data must be updated. Without it, the mock silently diverges from the
real type.

TypeScript uses *structural typing* — a type is compatible if it has the right shape
(all required fields with compatible types), regardless of what it was declared as. This means
any object that looks like a `Profile` *is* a `Profile` for type-checking purposes. Java/C#
use *nominal typing* — two types are only compatible if one explicitly extends the other. In
TypeScript, you don't need to write `class MockProfile extends Profile`; the shape check is
sufficient.

All nullable fields (`string | null`) must be explicitly present as `null` in the mock data
because `string | null` is not optional (`field?`). An optional field can be omitted
entirely; a nullable field must be provided, even if the value is `null`.

---

## 6. useMemo for completionPercentage — derived state, not stored state

`completionPercentage` and `missingFields` are computed from `form`, `skills`,
`workExperience`, and `education` via `useMemo`. They are not stored in `useState`.

Why not store them?

If `completionPercentage` were in `useState`, it would need to be updated every time any
related field changed. That means adding `setCompletionPercentage` calls inside every input's
`onChange` handler. This is error-prone — if you forget to update it in one handler, the
percentage goes stale. The percentage becomes "the thing we think it is" rather than "the
thing it actually is."

With `useMemo`, `completionPercentage` is always recomputed from the ground truth (the state
arrays and form object). It can never be stale. React automatically re-runs the memo when the
dependency array changes.

The database has `is_complete` (a boolean). This is different from `completionPercentage` (a
number, 0–100). `is_complete` is computed server-side when saving and stored for efficient
querying ("show me all profiles where `is_complete = true`"). The ring shows
`completionPercentage` for a richer UI. These are complementary — the derived client number
and the stored server boolean serve different purposes.

---

## 7. NavLinks extracted as client component — why Navbar stays a server component

`usePathname()` is a React hook that reads the current URL. Hooks cannot run in Server
Components — only in Client Components. But the `Navbar` is an `async` Server Component
because it calls `getCtaHref()`, which reads the auth session server-side to decide whether
to show "Sign In" or "Dashboard."

Making the entire `Navbar` a Client Component would:
1. Force `getCtaHref()` to be replaced by a client-side fetch or a new API route
2. Add the entire Navbar (and its imports) to the client JavaScript bundle
3. Potentially cause a flash of unauthenticated state on first load

The solution: extract only the part that needs a client hook into its own `"use client"`
component. `NavLinks` is that component — it imports `usePathname()` and renders the three
nav links with active/inactive styling. The rest of `Navbar` (logo, CTA button, layout) stays
on the server.

This is the "push the client boundary to the leaf" pattern applied to layout. Server Component
contains client subtree — Next.js handles the hydration boundary automatically.

---

## 8. TagInput must live at module scope — the react-hooks/static-components rule

**The bug this rule catches:**

`TagInput` was initially written as a function *inside* the `ProfileForm` function body:

```tsx
export function ProfileForm() {
  // ...state...
  function TagInput({ label, items, ... }) {   // ← inside ProfileForm
    return <div>...</div>;
  }
  return <TagInput label="Skills" ... />;
}
```

This looks harmless, but has a critical React problem: every time `ProfileForm` re-renders
(which happens on any state change), `TagInput` is *recreated as a new function reference*.
React identifies components by reference equality. A new function reference means a new
component type. React will unmount the old `TagInput` and mount a fresh one with zero state —
on every single keystroke in the form.

For this feature, `TagInput` itself has no state (all props are passed in), so there's no
visible bug in the browser. But the ESLint rule `react-hooks/static-components` catches the
pattern at lint time because the rule is:

> "Components defined inside another component's render function get recreated on every render,
> causing any state they hold (or child state) to reset. Always define components outside of
> render functions."

**The fix:**

Move `TagInput` to module scope — outside of `ProfileForm`. Since `TagInput` only uses its
own props (no closure over `ProfileForm`'s state), this is a clean move with no behaviour
change:

```tsx
// Module scope — defined once, stable reference forever
function TagInput({ label, items, ... }) {
  return <div>...</div>;
}

export function ProfileForm() {
  // TagInput is now a stable component reference — no remounting on re-render
  return <TagInput label="Skills" ... />;
}
```

**Why `inputCls` can still be used inside `TagInput`:**

`inputCls` is a module-level constant (a string). `TagInput` is now also at module level, so
it can read `inputCls` directly. If `inputCls` were defined inside `ProfileForm` (not the
case here), `TagInput` would need it passed as a prop. Module-level constants are fine to
reference from module-level functions — no closure, no stale state issue.

**The principle:**
Never define a React component inside another component's render path. If a helper component
needs data from the parent, pass it through props. This rule ensures React's component identity
is stable across renders.
