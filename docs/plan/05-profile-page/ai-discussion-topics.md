# AI Discussion Topics — Feature 05: Profile Page Full UI

Use these prompts to explore the concepts from this feature more deeply.

---

## Single Client Boundary

1. "ProfileForm is one big 'use client' component instead of many small leaf-level clients.
   The CLAUDE.md says to push the client boundary as deep as possible, but this feature didn't.
   Explain when the 'push to the leaf' principle applies and when it's correct to ignore it."

2. "Feature 06 will pass an `initialProfile` prop fetched server-side into `ProfileForm`.
   How does that data flow work when `ProfileForm` is already a client component? Does the
   `initialProfile` prop get passed through the hydration boundary?"

3. "What would need to change if we decided to split the SVG ring into its own `RingProgress`
   component? Would it be client or server? What prop would it receive?"

---

## SVG Ring

4. "Walk me through the formula `strokeDashoffset = circumference × (1 - percentage / 100)`
   from first principles. What does `strokeDashoffset = 0` look like, and what does
   `strokeDashoffset = circumference` look like?"

5. "The ring uses `style={{ transition: 'stroke-dashoffset 0.4s ease' }}` for animation.
   What is the difference between this CSS transition approach and using a library like
   Framer Motion's `animate` prop? In which cases would Framer Motion be worth the
   bundle-size cost?"

6. "SVG's coordinate system starts at the 3 o'clock position. Why does it start there
   (what is the mathematical convention)? And explain why `rotate(-90deg)` moves it to the
   top rather than `rotate(90deg)`."

---

## Controlled Inputs and Data Flow

7. "The tag input clears itself after 'Add' is clicked. Trace exactly what happens in React's
   render cycle: user clicks Add → chip added → input cleared. At what point does the browser
   DOM actually change, and why is it React's job to control that?"

8. "What would happen if you used `defaultValue` instead of `value` on the skill input? Try
   to describe the exact failure mode when the user clicks Add and the input does not clear."

9. "The `makeTagHandlers` factory returns `{ add, remove, onKey }` closures. What does each
   closure close over, and why is it important that these functions are recreated when the
   items array changes?"

---

## TypeScript: FormState and Structural Typing

10. "Explain why `ExperienceLevel | ''` is used for dropdown fields in FormState instead of
    `ExperienceLevel | null`. What would TypeScript error would you get if you tried to pass
    `null` as the `value` prop of a `<select>`?"

11. "If you removed the `: Profile` annotation from `const mockProfile: Profile = { ... }`,
    TypeScript would infer its type from the literal. What type would it infer for a field like
    `experience_level: 'junior'` — would it be `string`, `ExperienceLevel`, or `'junior'`?
    Which is most useful, and why?"

12. "TypeScript uses structural typing. Explain a concrete scenario where two completely
    unrelated types would be structurally compatible in TypeScript but would be rejected by
    a nominally typed language like Java."

---

## Derived State

13. "The completion percentage is computed by useMemo. If you forgot to include `skills` in
    the dependency array, what exact bug would occur? Would you notice it immediately, or
    only in a specific scenario?"

14. "`is_complete` (boolean) is stored in the database, but `completionPercentage` (number)
    is derived in the component. These represent the same underlying fact from different angles.
    What is the right mental model for when to store state vs derive it?"

15. "When would `useState` be more appropriate than `useMemo` for a derived value? Are there
    cases where computing via useMemo is actually harmful (performance or correctness)?"

---

## NavLinks and Client/Server Boundaries in Layout

16. "The Navbar is a Server Component that contains `<NavLinks />`, a Client Component.
    Where does `<NavLinks />` actually render? Does it render on the server, the client, or
    both? What is the sequence?"

17. "If I added a second thing to Navbar that needed a client hook — say, a notification bell
    that subscribes to a WebSocket — should I make Navbar 'use client', or extract another
    thin client component? What's the principle guiding that decision?"

18. "`usePathname()` returns the current URL path. What happens to that value during a
    Next.js soft navigation (clicking a Link)? Does the page reload, and how does NavLinks
    know to re-render with the new active state?"

---

## TagInput at Module Scope (Lint Fix)

19. "Explain exactly what React does when it sees a new function reference for a component
    type on re-render. What is 'unmounting' a component, and why does it matter for state?"

20. "The `react-hooks/static-components` ESLint rule caught the nested component definition.
    The bug it prevents was invisible in this feature (TagInput has no state). Describe a
    scenario where the same pattern *would* cause a visible bug — what would the user
    experience be?"

21. "What is the difference between a React component and a function that returns JSX? If
    both look identical (`function Foo() { return <div /> }`), why does it matter whether
    React treats it as a component vs a plain function?"
