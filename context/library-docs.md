# Library Docs

Project-specific usage patterns for every third party library in this project. This file only covers how we use each library in this specific project — rules, patterns, and constraints specific to JobPilot.

Read the relevant section before implementing any feature that touches these libraries.

---

## Before Using Any Library

Before implementing any feature that uses a third party library:

1. **Check AGENTS.md** at the project root — it lists every skill installed for this project and how to use them. Skills contain up-to-date API documentation, usage patterns, and best practices specific to this codebase.

2. **Check if an MCP server is configured** for that library. Some tools have MCP servers that give the AI agent direct access to documentation, logs, and debugging tools. If an MCP server is available — use it before falling back to general knowledge.

3. **Read this file** for project-specific patterns that override general library knowledge.

The order of authority is:

```
MCP server (real-time docs) → Skills via AGENTS.md → This file (project rules) → General training knowledge
```

Never rely on general training knowledge alone for library APIs — they change frequently and training data may be outdated.

---

## InsForge

**Check first:** Check AGENTS.md for an installed InsForge skill. If an InsForge MCP server is configured — use it. The skill/MCP will have the latest API patterns.

### Client vs Server

The real package is `@insforge/sdk` (not `@insforge/ssr`). SSR helpers live at the `@insforge/sdk/ssr` and `@insforge/sdk/ssr/middleware` subpaths. Three separate surfaces — never mix them:

```typescript
// lib/insforge-client.ts — browser context only
// No auth mutations exposed here by design (signIn/signUp/signOut run server-side
// so the refresh token cookie stays server-owned/httpOnly).
import { createBrowserClient } from "@insforge/sdk/ssr";

export const insforge = createBrowserClient(); // reads NEXT_PUBLIC_INSFORGE_URL / NEXT_PUBLIC_INSFORGE_ANON_KEY
```

```typescript
// lib/insforge-server.ts — server context only, read-only session access
import { createServerClient } from "@insforge/sdk/ssr";
import { cookies } from "next/headers";

export const createInsforgeServer = async () => {
  return createServerClient({ cookies: await cookies() });
};
```

```typescript
// app/actions/auth.ts ("use server") and Route Handlers — auth mutations only
import { createAuthActions } from "@insforge/sdk/ssr";

const auth = createAuthActions({ cookies: await cookies() });
// or, in a Route Handler with separate request/response cookies:
// const response = NextResponse.json({ success: true });
// createAuthActions({ requestCookies: request.cookies, responseCookies: response.cookies })
// where `response.cookies` is the outgoing NextResponse cookie writer.
```

**Rules:**

- Browser client — Client Components, browser-side session reads, realtime subscriptions
- Server client — Server Components, Route Handlers, agent functions (read-only `getCurrentUser()`)
- Auth Actions (`createAuthActions`) — Server Actions and Route Handlers only, the only place sign-in/sign-up/sign-out/OAuth exchange happen
- Never use browser client in server context
- Never use server client (or Auth Actions) in browser context

---

### Auth

```typescript
// Get current user in server context
const insforge = await createInsforgeServer();
const { data, error } = await insforge.auth.getCurrentUser(); // not getUser()
if (!data.user) redirect("/login");
```

OAuth is a server-driven PKCE flow — the SSR browser client does **not** auto-exchange the callback:

```typescript
// app/actions/auth.ts ("use server")
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";

export async function signInWithGoogle() {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  let result;

  try {
    result = await auth.signInWithOAuth("google", {
      redirectTo: new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL).toString(),
      skipBrowserRedirect: true,
    });
  } catch (error) {
    console.error("[actions/auth]", error);
    redirect("/login?error=oauth");
  }

  const { data, error } = result;
  if (error || !data.url || !data.codeVerifier) {
    console.error("[actions/auth]", error ?? "OAuth init failed");
    redirect("/login?error=oauth");
  }

  cookieStore.set("insforge_code_verifier", data.codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(data.url);
}
```

```typescript
// app/api/auth/callback/route.ts
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAuthActions } from "@insforge/sdk/ssr";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("insforge_code");
    const verifier = (await cookies()).get("insforge_code_verifier")?.value;
    if (!code || !verifier) return NextResponse.redirect(new URL("/login?error=oauth", request.url));

    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    const auth = createAuthActions({
      requestCookies: request.cookies,
      responseCookies: response.cookies, // outgoing response writer, not request.cookies
    });
    const { error } = await auth.exchangeOAuthCode(code, verifier);
    if (error) {
      console.error("[api/auth/callback]", error);
      return NextResponse.redirect(new URL("/login?error=oauth", request.url));
    }

    response.cookies.delete("insforge_code_verifier");
    return response;
  } catch (error) {
    console.error("[api/auth/callback]", error);
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
```

