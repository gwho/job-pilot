# Tutorial 07 - Profile Page Architect Deep Dive

**After completing this tutorial you will understand:** how the Feature 05 architect
session turned product requirements into implementation decisions, why the profile page
uses one client-owned form island, how the SVG completion ring works, why tag inputs are
controlled, why mock data is typed as the real `Profile`, how `NavLinks` preserves the
server/client boundary, and how to use an LLM separately for a warm-up tutorial before
studying the real code.

This tutorial is based on the architect docs in
[`docs/architect/05-profile-page`](../../architect/05-profile-page) and the generated
working code in:

- [`app/profile/page.tsx`](../../../app/profile/page.tsx)
- [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx)
- [`components/layout/Navbar.tsx`](../../../components/layout/Navbar.tsx)
- [`components/layout/NavLinks.tsx`](../../../components/layout/NavLinks.tsx)
- [`types/index.ts`](../../../types/index.ts)

> [!NOTE]
> Feature 05 is UI-only. The profile form is interactive and uses mock data, but it does
> not save to InsForge yet. Feature 06 wires the form to a Server Action and real
> profile rows.

---

## How To Use An LLM Before This Tutorial

Before drilling into the actual code, spend 20 to 30 minutes with a separate LLM session
to build the basic mental model. Do not paste the whole codebase first. Start with plain
concepts, ask for tiny examples, then ask the LLM to quiz you.

Use this structure:

```
Round 1: Ask for the concept in plain English.
Round 2: Ask for a tiny isolated code example.
Round 3: Predict what will happen if the code changes.
Round 4: Ask for a short quiz.
Round 5: Return to this repo and map the concept to real code.
```

### Warm-up prompt 1: Controlled inputs

Paste this into an LLM:

```text
I am about to study a React profile form with tag inputs for skills.
Give me a beginner-friendly mini tutorial on controlled vs uncontrolled inputs.
Use one tiny input example and one tag-input example.
Then give me 3 prediction questions, but do not answer them until I ask.
```

Practice before returning here:

- Predict what happens when a controlled input calls `setValue("")`.
- Predict what happens if a tag input forgets `e.preventDefault()` on Enter.
- Explain why chip arrays should live in React state, not be read from the DOM.

### Warm-up prompt 2: Derived state

```text
Teach me stored state vs derived state in React.
Use a form completion percentage as the example.
Show the stale-state bug that happens when completionPercentage is stored in useState.
Then quiz me with 4 short scenarios.
```

Practice:

- Identify which values in a form should be stored.
- Identify which values should be computed.
- Explain why a completion ring should not have its own independent setter.

### Warm-up prompt 3: SVG progress rings

```text
Teach me SVG progress rings from first principles.
Explain stroke-dasharray, stroke-dashoffset, 2*pi*r, and why the circle starts at 3 o'clock.
Use radius 40 and show the offset math for 25%, 70%, and 100%.
Then ask me to calculate one offset myself.
```

Practice:

- Calculate circumference for `r = 40`.
- Calculate offset for 75%.
- Explain why `rotate(-90deg)` moves the start to the top.

### Warm-up prompt 4: Next.js client/server boundaries

```text
Explain Next.js App Router Server Components vs Client Components.
Use this example: a Navbar needs server auth data, but its nav links need usePathname().
How do I split the components so only the nav links are client-side?
Give me a diagram and then quiz me.
```

Practice:

- Say why `Navbar` should stay server-side.
- Say why `NavLinks` must be client-side.
- Explain how a Server Component can render a Client Component child.

### Warm-up prompt 5: TypeScript mock data

```text
Teach me why mock data should be typed against the real TypeScript interface.
Explain structural typing, nullable fields, optional fields, and why Partial<T> can hide bugs.
Use a Profile object as the example.
Then give me 5 small true/false questions.
```

Practice:

- Explain the difference between `phone?: string | null` and `phone: string | null`.
- Explain why `const mockProfile: Profile = ...` catches drift early.
- Explain why `Partial<Profile>` is weaker for UI rehearsal.

