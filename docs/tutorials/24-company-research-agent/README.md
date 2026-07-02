# Tutorial 24 — Company Research Agent: Cloud Browsers, Fallback Chains, and Graceful Degradation

**After completing this tutorial you will understand:** how a cloud browser session works at the WebSocket/CDP level and why Stagehand can control a remote browser exactly as it would a local one; why `env: "LOCAL"` in Stagehand is a misleading name and what it actually instructs; how a three-step fallback chain derives a usable URL from unreliable job-board data; why external resources must be declared as `null` before a `try` block and individually guarded in `finally`; what the "never empty" invariant is and how isolating failures makes it structurally impossible to return nothing to the user; and why `useState(initialResearch)` is the right tool for updating UI after a fetch call returns data directly.

---

> [!NOTE]
> **Prerequisites:** Tutorial 23 (`../23-job-details-page/README.md`) — covers the job details page where this feature's "Research Company" button lives, the Server Component data fetch pattern, and how `company_research` is typed on `Job`. Tutorial 17 (`../17-adzuna-job-discovery/README.md`) — establishes the `agent/` layer architecture this feature extends, including the `logAgentError` pattern and the InsForge server client in agent code.
>
> Open [`lib/hyperbrowser.ts`](../../../lib/hyperbrowser.ts), [`lib/stagehand.ts`](../../../lib/stagehand.ts), [`agent/research.ts`](../../../agent/research.ts), [`app/api/agent/research/route.ts`](../../../app/api/agent/research/route.ts), and [`components/job-details/CompanyResearch.tsx`](../../../components/job-details/CompanyResearch.tsx) alongside this tutorial.

---

## CS & language concepts in this tutorial

| Concept | Where it appears | Category |
|---------|-----------------|----------|
| RAII — Resource Acquisition Is Initialization | Nullable variables + `finally` cleanup in `researchCompany()` | Design patterns |
| Fallback chain / multi-step graceful degradation | `deriveHomepageUrl()` three-step URL resolution | Algorithms |
| Set for O(1) deduplication | `new Set(allSources)` in `synthesizeDossier()` | Data structures |
| Graceful degradation invariant | Browser research isolated; synthesis always runs | System design |
| CDP — Chrome DevTools Protocol | Hyperbrowser `wsEndpoint` → Stagehand `cdpUrl` | OS fundamentals |
| Zod schema as extraction contract | `HomepageSchema` / `SubpageSchema` passed to `stagehand.extract()` | Type theory |

---

## How to use an LLM before this tutorial

Budget 25–35 minutes on these five concepts before reading code.

### Concept 1 — Remote browser control and WebSockets

> "Explain how web browsers expose an API for external control. What is the Chrome DevTools Protocol (CDP)? How does an external program connect to Chrome using a WebSocket URL? Once connected, what kinds of commands can be sent — give three concrete examples. Why does the program that connects and the browser that executes commands not need to be on the same machine? Quiz me on what happens to a CDP connection when the browser process is killed."

*What to listen for:* CDP is Chrome's built-in control API. Every running Chrome instance exposes a WebSocket endpoint at something like `ws://localhost:9222`. Any program that connects to that URL can send JSON-encoded commands: navigate to a URL, take a screenshot, evaluate JavaScript, read the DOM. Because it is a network protocol over WebSockets, the browser can run on a remote server. When the browser process dies, the WebSocket connection drops — the controller receives a connection-closed event.

*Practice question:* A cloud browser provider gives you a `wsEndpoint` string. Your Node.js server opens a WebSocket to it and sends a `Page.navigate` command. Who actually executes the navigation — your server, or the cloud machine hosting Chrome?

---

### Concept 2 — RAII: resource cleanup and partial initialization

> "Explain the concept of RAII — Resource Acquisition Is Initialization — as it applies to programming in general. In a language without destructors (like JavaScript or Python), how do you guarantee that an expensive external resource (a database connection, a file handle, a remote browser session) is always released, even when an error occurs? What is a `finally` block for, and what specific problem does it solve that try/catch alone does not? Give an example where initialization is partial — only some resources are acquired before an error. Quiz me on what happens if cleanup code references a variable that was never assigned."

*What to listen for:* RAII is the principle that resource lifetime is tied to a scope: acquire on entry, release on exit, guaranteed. JavaScript `finally` blocks run whether the `try` block succeeds or throws — they are the JS mechanism for guaranteed cleanup. The "partial initialization" problem: if you acquire Resource A then Resource B throws, your cleanup must release A but not B (B is unassigned). Referencing an unassigned variable in `finally` causes a second error that can hide the first.

*Practice question:* A function creates a database connection, then opens a file. The file open fails. A `finally` block calls `db.close()` and `file.close()`. What goes wrong? How would you fix it?

---

### Concept 3 — Fallback chains and defensive URL resolution

> "Explain the design pattern of a 'fallback chain' — a sequence of strategies tried in order, each falling through to the next when it fails. Give an example of resolving a resource (like a homepage URL) where the first strategy is most reliable but not always available, the second is less reliable but broader, and the third is a last resort. What should each step do when it fails — throw, return null, or continue? How do you write code that falls through cleanly without nested try/catches that obscure the logic? Quiz me on what a fallback chain looks like for finding a configuration value."

*What to listen for:* A fallback chain tries Strategy A, catches any failure, then tries Strategy B, catches any failure, then tries Strategy C, and so on. Each step has a clear success condition; if met, it returns immediately. If not (catch fires, wrong result), execution falls to the next step. The chain terminates at a guaranteed-always-works last resort. Clean structure: each step in its own `try/catch`, all at the same nesting level, no deep pyramids.

*Practice question:* You want to find a company's homepage. Strategy 1: follow the job apply URL's redirects. Strategy 2: parse the original URL directly. Strategy 3: construct from the company name. Which strategy is most likely to give the right answer? Which is most likely to run?

---

### Concept 4 — AI-powered structured extraction from web pages

> "Explain how AI models can extract structured data from a web page without CSS selectors. What information does the model need: the page content, a description of what to extract, and a schema for the output shape. What is Zod and how does a schema declare the expected shape of extracted data? How does the extract call differ from CSS-selector scraping in terms of fragility when a website redesigns? Explain what 'optional fields' in the schema mean for the extraction result. Quiz me on the trade-offs: when is AI extraction better than selectors, and when are selectors better?"

*What to listen for:* AI extraction reads the rendered page content as context and uses the instruction to understand what to pull out. It is resilient to DOM changes because it understands meaning, not structure. Zod schemas define the exact shape of the output — field names, types, whether fields are optional. Optional fields mean the extraction result may omit those keys if the page doesn't contain the information. AI extraction is worse than selectors when speed and cost matter; selectors fail when website structure changes but AI extraction degrades gracefully.

