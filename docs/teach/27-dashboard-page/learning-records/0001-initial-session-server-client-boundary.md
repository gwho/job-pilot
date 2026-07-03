# Learning Record 0001 — Initial Session: Server/Client Boundary

**Date:** 2026-07-03
**Lesson:** 0001-server-client-data-boundaries.html
**Topic:** When does code run — Server vs Client Components in the dashboard

## What was established

The user understands (at reading level) that:
- Server Components run on the server; Client Components run in the browser
- `"use client"` is added only when browser APIs are required (recharts, useState, etc.)
- The practical benefit: Server Components can query databases directly, eliminating loading states
- `StatsBar`, `ProfileBanner`, `RecentActivity` are Server Components; the three chart components are Client Components

## Key connection to mission

The user wants to use the dashboard as a bridge between web architecture and data work. The server/client split is the first architectural concept because it determines WHERE data is fetched — which directly affects how a dashboard pipeline is designed (what goes in the DB, what goes in an event system, what is computed server-side vs client-side).

## Zone of proximal development

Starting point: comfortable reading code, not yet confident explaining decisions.
After Lesson 1: should be able to explain why the three chart components need `"use client"` and why the profile banner DB query lives in `DashboardPage`.

Next lesson: the mock data seam — why all data arrays are defined in `page.tsx` and shaped like future real data. Directly prepares for Features 15–17.

## Open questions to address in future lessons

- What happens between "HTML arrives" and "charts appear"? (hydration — save for Lesson 3)
- How does `var(--color-accent)` reach inside an SVG chart? (Lesson 3: CSS custom properties in SVG)
- When does the pattern of "Server Component fetches, Client Component displays" break down? (deferred — cover when user hits a real case)
