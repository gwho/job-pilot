# Code Standards

Implementation rules and conventions for the entire project. The AI agent must follow these in every session without exception. These rules prevent pattern drift across sessions.

---

## Engineering Mindset

The AI agent on this project operates as a senior engineer. This means:

- **Think before implementing** — understand what is being built and why before writing a single line
- **Read context files first** — never assume, always verify against architecture.md and project-overview.md
- **Scope is sacred** — only build what the current feature requires. Never go beyond scope even if it seems helpful
- **Every feature must be testable** — if it cannot be verified immediately after implementation, it is incomplete
- **Clean over clever** — simple readable code that a junior developer can understand is always preferred over clever abstractions
- **One thing at a time** — complete one feature fully before touching the next
- **Failures are expected** — wrap agent operations in try/catch, log failures, never let one failure crash everything

---

## TypeScript

- Strict mode enabled in tsconfig.json — no exceptions
- Never use `any` — use `unknown` and narrow the type
- Never use type assertions (`as SomeType`) unless absolutely necessary and commented why
- All function parameters and return types must be explicitly typed
- Use `type` for object shapes and unions — use `interface` only for extendable component props
- All async functions must have proper error handling — never let promises float unhandled
- Use `const` by default — only use `let` when reassignment is necessary

---

## Next.js 16 Conventions

- App Router only — no Pages Router
- React 19 — use React 19 APIs throughout
- All components are Server Components by default
- Only add `"use client"` when the component requires:
  - useState or useReducer
  - useEffect
  - Browser APIs
  - Event listeners
  - Third party client-only libraries (PostHog browser side)
- Never add `"use client"` to layout files unless absolutely required
- Data fetching happens in Server Components — never fetch in Client Components directly
- Route handlers live in `app/api/` — never put business logic directly in route handlers
- Server Actions live in `actions/` — never define Server Actions inline in components
- Caching is uncached by default — all dynamic code runs at request time
- Always read Next.js documentation before implementing any Next.js specific feature — APIs may differ from training data

---

## File and Folder Naming

- Folders: kebab-case — `job-details`, `agent-controls`
- Component files: PascalCase — `StatsBar.tsx`, `RecentActivity.tsx`
- Utility files: camelCase — `browserbase.ts`, `posthog-client.ts`
- Type files: camelCase — `index.ts`
- API route files: always `route.ts`
- Server Action files: camelCase — `profile.ts`, `jobs.ts`
- One component per file — never export multiple components from one file
- Index files only in `components/ui/` — never barrel export from other folders

---

## Component Structure

Every component follows this exact order:

```typescript
"use client"; // only if needed

// 1. External imports
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 2. Internal imports
import { StatsCard } from "@/components/dashboard/StatsCard";

// 3. Type definitions
type Props = {
  jobId: string;
  matchScore: number;
};

// 4. Component
export function ComponentName({ jobId, matchScore }: Props) {
  // state
  // derived values
  // handlers
  // return JSX
}
```

- Never use default exports for components — always named exports
- Props type defined directly above the component — not in a separate types file unless shared
- No inline styles — all styling via Tailwind classes using CSS variables from ui-tokens.md

---

## API Route Handlers

```typescript
// app/api/agent/find/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createInsforgeServer } from "@/lib/insforge-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // validate body
    // call agent function
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[agent/find]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

- Every route handler has a try/catch
- Every route handler validates the request body before processing
- Errors are logged with the route path as prefix: `[agent/find]`
- Always return `{ success: boolean, data?: T, error?: string }`
- Never return raw data without the success wrapper

---

## Server Actions

```typescript
// actions/profile.ts

"use server";

import { revalidatePath } from "next/cache";
import { createInsforgeServer } from "@/lib/insforge-server";

