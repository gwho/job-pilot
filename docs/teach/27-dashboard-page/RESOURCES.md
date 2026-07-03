# Resources — Dashboard Architecture and Data Work

## Core reading (tied directly to this workspace)

- [Tutorial 27 README](../../tutorials/27-dashboard-page/README.md) — The full code-grounded tutorial on Feature 14. Read this after each lesson to see the concept applied to real code.
- [Feature 14 Plan](../../plan/14-dashboard-page/plan.md) — What was built and key invariants.
- [Feature 14 Explanation](../../plan/14-dashboard-page/explanation.md) — Deep explanation of every technical decision.

## React Server Components (foundational)

- [React Docs — Server Components](https://react.dev/reference/rsc/server-components) — The official explanation of what Server Components are and are not. **Start here for Lesson 1.** Read the "What problem does this solve?" section specifically.
- [Next.js Docs — Server and Client Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components) — How Next.js App Router implements Server Components. Explains the rendering boundary and "use client" in practical terms.

## CSS custom properties and SVG

- [MDN — Using CSS custom properties (variables)](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) — How `--color-accent` and `var(--color-accent)` work in the cascade. The "Inheritance of custom properties" section explains why changing a token on `:root` updates everything.
- [MDN — SVG presentation attributes](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/Presentation) — Why SVG uses `fill="..."` as an attribute rather than CSS `background-color`. Explains the specificity order.

## Data contracts and the seam design

- [Working Effectively with Legacy Code — Michael Feathers (Chapter 4: The Seam Model)](https://www.oreilly.com/library/view/working-effectively-with/0131177052/) — The original description of "seams" as substitution points in software. The dashboard's mock data boundary is a classic seam.
- [Martin Fowler — Data Transfer Object](https://martinfowler.com/eaaCatalog/dataTransferObject.html) — The pattern behind `{ day: string; count: number }[]` — a data shape designed for transfer between a data source and a consumer.

## Recharts

- [Recharts documentation](https://recharts.org/en-US/api) — API reference for `AreaChart`, `BarChart`, `ResponsiveContainer`, `linearGradient`. When reading: focus on the `data` prop shape and the `fill`/`stroke` prop types.

## Dashboards as data products

- [The Analytics Engineering Guide — dbt Labs](https://www.getdbt.com/analytics-engineering/start) — How data engineers think about transforming raw event data into metrics suitable for dashboards. Relevant when Feature 17 wires PostHog data. Free to read online.
- [Storytelling with Data — Cole Nussbaumer Knaflic (Chapter 2: Choosing an effective visual)](https://www.storytellingwithdata.com/book) — When to use a bar chart vs. line chart vs. area chart. Directly applicable to the three chart components built in Feature 14.