*Practice question:* A homepage has no explicit "funding" section. The `HomepageSchema` has `signals: z.array(z.string()).optional()`. What does Stagehand return for `signals`?

---

### Concept 5 — useState initialized from a server-fetched prop

> "In React, when a component receives a prop value and initialises `useState` with it, explain exactly what happens: does the state update when the prop changes? If the parent re-renders with a new prop value, does the state inside the child update? When is this the right pattern and when is it a bug? Contrast it with initialising state in useEffect based on a prop. Quiz me on a scenario where you receive server-fetched data as a prop and want the user to be able to update it locally without a page reload."

*What to listen for:* `useState(initialValue)` only uses `initialValue` at mount — the initial render. If the prop changes on subsequent renders, the state does NOT update (the initial value is stale). This is correct when the prop represents the "starting value" for data the user then modifies locally. It would be a bug if the intent is for the component to always mirror the parent's value. The pattern is also correct when the API call returns the updated value in the response body — you update state from the response, not from a prop change.

*Practice question:* `CompanyResearch` mounts with `initialResearch = null`. The user clicks "Research Company". The API returns a dossier. `setResearch(dossier)` is called. The parent re-renders with the same `initialResearch = null` prop. Does `research` become `null` again? Why or why not?

---

## Architecture overview

```
Browser (client)
┌────────────────────────────────────────────────────────────────┐
│  /find-jobs/[id]  →  CompanyResearch.tsx ("use client")        │
│                                                                │
│  useState(initialResearch)  ←── Server Component page.tsx      │
│  ↓ click "Research Company"                                    │
│  fetch POST /api/agent/research { jobId }                      │
│  setLoading(true)                                              │
└────────────────────────────────────────────────────────────────┘
                        │
                        ▼  HTTP POST
Server (Next.js)
┌────────────────────────────────────────────────────────────────┐
│  app/api/agent/research/route.ts                               │
│  ├─ auth guard (getCurrentUser)                                │
│  ├─ body validation (jobId: string)                            │
│  └─ researchCompany(jobId, userId)  ─────────────────────┐    │
└──────────────────────────────────────────────────────────│────┘
                                                           │
                        agent/research.ts                  │
                   ┌───────────────────────────────────────┘
                   │
                   ├── 1. Load job + profile from InsForge DB
                   │
                   ├── 2. deriveHomepageUrl(job)
                   │        ├── Step 1: fetch → follow redirects
                   │        ├── Step 2: parse original URL
                   │        └── Step 3: construct from name
                   │
                   ├── 3. Browser research block (try/catch)
                   │        │
                   │        ├── createHyperbrowserSession()
                   │        │     └─► Hyperbrowser cloud ──► wsEndpoint
                   │        │
                   │        ├── createStagehand(wsEndpoint)
                   │        │     └─► CDP connection to remote Chrome
                   │        │
                   │        └── conductBrowserResearch()
                   │              ├── page.goto(homepageUrl)
                   │              ├── stagehand.extract(instruction, HomepageSchema)
                   │              └── for each link: stagehand.extract(instruction, SubpageSchema)
                   │
                   │     finally: stagehand.close() → client.sessions.stop()
                   │
                   └── 4. synthesizeDossier(content, job, profile)  ◄── ALWAYS RUNS
                            └── Nemotron via OpenRouter
                                → JSON dossier
                                → saved to jobs.company_research
                                → returned in HTTP response body
```

**Three invariants governing this design:**

1. **Stagehand closes before the Hyperbrowser session stops.** Reversed order can produce CDP teardown errors as Stagehand's connection to the browser is cut mid-cleanup.
2. **Browser research is isolated; synthesis is unconditional.** The browser block is wrapped in `try/catch` so any failure leaves `content` at the empty default and synthesis still runs. The user always gets a dossier.
3. **Only the API route sees the generic error message; the server log sees the real one.** `console.error("[api/agent/research]", error)` records the full error; the 500 response only says `"Failed to research company"`.

---

## Part 1 — Remote browser sessions: what Hyperbrowser provides

Open [`lib/hyperbrowser.ts`](../../../lib/hyperbrowser.ts):

```typescript
import { Hyperbrowser, type HyperbrowserClient } from "@hyperbrowser/sdk";
import type { SessionDetail } from "@hyperbrowser/sdk/types";

export type HyperbrowserSession = SessionDetail;

export async function createHyperbrowserSession(): Promise<{
  client: HyperbrowserClient;
  session: HyperbrowserSession;
}> {
  const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! });
  const session = await client.sessions.create({
    useStealth: true,
    adblock: true,
    acceptCookies: true,
    timeoutMinutes: 2,
  });
  return { client, session };
}
```

`sessions.create()` does not start a local process. It calls Hyperbrowser's API, which provisions a Chrome instance in their cloud infrastructure. What comes back is a `SessionDetail` object — a descriptor with two key fields:

- `wsEndpoint` — a WebSocket URL pointing to that remote Chrome instance's CDP (Chrome DevTools Protocol) port
- `liveUrl` — a viewable URL you can open in a browser to watch the session in real time (useful for debugging; not used in production)

The Chrome DevTools Protocol is the internal API Chrome uses to communicate between its browser process and its DevTools panel. It is a WebSocket-based JSON protocol. Any program that opens a WebSocket connection to a `wsEndpoint` URL can send CDP commands: navigate to a URL, evaluate JavaScript, take a screenshot, click an element. The browser executes the commands on Hyperbrowser's machine; your server only receives the results.

The four session options serve specific purposes. `useStealth: true` patches browser fingerprints that headless Chrome otherwise exposes — missing plugins, specific viewport ratios, JavaScript property anomalies that anti-bot systems probe. `adblock: true` removes ad scripts that can interfere with page structure and slow load times. `acceptCookies: true` auto-clicks GDPR consent banners so pages render their full content. `timeoutMinutes: 2` is the safeguard: if your server crashes, throws, or forgets to call `sessions.stop()`, Hyperbrowser terminates the session after 2 minutes instead of leaving a billable browser running indefinitely.

**`HyperbrowserClient` vs `Hyperbrowser`** — The `Hyperbrowser` class is the constructor (what you `new`). `HyperbrowserClient` is the TypeScript interface that the constructed instance conforms to. The return type annotation uses `HyperbrowserClient` because that is the correct type for an instance, not a constructor. The `SessionDetail` type is not re-exported from the main `@hyperbrowser/sdk` index — it lives at `@hyperbrowser/sdk/types`. The wrong import path produces a TypeScript error.

> **OS fundamentals — Chrome DevTools Protocol (CDP):** CDP is Chrome's built-in remote-control bus, exposed over a WebSocket. It predates browser automation frameworks like Playwright and Puppeteer — those tools are abstractions built on top of CDP. The same protocol is what Chrome's actual DevTools panel uses to inspect running pages. This is why any CDP-capable browser — regardless of where it runs — is interchangeable from Stagehand's perspective: the protocol is the contract, not the machine.