**Rules:**

- `getCurrentUser()` is the only get-user method — there is no `getUser()`
- OAuth code verifier is stored in an httpOnly app cookie, never exposed to the browser
- Session refresh in `proxy.ts` uses `updateSession()` from `@insforge/sdk/ssr/middleware`
- In Route Handlers, always create the outgoing `NextResponse` first and pass that response's `.cookies` object as `responseCookies`; never pass `request.cookies` as the writer.

---

### DB Queries

```typescript
// Read
const { data, error } = await insforge
  .from("jobs")
  .select("*")
  .eq("user_id", user.id)
  .order("found_at", { ascending: false });

// Insert
const { data, error } = await insforge
  .from("jobs")
  .insert({ user_id: user.id, title, company, match_score })
  .select()
  .single();

// Update
const { error } = await insforge
  .from("jobs")
  .update({ company_research: dossier })
  .eq("id", jobId)
  .eq("user_id", user.id); // always scope to user
```

**Rules:**

- Always scope queries to `user_id` — never query without user filter
- Always handle the `error` return — never assume success
- Use `.single()` when expecting exactly one row

---

### Storage

```typescript
// Remove old file before re-uploading (upload() does NOT upsert — it auto-renames on conflict)
const { data: profile } = await insforge.database
  .from("profiles")
  .select("resume_pdf_key")
  .eq("id", userId)
  .maybeSingle();

if (profile?.resume_pdf_key) {
  await insforge.storage.from("resumes").remove(profile.resume_pdf_key);
}

// Upload new file — returns { data: { key, url }, error }
const { data, error } = await insforge.storage
  .from("resumes")
  .upload(`${userId}/resume.pdf`, file); // file is a File | Blob

// Save both key and URL to DB
await insforge.database
  .from("profiles")
  .upsert([{ id: userId, resume_pdf_key: data.key, resume_pdf_url: data.url }]);

// For private buckets, generate a signed URL for download (expires in 1h)
const { data: signed } = await insforge.storage
  .from("resumes")
  .createSignedUrl(data.key, 3600);
// signed.signedUrl is the time-limited download URL
```

**Storage paths:**

- Base resume: `resumes/{user_id}/resume.pdf`

**Rules:**

- `upload()` has NO `upsert` option — it auto-renames if the key already exists
- Always `remove(existingKey)` before re-uploading to keep a single file per user
- Always save `data.key` (not just `data.url`) to DB — key is needed for remove + signed URLs
- `resumes` bucket is private — use `createSignedUrl(key, expiresIn)` to serve files; `getPublicUrl()` only works for public buckets
- Never write files to disk — always upload File/Blob directly

---

## Apify (JobsDB HK Job Discovery)

**Consumer skill (Store + CLI):** `/apify-ultimate-scraper` installed at `.agents/skills/apify-ultimate-scraper/`. Use for: searching the Store, fetching actor input schemas, testing runs. Requires `apify login` or `APIFY_TOKEN` env var in shell.

**Runtime SDK (`apify-client`):** Used by `lib/apify.ts` inside Next.js. Never uses the CLI — pure HTTP calls with env var auth.

**Actor-building (development only):** `apify create` to scaffold, `apify run` to test locally, `apify push` to deploy. Actor lives in `apify/jobsdb-hk-actor/`. Requires `apify login`.

### Runtime pattern — `lib/apify.ts`

```typescript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

const run = await client
  .actor(process.env.APIFY_JOBSDB_ACTOR_ID!)
  .call(input, { timeoutSecs: 270 }); // slightly under route's maxDuration

if (run.status !== 'SUCCEEDED') {
  throw new Error(`Actor run ${run.status}`);
}

const { items } = await client.dataset(run.defaultDatasetId!).listItems();
```

### Auth/session boundary

The actor loads a Playwright `storageState` from the **Apify KV store** under the key `JOBSDB_SESSION`. The developer captures this manually and uploads it once to Apify. JobPilot never stores JobsDB credentials. See `docs/plan/10b-jobsdb-discovery/session-capture.md` for the full capture process.

### JobsDB search URL format

Use JobsDB's SEO search path, not the generic query-parameter route:

```text
https://hk.jobsdb.com/{query-slug}-jobs
https://hk.jobsdb.com/{query-slug}-jobs/in-{location-slug}
https://hk.jobsdb.com/{query-slug}-jobs/in-{location-slug}?page=2
```

Example:

```text
https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong
```

Do not use `https://hk.jobsdb.com/jobs?q=...&l=...` for actor search. Live Apify runs showed that URL can render generic JobsDB listings that do not match the typed keyword.

### JobsDB job record mapping

```typescript
// In app/api/agent/find/route.ts — after discoverJobsDbJobs()
{
  user_id: userId,
  run_id: runId,
  source: 'search',
  source_provider: 'jobsdb_hk',   // always set for JobsDB rows
  source_url: job.sourceUrl,
  external_apply_url: job.externalApplyUrl ?? job.sourceUrl,
  title: job.title,
  company: job.company,
  location: job.location,
  salary: job.salary ?? null,
  job_type: jobType,               // normalized from jobType string
  about_role: job.description,     // full detail-page description
}
```

### Deduplication

Before insert, query `jobs` for `user_id + source_provider='jobsdb_hk'` and build a `Set<source_url>`. Also dedupe within the batch. Skip rows with existing `source_url` — no fuzzy matching in v1.

### Required env vars

- `APIFY_TOKEN` — from https://console.apify.com/settings/integrations
- `APIFY_JOBSDB_ACTOR_ID` — returned by `apify push` (format: `username/actor-name` or numeric ID)

**Rules:**

- Never use the `apify` CLI in runtime code — only `apify-client` SDK in `lib/apify.ts`
- `route.ts` sets `export const maxDuration = 300` — tune to deployment plan (Vercel Hobby max is 60s)
- Session expiry check: if the actor returns 0 results and you expect some, the session may be expired — re-capture storageState
- `source_provider` is always `'jobsdb_hk'` for JobsDB rows — never omit it
- Success message format: `Found X jobs and saved Y new jobs.` (X = discovered, Y = newly inserted after dedupe)

---

## Adzuna API

**Check first:** Check AGENTS.md for an installed Adzuna skill. If none exists — use this file and the official Adzuna API docs.

### Job Search

```typescript
// lib/adzuna.ts
export async function searchJobs(
  jobTitle: string,
  location: string,
  country: string = "us",
): Promise<AdzunaJob[]> {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID!,
    app_key: process.env.ADZUNA_APP_KEY!,
    what: jobTitle,
    category: "it-jobs", // always filter to IT jobs
    results_per_page: "10",
    "content-type": "application/json",
  });

  // Only add where if location is provided
  if (location) {
    params.set("where", location);
  }

  const response = await fetch(
    `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`,
  );

  if (!response.ok) {
    throw new Error(`Adzuna API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}
```

### Response Shape

Each Adzuna job result contains:

```typescript
type AdzunaJob = {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  description: string; // snippet only — not full description
  redirect_url: string; // Adzuna tracking URL → redirects to actual job
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted: "0" | "1"; // "1" means salary is estimated
  contract_type?: string;
  created: string; // ISO date string
  category: { tag: string; label: string };
};
```

### Saving Jobs to DB

```typescript
// Map Adzuna result to jobs table
const jobRecord = {
  user_id: userId,
  run_id: runId,
  source: "search", // always 'search' for Adzuna jobs
  source_url: job.redirect_url,
  external_apply_url: job.redirect_url,
  title: job.title,
  company: job.company.display_name,
  location: job.location.display_name,
  salary: job.salary_min
    ? `$${Math.round(job.salary_min / 1000)}k - $${Math.round(job.salary_max! / 1000)}k`
    : null,
  job_type: job.contract_type || "fulltime",
  about_role: job.description, // Adzuna returns snippet — used as description
  match_score: scoredJob.matchScore,
  match_reason: scoredJob.matchReason,
  matched_skills: scoredJob.matchedSkills,
  missing_skills: scoredJob.missingSkills,
  found_at: new Date().toISOString(),
};
```

**Rules:**

- Always include `category=it-jobs` — never search Adzuna without this filter
- Never pass `where` if location is empty — omit the parameter entirely
- `source` is always `'search'` for Adzuna jobs — never any other value
- `salary_is_predicted: "1"` means Adzuna estimated the salary — this is normal
- Adzuna description is a snippet — Nemotron scores from it, not a full description
- Default country to `'us'` — support `gb`, `au`, `ca` as alternatives

---

## Hyperbrowser

**Check first:** Check AGENTS.md for an installed Hyperbrowser skill. If a Hyperbrowser MCP server is configured — use it.

### Session Creation — Company Research

```typescript
import { Hyperbrowser } from "@hyperbrowser/sdk";
import type { SessionDetail } from "@hyperbrowser/sdk/types";

