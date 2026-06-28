# AI Discussion Topics — Imprint Audit

Questions for deeper exploration of the concepts surfaced in this session.

---

## Group 1 — Design tokens vs raw values

1. Why does `text-accent-foreground` compose better than `text-white` even when both resolve to `#ffffff` today? What breaks if you only use raw values?

2. A developer argues: "the token and the raw value are identical, so refactoring later is trivial — just find-and-replace." Why is this argument wrong?

3. When should a token be named after its **appearance** (e.g. `text-white`) vs its **semantic role** (e.g. `text-accent-foreground`)? What rule decides?

4. Tailwind v4 defines tokens in `@theme {}` in `globals.css`. How does this differ from Tailwind v3's `tailwind.config.ts`? What advantage does the CSS-native approach give when components use `var(--color-name)` directly in `style` props?

5. If the accent color changed to a dark purple that needed black text on top of it, which files would need to change and which would update automatically? Walk through exactly what happens at each layer.

---

## Group 2 — The on-accent token pattern

6. The on-accent tokens were named `on-accent` (not `accent-text` or `accent-foreground-muted`). Why does the `on-*` naming convention communicate the relationship more clearly?

7. The BottomCTA is the only component on a dark gradient surface. Is it worth creating a full token group for a single component? What's the argument for doing it anyway?

8. `--color-on-accent-muted: rgb(255 255 255 / 0.7)` uses an alpha channel. How does Tailwind v4 handle color tokens with alpha channels? Can you still use the `/` opacity modifier syntax on top of an already-alpha token like `text-on-accent-muted/50`?

9. If a second dark-background section were added — say a dark testimonial banner — should it reuse the `on-accent` tokens or get its own group? What would the naming be?

---

## Group 3 — Intentional variation vs drift

10. What is the difference between intentional variation (a deliberate design signal) and drift (accidental inconsistency)? How do you tell them apart when auditing a codebase?

11. The audit found three levels of border radius: `rounded-2xl` (top-level cards), `rounded-xl` (nested sub-cards), `rounded-md` (interactive elements). What visual principle does this hierarchy encode? What would happen if everything used `rounded-2xl`?

12. Why do `shadow-sm` and `shadow-lg` carry semantic meaning beyond aesthetics? How does a developer decide which to use for a new component without asking a designer?

13. The audit confirmed that form labels (`text-text-dark`) and table column headers (`text-text-secondary uppercase tracking-wide`) are different by intent. If a new component needed a label — say a chart axis label — how would you decide which pattern to follow?

---

## Group 4 — The audit process itself

14. Why does `/imprint audit` present its findings and wait for confirmation before writing `ui-registry.md`? What could go wrong if it wrote automatically?

15. The audit scanned 18 components and found only 3 conflicts. Is this a sign the design system is healthy, or could there be more problems the audit missed? What can a visual scan of components reveal that a class-name audit cannot?

16. The audit did not flag `BottomCTA`'s inline `style` prop as a violation. Under what rule is that inline style acceptable, and what would make it not acceptable?

17. What is the right cadence for running `/imprint audit` vs `/imprint` (per-component capture)? When does a full re-audit make sense?

---

## Group 5 — Maintaining the registry going forward

18. The `ui-registry.md` baseline table now has 20+ rows. How does a developer know which rows apply to a new component they're building? Are all rows equally important?

19. Feature 12 (Job Details Page) is next. Before writing any JSX, what should a developer read in `ui-registry.md` and why? What is the minimum they need to confirm?

20. If a future designer updates the accent color from purple to blue, what is the minimal set of changes required in this codebase? List every file that needs touching, and explain why each one is necessary.