**Checkpoint:** Why does the code return both `client` and `session` from `createHyperbrowserSession()`? What would break if `researchCompany()` only received the `session` object?

<details>
<summary>Reveal answer</summary>

`session` has `wsEndpoint` (needed to connect Stagehand) and `id` (needed to stop the session). `client` has the `sessions.stop(id)` method. If `researchCompany()` only received the `session`, it could connect Stagehand but could never call `client.sessions.stop(session.id)` in the `finally` block — the Hyperbrowser session would run until `timeoutMinutes` expired, wasting quota on every research call.

</details>

**Try it yourself:** Run `grep -n "wsEndpoint\|liveUrl" node_modules/@hyperbrowser/sdk/dist/types/session.d.ts` to see the exact field names on `SessionDetail`. Confirm `wsEndpoint: string` exists as a non-optional property.

---

## Part 2 — Connecting Stagehand to an external browser: the `env: "LOCAL"` pattern

Open [`lib/stagehand.ts`](../../../lib/stagehand.ts):

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

export async function createStagehand(cdpUrl: string): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { cdpUrl },
    model: {
      // "openai/" prefix tells Stagehand to use its OpenAI provider; the rest is the
      // OpenRouter model ID sent as the model param to https://openrouter.ai/api/v1
      modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: "https://openrouter.ai/api/v1",
    },
    disablePino: true,
  });
  await stagehand.init();
  return stagehand;
}
```

`env: "LOCAL"` is Stagehand's most confusingly named option. It does not mean "run a local browser on the developer's machine." It means: "I am providing the browser connection externally — do not spin one up." The companion field `localBrowserLaunchOptions.cdpUrl` is where you supply that external connection. When set to Hyperbrowser's `session.wsEndpoint`, Stagehand opens a WebSocket to the remote Chrome instance and issues CDP commands over it. From Stagehand's perspective, the behaviour is identical to controlling a local browser — the protocol is the same. The only difference is who manages the Chrome process lifetime.

The alternative `env: "BROWSERBASE"` would have Stagehand manage its own Browserbase session using the `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` env vars. That was the original planned provider. The `env: "LOCAL"` + `cdpUrl` pattern gives us the same AI extraction capability through a different cloud browser provider.

**The model name format** — Stagehand's `LLMProvider.getClient()` splits model names at the first `/` to identify the sub-provider. `"openai/nvidia/nemotron-3-ultra-550b-a55b:free"` produces `subProvider = "openai"` and `subModelName = "nvidia/nemotron-3-ultra-550b-a55b:free"`. Stagehand creates an OpenAI-compatible client with `baseURL = "https://openrouter.ai/api/v1"` and sends `"nvidia/nemotron-3-ultra-550b-a55b:free"` as the model name in the API request body. OpenRouter accepts that model ID and routes it to the correct provider.

The original implementation used `modelName: "nvidia/nemotron-3-ultra-550b-a55b:free"` without the `openai/` prefix. That produced `subProvider = "nvidia"`, which is not in Stagehand's supported provider list. The result was an `UnsupportedAISDKModelProviderError` thrown during the first `stagehand.extract()` call — caught silently inside `conductBrowserResearch()`, meaning browser extraction silently never ran. This bug was caught via `/diagnosing-bugs`.

**`stagehand.extract()` positional vs object form** — The `context/library-docs.md` originally documented `stagehand.extract({ instruction, schema })`. The installed V3 type signature is positional: `extract(instruction: string, schema: ZodSchema)`. The object form compiles — TypeScript accepts an object literal as the first positional argument — but fails at runtime because Stagehand receives the whole object where it expects a string instruction. This is the highest-risk category of API mismatch: no compile error, runtime failure only. The lesson: verify `.d.ts` types in `node_modules` before writing code against any third-party API.

**Checkpoint:** The build plan docs originally showed `stagehand.extract({ instruction, schema })`. The actual V3 API is positional: `extract(instruction, schema)`. Why would this mistake be hard to catch before runtime — what would TypeScript actually accept, and what error would appear?

<details>
<summary>Reveal answer</summary>

TypeScript accepts `stagehand.extract({ instruction, schema })` because the first positional parameter is typed as `string`, but TypeScript applies structural typing to the call: `{ instruction, schema }` is an object that satisfies `string` only if… wait, it doesn't — but the exact error depends on overloads. More practically, `{ instruction: "...", schema: z.object({}) }` passed where a `string` is expected may produce a type error at the call site in strict mode. However, `instruction` alone as a string and the object as a second argument could be misread.

The real risk: an old Stagehand v2 API accepted an object form. `{ instruction, schema }` in the object destructure sense compiles if the library changed the API — the JS runtime sees the first arg as a plain object, passes it to the internal function that expects a string instruction, and gets `"[object Object]"` or `undefined` for the instruction. The extraction still runs but with garbage input, returning empty or malformed results rather than throwing an obvious error. The failure is silent and non-obvious.

</details>

**Try it yourself:** Run `grep -n "activePage\|context" node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/understudy/context.d.ts` to confirm `activePage(): Page | undefined`. Notice the `| undefined` — this is why `agent/research.ts` null-checks the result before calling `page.goto()`.

---

## Part 3 — Deriving a homepage URL: the three-step fallback chain

Open [`agent/research.ts`](../../../agent/research.ts), lines 47–108:

```typescript
const JOB_BOARD_DOMAINS = new Set([
  "jobsdb.com", "hk.jobsdb.com",
  "linkedin.com", "www.linkedin.com",
  "indeed.com", "www.indeed.com",
  "glassdoor.com", "www.glassdoor.com",
  "adzuna.com", "www.adzuna.com",
  "seek.com", "www.seek.com",
  "monster.com", "www.monster.com",
  "ziprecruiter.com", "www.ziprecruiter.com",
  "reed.co.uk", "www.reed.co.uk",
]);

const JOB_SUBDOMAINS = new Set(["careers", "jobs", "apply", "job", "work", "hiring"]);

function normalizeToRootDomain(parsed: URL): string {
  const parts = parsed.hostname.split(".");
  if (parts.length > 2 && JOB_SUBDOMAINS.has(parts[0])) {
    return `${parsed.protocol}//${parts.slice(1).join(".")}`;
  }
  return `${parsed.protocol}//${parsed.hostname}`;
}