const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! });

// Single session for company research — sequential page visits
const session = await client.sessions.create({
  useStealth: true,
  adblock: true,
  acceptCookies: true,
  timeoutMinutes: 2, // covers homepage + 3 sub-pages
});
// session.wsEndpoint — CDP WebSocket URL (pass to Stagehand)
// session.liveUrl    — viewable URL for debugging only, never stored or shown in UI
```

### Session Cleanup

Always clean up in `finally` using null-guards:

```typescript
let stagehand: Stagehand | null = null;
let session: SessionDetail | null = null;
let client: HyperbrowserClient | null = null;

finally {
  if (stagehand) await stagehand.close();
  if (client && session) await client.sessions.stop(session.id);
}
```

### Required environment

- `HYPERBROWSER_API_KEY` — server-only, never prefix with `NEXT_PUBLIC_`
- Only `lib/hyperbrowser.ts` initializes the client

**Rules:**

- Always use single sessions — one per research run
- Session timeout is 2 minutes — sufficient for homepage + 3 sub-pages
- Always stop session in `finally` — use null-guards for partial initialization
- API key only in `lib/hyperbrowser.ts` — never read directly in agent or route code
- Never store `session.liveUrl` in the DB or expose it in the UI

---

## Stagehand

**Check first:** Check AGENTS.md for an installed Stagehand skill. If a Stagehand MCP server is configured — use it. The skill/MCP will have the latest act() and extract() patterns.

### Initialisation (with Hyperbrowser CDP)

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

// session.wsEndpoint comes from createHyperbrowserSession() in lib/hyperbrowser.ts
const stagehand = new Stagehand({
  env: "LOCAL",                                          // "LOCAL" = bring your own browser via CDP
  localBrowserLaunchOptions: { cdpUrl: session.wsEndpoint },
  model: {
    // "openai/" prefix tells Stagehand to route via its OpenAI provider to https://openrouter.ai/api/v1
    modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
  },
  disablePino: true,
});

await stagehand.init();
const page = stagehand.context.activePage(); // Page | undefined
if (!page) throw new Error("No active page after Stagehand init");
```

### extract()

`extract()` takes positional args: `(instruction: string, schema: ZodSchema)`. Do NOT pass an options object `{ instruction, schema }`.

```typescript
import { z } from "zod";

const PageSchema = z.object({
  companyOverview: z.string().optional(),
  mainProduct: z.string().optional(),
  techMentions: z.array(z.string()).optional(),
  navLinks: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
});

const result = await stagehand.extract(
  "Extract the company overview, main product description, and any technology mentions from this page.",
  PageSchema,
);
// result is typed as z.infer<typeof PageSchema>
```

### act()

```typescript
// Always wrap in try/catch
try {
  await stagehand.act({
    action: "Click the About link in the navigation",
  });
} catch (error) {
  await logAgentError(jobId, null, error);
}
```

## NVIDIA Nemotron 3 Ultra (via OpenRouter)

**Model:** `nvidia/nemotron-3-ultra-550b-a55b:free` — accessed via OpenRouter's OpenAI-compatible endpoint. Free tier on OpenRouter. API key: `OPENROUTER_API_KEY`.

### Structured JSON Response

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://job-pilot.app",
    "X-Title": "JobPilot",
  },
});

const response = await openai.chat.completions.create({
  model: "nvidia/nemotron-3-ultra-550b-a55b:free",
  response_format: { type: "json_object" },
  temperature: 0.3,
  messages: [
    {
      role: "system",
      content: "You are a job matching assistant. Return only valid JSON.",
    },
    {
      role: "user",
      content: `Your prompt here`,
    },
  ],
});

const result = JSON.parse(response.choices[0].message.content!);
```

**Temperature settings:**

- `0.3` — matching, scoring, extraction — deterministic results
- `0.4` — company research synthesis — grounded but flexible enough to make real connections
- `0.7` — resume generation — natural variation

**Max tokens:**

- Job matching + scoring: `300`
- Company research synthesis: `2000`
- Resume generation: `1000`
- Profile extraction from resume: `800`

**Rules:**

- Model string is always `'nvidia/nemotron-3-ultra-550b-a55b:free'` — never use other model names
- Always use `response_format: { type: 'json_object' }` for structured data
- Always parse `response.choices[0].message.content` as string — even with json_object it returns a string
- Always validate parsed JSON before using — wrap in try/catch
- Match threshold is always `MATCH_THRESHOLD` from `lib/utils.ts` — never hardcode 70
- Company research synthesis must always return a complete dossier — never return empty even if browser research failed

---

## PostHog

**Check first:** Check AGENTS.md for an installed PostHog skill. If a PostHog MCP server is configured — use it. The skill/MCP will have the latest client and server patterns.

### Client Setup (Browser)

```typescript
// lib/posthog-client.ts
import posthog from "posthog-js";

