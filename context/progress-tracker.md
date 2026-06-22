# Progress Tracker

Update this file after every completed feature. Any AI agent reading this should immediately know what is done, what is in progress, and what is next.

---

## Current Status

**Phase:** Phase 1 — Foundation
**Last completed:** 02 Auth
**Next:** 03 PostHog Initialization

---

## Progress

### Phase 1 — Foundation

- [x] 01 Homepage
- [x] 02 Auth
- [ ] 03 PostHog Initialization
- [ ] 04 Database Schema

### Phase 2 — Profile Page

- [ ] 05 Profile Page — Full UI
- [ ] 06 Profile Save Logic
- [ ] 07 AI Profile Extraction from Resume
- [ ] 08 Resume PDF Generation from Profile

### Phase 3 — Find Jobs Page

- [ ] 09 Find Jobs Page — Full UI
- [ ] 10 Adzuna Job Discovery
- [ ] 11 Filter + Sort + Pagination

### Phase 4 — Job Details Page

- [ ] 12 Job Details Page — Full UI
- [ ] 13 Company Research Agent

### Phase 5 — Dashboard

- [ ] 14 Dashboard Page — Full UI
- [ ] 15 Stats Bar — Real Data
- [ ] 16 Recent Activity — Real Data
- [ ] 17 Analytics Charts — PostHog Data

---

## Decisions Made During Build

- **02 Auth**: `context/architecture.md`, `library-docs.md`, and `code-standards.md` referenced a fictional `@insforge/ssr` package and a `middleware.ts` file. Verified against the real published `@insforge/sdk` (v1.4.2, via npm registry + unpkg) and later confirmed via the InsForge MCP once it became available in-session. Corrected all three context files in place: real package is `@insforge/sdk` (SSR helpers at `@insforge/sdk/ssr` and `@insforge/sdk/ssr/middleware`), OAuth is a server-driven PKCE flow (not client-side token-in-URL), get-user method is `getCurrentUser()` not `getUser()`, and Next.js 16 requires `proxy.ts` not `middleware.ts`. Full rationale in `docs/plan/02-auth/explanation.md`.

---

## Notes

- Placeholder pages exist at `/dashboard`, `/profile`, `/find-jobs` purely to prevent 404s from the Feature 02 auth redirect logic (`getCtaHref()` in `lib/auth.ts`) before their real features are built. Each is a one-line "coming soon" Server Component. Replace entirely, don't extend, when 05 Profile Page, 09 Find Jobs Page, and 14 Dashboard Page start.
