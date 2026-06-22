# Feature 05 — Architect Session: Full Discussion Record

This document is a comprehensive record of every concept explored during the architect session
for Feature 05. Each section preserves the full explanation — not just the conclusion, but the
reasoning, the wrong alternatives, and the analogies that make the concept stick.

---

## 1. SVG Progress Ring

### stroke-dasharray and stroke-dashoffset from first principles

Every SVG stroke is secretly a series of dashes and gaps. By default the dash is infinite, so
you see a solid line. `stroke-dasharray` overrides that pattern. `stroke-dasharray="10 5"` means:
10px of ink, then 5px of nothing, then repeat. A single value like `stroke-dasharray="30"` means
the dash and the gap are both 30px.

The progress ring trick exploits this with one specific input: set `stroke-dasharray` equal to
the **full circumference of the circle**. Now the pattern is: one dash as long as the whole
circle, then a gap as long as the whole circle. Since the path is exactly as long as one dash,
the entire ring appears as a solid line — just one complete dash around the full circle.

`stroke-dashoffset` shifts where that dash pattern *starts* — it's a backwards offset along the
path. If dashoffset is 0, the dash starts at the beginning and the full ring is visible. If
dashoffset equals the circumference, the dash is shifted back by one full dash length, which
means the gap is on top — nothing is visible.

Everything between those two extremes is a partial arc:

```
dashoffset = circumference × (1 − percentage / 100)

// 70% filled:
dashoffset = 314 × (1 − 0.70) = 314 × 0.30 = 94.2
```

### Why 2πr and not the diameter

The circumference is the *length of the path itself* — how many pixels you'd travel if you
walked along the edge of the circle. That length is 2πr. The diameter (2r) is a straight-line
measurement from one side to the other. It has nothing to do with how long the curved path is.

If you used 2r = 100 as your dasharray on a circle with r=50 (circumference ≈ 314px), you'd
be saying "repeat the pattern every 100px along a 314px path." You'd get three partial dashes
around the ring instead of one continuous arc, and the offset math would be completely wrong —
a 70% offset would mean shifting by 70px, not 70% of the arc.

**The rule:** dasharray values are distances along the path. Always use the path's own length.

### CSS transition for animation

`stroke-dashoffset` is a numeric CSS property. When React re-renders and changes the value,
the browser interpolates from the old number to the new one:

```css
.progress-ring-arc {
  transition: stroke-dashoffset 0.4s ease;
}
```

React sets the final value; CSS handles everything in between. The animation runs on the
compositor thread — React is not involved after the render. This is zero-overhead, hardware-
accelerated, and requires no library.

**Compared to a React animation library (Framer Motion):**

| | CSS transition | Framer Motion |
|---|---|---|
| Who interpolates | Browser compositor | JS or WAAPI |
| Mount animation | Not possible (no "previous value") | `initial` prop handles it |
| Exit animation | Cannot animate unmounting | `AnimatePresence` |
| Complexity | None | Library import |

For a profile ring: CSS transition is all you need.

One subtlety: on first render, a CSS transition won't fire because there's no previous value.
If you want the ring to fill in on page load, use a `useEffect` + `setState` after mount to
trigger the transition, or use `initial` from Framer Motion.

### SVG vs CSS conic-gradient

**CSS conic-gradient approach:**
```css
background: conic-gradient(#7c5cfc 70%, #e7eaf3 70%);
border-radius: 50%;
```

Creates a pie chart. To make it look like a ring, overlay a smaller white circle in the center.
Simpler HTML, no math, but:

- **Sharp edges**: conic-gradient always has a hard edge where fill meets track. SVG gives
  `stroke-linecap="round"` for the rounded arc tip visible in the design.
- **Animation**: Animating a conic-gradient stop position has rougher browser support than
  animating `stroke-dashoffset`.
- **Text centering**: SVG's absolute coordinates make it trivial to overlay the percentage
  text. conic-gradient requires z-index and absolute positioning juggling.

The deciding factor for this project: the design shows a **rounded arc tip**. That requires
`stroke-linecap="round"`, which is SVG-only.

---

## 2. Controlled vs Uncontrolled Inputs

### The core difference

An **uncontrolled input** lets the DOM own the value. React renders the input once and steps
back. You read the value when you need it via a ref:

```tsx
const inputRef = useRef<HTMLInputElement>(null)
<input ref={inputRef} defaultValue="" />
// Read on demand:
const value = inputRef.current?.value
```

A **controlled input** makes React own the value. State is the source of truth:

```tsx
const [text, setText] = useState("")
<input value={text} onChange={(e) => setText(e.target.value)} />
```

In a controlled input, the DOM is always downstream of state. React renders what state says.

### Why the skills tag input must be controlled

The skills input must **clear itself after the user adds a skill**. This is the moment that
breaks the uncontrolled model.

With an uncontrolled input, the only way to clear programmatically is:
```tsx
inputRef.current.value = "" // writing to DOM outside React's render cycle
```

This works mechanically, but React has no record that the input is empty. If anything triggers
a re-render — parent state change, sibling update — React may reconcile against its last-known
value, not the DOM's actual value.

What would break with an uncontrolled approach:

1. **Clearing after add**: With controlled, clearing is just `setText("")`. React re-renders
   with `value=""` and the DOM follows. No DOM mutation, no sync issue.

2. **Validation feedback**: To warn "already added" on a duplicate, you'd need to read
   `inputRef.current?.value` on every keystroke — forcing an `onChange` handler anyway, which
   is a worse version of controlled.

3. **Feature 06 handoff**: When the Save button wires to a Server Action, you need to check
   whether the input still has unsaved text. With controlled, it's just `skillInput` from
   state. With uncontrolled, you'd have to interrogate the DOM mid-submit.

**General rule**: Uncontrolled inputs are appropriate when you only ever *read* from them
(a file input, a search field read on submit). The moment you need to *write* to an input
programmatically — clear it, prefill it, reset it — React must own the value.

### React's single-direction data flow vs reading from the DOM

React's unidirectional cycle:
```
state → render() → DOM → user event → setState → (loop)
```

State is always the entry point. DOM is always the output. Data flows one direction only.

For the skills array, this means `skills: string[]` serves two purposes simultaneously:

```tsx
// Display — same variable:
{skills.map(skill => <Chip key={skill} label={skill} onRemove={() => removeSkill(skill)} />)}

// Submission (Feature 06) — same variable:
const payload = { ...profileFields, skills }
await saveProfile(payload)
```

At any point, `skills` is a plain JavaScript array that is authoritative, serializable, and
complete. No DOM interrogation needed.

**If you read from the DOM instead**, the problems are:

- **Structure coupling**: You'd parse chip elements — `document.querySelectorAll('.chip')` —
  extracting their text content. Rename a class, restructure the chip, and the scraping breaks.
- **Intermediate state**: The DOM can be in-between states during animations. Is a chip
  halfway through its removal animation still in the skills list? State answers unambiguously.
- **SSR**: On the server, there is no DOM. State works identically on server and client.

**The principle**: The DOM is a projection of state. Never reverse the flow by reading state
back out of the DOM.

---

## 3. TypeScript Structural Typing and Mock Data

### Structural typing — what it means

TypeScript checks *shape*, not *name*. Two types are compatible if they have the same property
names and types, regardless of what the types are called:

```typescript
type Profile = { id: string; skills: string[] }
type User    = { id: string; skills: string[] }

const p: Profile = { id: "1", skills: ["React"] }
const u: User = p // valid — same shape, different names
```

This is **structural typing**. TypeScript doesn't care that `Profile` and `User` are distinct
declarations. It asks: "does this value have everything the target type requires?"

### Nominal typing in Java and C\#

Nominal typing makes compatibility depend on *declared identity*, not structure:

```java
// Java
class Profile { String id; }
class User    { String id; }

Profile p = new Profile()
User u = p  // compile error — Profile is not declared to be a User
```

For two Java types to be interchangeable, one must `extends` the other or both must `implements`
a common interface. Structure alone is not enough. The **name** establishes identity.

TypeScript chose structural typing because JavaScript objects are bags of properties. There was
never a way to say "this object is officially a Profile" — only "this object has these keys."
TypeScript models the language as it already works.

### Why TypeScript checks at the declaration site