async function deriveHomepageUrl(job: Job): Promise<string> {
  const raw = job.external_apply_url ?? job.source_url;

  if (raw) {
    // Step 1: Follow redirects, parse final URL
    try {
      const response = await fetch(raw, { redirect: "follow" });
      const parsed = new URL(response.url);
      if (!JOB_BOARD_DOMAINS.has(parsed.hostname)) {
        return normalizeToRootDomain(parsed);
      }
    } catch {
      // fall through
    }

    // Step 2: Parse original URL without following redirects
    try {
      const parsed = new URL(raw);
      if (!JOB_BOARD_DOMAINS.has(parsed.hostname)) {
        return normalizeToRootDomain(parsed);
      }
    } catch {
      // fall through
    }
  }

  // Step 3: Construct from company name
  if (job.company) {
    const cleanName = job.company
      .replace(/\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|Limited|Group|Holdings?).*$/i, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (cleanName) {
      return `https://www.${cleanName}.com`;
    }
  }

  return "";
}
```

The job data contains two URL fields: `source_url` (the JobsDB listing URL) and `external_apply_url` (the apply link scraped from the listing). Neither is the company homepage — both point into job board infrastructure. The three-step chain works backward from most-reliable to least.

**Step 1 follows HTTP redirects server-side.** Many job board apply links are tracking redirects: clicking "Apply Now" on a listings page sends you through `redirect.jobsdb.com/track?url=https://careers.stripe.com/jobs/123`. `fetch(url, { redirect: "follow" })` resolves the entire chain synchronously without opening a browser. `response.url` is the final destination. Parsing it with `new URL()` then gives the hostname — `careers.stripe.com`. `normalizeToRootDomain` strips the `careers` subdomain (it is in `JOB_SUBDOMAINS`) and returns `https://stripe.com`. If the final URL is still on a job board (`JOB_BOARD_DOMAINS.has(hostname)` is true), this step provides no value and falls through.

**Step 2 parses the original URL directly.** Useful when `external_apply_url` is already a direct employer link — `https://careers.deliveroo.com/apply?ref=jobsdb` — and Step 1's redirect resolution didn't produce anything useful. Same normalization, same denylist check.

**Step 3 constructs from the company name.** Last resort only. The regex strips legal suffixes (`Inc.`, `Ltd.`, `LLC`) before lowercasing and removing non-alphanumeric characters. `"Deliveroo Ltd."` → `"deliveroo"` → `https://www.deliveroo.com`. Fails for non-.com domains, fails for names with abbreviations, but provides a non-empty string so the browser research block can at least try.

> **Algorithms — Fallback chain:** This structure is a classic fallback chain: try the most reliable strategy first, catch all errors and fall through, try progressively simpler strategies, terminate with a guaranteed result. Each step is independent — its failure has no effect on the next step's inputs. The empty catch blocks are intentional: falling through is the desired behaviour when a step doesn't produce a valid result. This differs from error suppression (hiding real bugs) because each step's failure is expected and well-understood.

**Checkpoint:** `fetch(url, { redirect: "follow" })` resolves redirect chains server-side. What would happen if this was attempted inside the browser (via `page.goto()`) instead, and when does server-side resolution fail where browser resolution would succeed?

<details>
<summary>Reveal answer</summary>

Server-side: `fetch` follows HTTP 301/302 redirects automatically and returns `response.url` — the final destination after all redirects. This happens before the browser is opened, with no rendering overhead. Browser-side via `page.goto()`: the browser follows the redirect chain too (all browsers do), and you could read `page.url()` after navigation. The difference is timing and cost — opening a browser session just to resolve a redirect wastes 1–2 seconds and uses browser quota.

Server-side `fetch` fails when the redirect requires JavaScript execution (some sites redirect via `window.location = ...` in a script, not an HTTP header), or when the server blocks non-browser user agents. Browser resolution succeeds in those cases because the full Chrome environment executes the JavaScript. For standard HTTP redirect chains (which is the typical case for job board tracking URLs), server-side `fetch` is faster, cheaper, and more reliable.

</details>

**Checkpoint:** The `JOB_SUBDOMAINS` Set strips subdomains like `jobs.`, `careers.`, `apply.`. What would happen for a company whose actual product domain starts with one of those words — say, a company with domain `careers-inc.com`?

<details>
<summary>Reveal answer</summary>

`normalizeToRootDomain` splits the hostname on `.` and checks if `parts[0]` is in `JOB_SUBDOMAINS`. For `careers-inc.com`, `parts = ["careers-inc", "com"]` and `parts.length` is 2, not greater than 2. The condition `parts.length > 2 && JOB_SUBDOMAINS.has(parts[0])` is false. The function returns `https://careers-inc.com` correctly — no stripping occurs because `careers-inc` is not in `JOB_SUBDOMAINS` (which contains exact strings like `"careers"`, not `"careers-inc"`). However, if the company used `careers.careers-inc.com`, the subdomain `careers` would be stripped, producing `https://careers-inc.com` — still correct. The edge case that would fail: a company literally named "Jobs" with domain `jobs.com`.

</details>

**Try it yourself:** Open a Node.js REPL or browser console. Run `new URL("https://jobs.stripe.com/jobs/123").hostname.split(".")`. What do you get? Now trace through `normalizeToRootDomain` by hand with this result.

---

## Part 4 — Nullable cleanup in `finally`: safe resource teardown

Open [`agent/research.ts`](../../../agent/research.ts), lines 322–345:

```typescript
let stagehand: Stagehand | null = null;
let session: HyperbrowserSession | null = null;
let client: HyperbrowserClient | null = null;

const homepageUrl = await deriveHomepageUrl(job);

if (homepageUrl) {
  try {
    const hb = await createHyperbrowserSession();
    client = hb.client;
    session = hb.session;
    stagehand = await createStagehand(hb.session.wsEndpoint);
    content = await conductBrowserResearch(job, stagehand, homepageUrl, userId);
  } catch (err) {
    await logAgentError(userId, jobId, `[agent/research] Session setup failed: ${String(err)}`);
  } finally {
    if (stagehand) {
      try { await stagehand.close(); } catch { /* already closed */ }
    }
    if (client && session) {
      try { await client.sessions.stop(session.id); } catch { /* already stopped */ }
    }
  }
}
```

Three variables declared as `null` before the `try` block. Assignment happens inside `try`. Cleanup happens in `finally`. Every step is guarded with a truthy check.

The problem this solves: partial initialization. `createHyperbrowserSession()` might succeed — `client` and `session` are assigned — but then `createStagehand()` might throw before `stagehand` is assigned. Without null guards, `finally` would attempt `stagehand.close()` on an unassigned variable, producing a `ReferenceError` — a second error layered on top of the first, which can hide the root cause in stack traces.

By declaring `let stagehand: Stagehand | null = null` before the block, `finally` can safely test `if (stagehand)` — if the assignment never happened, the check is false and the close call is skipped. Only the resources that were actually acquired get released.

The cleanup order is not arbitrary. Stagehand is closed first because it may be mid-CDP-command when an error fires. Closing the Hyperbrowser session first would drop the WebSocket connection underneath Stagehand's teardown sequence, potentially throwing additional errors as Stagehand tries to disconnect cleanly. Stagehand first, then session stop.

