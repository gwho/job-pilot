# AI Discussion Topics — Profile Page Polish: Project Review

Use these prompts to go deeper on the concepts and decisions from this review session.

---

## The Ring Visibility Bug — Mock Data and Representative Default State

1. "The ring was built correctly but was never visible on default page load because the mock
   data was fully populated. Explain the concept of 'representative default state' in UI
   development. What is the rule for writing mock data when a component has conditional
   visibility?"

2. "The verification checklist for Feature 05 included 'Banner shows SVG ring with correct
   percentage + missing field pills' — and that check passed (by manually clearing Full Name).
   What is the difference between 'the component works when triggered' and 'the component is
   visible in the default state'? How should verification checklists account for this?"

3. "Two fix approaches were considered: (A) null out three mock fields to produce 70%, or
   (B) always show the ring card with dual-state content. What are the tradeoffs? In what
   situations is Option A preferable, and when is Option B preferable?"

---

## Conditional Rendering vs CSS Visibility

4. "What is the difference between `{condition && <Component />}` and
   `<Component style={{ display: condition ? 'block' : 'none' }} />`? For the profile ring,
   which approach would be correct after the fix, and why does it matter for CSS transitions?"

5. "When the ring card was conditionally rendered with `&&`, the SVG ring was absent from the
   DOM. Now that it's always rendered, the ring is in the DOM even when the profile is 'complete'.
   What are the accessibility implications of always rendering vs conditionally rendering a
   progress indicator? Should the ring have an `aria-label` when at 100%?"

6. "React renders `false` as nothing (no DOM output). Explain what other falsy values React
   renders differently — specifically, what happens if you do `{0 && <Component />}` vs
   `{false && <Component />}` vs `{undefined && <Component />}`?"

---

## CSS Token Families and Design System Completeness

7. "The warning color family was missing `--color-warning-light`. All other semantic families
   (accent, success, info) had complete families with light/dark/foreground variants. Explain
   what 'semantic color families' are in a design system. Why is completeness important — what
   breaks if families are incomplete?"

8. "The value `#fff3e0` was chosen for `--color-warning-light`. How would you derive the
   'light' variant for a base color in a real design system? What is the relationship between
   HSL lightness and a 'light' variant? Is `#fff3e0` a mathematically derived value from
   `#ff8904`, or a hand-picked aesthetic choice?"

9. "`bg-surface-muted` (#f4f5fb) has a blue-purple tint because it's in the accent color
   family. `bg-surface-secondary` (#f9fafb) is neutral grey. Explain how surface tokens in a
   design system carry semantic meaning — why does the upload zone's background color matter,
   and when would `bg-surface-muted` be the correct choice?"

---

## The Inert UI Contract and Progressive Feature Development

10. "Feature 05's buttons (Save Profile, Connect LinkedIn, Select Resume) are 'inert' — they
    render but do nothing. Explain the benefits and risks of this pattern. What could go wrong
    if a future developer forgets that a button is inert and ships it to production?"

11. "The Connected Accounts card was added during a project review rather than in Feature 05's
    original scope. Explain why the cost of adding inert UI is lower at the project review
    stage than after real data is wired in Feature 06. What would have needed to be tested if
    it were added post-Feature 06?"

12. "OAuth flows (like 'Connect LinkedIn') involve multiple steps: initiating an auth request,
    receiving a callback, storing tokens, and showing connected state. When the 'Connect LinkedIn'
    button eventually gets wired up, what are the stages of that flow and which part touches the
    browser, which part touches the server, and which part touches the database?"

---

## Project Reviews as a Practice

13. "This project review caught 5 gaps after Feature 05 was considered 'done'. What does a
    good project review check for? What is the difference between a project review and a code
    review — and why does the project review happen at the browser level, not the code level?"

14. "The explanation doc says: 'The cost of fixing visual bugs increases as a feature
    progresses.' Explain why this is true specifically for a Next.js app with Server Actions
    and real database data. What specifically would need to be re-tested if a visual bug were
    fixed in Feature 07 (AI extraction) that could have been fixed in Feature 05?"

15. "In this project, every feature gets a plan.md, explanation.md, and ai-discussion-topics.md.
    Project reviews get the same structure in a separate `docs/project-review/` folder. Why
    keep project review docs separate from feature plan docs? What is the conceptual difference
    between a feature plan doc and a project review doc?"