After this warm-up, start the real code study below. The goal is not to let the LLM
replace this tutorial. The goal is to make the vocabulary familiar before the real files
add project-specific constraints.

---

## 1. What The Architect Session Decided

Open [`docs/architect/05-profile-page/decisions.md`](../../architect/05-profile-page/decisions.md).
The architect session made six core decisions:

| Decision | Why it matters |
|---|---|
| Use one `ProfileForm` client component | The whole feature is an interactive form with tightly coupled state. |
| Keep `/profile/page.tsx` as a Server Component | The page owns route shell and later can fetch real profile data server-side. |
| Type mock data as `Profile` | Mock UI rehearses the real database shape. |
| Compute completion with `useMemo` | Completion cannot drift from the actual form fields. |
| Use SVG for the progress ring | SVG supports rounded arc ends and smooth dash-offset animation. |
| Extract `NavLinks` as the client leaf | Active route highlighting needs `usePathname()`, but `Navbar` still needs server auth. |

The most important architectural principle is feature splitting:

```
Feature 05: full UI with mock data
Feature 06: save logic and real InsForge data
Feature 07: AI resume extraction
Feature 08: generated resume PDF
```

Feature 05 intentionally stops before persistence. The Save button exists visually, but
it is inert.

**Checkpoint:** Why is an inert Save button acceptable in Feature 05?

<details>
<summary>Reveal answer</summary>

Because Feature 05 is the UI rehearsal. It verifies layout, interaction state, form
controls, tags, work rows, and completion calculation without mixing in database errors.
Feature 06 owns the Server Action and persistence path.

</details>

---

## 2. The Route Shell Is Tiny On Purpose

Open [`app/profile/page.tsx`](../../../app/profile/page.tsx):

```tsx
import { Navbar } from "@/components/layout/Navbar";
import { ProfileForm } from "@/components/profile/ProfileForm";

export default function ProfilePage() {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <ProfileForm />
      </main>
    </>
  );
}
```

This file does almost nothing. That is the point.

- It renders the shared `Navbar`.
- It gives the page the correct background and minimum height.
- It mounts the interactive profile form.

The page remains a Server Component because it has no `"use client"` directive. In
Feature 06, this same file can fetch the real profile server-side and pass it down:

```tsx
// Future Feature 06 shape
const profile = await fetchProfileForCurrentUser();
return <ProfileForm initialProfile={profile} />;
```

The client boundary stays below the page.

**Checkpoint:** What would be lost if `app/profile/page.tsx` became `"use client"`?

<details>
<summary>Reveal answer</summary>

It would lose direct server-side access to cookies and database reads. Feature 06 would
need a client-side fetch or separate API route just to load initial profile data,
introducing loading states and more JavaScript.

</details>

---

## 3. One Large Client Island

Open the top of [`components/profile/ProfileForm.tsx`](../../../components/profile/ProfileForm.tsx):

```tsx
"use client";

import { useState, useMemo } from "react";
import { AlertCircle, CheckCircle, Upload, Plus, X } from "lucide-react";
```

The architect session considered splitting this into several components:

```text
ResumeUpload
CompletionIndicator
ProfileFields
WorkExperienceList
TagInput
```

Instead, Feature 05 uses one large `ProfileForm`. This is not because smaller components
are bad. It is because all major sections share one state model.

The completion banner at the top depends on fields throughout the page:

```text
Completion banner
  reads full name, phone, location, title, level, years, skills, work, education

Profile form
  updates full name, phone, location, title, level, years, skills, work, education
```

If each section owned its own state, the banner would need a context provider or a long
chain of props. For a UI-only feature with mock data, that is extra machinery without a
benefit.

The architect decision:

```
Keep the page server-side.
Make the whole interactive form one client component.
Extract only reusable/stability-sensitive helpers like TagInput.
```

**Checkpoint:** Why is a single client component reasonable here, even though the
general App Router rule is to push client boundaries deep?