export function initPostHog() {
  if (typeof window !== "undefined") {
posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host:
    process.env.NODE_ENV === "development"
      ? process.env.NEXT_PUBLIC_POSTHOG_HOST!
      : "/ingest",
  autocapture: false,
  capture_pageview: false, // manual pageview tracking
  capture_exceptions: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_web_experiments: true,
});
  }
}

// Capture event client-side
posthog.capture("job_found", {
  userId,
  source: "search",
  matchScore: score,
});
```

### Server Setup

```typescript
// lib/posthog-server.ts
import { PostHog } from "posthog-node";

export const createPostHogServer = () =>
  new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
    flushAt: 1, // send immediately
    flushInterval: 0, // no batching — Next.js functions are short-lived
  });

// Always use and shutdown in the same function
const posthog = createPostHogServer();
posthog.capture({
  distinctId: userId,
  event: "company_researched",
  properties: { userId, jobId, company },
});
await posthog.shutdown(); // required — ensures event is sent
```

**Rules:**

- Always call `await posthog.shutdown()` in server-side functions — events are lost without it
- `flushAt: 1` and `flushInterval: 0` always set on server client
- Event names must match exactly the list in `code-standards.md`
- Always include `userId` as a property on every server-side event
- Call `posthog.identify(userId)` after login on client side
- Call `posthog.reset()` on logout on client side
- Browser-side PostHog must use `NEXT_PUBLIC_POSTHOG_HOST` directly in development and `/ingest` only outside development. This keeps local dev from surfacing reverse-proxy failures as app-origin 500s while preserving the production proxy path.
- Keep `autocapture`, exception capture, session recording, surveys, product tours, and web experiments disabled unless `code-standards.md` is explicitly expanded with the extra events those features produce.

---

## @react-pdf/renderer

**Check first:** Check AGENTS.md for an installed react-pdf skill. PDF generation APIs can differ from general training knowledge.

### Resume PDF Generation

```typescript
import { renderToBuffer } from '@react-pdf/renderer'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica' },
  section: { marginBottom: 10 },
  heading: { fontSize: 14, fontWeight: 'bold' },
  text: { fontSize: 10 },
})

const ResumePDF = ({ profile }: { profile: Profile }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.section}>
        <Text style={styles.heading}>{profile.fullName}</Text>
        <Text style={styles.text}>{profile.email}</Text>
      </View>
    </Page>
  </Document>
)

// Generate buffer
const buffer = await renderToBuffer(<ResumePDF profile={profile} />)

// Upload directly to InsForge Storage
await insforge.storage
  .from('resumes')
  .upload(`${userId}/resume.pdf`, buffer, {
    contentType: 'application/pdf',
    upsert: true
  })
```

**Supported CSS properties:**
Only use these — others are silently ignored:
`padding, margin, fontSize, color, fontFamily, flexDirection, alignItems, justifyContent, borderRadius, width, height, fontWeight, textAlign, lineHeight`

**Rules:**

- Server-side only — never import in client components
- Always use `renderToBuffer` — not `renderToStream` or `PDFDownloadLink`
- PDF generation only in `app/api/resume/` routes
- Generated buffer uploaded directly to InsForge Storage — never written to disk
- Always save public URL to DB after upload

---

## pdf-parse

**Check first:** Check AGENTS.md for an installed pdf-parse skill.

### Extract Text from Uploaded Resume

```typescript
import pdf from "pdf-parse";

// In API route handling resume upload
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("resume") as File;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const pdfData = await pdf(buffer);
  const extractedText = pdfData.text; // raw text content

  // Send to GPT-4o for structured extraction
}
```

**Rules:**

- Server-side only — never import in client components
- `pdfData.text` is raw unformatted text — GPT-4o handles the structure extraction
- Always handle parse errors — some PDFs are image-based and return empty text
- If `pdfData.text` is empty or very short — return error to user: "Could not extract text from this PDF. Please try a different file."