When you annotate a variable:
```typescript
const mockProfile: Profile = {
  id: "123",
  full_name: "Taryn Ali",
  // missing phone — TypeScript errors HERE
}
```

The annotation `mockProfile: Profile` tells TypeScript your *intent* at the point you write it.
It doesn't wait until you pass `mockProfile` to a function. The declaration is the contract,
and TypeScript validates it the moment you assign a value.

Without the annotation:
```typescript
const mockProfile = { id: "123", full_name: "Taryn Ali" }
```

TypeScript infers `{ id: string; full_name: string }` — not `Profile`. You'd get no error until
you tried to use it somewhere that expects a `Profile`, and that error message would be a long
shape mismatch diff instead of "you declared this as Profile, here's what's missing."

**The annotation does two things**: asserts intent and triggers the check at the right place.

### `string | null` fields — why you must still provide them all

`string | null` is a *value type*, not an optionality marker. It says: "this field must be
present; its value is either a string or null." Contrast with optional:

```typescript
phone?: string | null   // field may be absent entirely, or present as string or null
phone: string | null    // field must be present; its value is string or null
```

Without `?`, the field is required. For nullable fields in the mock, you write `phone: null` —
the field is present, its value is explicitly "no value."

### Why `Partial<Profile>` would be wrong for mock data

`Partial<T>` makes every field optional. With `Partial<Profile>`, you could skip any field
and TypeScript would not complain:

```typescript
const mock: Partial<Profile> = { id: "123", full_name: "Taryn" }
// TypeScript: fine. phone, location, skills... all optional now.
```

**The problems:**

1. **Type changes every field**: `phone` on `Profile` is `string | null`. On `Partial<Profile>`
   it becomes `string | null | undefined`. These are different. A component checking
   `if (phone !== null)` does not guard against `undefined`. The bug surfaces only when
   Feature 06 connects real data (which is `string | null`, never `undefined`).

2. **Removes the compile-time test**: Typing mock data as `Profile` verifies that your
   components can handle a real profile *before* the database is wired. Partial turns off
   that verification — TypeScript lets you ship components that have never handled null fields.

3. **The swap becomes unsafe**: When Feature 06 replaces the mock, fields that were absent
   (`undefined`) in the mock may now be present as `null`. Code that accidentally worked with
   `undefined` may not handle `null` correctly.

**The principle**: Mock data typed as `Profile` is a rehearsal. Every field, every `null`,
every empty array exercises real code paths. Partial lets you skip the rehearsal.

---

## 4. Next.js Client/Server Boundaries

### "use client" doesn't mean "browser only"

A component marked `"use client"` still renders on the **server** during SSR. The directive means:

- This component may use browser APIs, React hooks, and event handlers
- Its JavaScript is included in the bundle shipped to the browser
- React will **hydrate** it in the browser — re-render it there and attach event listeners

Server Components never run in the browser. Their code never appears in the JS bundle. They
produce HTML and nothing else runs client-side.

| | Server Component | Client Component |
|---|---|---|
| Renders on server | Yes | Yes (SSR) |
| Renders in browser | No | Yes (hydration) |
| Uses useState/hooks | No | Yes |
| In JS bundle | No | Yes |
| Awaits DB/cookies | Yes | No |

### Where hydration happens and why it matters for forms

SSR renders the full page HTML server-side, including the form with its initial values. The
browser receives this HTML and displays it immediately — no blank screen while JS loads.

Then hydration runs: React's JS arrives, React re-renders `ProfileForm` in memory with the same
initial values (same mock data), compares virtual DOM to server HTML (they must match), and
attaches all event listeners.

**Why this matters for Feature 06**: When real data replaces mock data, `page.tsx` (Server
Component) fetches the profile from InsForge and passes it as `initialProfile` to ProfileForm.
The same HTML is produced server-side and client-side (both use `initialProfile`), hydration
is clean, and the form is instantly interactive with real data — no loading spinner, no flash
of empty fields.

### Why push the client boundary to leaf level

Two concrete benefits:

1. **Bundle size**: Every Server Component kept off the client = less JavaScript shipped.
   A page where only the interactive parts are Client Components ships less code than the
   same page entirely as a Client Component.

