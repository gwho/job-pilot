# Mission — Dashboard Architecture as a Bridge to Data Work

**What I want to learn:**
Use the Feature 14 Dashboard as a learning vehicle to understand why a data-driven web app is structured the way it is — and to build the mental models I'll need for future data work.

**Specific goals:**

1. Understand why the dashboard is split the way it is: Server Components for authenticated/profile-aware data, "use client" chart components for browser rendering, clear phase boundaries between UI (Feature 14), DB stats (15), activity feeds (16), and PostHog analytics (17).

2. Learn how mock data shaped like future real data is a design contract — and why this matters when the real data source (a database or analytics API) isn't wired yet.

3. Build a bridge to practical data work: turning raw app events and database rows into meaningful metrics, choosing the right chart type for a dataset, designing data schemas that make dashboards easy to build, and explaining dashboard architecture clearly for freelance, sales admin, or portfolio projects.

**Why this matters beyond JobPilot:**
Dashboards are the output of data work. Understanding how a dashboard pulls from databases, event systems, and analytics APIs — and why the architecture separates those concerns — gives me vocabulary and patterns I can use to describe and build data pipelines in any context.

**Zone of proximal development (starting point):**
Comfortable reading code with guidance. Not yet confident explaining *why* architectural decisions are made. Wants to be able to explain decisions to others (freelance clients, portfolio reviewers).

---

*Last updated: Feature 14 — Dashboard Page: Full UI*
