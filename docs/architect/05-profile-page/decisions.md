# Feature 05 — Profile Page: Architecture Decisions Explained

This document unpacks every architectural question raised before building Feature 05
(Profile Page UI with mock data). It is written for learning — not just "what we decided"
but "why this is the right call at this stage and what the alternatives cost you."

---

## 1. Completion Percentage Ring

### What it is

A circular SVG progress indicator — sometimes called a "donut chart" or "progress ring" — that
visually communicates how complete the user's profile is. The design shows something like 70%
filled as an arc.

### How it works

The ring is drawn using two overlapping SVG `<circle>` elements:

- A background circle (grey track) rendered at full circumference
- A foreground circle (accent colour) with its `stroke-dashoffset` animated proportionally to the
  completion percentage

The key SVG property is `stroke-dasharray` (total circumference) and `stroke-dashoffset` (how
much of that circumference to skip, i.e. leave unfilled).

```
circumference = 2 × π × radius
offset = circumference × (1 - completionDecimal)
```

At 70% complete: offset = circumference × 0.30 — leaving 30% of the stroke invisible.

### How the percentage is calculated

In Feature 05 with mock data, you define which Profile fields count as "required" for
completion. Each field that has a non-null, non-empty value contributes to the score:

```typescript
const completionPercentage = useMemo(() => {
  const checks = [
    form.full_name.trim() !== '',
    (mockProfile.email ?? '').trim() !== '',
    form.phone.trim() !== '',
    form.location.trim() !== '',
    form.current_title.trim() !== '',
    form.experience_level !== '',
    form.years_experience !== '' && Number(form.years_experience) > 0,
    skills.length > 0,
    workExperience.length > 0,
    education.degree !== null && education.degree !== '',
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}, [form, skills, workExperience, education])
```

This calculation lives inside `ProfileForm.tsx` and is derived from React state, not stored
separately. In Feature 06, this same calculation determines when to flip `is_complete` to
`true` before saving.

---

## 2. Skills Tag Input

### What it is

A custom compound input pattern — a text field paired with an "Add" button that appends a string
to an array in component state. Each entry in the array renders as a removable pill chip.

It is NOT:
- A `<select>` dropdown (fixed options)
- A combobox / autocomplete (suggestions from a list)
- A native multi-select (ugly and uncontrollable)

### Why this pattern

The `Profile.skills` field is `string[] | null` — an open-ended array. Users enter anything:
"TypeScript", "AWS Lambda", "leadership". There is no canonical skills list to select from.
The tag pattern lets them type freely while giving the UI a sense of structure.

### State shape

```typescript
const [skills, setSkills] = useState<string[]>(mockProfile.skills ?? [])
const [skillInput, setSkillInput] = useState('')

const addSkill = () => {
  const trimmed = skillInput.trim()
  if (trimmed && !skills.includes(trimmed)) {
    setSkills([...skills, trimmed])
    setSkillInput('')
  }
}

const removeSkill = (skill: string) => {
  setSkills(skills.filter(s => s !== skill))
}
```

The pill renders with an ×-button that calls `removeSkill`. The same pattern applies to
`industries`, `job_titles_seeking`, and `preferred_locations` — all are `string[]` fields on
the Profile type.

---

## 3. Mock Data

### What it is

Hardcoded constants typed against the real `Profile` interface, declared inline in `ProfileForm.tsx`.

```typescript
const mockProfile: Profile = {
  id: 'mock-user-id',
  full_name: 'Taryn Ali',
  email: 'taryn@example.com',
  skills: ['React', 'TypeScript', 'Next.js', 'Tailwind CSS'],
  // ... all other fields present — nullable fields as null
}
```

### What it is NOT

- Not a separate `__mocks__/` folder (Jest convention — we have no test runner)
- Not a fixture file imported from `lib/` (that implies it might be reused elsewhere)
- Not a database seed (those are schema-level concerns)

### Why inline

The mock exists solely to make the form renderable before Feature 06 wires up real data.
It is the cheapest possible scaffolding. When Feature 06 arrives, the `useState` initialiser
changes from `mockProfile.skills` to `serverFetchedProfile.skills` — one line per field.
No imports to remove, no files to delete.

### Why typed against the real Profile interface

Discipline. If the mock drifts from the real shape, TypeScript will error at the mock
declaration, not silently at runtime when Feature 06 connects real data. This is the value
of `types/index.ts` — every consumer of profile data must conform.

---

## 4. The Inert Save Button (No Save Logic Yet)

### What it is

The "Save Profile" button exists in the UI but has no `onClick` handler in Feature 05.
Clicking it does nothing visible.

### Why this is correct