2. **Server-side data access**: If the client/server split is at the page level (page.tsx =
   server, ProfileForm = client), the page can `await` the DB query on the server and pass
   `initialProfile` to the form as a prop — no `useEffect`, no loading state, no client-side
   fetch, no flicker.

For Feature 05, this is academic (mock data). For Feature 06, it is the correct architecture.

---

## 5. Feature Split Pattern — UI-Only vs Logic

### Why this split reduces bugs

Feature 05 (mock data) and Feature 06 (real data) separate two categories of bugs:

**UI bugs**: Missing field, wrong token, broken tag input, ring calculation off, layout broken.
These are visible immediately, reproduce every reload, and have nothing to do with the backend.

**Data bugs**: RLS policy rejection, malformed upsert, cookie not forwarded to Server Action,
`revalidatePath` not clearing the cache. These are silent, appear only when the backend is
connected, and can only be diagnosed by isolating the data layer.

Testing them in separate features means: once Feature 05 passes visual inspection, any bug
that appears in Feature 06 is **definitively a data layer bug**. The diagnostic space collapses.

### Server Action vs API route — the mental model

Both run server-side code from a client interaction. The distinction:

**Server Action** (`actions/profile.ts`):
- A function marked `"use server"` called directly from a Client Component
- Best for: form submissions and simple mutations
- Under the hood: Next.js generates a `POST` endpoint, serializes the call, runs the function
- Feature 06 uses this for the Save Profile button

**API Route** (`app/api/agent/find/route.ts`):
- A traditional HTTP endpoint called via `fetch()`
- Best for: agent operations (job search, company research), streaming, webhooks, operations
  needing fine-grained HTTP control
- Features 10 and 13 use this for Find Jobs and Company Research

**Rule**: user action → form mutation → Server Action. User action → agent operation → API route.

---

## 6. Derived State vs Stored State

### Why completionPercentage is useMemo, not useState

Two options for making the percentage available:

**Stored state (wrong):**
```typescript
const [pct, setPct] = useState(70)
// Must remember to call setPct after EVERY field update:
const addSkill = () => {
  const next = [...skills, trimmed]
  setSkills(next)
  setPct(recalc(form, next, workExperience, education)) // forget this → stale ring
}
```

Miss a single `setPct` call — in `removeWorkEntry`, `updateEducation`, anywhere — and the ring
shows the wrong number. This is the "stale derived state" bug.

**Derived state (correct):**
```typescript
const completionPercentage = useMemo(() => {
  const checks = [ /* required field checks */ ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}, [form, skills, workExperience, education])
```

`completionPercentage` recomputes whenever any dependency changes. There is no "remember to
update" burden. React's dependency array guarantees freshness automatically.

**React principle**: if a value can be computed from existing state, compute it — don't store it.

### is_complete (boolean) vs completionPercentage (number)

These are two different things:

- `completionPercentage` — UI display value, derived in the component, **never stored in DB**
- `profiles.is_complete` — business logic flag, saved to DB, set `true` when all required
  fields are present at save time (Feature 06)

Feature 06's save action:
```typescript
const percentage = calculateCompletion(profileData)
await insforge.from('profiles').upsert({
  ...profileData,
  is_complete: percentage === 100,
})
```

The component never reads `is_complete` from the DB to drive the ring. It always derives the
percentage from live form state. `is_complete` is a consequence of a save, not a source of
truth for the UI.

---

## Process Learning — Shared Component Audit

During the architect session, the Navbar active state was not discussed — even though
`context/ui-registry.md` had an explicit note: "Active nav items (future feature) use
`text-accent`."

**Why it was missed**: The session focused narrowly on the new component being built
(`ProfileForm`). It did not audit existing shared components for deferred behavior that
becomes relevant when a new real page is added.

**The check that should have run**:
1. Scan `context/ui-registry.md` for "future feature", "deferred", "not yet implemented"
2. Ask: "Does adding this page make any deferred nav/layout behavior now required?"

For Feature 05 specifically: adding `/profile` as a real navigable page made the Navbar's
active state meaningful for the first time. The Navbar needed a `NavLinks.tsx` client component
using `usePathname()` — a simple addition that was caught before implementation but should have
been part of the architect session.

**Pattern for future sessions**: Any feature that adds a real protected route should begin with
a shared component audit against the ui-registry deferred items list.