<details>
<summary>Reveal answer</summary>

Because the entire form subtree is interactive and state-coupled. Splitting into many
client leaves would not preserve meaningful server-rendered content, but it would make
shared state harder to manage.

</details>

---

## 4. Mock Data As A Real Contract

Near the top of `ProfileForm.tsx`, the mock is typed as the real `Profile`:

```tsx
const mockProfile: Profile = {
  id: "mock-user-id",
  full_name: "Taryn Ali",
  email: "taryn@example.com",
  phone: "(555) 300-0000",
  location: "San Francisco, CA",
  current_title: "Frontend Engineer",
  experience_level: "junior",
  years_experience: 4,
  skills: ["React", "TypeScript", "Next.js", "Tailwind CSS"],
  industries: ["FinTech", "Healthcare"],
  work_experience: [
    {
      company: "Vercel",
      title: "Frontend Engineer",
      startDate: "January 2023",
      endDate: null,
      current: true,
      responsibilities:
        "Built Next.js features and optimized web vitals. Led a team of 3 developers.",
    },
  ],
  education: {
    degree: "High School",
    fieldOfStudy: "Computer Science",
    institution: null,
    graduationYear: null,
  },
  job_titles_seeking: ["Frontend Engineer", "React Developer"],
  remote_preference: "any",
  preferred_locations: [],
  salary_expectation: null,
  cover_letter_tone: null,
  linkedin_url: "https://linkedin.com/in/taryan",
  portfolio_url: "https://github.com/taryanali",
  work_authorization: "citizen",
  resume_pdf_url: null,
  is_complete: false,
  created_at: "2026-06-18T00:00:00Z",
  updated_at: "2026-06-18T00:00:00Z",
};
```

This is not throwaway fake data in the loose sense. It is a rehearsal of the real data
shape from [`types/index.ts`](../../../types/index.ts).

The key TypeScript idea:

```ts
phone: string | null
```

means the field must exist, but its value may be `string` or `null`.

It does not mean:

```ts
phone?: string | null
```

which means the field may be absent entirely.

That is why nullable mock fields are written explicitly as `null`.

**Checkpoint:** Why would `Partial<Profile>` be weaker for this mock?

<details>
<summary>Reveal answer</summary>

`Partial<Profile>` makes every field optional, so the mock could omit fields that real
database rows always provide. The UI would not rehearse real `null` and array cases, and
bugs could surface later when Feature 06 connects actual profile rows.

</details>

**Try it yourself:** In a scratch note, list three fields in `mockProfile` that are
present as `null`. Explain why each is different from being omitted.

---

## 5. FormState Is Not The Same As Profile

The form does not use `Profile` directly as edit state. It defines a separate
`FormState`:

```tsx
type FormState = {
  full_name: string;
  phone: string;
  location: string;
  current_title: string;
  experience_level: ExperienceLevel | "";
  years_experience: string;
  linkedin_url: string;
  portfolio_url: string;
  work_authorization: WorkAuthorization | "";
  remote_preference: RemotePreference | "";
  salary_expectation: string;
  cover_letter_tone: CoverLetterTone | "";
};
```

This type exists because editing state and database state are not identical.

Examples:

| Database shape | Editing shape | Why |
|---|---|---|
| `years_experience: number | null` | `years_experience: string` | HTML input values are strings while the user types. |
| `experience_level: ExperienceLevel | null` | `ExperienceLevel | ""` | A controlled `<select>` needs a string sentinel for "Select...". |
| `salary_expectation: string | null` | `string` | Empty input is easier to render as `""`, then convert later. |

The empty string is local to the UI. Feature 06 will convert empty values back to `null`
or validated domain values before saving.

Here is the matching select:

```tsx
<select
  value={form.experience_level}
  onChange={(e) =>
    setField("experience_level", e.target.value as ExperienceLevel | "")
  }
  className={inputCls}
>
  <option value="">Select...</option>
  <option value="junior">Junior</option>
  <option value="mid">Mid</option>
  <option value="senior">Senior</option>
  <option value="lead">Lead</option>
</select>
```