Feature 05 and Feature 06 have a clean contract:
- Feature 05: Build the form. Make it look right. Make state update correctly.
- Feature 06: Wire the Save button to `actions/profile.ts` (the Server Action).

Mixing them in one feature would couple UI concerns (layout, interaction, validation) with
data concerns (Server Action contract, revalidation, error states). The split lets you verify
the UI works independently before adding the complexity of the backend path.

The inert button is a placeholder that preserves the visual design without creating a
partially-implemented data path that could mislead future debugging.

---

## 5. Where Does "use client" Live?

This is the most consequential decision for Feature 05.

### The two options

**Option A — Single `ProfileForm.tsx` client component**

`app/profile/page.tsx` is a Server Component. It renders:
```tsx
<Navbar />
<ProfileForm />  // "use client" at the top of this file
```

`ProfileForm.tsx` is one large client component that owns all state: the banner, the ring,
the resume section, the skills inputs, the work experience rows, the "Currently working here"
checkbox.

**Option B — Multiple smaller client components**

Each interactive section (`ResumeSection`, `SkillsInput`, `WorkExperienceList`, etc.) is its own
client component. State either lives in each leaf, or a shared parent passes it down.

### Why Option A is right for Feature 05

**1. There is no server data to protect.**

The primary reason to split client components in Next.js App Router is to keep data-fetching
in Server Components and push the client boundary as deep (as "leaf") as possible. This matters
because Server Components can `await` database calls, stream data, and reduce JavaScript bundle
size.

But Feature 05 has no server data. The form is fed mock data inline. There is nothing to fetch
server-side, and therefore no client/server boundary to protect.

**2. The form fields are tightly coupled through completion state.**

The percentage ring depends on which fields are filled. The fields are spread across sections.
If state lives in multiple components, they must communicate — either through prop drilling
(painful) or a context/store (premature abstraction for a mock-data feature).

A single `ProfileForm.tsx` holding all state solves this trivially: the ring reads the same state
array that the inputs update.

**3. The split components would be thrown away in Feature 06.**

When Feature 06 wires real data, `app/profile/page.tsx` will become:
```tsx
// Server Component
const profile = await fetchProfileFromDB(userId)
return <ProfileForm initialProfile={profile} />
```

`ProfileForm` will accept `initialProfile: Profile` as a prop and seed state from it. This works
identically whether ProfileForm is one component or many. The refactor cost to split now is
real; the benefit is zero.

**4. architecture.md lists the split components but not as a Feature 05 requirement.**

The component map in `context/architecture.md` is an aspirational structure — it describes where
things will eventually live. It does not mandate that every component exists independently from
day one. Building `ResumeUpload.tsx` as a separate file now means it's an untested, unconnected
stub. Building it inline in `ProfileForm.tsx` means it's testable immediately in the running dev
server.

### The one exception

`Navbar.tsx` stays outside `ProfileForm.tsx`. It is already built, has no dependency on profile
state, and is not interactive in a way that requires the profile's state.

### Summary of the decision

| Criterion | Option A (single) | Option B (split) |
|---|---|---|
| Server data to protect | No | No |
| State coupling between sections | Trivial (shared state) | Complex (prop drilling or context) |
| Throw-away code in Feature 06 | Minimal | More to discard |
| Matches architecture.md exactly | No (consolidated) | Yes (literal) |
| **Verdict for Feature 05** | **Correct** | **Premature** |

---

## 6. Next.js Client/Server Boundaries

### "use client" does not mean "browser only"

This is one of the most common React Server Component misconceptions. A component marked
`"use client"` still renders on the **server** during SSR. What the directive actually means:

- This component (and everything it imports below it) may use browser APIs, React hooks
  (`useState`, `useEffect`, `useRef`), and event handlers
- It will be **hydrated** in the browser — React sends the component's JavaScript to the client
  and re-renders it there to attach interactivity
- Server Components, by contrast, **never** run in the browser — their output is HTML + an RSC
  payload, and their code is never included in the JavaScript bundle shipped to the client

**The render environments:**

| | Server Component | Client Component |
|---|---|---|
| Renders on server | Yes (always) | Yes (SSR) |
| Renders in browser | No | Yes (hydration + interactions) |
| Can use useState / hooks | No | Yes |
| Can fetch data with await | Yes | No (without useEffect) |
| Code in JS bundle | No | Yes |
| Can accept Server Component children | Yes | Yes (via `children` prop) |

### Hydration

When `ProfileForm.tsx` (a client component) is first rendered on the server, React produces
static HTML for the initial state (mock data, 70% ring, pre-filled fields). The browser receives
this HTML and displays it immediately — no blank loading state.

Then React's hydration process runs: the JavaScript bundle for `ProfileForm` arrives, React
re-renders the component in memory, compares the virtual DOM to the server HTML (they must
match), and attaches all event listeners (`onClick`, `onChange`, etc.). After hydration, the
form is fully interactive.