export async function saveProfile(formData: ProfileFormData) {
  try {
    const insforge = await createInsforgeServer();
    // validate
    // write to DB
    revalidatePath("/profile");
    return { success: true };
  } catch (error) {
    console.error("[actions/profile]", error);
    return { success: false, error: "Failed to save profile" };
  }
}
```

- Every Server Action has a try/catch
- Every Server Action returns `{ success: boolean, error?: string }`
- Always call `revalidatePath` after mutations that affect page data
- Never throw from Server Actions — always return the error
- **Exception — auth redirect actions**: `signInWithGoogle`, `signInWithGithub`, `signOut` in `app/actions/auth.ts` call `redirect()` instead of returning. `redirect()` throws a special Next.js error internally and cannot coexist with a return value. These are navigation actions, not data mutations — they are the approved exception to the return pattern above.

---

## Agent Code

```typescript
// agent/adzuna.ts

export async function discoverJobs(
  jobTitle: string,
  location: string,
  profile: Profile,
  runId: string,
): Promise<{ success: boolean; jobs?: Job[]; error?: string }> {
  try {
    // implementation
    return { success: true, jobs };
  } catch (error) {
    await logAgentError(runId, null, error);
    return { success: false, error: String(error) };
  }
}
```

- Every agent function returns `{ success: boolean, error?: string }`
- Every agent function has a try/catch — never let one failure crash the run
- Errors are always logged to agent_logs table before returning
- Agent functions never import from `components/` or `actions/`
- Agent functions never use React hooks or browser APIs

---

## InsForge Client Usage

```typescript
// Browser context — Client Components only, read-only session
import { insforge } from "@/lib/insforge-client";

// Server context — Server Components, Route Handlers, Agent (read-only getCurrentUser())
import { createInsforgeServer } from "@/lib/insforge-server";
const insforge = await createInsforgeServer();