React wants `value` to be a string. `null` would push the control toward an uncontrolled
state and produce warnings.

**Checkpoint:** Why is `ExperienceLevel | ""` better than `ExperienceLevel | null` for
the edit form?

<details>
<summary>Reveal answer</summary>

Because the DOM `<select>` uses string values. The empty `<option value="">` naturally
maps to `""`, while `null` is not a valid controlled select value.

</details>

---

## 6. State Buckets, Not One Giant Object

`ProfileForm` splits state by update behavior:

```tsx
const [form, setForm] = useState<FormState>({ ... });

const [skills, setSkills] = useState<string[]>(mockProfile.skills ?? []);
const [industries, setIndustries] = useState<string[]>(
  mockProfile.industries ?? []
);
const [jobTitlesSeeking, setJobTitlesSeeking] = useState<string[]>(
  mockProfile.job_titles_seeking ?? []
);
const [preferredLocations, setPreferredLocations] = useState<string[]>(
  mockProfile.preferred_locations ?? []
);

const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>(
  mockProfile.work_experience ?? []
);
const [education, setEducation] = useState<Education>(
  mockProfile.education ?? {
    degree: null,
    fieldOfStudy: null,
    institution: null,
    graduationYear: null,
  }
);

const [skillInput, setSkillInput] = useState("");
const [industryInput, setIndustryInput] = useState("");
const [jobTitleInput, setJobTitleInput] = useState("");
const [locationInput, setLocationInput] = useState("");
```

This creates four buckets:

| Bucket | Examples | Reason |
|---|---|---|
| Scalar form object | name, phone, location, dropdowns | Updated through the same `setField` helper. |
| Tag arrays | skills, industries | Chips are arrays with add/remove behavior. |
| Complex objects | work experience, education | Nested structure needs local update helpers. |
| Cursor state | `skillInput` | Temporary text, not saved as accepted profile data. |

The generic scalar setter is small:

```tsx
function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
  setForm((prev) => ({ ...prev, [key]: value }));
}
```

The generic type parameter `K` ties the key to the matching value type. If the key is
`"experience_level"`, the value must be `ExperienceLevel | ""`. If the key is
`"phone"`, the value must be `string`.

**Checkpoint:** Why not store `skillInput` inside the `skills` array?

<details>
<summary>Reveal answer</summary>

Because `skillInput` is cursor text the user is still editing. It is not an accepted
skill until the user clicks Add or presses Enter. Accepted tags and transient input text
represent different states.

</details>

---

## 7. Controlled Tag Inputs

The reusable `TagInput` receives everything as props:

```tsx
function TagInput({
  label,
  items,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  onKeyDown,
  placeholder,
  optional,
}: {
  label: string;
  items: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (item: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-dark mb-1.5">
        {label}
        {optional && (
          <span className="text-text-muted font-normal ml-1">(Optional)</span>
        )}
      </label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {items.map((item) => (
            <span
              key={item}
              className="bg-accent-light text-accent text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                className="hover:text-accent-dark leading-none"
                aria-label={`Remove ${item}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          type="button"
          onClick={onAdd}
          className="bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors whitespace-nowrap"
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

The handler factory creates the behavior for each tag array:

```tsx
function makeTagHandlers(
  items: string[],
  setItems: React.Dispatch<React.SetStateAction<string[]>>,
  input: string,
  setInput: React.Dispatch<React.SetStateAction<string>>
) {
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !items.includes(trimmed)) {
      setItems([...items, trimmed]);
      setInput("");
    }
  };
  const remove = (item: string) =>
    setItems(items.filter((i) => i !== item));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
  return { add, remove, onKey };
}
```

Three details matter:

1. `trim()` prevents whitespace-only tags.
2. `!items.includes(trimmed)` prevents duplicates.
3. `e.preventDefault()` stops Enter from accidentally submitting the larger form.

**Checkpoint:** Why does `TagInput` use `value={inputValue}` instead of
`defaultValue={inputValue}`?