For Feature 05 this is clean: server and client both render from the same mock data, so the
HTML always matches. For Feature 06, the profile data from the DB travels as a prop from the
Server Component page to ProfileForm — the RSC protocol serializes it into the page payload
automatically.

### Why push the client boundary to leaf level

The rule "push the client boundary as deep as possible" exists for two reasons:

1. **Bundle size**: Every Server Component removed from the client bundle reduces the JavaScript
   shipped to the browser. A page with a Server Component wrapping a Client Component sends less
   code than the same page entirely as a Client Component.

2. **Server-side data access**: Server Components can directly `await` database queries, read
   cookies, and access environment variables without `useEffect`. If the server/client split is
   at the page level (`page.tsx` = server, `ProfileForm` = client), the page can fetch the user's
   real profile server-side and pass it as `initialProfile` to the form — no loading state, no
   client-side fetch, no flicker.

For Feature 05 this is academic (no server data). It becomes the correct architecture in
Feature 06 when `page.tsx` fetches the real profile and passes it down.

---

## 7. Feature Split Pattern — 05 vs 06

### Why separate UI-only from logic

Feature 05 (mock data) and Feature 06 (real data) are separate features by design. The split
separates two categories of bugs that behave very differently:

**UI bugs (Feature 05):** Missing field, wrong token class, broken tag input, ring math off,
layout misalignment. These are visible, fast to find, reproduce every reload.

**Data bugs (Feature 06):** RLS policy rejection, malformed upsert, cookie not forwarded to
Server Action, `revalidatePath` not clearing the cache. These are silent, appear only when the
real backend is connected, and can be confused with UI bugs if both are built simultaneously.

Testing them in separate features means: once Feature 05 passes visual inspection, any bug that
appears in Feature 06 is **definitively a data layer bug**. The diagnostic space collapses.

### Server Action vs API route — the mental model

Both are ways to run server-side code from a client interaction. The distinction:

**Server Action** (`actions/profile.ts`):
- A function marked `"use server"` that can be called directly from a Client Component
- Best for: form submissions and simple mutations where the UI calls one function and gets a
  success/error back
- Under the hood: Next.js serializes the call as a `POST` to a generated endpoint, runs the
  function on the server, and returns the result
- Feature 06 uses this: `<button onClick={() => saveProfile(formData)}>`

**API Route** (`app/api/agent/find/route.ts`):
- A traditional HTTP endpoint called via `fetch()`
- Best for: agent operations (job search, company research), streaming responses, webhooks from
  third parties, operations that need fine-grained HTTP control
- Features 10 and 13 use this: the Find Jobs button triggers a `POST` to `/api/agent/find`

Rule of thumb: **user action → form mutation → Server Action. User action → agent operation or
external API → API route.**

---

## 8. Derived State vs Stored State

### The completion percentage is derived, not stored

There are two ways to have a `completionPercentage` value available in the component:

**Option A — Stored state:**
```typescript
const [completionPercentage, setCompletionPercentage] = useState(70)

// Must remember to call this after EVERY field update:
const addSkill = () => {
  const newSkills = [...skills, trimmed]
  setSkills(newSkills)
  setCompletionPercentage(recalculate(form, newSkills, workExperience, education))
}
```

**Option B — Derived state (what we use):**
```typescript
const completionPercentage = useMemo(() => {
  const checks = [ /* all required field checks */ ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}, [form, skills, workExperience, education])
```

Option A has a failure mode: every path that updates any field must also call
`setCompletionPercentage`. Miss one update (e.g. in `removeWorkEntry`) and the ring shows
a stale value. This is the "stale derived state" bug — extremely common and non-obvious.

Option B has no failure mode. `completionPercentage` is recomputed automatically whenever
`form`, `skills`, `workExperience`, or `education` changes. React's dependency array guarantees
freshness. There is no "remember to update" burden.

**React principle:** If a value can be computed from existing state, compute it — don't store it.
Stored state that duplicates a derivation is a synchronization problem waiting to happen.

### is_complete vs completionPercentage

The database column `profiles.is_complete` is a `boolean`. The ring shows a `number` (0–100).
These are two different things with two different purposes:

- `completionPercentage` — UI display value, derived in the component, never stored in the DB
- `is_complete` — business logic flag saved to the DB, set to `true` by Feature 06 when
  `completionPercentage === 100` at save time

Feature 06's save action will:
```typescript
const percentage = calculateCompletion(profileData)
await insforge.from('profiles').upsert({
  ...profileData,
  is_complete: percentage === 100,
})
```

The component never reads `is_complete` from the DB to drive the ring — it always derives the
percentage from live form state.