// Auth mutations only — Server Actions and Route Handlers (sign-in/sign-up/sign-out/OAuth)
import { createAuthActions } from "@insforge/sdk/ssr";
const auth = createAuthActions({ cookies: await cookies() });
```

- Never use the browser client in server context
- Never use the server client (or `createAuthActions`) in browser context
- The browser client has no auth mutation methods by design — those run server-side only
- Always await createInsforgeServer() — it reads cookies asynchronously
- Get the current user with `insforge.auth.getCurrentUser()` — there is no `getUser()`
- Always scope every query to the current user_id — never query without a user filter

---

## InsForge Schema & Infrastructure Changes

Before running any DDL (`CREATE TABLE`, `ALTER TABLE`, `DROP`) or infrastructure operations (`create-bucket`, `create-function`) via the InsForge MCP tools, always call `get-backend-metadata` first.

```
Step 1 — mcp__insforge__get-backend-metadata   ← confirm connectivity and correct project
Step 2 — mcp__insforge__run-raw-sql / create-bucket / etc.
```

**Why this is required:** Successful MCP tool calls implicitly confirm connectivity, but they do not confirm you are targeting the intended project. A misconfigured backend URL silently routes DDL to the wrong InsForge project — the call succeeds, the table appears created, and the bug surfaces later when the app cannot find the table. `get-backend-metadata` makes the project identity explicit before any state-changing operation. This step was identified as an oversight in Feature 04 and is now standard for all future schema and infrastructure work.

---

## Error Handling

- Never use empty catch blocks — always log or handle
- Console errors always include context prefix: `[component/function name]`
- User-facing errors must be human readable — never expose raw error messages
- Agent errors go to agent_logs table — never surface raw agent errors to the UI
- API route errors return `status: 500` with generic message — never expose internals

---

## PostHog Events

All PostHog events must use these exact event names. Never invent new event names without adding them here first.

| Event                | When                                       | Key Properties             |
| -------------------- | ------------------------------------------ | -------------------------- |
| `user_signed_in`     | OAuth sign-in completed successfully       | email                      |
| `user_signed_out`    | User session cleared                       | —                          |
| `job_search_started` | Find Jobs button clicked                   | userId, jobTitle, location |
| `job_found`          | Each job discovered and saved              | userId, source, matchScore |
| `profile_completed`  | User saves complete profile for first time | userId                     |
| `company_researched` | Company research dossier generated         | userId, jobId, company     |

These six events are the only events in this project. Do not add more without updating this list first.

Fire these events consistently — they are the analytics record of user activity in PostHog.

The three dashboard charts (Jobs Found Over Time, Company Research Activity, Match Score Distribution) source their data from the DB at render time, not from PostHog event history. `posthog-node` is capture-only and cannot query events. Chart data comes from `jobs.found_at`, `jobs.company_research.researchedAt` (JSONB), and `jobs.match_score` respectively.

---

## Environment Variables

All environment variables defined in `.env.local` for development. Never hardcode any key, URL, or secret anywhere in the codebase.

| Variable                        | Used In                |
| ------------------------------- | ---------------------- |
| `NEXT_PUBLIC_INSFORGE_URL`      | lib/insforge-client.ts |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | lib/insforge-client.ts |
| `NEXT_PUBLIC_APP_URL`           | app/actions/auth.ts (OAuth redirectTo) |
| `HYPERBROWSER_API_KEY`          | lib/hyperbrowser.ts    |
| `OPENROUTER_API_KEY`            | agent/ functions, lib/stagehand.ts |
| `ADZUNA_APP_ID`                 | lib/adzuna.ts          |
| `ADZUNA_APP_KEY`                | lib/adzuna.ts          |
| `NEXT_PUBLIC_POSTHOG_KEY`       | instrumentation-client.ts, lib/posthog-server.ts |
| `NEXT_PUBLIC_POSTHOG_HOST`      | instrumentation-client.ts, lib/posthog-server.ts |

`NEXT_PUBLIC_` prefix means the variable is exposed to the browser. Never add `NEXT_PUBLIC_` to secret keys.

---

## Match Threshold

The job match threshold is defined once as a constant. Never hardcode this value anywhere else.

```typescript
// lib/utils.ts
export const MATCH_THRESHOLD = 70;
```

Import and use `MATCH_THRESHOLD` everywhere this value is needed.

---

## Import Aliases

Always use the `@/` alias — never use relative imports that go up more than one level.

```typescript
// Correct
import { Button } from "@/components/ui/button";
import { insforge } from "@/lib/insforge-client";
import { MATCH_THRESHOLD } from "@/lib/utils";

// Never
import { Button } from "../../../components/ui/button";
```

---

## Comments

- No comments explaining what the code does — code must be self-explanatory
- Comments only for why — explaining a non-obvious decision
- Agent functions may have a brief comment explaining the Hyperbrowser or Stagehand strategy
- Never leave TODO comments in committed code

---

## Dependencies

Never install a new package without a clear reason. Before installing anything check:

1. Does shadcn/ui already have this component?
2. Does Next.js already provide this functionality?
3. Is there a simpler native solution?

Approved dependencies for this project:

- `@insforge/sdk` — InsForge client (SSR helpers via the `@insforge/sdk/ssr` and `@insforge/sdk/ssr/middleware` subpaths)
- `@hyperbrowser/sdk` — Hyperbrowser cloud browser sessions
- `@browserbasehq/stagehand` — AI browser control (Stagehand connects to Hyperbrowser via CDP)
- `openai` — Nemotron via OpenRouter's OpenAI-compatible endpoint (`baseURL: https://openrouter.ai/api/v1`)
- `posthog-js` — PostHog browser client
- `posthog-node` — PostHog server client
- `@react-pdf/renderer` — Resume PDF generation
- `pdf-parse` — Extract text from uploaded PDF
- `zod` — Schema validation
- `lucide-react` — Icons
- `tailwindcss` — Styling
- `shadcn/ui` components — UI primitives
- `recharts` — Dashboard charts (bar, area/line). Feature 14 mock data; Feature 17 real DB data.

Do not install any other packages without updating this list first.