<details>
<summary>Reveal answer</summary>

Because it is controlled. The source of truth is React state. The input must also clear
itself after a tag is added, which requires state to drive the displayed value.

</details>

---

## 8. Why TagInput Lives At Module Scope

The architect discussion explains a subtle React identity issue. `TagInput` is defined
outside `ProfileForm`, at module scope:

```tsx
function TagInput(...) {
  return (...);
}

export function ProfileForm() {
  return <TagInput ... />;
}
```

This avoids a common bug:

```tsx
export function ProfileForm() {
  function TagInput(...) {
    return (...);
  }

  return <TagInput ... />;
}
```

That second version creates a brand-new `TagInput` function on every render. React sees
the component type as different and may unmount/remount it, which resets any child state.

The lint rule `react-hooks/static-components` caught this during Feature 05. Even though
`TagInput` currently has no internal state, placing it at module scope is the correct
future-safe pattern.

**Checkpoint:** If `TagInput` needed access to `skills`, should it close over `skills`
from the parent or receive `items={skills}` as a prop?

<details>
<summary>Reveal answer</summary>

It should receive data as props. That keeps `TagInput` at module scope with stable
component identity.

</details>

---

## 9. Derived Completion State

The completion percentage is computed with `useMemo`:

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

`missingFields` uses the same source state:

```tsx
const missingFields = useMemo(() => {
  const missing: string[] = [];
  if (!form.full_name.trim()) missing.push("FULL NAME");
  if (!(mockProfile.email ?? "").trim()) missing.push("EMAIL");
  if (!form.phone.trim()) missing.push("PHONE");
  if (!form.location.trim()) missing.push("LOCATION");
  if (!form.current_title.trim()) missing.push("CURRENT TITLE");
  if (!form.experience_level) missing.push("EXPERIENCE LEVEL");
  if (!form.years_experience || Number(form.years_experience) <= 0)
    missing.push("YEARS EXP");
  if (skills.length === 0) missing.push("SKILLS");
  if (workExperience.length === 0) missing.push("WORK EXPERIENCE");
  if (!education.degree) missing.push("EDUCATION");
  return missing;
}, [form, skills, workExperience, education]);
```

These values are derived. They are not stored with independent setters.

Storing them would create a synchronization bug:

```tsx
setPhone(newPhone);
setCompletionPercentage(recalculate(...));
setMissingFields(recalculateMissing(...));
```

Every field handler would need to remember every derived update. One missed setter
would make the ring or banner stale.

With `useMemo`, the source of truth stays simple:

```
form + skills + workExperience + education
  -> completionPercentage
  -> missingFields
  -> banner and ring
```

**Checkpoint:** If the user removes the only work experience row, which stored values
change and which derived values recompute?

<details>
<summary>Reveal answer</summary>

Stored state: `workExperience` changes. Derived values: `completionPercentage` and
`missingFields` recompute from the new `workExperience` array.

</details>

---

## 10. SVG Ring Math

The ring values are plain math:

```tsx
const ringRadius = 40;
const ringCircumference = 2 * Math.PI * ringRadius;
const ringOffset = ringCircumference * (1 - completionPercentage / 100);
```

The SVG uses two circles:

```tsx
<circle
  cx="50"
  cy="50"
  r={ringRadius}
  fill="none"
  strokeWidth="8"
  style={{ stroke: "var(--color-border)" }}
/>

<circle
  cx="50"
  cy="50"
  r={ringRadius}
  fill="none"
  strokeWidth="8"
  strokeLinecap="round"
  strokeDasharray={ringCircumference}
  strokeDashoffset={ringOffset}
  style={{
    stroke: "var(--color-accent)",
    transform: "rotate(-90deg)",
    transformOrigin: "center",
    transition: "stroke-dashoffset 0.4s ease",
  }}
/>
```

How it works:

```
circumference = 2 * pi * r
              = 2 * pi * 40
              = about 251.3

At 75%:
offset = 251.3 * (1 - 0.75)
       = 251.3 * 0.25
       = about 62.8
```

