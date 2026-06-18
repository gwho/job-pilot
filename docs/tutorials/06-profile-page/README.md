# Tutorial 06 — Profile Page: Client Boundaries, Controlled Forms, SVG Rings, and Derived State

**After completing this tutorial you will understand:** when to make a whole component
`"use client"` vs. extracting a thin client leaf, how React's one-way data flow makes
controlled inputs the only sensible choice for compound form UIs, why `useMemo` is the
correct primitive for values that are computed rather than stored, the SVG math behind
an animated progress ring, the TypeScript trick for select dropdowns that would break
with `null`, and the ESLint rule that catches a React bug invisible at runtime but
devastating in stateful children.

> [!NOTE]
> **Prerequisites:** Tutorial 02 (`02-auth/README.md`) — the Navbar is a Server
> Component that calls `getCtaHref()`, and that context is needed for Part 6. Tutorial
> 05 (`05-database-schema/README.md`) — `Profile`, `WorkExperienceEntry`, and the
> literal union types (`ExperienceLevel`, `RemotePreference`, etc.) are defined in
> `types/index.ts` and used directly in this feature. Open
> [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx) and
> [`components/layout/NavLinks.tsx`](../../../components/layout/NavLinks.tsx) alongside
> this tutorial.

---

## How To Use An LLM Before This Tutorial

This tutorial covers several concepts that are easier to absorb if you've already had a
short warm-up conversation with an AI about them in plain terms *before* looking at real
code. The prompts below are designed for that. Feed them to your preferred LLM one at a
time, attempt your own answer first, then compare. They take 15–20 minutes and will make
every "Checkpoint" question in this tutorial feel like recognition rather than discovery.

### Concept 1: React's render model and controlled inputs

> "Explain React's one-way data flow in plain language. What does it mean for a `<input>`
> to be 'controlled' vs 'uncontrolled'? Give me a small code example of each, and
> describe what happens to each one when I try to clear it programmatically after a user
> clicks a button."

*What to listen for:* The key is that a controlled input's value comes from state — the
DOM reflects state, not the other way around. `input.value = ''` on a controlled input
does nothing because React will overwrite it on the next render.

### Concept 2: `useState` vs `useMemo` — stored vs derived state

> "I have a form with 10 fields and a 'completion percentage' that shows how many fields
> are filled. Should I store the percentage in `useState` and update it in every
> `onChange` handler, or compute it with `useMemo`? Explain the failure mode of the
> first approach."

*What to listen for:* Stored derived state can go stale if any one handler forgets to
update it. `useMemo` makes the value always the function of its inputs — it cannot drift.

### Concept 3: React component identity and the module-scope rule

> "What does React use to identify a component type across re-renders? What happens if a
> component is defined *inside* another component's function body — what changes about its
> identity on each render, and why does that cause problems for child state?"

*What to listen for:* React compares component types by reference equality. A function
defined inside a render body is a new reference on every render → React treats it as a
brand new type → unmounts the old one and mounts a fresh one → all child state is lost.

### Concept 4: Server vs Client Components and the leaf pattern

> "In Next.js App Router, I have a Navbar that reads session data server-side (needs to
> be a Server Component) but also has nav links that need to highlight the active route
> with `usePathname()` (needs a Client Component hook). How do I keep the Navbar as a
> Server Component while still using the hook?"

*What to listen for:* The answer is to extract only the hook-dependent part into its own
`"use client"` component — the leaf. The server component renders the leaf as a child.
The leaf renders on the server too during SSR, then hydrates with the hook on the client.

### Concept 5: SVG stroke-dasharray and stroke-dashoffset

> "Explain how stroke-dasharray and stroke-dashoffset work on an SVG circle to create a
> progress arc. Walk me through the math: if the circle's circumference is 251, what
> offset value shows 75% progress? Why is a rotation of -90 degrees needed to start the
> arc at the top of the circle?"

*What to listen for:* `dasharray = circumference` → one "dash" covers the whole circle.
`dashoffset = circumference × (1 - progress)` → shifts the dash start so only the
progress portion is visible. SVG starts at 3 o'clock; rotating by -90° moves it to 12.

---

## Architecture: what this feature is

The entire `/profile` route is one large interactive form. Three cards stacked
vertically, all controlled by a single `ProfileForm` component:

```
app/profile/page.tsx  (Server Component — no state, no hooks)
├── <Navbar />        (Server Component — reads auth session for CTA button)
│     └── <NavLinks /> (Client Component — uses usePathname() for active state)
└── <ProfileForm />   (Client Component — "use client", owns ALL state)
      ├── Card 1: Completion banner + SVG donut ring
      ├── Card 2: Connected Accounts
      ├── Card 3: Resume upload zone
      └── Card 4: Profile Information
            ├── Personal Info section
            ├── Professional Info section (with TagInputs)
            ├── Work Experience section (dynamic rows)
            ├── Education section
            └── Job Preferences section (with TagInputs)
```

State ownership: `ProfileForm` holds everything. There is no context, no prop drilling
past one level, no external state library. The SVG ring in Card 1 reacts to fields
edited in Card 4 — both live in the same component, so no lifting is needed.

---

## Part 1 — The "use client" decision: when to push to the leaf vs own it all

Open [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
line 1:

```tsx
"use client";

import { useState, useMemo } from "react";
```

The entire file is a Client Component. This is intentional. The general Next.js principle
is "push the client boundary as deep (as leaf-level) as possible" — because Server
Components produce zero client-side JS, keeping more of the tree server-rendered reduces
bundle size.

But that principle has a prerequisite: **there must be server-rendered content worth
protecting.** Here there isn't. The profile page is a fully interactive form — every
card, every input, the SVG ring, the tag chips all need client-side state and event
handlers. Making `ProfileForm` a server wrapper with leaf client components would add
file structure complexity with no measurable bundle benefit.

More importantly, **the ring in Card 1 reacts to inputs in Card 4.** The
`completionPercentage` that drives the SVG offset is computed from `form`, `skills`,
`workExperience`, and `education` — all of which live in Card 4's sections. If those
were separate components, you'd need one of:

- A Context provider wrapping everything (adds indirection, boilerplate)
- Props drilled from a parent (adds coupling)
- Each component managing its own slice (makes the ring impossible to compute from one place)

Single component, single state owner. The complexity lives in one clearly-bounded file,
not spread across a component tree.

The principle to take away: **"push to the leaf" is about minimising unnecessary client
JS. It is not a rule that applies when the entire subtree is interactive.**

**Checkpoint:** Feature 06 will add a server-fetched `initialProfile` prop to
`ProfileForm`. Does that require changing `"use client"` to a server component?

<details>
<summary>Reveal answer</summary>

No. A Server Component (like `app/profile/page.tsx`) can pass props to a Client
Component child. The data fetching happens on the server in `page.tsx`; the prop crosses
the hydration boundary and arrives at `ProfileForm` as a plain JavaScript value.
`ProfileForm` remains `"use client"`. The boundary stays where it is — only the data
source changes. The prop value must be serialisable (plain objects, strings, numbers,
arrays — no functions, no class instances, no Dates) to cross the boundary.
</details>

---

## Part 2 — State architecture: four separate buckets

Look at the state declarations in `ProfileForm` (lines 175–219):

```tsx
// 1. Scalar form fields — one useState for the whole flat object
const [form, setForm] = useState<FormState>({ ... });

// 2. Tag arrays — each gets its own useState
const [skills, setSkills] = useState<string[]>(...);
const [industries, setIndustries] = useState<string[]>(...);
const [jobTitlesSeeking, setJobTitlesSeeking] = useState<string[]>(...);
const [preferredLocations, setPreferredLocations] = useState<string[]>(...);

// 3. Structural objects — complex enough to merit their own state
const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>(...);
const [education, setEducation] = useState<Education>(...);

// 4. Cursor state for tag inputs — transient, never saved
const [skillInput, setSkillInput] = useState("");
const [industryInput, setIndustryInput] = useState("");
const [jobTitleInput, setJobTitleInput] = useState("");
const [locationInput, setLocationInput] = useState("");
```

Why not one giant `useState` for everything? Because updates to nested objects require
spreading the whole object, which is painful for deeply nested structure:

```tsx
// Updating a single work entry's company field — needs manual spread at every level
setEverything(prev => ({
  ...prev,
  workExperience: prev.workExperience.map((entry, i) =>
    i === index ? { ...entry, company: newValue } : entry
  )
}))
```

By keeping `workExperience` in its own `useState`, the update is:

```tsx
setWorkExperience(prev => prev.map((entry, i) =>
  i === index ? { ...entry, company: newValue } : entry
))
```

Same spread logic, but scoped to only the thing that changed.

**Checkpoint:** The `form` object is *one* `useState` holding all scalar fields (strings,
dropdowns). Why is it not split into `full_name`, `phone`, `location`, etc. each with
their own `useState`?

<details>
<summary>Reveal answer</summary>

The scalar fields are all leaf values that change independently with no inter-field
computed logic. Grouping them in one object means one `setForm` call can update multiple
fields simultaneously (useful when Feature 07's AI extraction overwrites several fields
at once: `setForm(prev => ({ ...prev, ...extractedFields }))`). If each field were a
separate `useState`, a multi-field update would require firing multiple setters in
sequence, which triggers multiple renders. The object shape also mirrors the database
`Profile` row — cognitive alignment between the form state and what gets saved.
</details>

---

## Part 3 — `FormState`: why `ExperienceLevel | ''` instead of `ExperienceLevel | null`

Look at `FormState` (lines 69–82):

```tsx
type FormState = {
  full_name: string;
  phone: string;
  // ...
  experience_level: ExperienceLevel | "";     // ← note: '' not null
  work_authorization: WorkAuthorization | ""; // ← same
  remote_preference: RemotePreference | "";   // ← same
  cover_letter_tone: CoverLetterTone | "";    // ← same
};
```

And the select element that uses it (lines 668–685):

```tsx
<select
  value={form.experience_level}    // ← React requires a string here
  onChange={(e) =>
    setField("experience_level", e.target.value as ExperienceLevel | "")
  }
>
  <option value="">Select...</option>   // ← maps to ''
  <option value="junior">Junior</option>
  ...
</select>
```

React's `<select>` component requires the `value` prop to be a `string`. Passing `null`
triggers a React warning and causes the input to become uncontrolled — the internal
value lives in the DOM, not in React state, breaking the controlled pattern.

The empty string `''` is the HTML-native "no selection" value: the `<option value="">
Select...</option>` sentinel. When a user hasn't chosen yet, `form.experience_level` is
`''`. When they choose "Junior", it becomes `'junior'`. This works cleanly as a string
throughout — no `null`-to-string conversion required anywhere in the render path.

The explicit `type FormState = { ... }` annotation is required for a second reason:

```tsx
// Without the annotation, TypeScript infers this for experience_level:
const [form, setForm] = useState({
  experience_level: mockProfile.experience_level ?? ""  // inferred as: string
  //                                                    NOT: ExperienceLevel | ""
})
```

TypeScript widens `'junior'` to `string` in the `useState` initialiser unless the type
is annotated. With `useState<FormState>(...)`, TypeScript holds the union type
throughout and catches `experience_level: 'wizard'` as an error.

When Feature 06 saves the form, it converts `''` back to `null` before writing to the
database — the `| ''` widening is local to the editing phase, not the storage phase.

**Try it yourself:** Comment out the `: Profile` annotation on line 21 of
`ProfileForm.tsx` (`const mockProfile: Profile = {`). Run `npx tsc --noEmit`. Notice
that TypeScript no longer knows `experience_level` must be `ExperienceLevel` — it
infers `string`. Now delete `full_name` from `mockProfile` entirely. With the
annotation: compile error immediately. Without it: no error, silently diverged. Undo
before moving on.

---

## Part 4 — `useMemo` for derived state: the completion ring's foundation

Find the `completionPercentage` computation (lines 224–238):

```tsx
const completionPercentage = useMemo(() => {
  const checks = [
    form.full_name.trim() !== "",
    (mockProfile.email ?? "").trim() !== "",
    form.phone.trim() !== "",
    form.location.trim() !== "",
    form.current_title.trim() !== "",
    form.experience_level !== "",
    form.years_experience !== "" && Number(form.years_experience) > 0,
    skills.length > 0,
    workExperience.length > 0,
    education.degree !== null && education.degree !== "",
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}, [form, skills, workExperience, education]);
```

`completionPercentage` is not in `useState`. It's derived from state.

### Why not `useState`?

If it were stored:

```tsx
// Fragile — every handler must remember to recalculate
const [completionPercentage, setCompletionPercentage] = useState(70);

// In the skills handler:
const newSkills = [...skills, trimmed];
setSkills(newSkills);
setCompletionPercentage(recalculate(form, newSkills, workExperience, education));
// ↑ What if you forget this in one of the 15 handlers? The ring shows a stale value.
```

With `useMemo`, forgetting to call anything is impossible — there is nothing to call.
React re-runs the memo function automatically whenever any value in the dependency array
changes. The percentage is always the current truth, never a cached approximation.

### What happens if a dependency is missing from the array?

```tsx
// Bug: 'skills' is not in the dep array
const completionPercentage = useMemo(() => {
  const checks = [
    // ...
    skills.length > 0,   // ← reads skills
    // ...
  ];
  return Math.round(...);
}, [form, workExperience, education]);  // ← skills missing!
```

React would not re-run the memo when `skills` changes. The ring would freeze at its
last value while the Skills section updates normally. The bug is invisible until you add
your first skill — the ring doesn't move when the Skills chip appears. ESLint's
`react-hooks/exhaustive-deps` rule catches exactly this: any variable read inside the
memo that isn't in the array is flagged.

### `is_complete` (DB boolean) vs `completionPercentage` (client number)

The database stores `is_complete: boolean` (Feature 06 sets it on save). The ring shows
`completionPercentage: number` (0–100). These are complementary:

- `is_complete` is for efficient server-side queries: `WHERE is_complete = true`
- `completionPercentage` is for the UI ring: a binary boolean can't animate to 90%

Neither replaces the other. The client derives the number; the server stores the boolean.

**Checkpoint:** `missingFields` is also a `useMemo` (lines 240–254), derived from the
same state. Could both be computed in one `useMemo` call that returns `{ percentage,
missing }`? What are the trade-offs?

<details>
<summary>Reveal answer</summary>

Yes — they iterate the same 10 checks and could share one pass. The trade-off is
granularity: two separate memos re-run independently. If something changes
`completionPercentage` but not `missingFields` (theoretically not possible here since
both use the same fields, but in a more complex form it could be), merging them would
cause both to re-run when only one changed. Separate memos are the conservative default.
Merging is a valid micro-optimisation once the form is stable and profiling shows the
memo re-computation is measurable.
</details>

---

## Part 5 — SVG ring: the math behind `strokeDashoffset`

Find the ring values in `ProfileForm` (lines 335–337) and the SVG markup (lines
396–435):

```tsx
// The math — computed fresh on every render from completionPercentage
const ringRadius = 40;
const ringCircumference = 2 * Math.PI * ringRadius;  // ≈ 251.3
const ringOffset = ringCircumference * (1 - completionPercentage / 100);
```

```tsx
<svg width="100" height="100" viewBox="0 0 100 100">
  {/* Track — always a full circle, no dash logic */}
  <circle cx="50" cy="50" r={ringRadius} fill="none" strokeWidth="8"
    style={{ stroke: "var(--color-border)" }} />

  {/* Progress arc — the actual ring */}
  <circle
    cx="50" cy="50" r={ringRadius} fill="none" strokeWidth="8"
    strokeLinecap="round"
    strokeDasharray={ringCircumference}      // one "dash" = full circumference
    strokeDashoffset={ringOffset}            // shift it back by the incomplete portion
    style={{
      stroke: "var(--color-accent)",
      transform: "rotate(-90deg)",
      transformOrigin: "center",
      transition: "stroke-dashoffset 0.4s ease",  // browser interpolates on change
    }}
  />
</svg>
```

### Step-by-step: what `strokeDasharray` and `strokeDashoffset` do

`strokeDasharray` defines a "dash pattern" — a repeating sequence of dash and gap
lengths. When you set it to a single value equal to the full circumference, you create
**one dash exactly as long as the whole circle**. No gap. The entire circle becomes one
dash.

`strokeDashoffset` shifts the start of the dash pattern backward. Positive offset moves
the dash start *earlier* — away from where the drawing would begin — leaving a gap at
the start. Here's what different values produce:

```
circumference = 251.3

completionPercentage = 100% → offset = 251.3 × (1 - 1.0) = 0
  The dash starts exactly at the drawing origin. Full circle visible.

completionPercentage = 75% → offset = 251.3 × (1 - 0.75) = 62.8
  The dash is shifted back 62.8 units. Only 75% of the arc is visible.

completionPercentage = 0% → offset = 251.3 × (1 - 0) = 251.3
  The dash is shifted back by the full circumference. Nothing visible.
```

### Why `rotate(-90deg)` — not `rotate(90deg)`

SVG's coordinate system originates from the right (3 o'clock position — the positive x
axis). The dash, by default, starts drawing there. The design wants the arc to start at
the top (12 o'clock). Moving from 3 o'clock to 12 o'clock is a counter-clockwise
rotation of 90 degrees. In CSS/SVG transforms, counter-clockwise is negative:
`rotate(-90deg)`. Rotating +90deg would move the start to the bottom (6 o'clock),
which is wrong.

`transformOrigin: "center"` ensures the rotation is around the circle's own centre
(50, 50), not the SVG viewport's origin (0, 0).

### Why SVG and not CSS `conic-gradient`?

`conic-gradient` can draw a ring visually, but it cannot have **rounded arc ends** —
`stroke-linecap="round"` is an SVG-exclusive concept. The design has a rounded tip on
the arc. SVG is the only option for that.

### The animation

```tsx
transition: "stroke-dashoffset 0.4s ease"
```

When `completionPercentage` changes, React updates the `strokeDashoffset` attribute on
the DOM element. The `transition` CSS property tells the browser: "when `stroke-dashoffset`
changes on this element, interpolate from the old value to the new value over 0.4
seconds." No animation library. No `requestAnimationFrame`. The browser handles it.

**Try it yourself:** Open the running dev server (`npm run dev`) and navigate to
`/profile` (you'll be redirected to `/login` — log in first, or temporarily comment out
the `proxy.ts` matcher). Clear the "Full Name" field. Watch the ring drop from 100% to
90% with the 0.4s ease animation. Then clear "Phone" — down to 80%. Then add a skill
chip — back up. The animation runs in both directions.

**Checkpoint:** The two SVG circles share identical `cx`, `cy`, `r`, and `strokeWidth`
values. Why is there a "track" circle at all — why not just the progress arc on an
empty background?

<details>
<summary>Reveal answer</summary>

At 0% completion, the progress arc is completely offset — nothing is drawn. If there
were no track, the ring area would be empty/invisible, which looks broken rather than
"empty state." The track circle uses `var(--color-border)` (a light grey) to show the
full ring shape at all completion percentages, giving the progress arc a visible "rail"
to fill. The track has no `strokeDasharray` or `strokeDashoffset` — it's always fully
drawn. It simply sits behind the arc in the SVG layer order (declared first in the
markup, painted first, underneath).
</details>

---

## Part 6 — Controlled tag inputs: how the add/clear cycle works

Look at `makeTagHandlers` (lines 264–286):

```tsx
function makeTagHandlers(
  items: string[],
  setItems: React.Dispatch<React.SetStateAction<string[]>>,
  input: string,
  setInput: React.Dispatch<React.SetStateAction<string>>
) {
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !items.includes(trimmed)) {   // deduplicate
      setItems([...items, trimmed]);
      setInput("");                               // ← clears the input
    }
  };
  const remove = (item: string) =>
    setItems(items.filter((i) => i !== item));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();   // prevent form submission
      add();
    }
  };
  return { add, remove, onKey };
}
```

`setInput("")` is the key line. Trace what happens in React's render cycle when a user
types "React" and clicks Add:

```
1. User types "React" into the input
   → onChange fires → setSkillInput("React") → re-render
   → input DOM element value = "React" (driven by skillInput state)

2. User clicks "Add"
   → add() fires
   → setSkills([...skills, "React"]) → schedules re-render
   → setSkillInput("") → schedules re-render

3. React batches both updates and re-renders once
   → skills state now includes "React" → new chip appears
   → skillInput state is now "" → input DOM element value = ""

4. React commits the new DOM — input is cleared, chip is visible
```

Step 4 is why "clear" works without touching the DOM directly. React owns the input
value. `setSkillInput("")` updates the state; React re-renders the input with
`value=""`. If the input were uncontrolled (`defaultValue` instead of `value`), step 4
would not clear the input — React doesn't manage the DOM value for uncontrolled inputs,
so there's nothing to update.

`makeTagHandlers` is a factory function, not a component. It returns plain event
handler objects. Each set of four tag inputs gets its own handlers:

```tsx
const skillHandlers = makeTagHandlers(skills, setSkills, skillInput, setSkillInput);
const industryHandlers = makeTagHandlers(industries, setIndustries, ...);
// etc.
```

The closures inside each call capture the specific state arrays and setters for that
tag — `skillHandlers.add` closes over `skills` and `setSkills`, so it updates the right
array when called.

**Checkpoint:** `items.includes(trimmed)` prevents adding duplicate tags. But `items` is
a closure variable captured at the time `makeTagHandlers` was called. If `items` is
stale (a render just added a new item but the closure hasn't refreshed), could a
duplicate slip through?

<details>
<summary>Reveal answer</summary>

`makeTagHandlers` is called on every render of `ProfileForm` (it's not memoised). Every
time any state changes, `ProfileForm` re-renders and fresh closures are created with the
current `items`. So by the time the user could click "Add" a second time, the component
has re-rendered at least once (from the first add) and `items` in the new closure
reflects the updated array. A true stale-closure duplicate race would only be possible
if two "Add" clicks happened before a single render cycle completed — not possible with
user interaction, but would be in concurrent React. For a form like this, the current
pattern is correct and readable. If this were called from automated code or rapid batch
processing, `setItems(prev => ...)` with a functional update would be the safe version.
</details>

---

## Part 7 — `TagInput` at module scope: the invisible bug ESLint caught

Look at the comment on lines 98–99 in `ProfileForm.tsx`:

```tsx
// ---------------------------------------------------------------------------
// TagInput — declared at module level to avoid React re-creating it on render
// ---------------------------------------------------------------------------
function TagInput({ label, items, ... }) { ... }
```

This placement is documented because the component was originally defined *inside*
`ProfileForm`'s function body. That version passed TypeScript type-checking cleanly and
produced the correct visual output. The bug was invisible. ESLint's
`react-hooks/static-components` rule caught it at lint time.

### What the bug was

```tsx
// ❌ BROKEN — the version before the fix
export function ProfileForm() {
  const [form, setForm] = useState<FormState>({ ... });

  // ← TagInput defined HERE, inside ProfileForm
  function TagInput({ label, items, onAdd, ... }) {
    return <div>...</div>;
  }

  return (
    <div>
      <TagInput label="Skills" items={skills} ... />
    </div>
  );
}
```

Every time `ProfileForm` re-renders (every state change — every keystroke, every tag
add, every field edit), the `function TagInput` declaration is executed again. A new
function object is created. It has a new reference in memory.

React identifies component types by reference equality: `TagInput_old !== TagInput_new`
→ these are different component types. React unmounts the old `TagInput` tree and mounts
a fresh one. Every time. On every single keystroke in the form.

### Why it was invisible in this feature

`TagInput` has no internal state. It's purely a display component driven by props. So
unmounting and remounting it produces no visible difference — the same props produce the
same output. The performance overhead (unnecessary DOM mutations) exists but isn't
perceptible in a small form.

### When it would be catastrophic

Imagine a version of `TagInput` with a local loading state:

```tsx
// Hypothetical TagInput with internal state
function TagInput({ ... }) {
  const [isLoading, setIsLoading] = useState(false);  // ← internal state
  // ...
}
```

Every re-render of `ProfileForm` would unmount this `TagInput` and mount a fresh one.
`isLoading` resets to `false` on every keystroke. If a user typed quickly while an async
validation was running, the loading indicator would flash and reset constantly — a
completely broken UX that would be near-impossible to debug without knowing the root
cause.

### The fix: module scope

```tsx
// ✅ CORRECT — at module scope, outside ProfileForm
function TagInput({ label, items, ... }) {
  return <div>...</div>;
}

export function ProfileForm() {
  // TagInput is now a stable reference — the same object every render
  return <TagInput label="Skills" ... />;
}
```

Module-level functions have stable references for the lifetime of the module. React sees
the same `TagInput` object on every render → no unmount/remount → correct identity.

**The principle:** Never define a React component inside another component's render
path. If a helper component needs data from the parent, pass it through props.

**Try it yourself:** Move `TagInput` back inside `ProfileForm` (just the function
declaration, before the `return`). Run `npm run lint`. Look for the
`react-hooks/static-components` rule violation. Then move it back to module scope and
confirm lint passes.

---

## Part 8 — NavLinks: extracting the client leaf from a server parent

Look at [`components/layout/NavLinks.tsx`](../../../components/layout/NavLinks.tsx) in
full:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Find Jobs",  href: "/find-jobs"  },
  { label: "Profile",   href: "/profile"    },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-8">
      {NAV_ITEMS.map(({ label, href }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`text-sm font-medium transition-colors ${
              isActive ? "text-accent" : "text-text-dark hover:text-accent"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

And the `Navbar` that contains it (from Tutorial 02, now with `<NavLinks />`):

```tsx
// components/layout/Navbar.tsx
export async function Navbar() {
  const ctaHref = await getCtaHref();   // ← async, reads auth session server-side

  return (
    <header ...>
      <Link href="/">...</Link>         {/* server-rendered */}
      <NavLinks />                       {/* ← client leaf */}
      <Link href={ctaHref}>...</Link>   {/* server-rendered */}
    </header>
  );
}
```

`usePathname()` is a React hook. Hooks cannot run in Server Components. `Navbar` is an
async Server Component (it calls `getCtaHref()` which reads the auth session) — it
cannot become a Client Component without losing that server-side session read.

The solution: extract *only* the part that needs the hook (`NavLinks`) into its own
`"use client"` file. Everything else (logo, CTA button) stays server-rendered.

### What `as const` does to `NAV_ITEMS`

```tsx
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  ...
] as const;
```

Without `as const`, TypeScript infers `href` as `string`. With `as const`, TypeScript
infers it as `"/dashboard"` (a literal type). This allows Next.js's `<Link href={...}>`
to benefit from the narrower type and prevents accidentally assigning a non-route string.
It also makes the array deeply readonly — `NAV_ITEMS.push(...)` would be a type error.

### How `usePathname` triggers re-renders on navigation

When a user clicks a `<Link>`, Next.js performs a "soft navigation" — it updates the URL
and re-renders the relevant page segments without a full browser reload. `usePathname()`
subscribes to these navigation events. When the pathname changes, `NavLinks` re-renders
with the new `pathname` value, and `isActive` recalculates for each link. This is why
the active link updates instantly without a page reload.

**Checkpoint:** What would happen if you moved `getCtaHref()` out of `Navbar` and into a
`useEffect` inside a client version of `Navbar`? Describe the user-visible consequence.

<details>
<summary>Reveal answer</summary>

The CTA button would first render with a placeholder value (e.g., the href would be
undefined or `/login` by default), then after the `useEffect` fires and the async call
completes, it would update to the correct value. The user would see a brief flash of the
wrong state — the button showing "Sign In" for a logged-in user, or "Dashboard" for a
logged-out user, before correcting itself. This is the flash-of-unauthenticated-state
problem that server-side session reads specifically avoid. The server knows the session
before a single byte of HTML is sent to the browser.
</details>

---

## Part 9 — Work experience rows: immutable array update patterns

The work experience section is a dynamic list of up to 3 entries. Look at
`updateWorkEntry` (lines 319–326):

```tsx
function updateWorkEntry(index: number, updates: Partial<WorkExperienceEntry>) {
  setWorkExperience((prev) =>
    prev.map((entry, i) => (i === index ? { ...entry, ...updates } : entry))
  );
}
```

And the "currently working here" checkbox (lines 823–838):

```tsx
<input
  type="checkbox"
  checked={entry.current}
  onChange={(e) =>
    updateWorkEntry(index, {
      current: e.target.checked,
      endDate: e.target.checked ? null : entry.endDate,
      // ↑ atomic update: toggle current AND update endDate in one call
    })
  }
/>
```

Three patterns worth isolating:

**1. Functional update form:** `setWorkExperience(prev => ...)` takes a function
instead of a value. This guarantees the update runs against the latest state, not a
stale closure capture. For updates derived from existing state (the `.map()` here),
always use the functional form.

**2. Immutable array update:** React's state must never be mutated directly.
`workExperience[index].company = newValue` would mutate the existing array in place —
React would not detect the change because the array reference hasn't changed. The
`.map()` creates a new array and a new object at `index`, so React detects the reference
change and re-renders.

**3. Atomic multi-field update:** `updateWorkEntry` accepts `Partial<WorkExperienceEntry>`
— a partial object. When the "currently working here" checkbox fires, it sets both
`current` and `endDate` in a single call. The spread `{ ...entry, ...updates }` merges
the partial into the full entry. This avoids a brief intermediate state where `current`
is `true` but `endDate` still has a value.

The End Date field's conditional rendering:

```tsx
{!entry.current && (
  <div>
    <label>End Date</label>
    <input value={entry.endDate ?? ""} ... />
  </div>
)}
```

When `entry.current` becomes `true`, this JSX evaluates to `null` → React unmounts the
End Date input → the field disappears. The value `entry.endDate` was already set to
`null` in the same `updateWorkEntry` call. Both the UI (hidden) and the state (null) are
in sync.

---

## Self-check quiz

<details>
<summary><strong>1. The whole ProfileForm is "use client". The Navbar is async (server). Both are on the same page. How does Next.js handle rendering a Client Component (ProfileForm) as a sibling of a Server Component (Navbar) in page.tsx?</strong></summary>

`app/profile/page.tsx` is a Server Component that renders both. During the server-side
pass, Next.js renders `<Navbar />` fully and renders `<ProfileForm />` as a
pre-rendered shell (HTML output of the initial state, using the mock data). That HTML is
sent to the browser. When the JS bundle loads in the browser, React hydrates
`ProfileForm` — attaches event handlers to the existing HTML — and the component becomes
interactive. `Navbar` doesn't need hydration because it has no client-side interactivity.
</details>

<details>
<summary><strong>2. What exactly does the `as const` assertion do to NAV_ITEMS, and what TypeScript error would you get if you accidentally wrote `href="/dashbord"` (typo) as one of the items?</strong></summary>

`as const` makes the array deeply readonly and narrows every string value to a literal
type (`"/dashboard"` not `string`). However, TypeScript would not catch `"/dashbord"` as
a typo — `"/dashbord"` is a valid string literal, just a wrong one. What `as const`
protects against is dynamic assignment: `NAV_ITEMS[0].href = "/other"` would be a type
error. The route typo would need a stricter type like `type AppRoute = "/dashboard" |
"/find-jobs" | "/profile"` applied to the `href` field.
</details>

<details>
<summary><strong>3. Why is `setWorkExperience(prev => prev.map(...))` better than `setWorkExperience(workExperience.map(...))`?</strong></summary>

The second form closes over `workExperience` from the outer render scope. If two state
updates are batched in the same event (possible in React 18's concurrent mode), the
second update might read a stale `workExperience` that doesn't include the first
update's changes. The functional form `prev => ...` always receives the latest state as
of when that specific update is applied, regardless of batching. For updates derived from
existing state, the functional form is always the safe choice.
</details>

<details>
<summary><strong>4. `completionPercentage` uses `useMemo` but `ringRadius` and `ringCircumference` are plain const declarations. Why doesn't `ringCircumference` need `useMemo`?</strong></summary>

`ringCircumference` is `2 * Math.PI * 40` — a pure computation from constants. It never
changes. `useMemo` is for values that depend on *state* — values that might be different
on each render based on the current state. A computation from constants produces the
same value on every render; there is nothing to memoize. `useMemo` on constants would
add overhead (React runs the cache-check machinery) with no benefit.
</details>

<details>
<summary><strong>5. If `TagInput` were moved back inside `ProfileForm` and we added `const [focused, setFocused] = useState(false)` inside `TagInput`, what specific user experience bug would occur and when would it first be visible?</strong></summary>

Every time any state in `ProfileForm` changes (typing in any field, adding a skill,
editing work experience), `ProfileForm` re-renders. This recreates `TagInput` as a new
function reference → React unmounts the old `TagInput` (losing `focused = true`) and
mounts a fresh one (starting with `focused = false`). The visible bug: a user clicks
into the tag input (setting `focused = true`, which might show a dropdown or highlight
ring), then types a character (triggering a re-render) → focus state resets → any
focus-dependent UI disappears mid-typing. It would be visible on the first keystroke
after focusing the input.
</details>

---

## Extend it (challenges)

### Challenge 1 — Add a fourth nav item

Add a `/settings` route to `NavLinks` that renders as active when the URL is
`/settings` or any sub-path (`/settings/billing`, `/settings/team`, etc.).

Requirements:
- Add to the `NAV_ITEMS` array (maintaining `as const`)
- The `isActive` logic already handles sub-paths — confirm it works for `/settings/billing`
- `app/settings/page.tsx` doesn't exist yet — add a `ComingSoonCard` placeholder
  following the pattern from Tutorial 04

<details>
<summary>Hint</summary>

```tsx
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Find Jobs",  href: "/find-jobs"  },
  { label: "Profile",   href: "/profile"    },
  { label: "Settings",  href: "/settings"   },  // ← add this
] as const;
```

The existing `isActive` check: `pathname === href || pathname.startsWith(href + "/")` — this correctly handles `/settings/billing` because `/settings/billing`.startsWith`("/settings/")` is `true`.
</details>

### Challenge 2 — Add a fifth completion check

The current `completionPercentage` has 10 checks. Add an 11th: "at least one job title
seeking must be entered." Update `completionPercentage` and `missingFields` together.

Requirements:
- `missingFields` should push `"JOB TITLES"` when `jobTitlesSeeking.length === 0`
- Both `useMemo` calls must include `jobTitlesSeeking` in their dependency arrays
- Run `npx tsc --noEmit` after — the type should be clean

<details>
<summary>Hint</summary>

In `completionPercentage`:
```tsx
const checks = [
  // ...existing 10 checks...
  jobTitlesSeeking.length > 0,  // ← add this
];
```

In `missingFields`:
```tsx
if (jobTitlesSeeking.length === 0) missing.push("JOB TITLES");
```

Both dependency arrays: add `jobTitlesSeeking` alongside `skills`. Then confirm the
ring drops when you remove all job titles from the mock data.
</details>

### Challenge 3 — Break and fix the ring formula

In `ProfileForm.tsx`, temporarily change the ring offset formula from:

```tsx
const ringOffset = ringCircumference * (1 - completionPercentage / 100);
```

to:

```tsx
const ringOffset = ringCircumference * (completionPercentage / 100);  // ← inverted
```

Open `/profile` in the browser and observe what changes. Then reason from the
`strokeDashoffset` math (Part 5) to explain exactly what this inverted formula produces,
and restore the correct formula.

---

For deeper, open-ended exploration, `docs/plan/05-profile-page/ai-discussion-topics.md`
has 21 prompts covering the client boundary decision, SVG math, `usePathname`
re-render mechanics, structural typing, `useMemo` dependency bugs, and the
component-identity problem. Feed them to an LLM *after* forming your own answer first —
that gap between "what I think" and "what the LLM says" is where learning lands.
