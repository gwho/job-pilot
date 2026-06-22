# AI Discussion Topics — Feature 05: Profile Page Architect Session

Use these prompts to explore the concepts from this session more deeply.

---

## SVG Progress Rings

1. "Explain stroke-dasharray and stroke-dashoffset to me from first principles. Why do we use
   the circumference formula 2πr, and what would go wrong if we used the diameter instead?"

2. "How would I animate the ring so it transitions smoothly when the percentage changes in React?
   What is the difference between a CSS transition on stroke-dashoffset vs using a React animation
   library like Framer Motion?"

3. "Why is SVG used for this instead of a CSS conic-gradient? What are the trade-offs between
   the two approaches for a progress ring with rounded arc ends?"

4. "The ring is rotated -90 degrees so it starts at the top. Why doesn't SVG start at the top
   by default, and what would the ring look like without the rotation transform?"

---

## Controlled vs Uncontrolled Inputs

5. "Explain the difference between a controlled and uncontrolled input in React. Why does the
   skills tag input need to be controlled, and what would break if it were uncontrolled?"

6. "The skills array is both display state and future form submission data. How does React's
   single-direction data flow (state → render → event → setState) make this reliable compared
   to reading from the DOM directly?"

7. "What is the difference between `defaultValue` and `value` on an input element? When would
   you choose one over the other?"

---

## TypeScript Structural Typing and Mock Data

8. "Why does TypeScript check our mock data against the Profile interface at the declaration site,
   not at the point of use? What is 'structural typing' and how is it different from nominal
   typing in Java or C#?"

9. "The Profile interface has many nullable fields (string | null). Why does the mock data still
   need to provide all of them? What would happen if we used Partial<Profile> for the mock?"

10. "The FormState type uses `ExperienceLevel | ''` instead of `ExperienceLevel | null` for
    dropdown fields. Why is the empty string used here? What breaks if you use null instead,
    and why does TypeScript require the explicit type annotation rather than inferring it?"

---

## Next.js App Router Client/Server Boundaries

11. "Explain why making a component 'use client' in Next.js does not mean it only runs in the
    browser. What is the difference between a Server Component and a Client Component's render
    environment?"

12. "If ProfileForm.tsx is a client component and page.tsx is a server component, where does
    hydration happen? What is hydration and why does it matter for a form with pre-populated data?"

13. "The architecture says to push the client boundary as deep (as leaf-level) as possible. Why?
    What concrete benefit does that give — is it bundle size, render performance, something else?"

14. "The Navbar is an async Server Component that needs getCtaHref(), but active nav state needs
    usePathname() which is a client hook. How does splitting these into Navbar.tsx (server) and
    NavLinks.tsx (client) solve this? What would break if Navbar became 'use client'?"

---

## Feature Split Pattern

15. "Why is separating UI-with-mock-data (Feature 05) from UI-with-real-data (Feature 06) a
    good engineering practice? What category of bugs does it help you find earlier?"

16. "The Server Action in actions/profile.ts will be an async function with 'use server'. What
    is the mental model for how a Server Action differs from an API route? When would I use each?"

17. "Feature 05's Save button is inert — no onClick, no disabled attribute. Why is it better
    to leave it fully styled but non-functional rather than marking it `disabled`?"

---

## Derived State and useMemo

18. "The completion percentage is derived from the skills array and other form fields, not stored
    separately. Why is derived state preferred over storing a completionPercentage number in
    useState? What React concept describes this pattern?"

19. "Profile.is_complete is a boolean in the database but the ring shows a percentage. How do
    these relate? Why is is_complete never used as the source of truth for the ring display?"

20. "useMemo recomputes when its dependency array changes. What happens if you forget to include
    a dependency — say, skills — in the array? What bug does that create, and how does React's
    exhaustive-deps ESLint rule catch it?"

---

## Shared Component Audit Pattern

21. "The Navbar active state was in ui-registry.md marked as a 'future feature' but was missed
    in the architect session. What process check would reliably catch this kind of deferred
    component work before implementation starts?"

22. "When should a deferred item in ui-registry.md be promoted to an explicit task in the
    current feature? What signal indicates that a deferred behavior is now 'unlocked' by the
    current feature being built?"