`strokeDasharray={ringCircumference}` creates one dash as long as the circle. The offset
moves part of that dash out of view. A smaller offset means more progress is visible.

SVG circles start at 3 o'clock by default, so the arc is rotated `-90deg` to start at
12 o'clock.

**Try it yourself:** Calculate the offset for 40% complete with radius 40.

<details>
<summary>Reveal answer</summary>

Circumference is about `251.3`. Offset is `251.3 * (1 - 0.40) = 251.3 * 0.60`,
which is about `150.8`.

</details>

---

## 11. Completion Banner States

The banner always renders, but its content changes based on `missingFields.length`.

Complete state:

```tsx
{missingFields.length === 0 ? (
  <>
    <div className="flex items-center gap-2 mb-2">
      <CheckCircle size={18} className="text-success flex-shrink-0" />
      <h2 className="text-base font-semibold text-text-primary">
        Profile complete
      </h2>
    </div>
    <p className="text-sm text-text-secondary">
      Your profile is fully filled out. You&apos;re ready to find
      great matches.
    </p>
  </>
) : (
  ...
)}
```

Incomplete state:

```tsx
<AlertCircle size={18} className="text-warning flex-shrink-0" />
<h2 className="text-base font-semibold text-text-primary">
  Profile needs attention
</h2>
...
{missingFields.map((field) => (
  <span
    key={field}
    className="bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full"
  >
    {field}
  </span>
))}
```

This follows the registry:

- Success uses `text-success`.
- Attention uses `text-warning`.
- Missing field pills use `bg-warning-light text-warning`.
- The card itself remains `bg-surface`.

Color goes inside the card, not on the card surface.

**Checkpoint:** Why is the banner always rendered instead of only appearing when the
profile is incomplete?

<details>
<summary>Reveal answer</summary>

It gives the user constant feedback. When incomplete, it shows what to fix. When
complete, it confirms readiness. The layout also stays stable because the top card does
not appear and disappear.

</details>

---

## 12. Work Experience Rows

Work experience is an array with a hard maximum of 3 rows:

```tsx
function addWorkEntry() {
  if (workExperience.length < 3) {
    setWorkExperience([...workExperience, { ...EMPTY_WORK_ENTRY }]);
  }
}
```

Updates use immutable mapping:

```tsx
function updateWorkEntry(
  index: number,
  updates: Partial<WorkExperienceEntry>
) {
  setWorkExperience((prev) =>
    prev.map((entry, i) => (i === index ? { ...entry, ...updates } : entry))
  );
}
```

Removal filters by index:

```tsx
function removeWorkEntry(index: number) {
  setWorkExperience((prev) => prev.filter((_, i) => i !== index));
}
```

The "Currently working here" checkbox controls whether End Date appears:

```tsx
{!entry.current && (
  <div>
    <label className="block text-sm font-medium text-text-dark mb-1.5">
      End Date
    </label>
    <input
      type="text"
      value={entry.endDate ?? ""}
      onChange={(e) =>
        updateWorkEntry(index, {
          endDate: e.target.value || null,
        })
      }
      placeholder="December 2023"
      className={inputCls}
    />
  </div>
)}
```

When the checkbox is checked, `endDate` becomes `null`:

```tsx
updateWorkEntry(index, {
  current: e.target.checked,
  endDate: e.target.checked ? null : entry.endDate,
})
```

That preserves a clean model:

```
current === true  -> endDate === null
current === false -> endDate may be a string
```

**Checkpoint:** Why use `{ ...EMPTY_WORK_ENTRY }` instead of `EMPTY_WORK_ENTRY`
directly when adding a role?

<details>
<summary>Reveal answer</summary>

It creates a fresh object for each row. Reusing the same object reference would make
future mutation bugs easier, especially if nested fields are added later.

</details>

---

## 13. Connected Accounts Is Inert UI

The LinkedIn account card is present but does not perform an integration yet:

```tsx
<div className="w-10 h-10 rounded-lg bg-linkedin flex items-center justify-center flex-shrink-0">
  <span className="text-linkedin-foreground text-sm font-bold">
    in
  </span>
</div>
...
<button
  type="button"
  className="bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors"
>
  Connect LinkedIn
</button>
```

This is a design placeholder, not a backend feature. It uses LinkedIn-specific tokens:

- `bg-linkedin`
- `text-linkedin-foreground`

The button has no handler because this feature does not implement LinkedIn OAuth or
apply automation.

**Checkpoint:** Why is it better for this button to be inert than to call a placeholder
API route?

<details>
<summary>Reveal answer</summary>

An inert button preserves the intended UI without creating a fake or partial data path.
A placeholder API route would imply functionality exists and create misleading failure
cases for future debugging.

</details>

---

## 14. Active Nav Without Making Navbar Client-Side

The profile page made active nav state newly important. `Navbar` is still a Server
Component:

```tsx
import Image from "next/image";
import Link from "next/link";
import { getCtaHref } from "@/lib/auth";
import { NavLinks } from "@/components/layout/NavLinks";

export async function Navbar() {
  const ctaHref = await getCtaHref();

  return (
    <header className="sticky top-0 z-50 w-full bg-surface border-b border-border h-16">
      ...
      <NavLinks />
      ...
    </header>
  );
}
```

`Navbar` needs to stay server-side because `getCtaHref()` reads the auth session.