The inner `try { } catch { }` on each cleanup call handles the case where cleanup itself fails — the Hyperbrowser session may have already timed out, making `sessions.stop()` throw. An unhandled error in `finally` would mask the original error from `try`. The inner catch silences cleanup failures while still attempting cleanup.

> **Design patterns — RAII (Resource Acquisition Is Initialization):** RAII is the principle that resource lifetime is tied to a scope — acquired at entry, guaranteed released at exit. In C++ it is enforced by destructors. In JavaScript, `try/finally` is the manual equivalent: the `finally` block runs whether the `try` succeeds or throws, giving the same guarantee. Declaring resources as `null` before the `try` and guarding cleanup with truthy checks is the correct JavaScript RAII pattern for resources that can only be partially acquired.

**Checkpoint:** Why are `stagehand`, `session`, and `client` declared as `null` before the `try` block rather than inside it? What TypeScript error would appear if you declared them inside `try` and then referenced them in `finally`?

<details>
<summary>Reveal answer</summary>

TypeScript performs control-flow analysis to determine what is definitely assigned at each point in the code. If `stagehand` is declared inside the `try` block, TypeScript knows it might not have been reached (because the `try` could throw before that line). In the `finally` block, TypeScript would report: "Variable 'stagehand' is used before being assigned." The `finally` block is outside the `try` block's scope of guaranteed execution.

Declaring variables before the `try` block (initialised to `null`) puts them in scope for both `try` and `finally`. TypeScript then knows the variable is definitely assigned (to `null`) before `finally` runs. The `if (stagehand)` check narrows the type from `Stagehand | null` to `Stagehand` inside the block.

</details>

**Checkpoint:** Walk through what happens when `createHyperbrowserSession()` succeeds but `createStagehand()` throws: which variables are assigned, what does the `finally` block do, and what does `synthesizeDossier()` receive as its `content` argument?

<details>
<summary>Reveal answer</summary>

1. `createHyperbrowserSession()` returns `{ client: HyperbrowserClient, session: HyperbrowserSession }`. Both are assigned: `client = hb.client`, `session = hb.session`. `stagehand` is still `null`.

2. `createStagehand(hb.session.wsEndpoint)` throws. Execution jumps to `catch`. `logAgentError` is called.

3. `finally` runs. `if (stagehand)` is `false` — `stagehand` is still `null`, so `stagehand.close()` is skipped. `if (client && session)` is `true` — both were assigned. `client.sessions.stop(session.id)` is called, releasing the Hyperbrowser session.

4. Back in `researchCompany()`, `content` is still the empty default (`{ homepage: {}, subpages: [], homepageUrl: "", visitedUrls: [] }`). The `if (homepageUrl)` block has completed.

5. `synthesizeDossier(content, job, profile)` runs. `content.homepageUrl` is `""` (falsy), so `companyResearchText` becomes `"No browser research available — synthesize from job posting and candidate profile only."` Nemotron synthesises from the job description and profile. The user gets a dossier despite the browser failure.

</details>

---

## Part 5 — The "never empty" invariant: synthesis always runs

Open [`agent/research.ts`](../../../agent/research.ts), lines 314–358 (the full `researchCompany` function body):

```typescript
// Browser research — failures are contained, synthesis always runs
let content: ExtractedContent = {
  homepage: {},
  subpages: [],
  homepageUrl: "",
  visitedUrls: [],
};

let stagehand: Stagehand | null = null;
let session: HyperbrowserSession | null = null;
let client: HyperbrowserClient | null = null;

const homepageUrl = await deriveHomepageUrl(job);

if (homepageUrl) {
  try {
    // ... session, stagehand, conductBrowserResearch ...
  } catch (err) {
    await logAgentError(userId, jobId, `[agent/research] Session setup failed: ${String(err)}`);
  } finally {
    // ... cleanup ...
  }
}

// Synthesis always runs, even with empty content
const dossier = await synthesizeDossier(content, job, profile);

// Save to DB
await insforge.database
  .from("jobs")
  .update({ company_research: dossier })
  .eq("id", jobId)
  .eq("user_id", userId);

return dossier;
```

`synthesizeDossier()` is called unconditionally — outside any `try/catch`, after the browser block has completed or failed. This structural choice is the "never empty" invariant: there is no code path through `researchCompany()` that returns nothing.

The mechanism is `content`'s initial value. An `ExtractedContent` with empty homepage data and no subpages is still a valid input to `synthesizeDossier()`. When `content.homepageUrl` is an empty string (falsy), the synthesis prompt substitutes `"No browser research available — synthesize from job posting and candidate profile only."` Nemotron then produces the candidate-specific sections (`yourEdge`, `gapsToAddress`, `smartQuestions`, `interviewPrep`) from the job description and the candidate's profile alone. `companyOverview` and `techStack` may be thin, but the user receives actionable output.

The alternative — placing synthesis inside the browser block or gating it on a success flag — would mean any browser failure produces the generic error. That is a worse user experience than a partial dossier.

> **System design — Graceful degradation:** Graceful degradation is the property that a system continues to provide value when components fail, with quality that degrades proportionally to the failure — not a cliff edge from full output to nothing. The invariant here is explicit: browser research is optional, synthesis is mandatory. This is the same principle used in Progressive Web Apps (offline fallback), CDN edge caches (stale-while-revalidate), and database read replicas (serve stale reads when primary is down).

**Checkpoint:** `synthesizeDossier()` is called outside any try/catch. If Nemotron's API returns an empty response and the null check throws, what does the user experience? Is there a better alternative?

<details>
<summary>Reveal answer</summary>

If `synthesizeDossier()` throws — e.g. Nemotron returns empty content and the guard `if (!rawContent) throw new Error(...)` fires — the error propagates to `researchCompany()`, which propagates to the API route's outer `try/catch`. The route logs the real error and returns `{ success: false, error: "Failed to research company" }` with a 500 status. The component shows the error state.

The alternative would be wrapping synthesis in try/catch and returning a minimal dossier on failure:

```typescript
let dossier: CompanyResearchDossier;
try {
  dossier = await synthesizeDossier(content, job, profile);
} catch {
  dossier = { companyOverview: "", techStack: [], culture: [], ... researchedAt: new Date().toISOString() };
}
```

This preserves the "never empty" invariant even for synthesis failures. The trade-off: the user sees empty fields rather than an error. Whether that is better depends on product requirements. The current implementation treats synthesis failure as a hard error — which is appropriate because it suggests an API key problem or quota issue that the developer needs to know about.

</details>

---

## Part 6 — AI extraction with Zod: schemas, optional fields, and sub-page selection

