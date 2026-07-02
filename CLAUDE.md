# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Commands

```bash
npm run dev       # Start dev server (Next.js 16, http://localhost:3000)
npm run build     # Production build
npm run lint      # Run ESLint
npm run test:run  # Run Vitest tests once (CI)
npm run test      # Run Vitest in watch mode
```

No test runner is configured. Verify features manually after implementation by running the dev server.

---

## Stack at a Glance

| Concern        | Tool                                        |
| -------------- | ------------------------------------------- |
| Framework      | Next.js 16 App Router, React 19             |
| Backend        | InsForge — auth, database, storage, realtime (Supabase-compatible API) |
| AI             | NVIDIA Nemotron 3 Ultra via OpenRouter (matching, extraction, synthesis, resume generation) |
| Browser agent  | Hyperbrowser (cloud browser sessions) + Stagehand (AI page control via CDP) |
| Job data       | JobsDB HK via Apify actor (active); Adzuna API (preserved, bypassed in v1) |
| Analytics      | PostHog (event tracking + dashboard charts) |
| PDF            | @react-pdf/renderer (resume generation), pdf-parse (resume extraction) |
| Styling        | Tailwind CSS v4 + shadcn/ui |
| Language       | TypeScript strict mode throughout |

InsForge behaves like Supabase (`createBrowserClient` / `createServerClient` from `@insforge/ssr`). The client pattern is documented in `context/architecture.md` — never mix browser and server clients.

---

## Architecture in One Pass

### Folder responsibilities

| Folder        | Owns                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `app/`        | Pages and API routes only — no business logic                         |
| `agent/`      | All agent logic (Adzuna, research, matching, extraction) — no React   |
| `actions/`    | Server Actions for UI-triggered mutations (profile save, job updates) |
| `components/` | UI only — no DB calls, no data fetching                               |
| `lib/`        | Third-party client initialisation and shared utilities                |
| `types/`      | TypeScript types shared across the project                            |

### Three data flows

**UI mutations** → Server Action in `actions/` → InsForge DB write → `revalidatePath()`

**Agent operations** → API route in `app/api/agent/` → function in `agent/` → JobsDB HK Apify actor + Nemotron scoring → InsForge DB write → page revalidated

**Company research** → `app/api/agent/research` → `agent/research.ts` → single Hyperbrowser session + Stagehand via CDP (homepage + max 3 sub-pages) → Nemotron synthesis → dossier saved to `jobs.company_research` JSONB

### Key invariants

- Agent code in `agent/` never imports from `components/` or `actions/`
- Server Actions never call agent functions — only API routes do
- All server-side InsForge writes use `createInsforgeServer()` — never the browser client
- Every query must be scoped to `user_id` — never fetch without a user filter
- Every Stagehand action is wrapped in try/catch; failures logged to `agent_logs`, never thrown
- Browserbase sessions always closed with `stagehand.close()` — even on failure
- Company research always returns a dossier — Nemotron synthesises from job description + profile if browser research fails
- Adzuna always includes `category=it-jobs`
- `MATCH_THRESHOLD = 70` lives in `lib/utils.ts` — import it, never hardcode

### Styling

Tailwind v4 — tokens defined with `@theme` in `app/globals.css`. No `tailwind.config.ts` for colors. Never use raw Tailwind color classes (`bg-purple-500`) or hex values in components — only project token classes (`bg-accent`, `text-text-primary`). Full token list is in `context/ui-tokens.md`.

### PostHog events (exactly four — do not add more without updating `context/code-standards.md`)

| Event                | Fired when                              |
| -------------------- | --------------------------------------- |
| `job_search_started` | Find Jobs button clicked                |
| `job_found`          | Each job discovered and saved           |
| `profile_completed`  | User saves complete profile first time  |
| `company_researched` | Company research dossier generated      |

### Environment variables

All in `.env.local`. Required: `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `HYPERBROWSER_API_KEY`, `OPENROUTER_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `APIFY_TOKEN`, `APIFY_JOBSDB_ACTOR_ID`.

`APIFY_TOKEN` — from https://console.apify.com/settings/integrations. `APIFY_JOBSDB_ACTOR_ID` — the deployed actor ID returned by `apify push` (format: `username/actor-name` or the numeric ID).

---

## Agent skills

### Issue tracker

GitHub Issues (`github.com/gwho/job-pilot`). External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