The active route logic is isolated in `NavLinks`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Find Jobs", href: "/find-jobs" },
  { label: "Profile", href: "/profile" },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-8">
      {NAV_ITEMS.map(({ label, href }) => {
        const isActive =
          pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`text-sm font-medium transition-colors ${
              isActive
                ? "text-accent"
                : "text-text-dark hover:text-accent"
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

This is the "client leaf" pattern:

```
Navbar Server Component
  reads auth and renders logo/CTA
  includes NavLinks

NavLinks Client Component
  reads browser route via usePathname()
  renders active/inactive link classes
```

**Checkpoint:** What would break if `Navbar` itself became `"use client"`?

<details>
<summary>Reveal answer</summary>

It could no longer directly call the async server helper `getCtaHref()`. The app would
need to move auth CTA resolution into a client fetch or another API path, adding
complexity and likely a loading or flash state.

</details>

---

## 15. The Inert Save Button

At the bottom of the form:

```tsx
<button
  type="button"
  className="w-full bg-accent text-accent-foreground font-medium rounded-md px-4 py-2.5 text-sm hover:bg-accent-dark transition-colors"
>
  Save Profile
</button>
```

There is no `onClick`.

This is not an omission. It is the Feature 05/06 boundary:

```
Feature 05:
  Form exists
  User can edit state
  UI responds correctly
  Save button is visually present

Feature 06:
  Server Action saves to profiles table
  Resume upload writes to storage
  revalidatePath('/profile')
  profile_completed event can fire
```

**Checkpoint:** Why is the button `type="button"` instead of the default submit
behavior?

<details>
<summary>Reveal answer</summary>

Because there is no submit handler yet. `type="button"` prevents accidental form
submission behavior while preserving the visual control.

</details>

---

## 16. Practice: Predict Then Check

Use the real app or editor for these exercises.

### Exercise A: Completion math

Starting from the mock profile, clear the Full Name input.

Predict:

- What percentage should the ring show?
- Which missing field pill should appear?
- Which icon should show in the banner?

Then compare with the running page or the verification notes in
[`docs/plan/05-profile-page/plan.md`](../../plan/05-profile-page/plan.md).

### Exercise B: Tag input behavior

Predict what happens when you type `React` into Skills and click Add.

Questions:

- Does it add a duplicate?
- Does the input clear?
- Why?

Find the answer in `makeTagHandlers`.

### Exercise C: Current work checkbox

Predict what happens when a work entry is marked "Currently working here."

Questions:

- Does End Date show?
- What happens to `endDate` in state?
- Why is `null` the correct value?

Find the answer in the checkbox handler.

### Exercise D: Active nav

Imagine the route is `/find-jobs/abc123`.

Predict:

- Which nav item is active?
- Which condition in `NavLinks` makes nested routes work?

Find the answer in:

```tsx
pathname === href || pathname.startsWith(href + "/")
```

---

## 17. Self-Check Quiz

Answer these before expanding.

**1. Why did the architect session choose one large `ProfileForm` client component?**

<details>
<summary>Reveal answer</summary>

The whole subtree is interactive and the completion banner depends on state from many
sections. One state owner avoids premature context, prop drilling, or split-state bugs.

</details>

**2. Why is `mockProfile` typed as `Profile`?**

<details>
<summary>Reveal answer</summary>

So TypeScript verifies the mock has the same shape as real database profile rows at the
declaration site. It catches drift before Feature 06 connects real data.

</details>

**3. Why is `completionPercentage` computed with `useMemo`?**

<details>
<summary>Reveal answer</summary>

It is derived from existing state. Storing it separately would create stale derived
state if any handler forgot to update it.

</details>

**4. Why does `TagInput` live outside `ProfileForm`?**

<details>
<summary>Reveal answer</summary>

To keep its component identity stable across renders. A component function declared
inside `ProfileForm` would be recreated on every render and could cause remounts.

</details>

**5. Why is SVG better than a CSS conic gradient for this ring?**

<details>
<summary>Reveal answer</summary>

The design needs a rounded arc tip. SVG supports that with `strokeLinecap="round"`;
conic gradients do not provide the same stroke-linecap behavior.

</details>

**6. Why is `NavLinks` client-side but `Navbar` server-side?**

<details>
<summary>Reveal answer</summary>

`NavLinks` needs `usePathname()`, a client hook. `Navbar` needs server auth via
`getCtaHref()`. Splitting the leaf preserves both requirements.

</details>

---

## 18. Discussion Prompts For A Separate LLM Session

Use these after studying the code. Ask one prompt at a time and force the LLM to ask you
questions back.

```text
I just studied a Next.js profile form where one client component owns all state.
Challenge me: when would that decision become wrong, and what signals would justify
splitting it into smaller components?
```

```text
I studied a Profile mock typed as the real Profile interface.
Quiz me on TypeScript structural typing, nullable vs optional fields, and why Partial<T>
can hide bugs.
```

```text
I studied an SVG completion ring using strokeDasharray and strokeDashoffset.
Give me 5 percentage values and make me calculate the offset for radius 40. Correct my
math step by step.
```

```text
I studied controlled tag inputs with chips.
Ask me to debug three broken versions: one that allows duplicates, one where Enter
submits the form, and one where the input does not clear after Add.
```

```text
I studied a server Navbar with a client NavLinks leaf.
Give me three alternative designs, ask me to reject the worse ones, and make me explain
the tradeoff in terms of bundle size, auth access, and hydration.
```

For best results, ask the LLM to withhold answers until you commit to a prediction.
That mirrors the way this codebase should be studied: predict first, then inspect the
actual implementation.

---

## 19. What You Should Take Away

The profile page is not just a form. It is a controlled-state rehearsal for the data
model that powers the rest of JobPilot.

The durable patterns are:

- Keep route pages server-side when they will eventually fetch protected data.
- Use one client island when the entire subtree is interactive and tightly coupled.
- Type mock data as the real interface so UI code rehearses real data.
- Use UI edit types like `ExperienceLevel | ""` when DOM controls require strings.
- Store source state; derive completion and missing fields.
- Keep helper components at module scope for stable React identity.
- Use SVG when the visual requirement is a true stroked arc with rounded ends.
- Split tiny client leaves like `NavLinks` when only one part of a server component
  needs a browser hook.

Feature 06 will replace the mock source with real InsForge data. If you understand this
tutorial, that change should feel narrow: data source and save path change, but the UI
state model remains recognizable.