Open [`agent/research.ts`](../../../agent/research.ts), lines 16–188 (schemas and `conductBrowserResearch`):

```typescript
const HomepageSchema = z.object({
  oneLiner: z.string().describe("What the company does in one sentence").optional(),
  productSummary: z.string().describe("What they build/sell and who it's for").optional(),
  signals: z.array(z.string()).describe("Funding, notable customers, scale, mission, recent news").optional(),
  pageLinks: z.array(z.object({
    url: z.string(),
    kind: z.enum(["about", "careers", "blog", "engineering", "product", "team", "other"]),
  })).describe("Internal links worth visiting").optional(),
});

const SubpageSchema = z.object({
  keyPoints: z.array(z.string()).optional(),
  technologies: z.array(z.string()).describe("Specific languages, frameworks, tools, platforms").optional(),
  valuesOrCulture: z.array(z.string()).describe("Stated values, working style, team norms").optional(),
  notable: z.array(z.string()).describe("Customers, funding, scale, projects, awards").optional(),
});
```

And from `conductBrowserResearch()`:

```typescript
const homepageData = await stagehand.extract(
  "This is a company's homepage. Capture what the company actually does, who it's for, and any concrete signals (funding, customers, scale, mission, recent launches). Then find the internal links most worth visiting to research them as an employer.",
  HomepageSchema,
);

content.homepage = homepageData;
content.visitedUrls.push(homepageUrl);

if (!homepageData.oneLiner && !homepageData.productSummary) {
  return content;
}

// Visit up to 3 sub-pages, prefer substantive sections over careers
const links = (homepageData.pageLinks ?? [])
  .filter((l) => l.kind !== "careers" && l.kind !== "other")
  .slice(0, 3);
```

Every field in both schemas is `.optional()`. This is not defensive coding for its own sake — it reflects the reality of web extraction. A company homepage might not have explicit funding information, might have no engineering blog link, might not state its values anywhere visible. If the schema required these fields, Stagehand would have to hallucinate values when the page doesn't contain them. Optional fields let Stagehand return only what it found; `synthesizeDossier()` handles `undefined` values by defaulting to empty strings or arrays.

The `pageLinks` field uses `z.enum(["about", "careers", "blog", "engineering", "product", "team", "other"])` for the `kind` field. This is an extraction contract: Stagehand categorises each found link into one of these buckets. The filtering step in `conductBrowserResearch()` then selects links where `kind !== "careers" && kind !== "other"`. Careers pages list open positions — useful for knowing a company is hiring, but not for understanding the company's product, values, or technology. About, engineering, blog, and product pages contain the substance that produces high-quality dossier sections.

The bail condition `if (!homepageData.oneLiner && !homepageData.productSummary)` exits early when the homepage extraction returned nothing meaningful. This happens on certain pages (heavy SPAs that don't render content until client-side JavaScript runs, or pages that require login) where Stagehand's extraction sees empty content. Continuing to navigate sub-pages from an empty homepage would waste the remaining time budget.

> **Type theory — Zod schema as extraction contract:** A Zod schema in this context is not just runtime validation — it is a type-level specification that Stagehand uses as an output contract for the AI model. The model sees the schema field names, descriptions, and types as the shape it must produce. This is the same pattern as JSON Schema used by OpenAI's `response_format: { type: "json_schema" }`. The schema is the interface between the natural-language instruction and the typed TypeScript output.

**Checkpoint:** `stagehand.context.activePage()` returns `Page | undefined`. Why would the active page ever be `undefined` after a successful `stagehand.init()`, and what does the null check in `conductBrowserResearch` prevent?

<details>
<summary>Reveal answer</summary>

Stagehand's `init()` sets up a CDP context (a Playwright BrowserContext), but the active page within that context could theoretically be `undefined` in edge cases: if the context was created but no initial page was opened, or if the page was closed by a concurrent operation. The Stagehand type declaration returns `Page | undefined` to reflect this possibility — it is a best-effort accessor, not a guaranteed one.

The null check `if (!page) throw new Error("No active page after Stagehand init")` protects against calling `page.goto()` on `undefined`, which would throw a `TypeError: Cannot read properties of undefined (reading 'goto')`. Throwing explicitly with a descriptive message is better because the error lands in `agent_logs` with context about what failed, rather than a generic property-access error.

</details>

**Checkpoint:** The code prefers `about`, `blog`, `engineering`, and `product` sub-pages over `careers` pages. What information does a careers page have that makes it less useful for dossier synthesis?

<details>
<summary>Reveal answer</summary>

Careers pages list open positions — titles, locations, and generic role descriptions. This tells a candidate that the company is hiring, but not why the company is interesting, what it values, how it works, or what technology it uses. The `whyThisRole`, `culture`, and `techStack` dossier sections are best served by About pages (stated values, mission, founding story), Engineering blogs (specific technology choices, how problems are solved), and Product pages (what was built, who uses it, at what scale). Careers page content overlaps heavily with the job description already in the DB — it adds no new signal.

</details>

---

## Part 7 — Synthesis, source deduplication, and the PostHog null error

Open [`agent/research.ts`](../../../agent/research.ts), lines 194–281 (`synthesizeDossier`):

```typescript
  const allSources = [
    ...((raw.sources as string[] | undefined) ?? []),
    ...content.visitedUrls,
  ].filter(Boolean);

  return {
    companyOverview: (raw.companyOverview as string) ?? "",
    techStack: (raw.techStack as string[]) ?? [],
    culture: (raw.culture as string[]) ?? [],
    whyThisRole: (raw.whyThisRole as string) ?? "",
    yourEdge: (raw.yourEdge as string[]) ?? [],
    gapsToAddress: (raw.gapsToAddress as string[]) ?? [],
    smartQuestions: (raw.smartQuestions as string[]) ?? [],
    interviewPrep: (raw.interviewPrep as string[]) ?? [],
    sources: [...new Set(allSources)],
    researchedAt: new Date().toISOString(),
  };
```

And the route's PostHog call in [`app/api/agent/research/route.ts`](../../../app/api/agent/research/route.ts):

```typescript
    await captureServerEvent({
      distinctId: userId,
      event: "company_researched",
      properties: { userId, jobId },
    });
```

**Source deduplication with Set.** The `sources` field merges two lists: URLs that Nemotron cites in its output, and `visitedUrls` from the browser navigation loop. The same homepage URL often appears in both — Nemotron includes it in `raw.sources` because the research prompt contains it, and the navigation code added it to `visitedUrls` when the page was visited. `new Set(allSources)` removes duplicates in O(n) time — inserting n elements into a Set is O(n), and spreading back to an array is O(n). Without deduplication, the UI renders the same URL twice in the sources footer.

The `filter(Boolean)` before the Set removes empty strings. `visitedUrls[i + 1] ?? ""` in the synthesis prompt string-building code can produce empty strings when a sub-page's URL was never set. These would appear in the sources list as blank entries without the filter.

> **Data structures — Set for O(1) deduplication:** A JavaScript `Set` internally uses a hash table: inserting an element takes O(1) amortized, and duplicate entries are silently ignored. Deduplicating an array by scanning for duplicates with `Array.find` would be O(n²) — each element scanned against all previous elements. For small arrays (5–10 URLs) the difference is negligible, but the `Set` pattern is the idiomatic JavaScript choice regardless of scale because it expresses intent: "I want unique values."

**The PostHog null error.** The route originally called `createPostHogServer()` directly:

```typescript
const posthog = createPostHogServer();
posthog.capture({ ... }); // TypeScript error: posthog is possibly null
```

`createPostHogServer()` returns `PostHog | null` — `null` when `NEXT_PUBLIC_POSTHOG_KEY` is absent, to no-op safely in environments without analytics. TypeScript's build check caught this immediately: calling `.capture()` on `PostHog | null` requires a null check first. The fix is `captureServerEvent()` — a wrapper in `lib/posthog-server.ts` that handles the null guard, calls `shutdown()` in its own `finally`, and accepts the typed event name. This is the established pattern used by every other API route in the project.

**Checkpoint:** `[...new Set(allSources)]` deduplicates the sources array. Why might Nemotron include a URL in `raw.sources` that is also in `content.visitedUrls`?

<details>
<summary>Reveal answer</summary>

The synthesis prompt explicitly includes the visited URLs: `Homepage (${content.homepageUrl}): ...` and `Sub-page ${i + 1} (${content.visitedUrls[i + 1] ?? ""}): ...`. Nemotron sees those URLs in its input context. When it generates the `sources` field, it often copies them back into the output — they are the literal sources for the research content it is synthesising. Meanwhile, `conductBrowserResearch()` also pushes each visited URL into `content.visitedUrls` independently. So the homepage URL, for example, appears in Nemotron's `raw.sources` (because it was in the prompt) and in `content.visitedUrls` (because navigation pushed it). The Set eliminates this overlap.

</details>

**Checkpoint:** The PostHog `captureServerEvent()` call is awaited inside the `try` block of the route. If PostHog's server is down and this call throws, what happens to the API response?

<details>
<summary>Reveal answer</summary>

`captureServerEvent()` throws. The route's outer `catch` block catches it: `console.error("[api/agent/research]", error)` logs it. Then `NextResponse.json({ success: false, error: "Failed to research company" }, { status: 500 })` is returned. The dossier has already been produced and saved to the DB, but the client never receives it — the response is an error. The user sees the error state and would need to click "Research Company" again.

Is that the right behaviour? Arguably no — the dossier was produced successfully, and only the analytics event failed. A more robust implementation would move `captureServerEvent()` after the `return` (not possible directly) or wrap it in its own try/catch so analytics failures don't fail the response. The current implementation trades analytics reliability for code simplicity.

</details>

---

## Part 8 — Client state update: `useState(initialResearch)` vs `router.refresh()`

Open [`components/job-details/CompanyResearch.tsx`](../../../components/job-details/CompanyResearch.tsx), lines 14–39:

```typescript
export function CompanyResearch({ jobId, company, initialResearch }: Props) {
  const [research, setResearch] = useState<CompanyResearchDossier | null>(initialResearch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResearch(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json() as { success: boolean; data?: { companyResearch: CompanyResearchDossier }; error?: string };
      if (body.success && body.data?.companyResearch) {
        setResearch(body.data.companyResearch);
      } else {
        setError(body.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
```

`useState(initialResearch)` initialises `research` once — at mount. When the Server Component page fetches the job row from the DB and finds `company_research: CompanyResearchDossier`, it passes it as `initialResearch`. The component mounts with the dossier already in state and renders it immediately, with no API call needed.

`setResearch(body.data.companyResearch)` after the fetch succeeds is the update path. The API route returns the dossier in its response body — not just a success indicator. The component calls `setResearch` with the body's data, triggering an immediate re-render with the new dossier. This is the key distinction from `router.refresh()`.

`router.refresh()` would trigger Next.js to re-fetch the Server Component data — reading `jobs.company_research` from the DB again and passing it down as a new `initialResearch` prop. But `useState(initialValue)` ignores prop changes after mount: the initial value is captured once and subsequent renders with a different prop do not update the state. So `router.refresh()` in this pattern would produce a new prop, which React ignores, leaving `research` unchanged. To use `router.refresh()` correctly, you would need `useEffect(() => setResearch(initialResearch), [initialResearch])` — which adds an extra render cycle and a round-trip to the server that the fetch response has already eliminated.

The four UI states render conditionally:
- Empty (`!research && !loading`): Building2 icon, invite text
- Loading (`loading && !research`): Loader2 spinner
- Error (`error`): AlertCircle banner, retryable
- Dossier (`research`): All sections, each guarded by a truthy/length check

**Checkpoint:** `Job.company_research` is typed as `CompanyResearchDossier | null`. When the page loads with an existing dossier, `CompanyResearch.tsx` renders it immediately. What React mechanism makes this work — and what would happen if `useState` didn't accept the `initialResearch` prop?

<details>
<summary>Reveal answer</summary>

`useState<CompanyResearchDossier | null>(initialResearch)` captures `initialResearch` at mount as the initial state value. React stores this in the component's state slot. On the first render, `research === initialResearch` — which is the full dossier. The component renders the dossier sections immediately, without needing a fetch call.

If `useState` didn't accept an initial value (if it was always `useState(null)`), the component would always mount in the empty state, show the "No research yet" empty state, and require the user to click "Research Company" even when a dossier already exists in the DB. The user would experience a flash of empty content on every page load for jobs they had already researched.

</details>

---

## Full data flow: user clicks "Research Company" on a job with no existing dossier

```
1. CompanyResearch.tsx — handleResearch() fires
   setLoading(true), setError(null)
   → component re-renders: loading spinner appears

2. fetch POST /api/agent/research { jobId: "job-abc-123" }
   → HTTP request leaves the browser

3. app/api/agent/research/route.ts — POST handler
   await createInsforgeServer()
   await insforge.auth.getCurrentUser() → { user: { id: "user-xyz" } }
   await req.json() → { jobId: "job-abc-123" }

4. agent/research.ts — researchCompany("job-abc-123", "user-xyz")
   await insforge.database.from("jobs").select("*").eq("id", ...).eq("user_id", ...).single()
   → job = { company: "Stripe", external_apply_url: "https://jobs.stripe.com/...", ... }
   await insforge.database.from("profiles").select("*").eq("id", "user-xyz").maybeSingle()
   → profile = { skills: ["TypeScript", "React"], ... }

5. deriveHomepageUrl(job)
   Step 1: fetch("https://jobs.stripe.com/...", { redirect: "follow" })
   → response.url = "https://jobs.stripe.com/jobs/123" (no redirect off the domain)
   → JOB_BOARD_DOMAINS.has("jobs.stripe.com") = false
   → normalizeToRootDomain: parts = ["jobs", "stripe", "com"], parts[0] = "jobs" ∈ JOB_SUBDOMAINS
   → return "https://stripe.com"

6. homepageUrl = "https://stripe.com" → browser block runs

7. createHyperbrowserSession()
   → POST https://api.hyperbrowser.ai/api/v1/sessions { useStealth, adblock, acceptCookies, timeoutMinutes: 2 }
   → session.wsEndpoint = "wss://cdp.hyperbrowser.ai/session/hbs-abc"

8. createStagehand("wss://cdp.hyperbrowser.ai/session/hbs-abc")
   → new Stagehand({ env: "LOCAL", localBrowserLaunchOptions: { cdpUrl }, ... })
   → stagehand.init() → CDP handshake over WebSocket

9. conductBrowserResearch(job, stagehand, "https://stripe.com", "user-xyz")
   stagehand.context.activePage() → Page
   page.goto("https://stripe.com")
   page.waitForLoadState("networkidle")
   stagehand.extract(instruction, HomepageSchema)
   → { oneLiner: "Stripe is a financial infrastructure...", pageLinks: [...about, ...blog, ...engineering] }
   content.visitedUrls.push("https://stripe.com")

   for link { url: "https://stripe.com/about", kind: "about" }:
     page.goto("https://stripe.com/about")
     stagehand.extract(instruction, SubpageSchema)
     → { keyPoints: [...], technologies: ["Ruby", "Scala", "Go"], valuesOrCulture: [...] }
     content.visitedUrls.push("https://stripe.com/about")

10. finally block:
    stagehand.close() → CDP disconnect
    client.sessions.stop(session.id) → Hyperbrowser terminates Chrome

11. synthesizeDossier(content, job, profile)
    → openai.chat.completions.create({ model: "openrouter: nemotron", ... })
    → Nemotron returns JSON: { companyOverview: "...", techStack: ["Ruby", ...], yourEdge: [...], ... }
    → sources = [...new Set(["https://stripe.com", "https://stripe.com/about", "https://stripe.com"])]
                = ["https://stripe.com", "https://stripe.com/about"]
    → researchedAt = "2026-07-02T10:43:00.000Z"

12. insforge.database.from("jobs").update({ company_research: dossier }).eq("id", "job-abc-123").eq("user_id", "user-xyz")
    → jobs.company_research column saved as JSONB

13. return dossier

14. app/api/agent/research/route.ts
    captureServerEvent({ event: "company_researched", ... })
    return NextResponse.json({ success: true, data: { companyResearch: dossier } })

15. CompanyResearch.tsx — fetch resolves
    body.success = true
    setResearch(body.data.companyResearch)
    setLoading(false)
    → component re-renders: dossier sections appear
```

---

## Extend it (challenges)

### Challenge 1 — Trace the Stagehand model routing (15–20 min)

Open `node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/llm/LLMProvider.js`. Find the `getClient` function. Trace what happens with `modelName = "openai/nvidia/nemotron-3-ultra-550b-a55b:free"`:

1. What is `subProvider` after the first slash split?
2. What is `subModelName`?
3. The code has `hasValidOptions` — what property values make this true given `lib/stagehand.ts`'s config?
4. Which creator function is called from `AISDKProvidersWithAPIKey`?
5. What URL does the resulting AI SDK client send requests to?

Write out the answer at each step. Then try the original broken value `"nvidia/nemotron-3-ultra-550b-a55b:free"` — trace why it throws.

<details>
<summary>Hint</summary>

Look for `const firstSlashIndex = modelName.indexOf("/")` in `getClient`. Follow the `subProvider` variable into `AISDKProvidersWithAPIKey[subProvider]`. Check what `createOpenAI` produces when given `{ apiKey, baseURL: "https://openrouter.ai/api/v1" }`.

</details>

---

### Challenge 2 — Add a confidence field to the dossier (20–30 min)

Add a `confidence: "high" | "medium" | "low"` field to `CompanyResearchDossier` in `types/index.ts`. Set it in `synthesizeDossier()` based on how much browser data was available:

- `"high"` when `content.visitedUrls.length >= 2` (homepage + at least one sub-page)
- `"medium"` when `content.visitedUrls.length === 1` (homepage only)
- `"low"` when `content.visitedUrls.length === 0` (fallback synthesis only)

Display a small badge in `CompanyResearch.tsx` next to the "About the Company" heading, using the appropriate token classes from `ui-tokens.md` (success/warning/error light tokens).

Files to touch: `types/index.ts`, `agent/research.ts` (`synthesizeDossier`), `components/job-details/CompanyResearch.tsx`.

<details>
<summary>Hint</summary>

`content.visitedUrls` is available in `synthesizeDossier` — it is part of the `ExtractedContent` parameter. Set `confidence` before building the return object. In the component, match `confidence` against the three levels with a helper function that returns the right Tailwind class combination.

</details>

---

### Challenge 3 — Design: what should happen when "Re-research" is clicked on a job with existing data? (30–45 min)

Currently, clicking the "Re-research" button calls the same `handleResearch()` function as the first run. The API route calls `researchCompany()`, which always overwrites `jobs.company_research` with the new dossier.

Consider this scenario: the user researched a company two weeks ago. They click "Re-research" to get fresh data. The Hyperbrowser session fails (anti-bot block). Synthesis runs with no browser data. The new dossier is worse than the old one — and it has overwritten the good one.

Design a solution. Answer these questions first, then implement if you have time:

1. Should the server compare old and new dossiers before overwriting? What metric would you use?
2. Should the client keep both and let the user choose? How would that affect `CompanyResearch.tsx`'s state shape?
3. Should the API return the old dossier when the new one has zero browser data, and flag it as "cached"?
4. Which option requires the fewest code changes and is safest for the user?

<details>
<summary>Hint</summary>

Option 3 is a low-code, safe approach: before calling `synthesizeDossier`, check if `job.company_research` exists and `content.visitedUrls.length === 0`. If so, return the existing dossier unchanged instead of overwriting it. The API response looks the same to the client — but the DB is not degraded. Add a `cached: true` flag to the response so the component can show "Using cached research — browser failed" instead of showing the re-research button as if it succeeded.

</details>

---

For deeper exploration, `docs/plan/13-company-research-agent/ai-discussion-topics.md` has 18 prompts covering CDP session management, Stagehand extraction trade-offs, URL derivation edge cases, and RAII cleanup patterns. Feed them to an LLM *after* forming your own answer first — the gap between what you thought and what you learn is where understanding lands.
