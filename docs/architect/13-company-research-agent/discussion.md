# Architect Discussion — Feature 13 Company Research Agent

Deep teaching record of every concept explored in this session.

---

## 1. What does "cloud browser session" actually mean?

When you run `npm run dev`, your server is a Node.js process. Node can make HTTP requests, query databases, call APIs — but it cannot browse the web the way a human does. Browsing requires a real browser: a rendering engine (Blink/V8 in Chrome), a display layer, JavaScript execution, cookie jars, redirect chains. All of that is heavy and stateful.

Cloud browser providers solve this by running Chrome as a service in their own infrastructure. You make an API call to spin up a Chrome instance, and they give you a WebSocket URL that points to that remote instance. You then issue commands to it using the Chrome DevTools Protocol (CDP) — the same protocol Chrome's own DevTools tab uses internally.

From your code's perspective, there is no difference between controlling a local Chrome and a remote one: both speak CDP. The only difference is the URL you connect to.

Hyperbrowser's session creation:

```typescript
const session = await client.sessions.create({
  useStealth: true,    // anti-bot evasion
  adblock: true,       // block ad scripts that can break page structure
  acceptCookies: true, // auto-dismiss GDPR banners
  timeoutMinutes: 2,   // kill session automatically if we don't stop it
});
// session.wsEndpoint = "ws://cdp.hyperbrowser.ai/session/abc123"
// session.liveUrl    = "https://live.hyperbrowser.ai/session/abc123"
```

The `liveUrl` lets a human watch the browser session in real time — useful during development to see what the agent is actually visiting. Not stored or shown in production.

---

## 2. What is Stagehand and why is it the right extraction layer?

Traditional web scraping uses CSS selectors or XPath: `document.querySelector('.product-title').textContent`. These are brittle — they break the moment a company redesigns their website. They also require you to know the page structure in advance.

Stagehand takes a different approach: it uses an AI model to understand the page and extract what you describe in natural language. You provide:
1. A plain-English instruction describing what you want
2. A Zod schema defining the shape you want the output in

```typescript
const data = await stagehand.extract(
  "Find what this company does, who they serve, and any notable signals like funding or customers",
  z.object({
    oneLiner: z.string(),
    signals: z.array(z.string()),
  })
);
```

Stagehand sees the full rendered page (including JavaScript-rendered content) and returns structured data matching the schema.

### Why Stagehand over Hyperbrowser's own Extract/Crawl APIs

Hyperbrowser offers its own extraction primitives. The reason to keep Stagehand is that the Feature 13 build plan already defined the extraction schemas and the per-page strategy. Replacing Stagehand would have meant:
- Redesigning the schema format for a different API
- Changing the extraction loop (Hyperbrowser Extract works differently from page-by-page navigation)
- Testing different output shapes
- Updating `context/library-docs.md` with a new pattern

The cost exceeded the benefit for v1. Stagehand stays.

### The `env: "LOCAL"` confusion

Stagehand's `env` option is named confusingly. `"LOCAL"` does not mean "run a local browser on the developer's machine." It means "I am providing the browser connection myself; don't spin up your own." The companion option `localBrowserLaunchOptions: { cdpUrl }` is where you supply the CDP endpoint from Hyperbrowser.

```typescript
new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: { cdpUrl: session.wsEndpoint },
  // ...
})
```

This is the correct pattern for connecting Stagehand to any external browser — Hyperbrowser, Browserbase, a self-hosted Chrome, anything.

---

## 3. The 3-step URL derivation chain

The agent needs the company's public homepage, but the job data only has:
- `source_url` — the JobsDB listing URL (e.g. `https://hk.jobsdb.com/job/12345`)
- `external_apply_url` — the apply link extracted from that listing, which may redirect through the job board before reaching the employer

The challenge: we need to get from job board URLs to the employer's actual homepage.

### Step 1 — Follow HTTP redirects

Most "apply now" links on job boards are not direct links to the company's career portal — they redirect through tracking URLs. The native `fetch()` option `{ redirect: "follow" }` resolves the full chain server-side without opening a browser:

```typescript
const res = await fetch(applyUrl, { redirect: "follow" });
const finalUrl = new URL(res.url);
// response.url is the URL after all redirects
```

After resolving, the URL might be `https://jobs.stripe.com/jobs/123` — which tells us the root domain is `stripe.com`.

### Subdomain stripping

`jobs.stripe.com` is not the homepage. The agent normalises it by:
1. Checking if the subdomain or domain is in a `JOB_BOARD_DOMAINS` Set (jobsdb.com, linkedin.com, indeed.com, etc.)
2. If it's a job board, this step fails and we fall through
3. If it's the employer's domain, strip the subdomain: `jobs.stripe.com` → `stripe.com` → `https://stripe.com`

### Step 2 — Parse the original URL directly

If the fetch throws (network error, timeout) or the resolved URL is still a job board, we try the same normalization on the raw `applyUrl` itself. This is more likely to be useful for `external_apply_url` which might already be `https://careers.stripe.com/jobs/123`.

### Step 3 — Company name construction

Last resort. Given company name `"Deliveroo"`:
1. Lowercase: `deliveroo`
2. Replace spaces/special chars with hyphens
3. Construct `https://www.deliveroo.com`

This fails for non-.com companies but is better than nothing. The Nemotron synthesis fallback means even a completely wrong URL doesn't crash the feature.

The amendment that added redirect-following as Step 1 was important: the original plan started at Step 2 (parse the original URL), which would miss the common case where the apply link is a redirect chain that eventually resolves to the employer's canonical domain.

---

## 4. The nullable variable cleanup pattern

Resource management is a sharp edge in async TypeScript. Consider this naive pattern:

```typescript
// WRONG — what if createStagehand() throws?
const { client, session } = await createHyperbrowserSession();
const stagehand = await createStagehand(session.wsEndpoint);
try {
  // ...research...
} finally {
  await stagehand.close();           // this is fine
  await client.sessions.stop(id);    // this is fine
}
```

If `createStagehand()` throws before `stagehand` is assigned, the `finally` block runs with `stagehand` undefined — and throws a second error. Now you have two errors: the original failure plus a null reference in cleanup. The original error may be swallowed or obscured.

The correct pattern:

```typescript
let stagehand: Stagehand | null = null;
let session: HyperbrowserSession | null = null;
let client: HyperbrowserClient | null = null;

try {
  ({ client, session } = await createHyperbrowserSession());
  stagehand = await createStagehand(session.wsEndpoint);
  // ... research ...
} finally {
  // Each cleanup is independently guarded
  if (stagehand) { try { await stagehand.close(); } catch { } }
  if (client && session) { try { await client.sessions.stop(session.id); } catch { } }
}
```

### Why the inner try/catch in finally?

Cleanup itself can fail. If the Hyperbrowser session already timed out, calling `sessions.stop()` may throw. An unhandled error in `finally` would mask the original error. The inner `try { } catch { }` silences cleanup failures while still attempting cleanup.

### Cleanup order: Stagehand before Hyperbrowser

Stagehand is closed first because it may be mid-page-interaction when an error fires. If the Hyperbrowser session is stopped first, the underlying WebSocket connection drops — and Stagehand's teardown sequence (which tries to gracefully disconnect from the CDP endpoint) may throw additional errors. Closing Stagehand first lets it release its connection cleanly before the session is terminated.

---

## 5. Synthesis fallback — the "never empty" invariant

Browser research is unreliable by nature:
- Anti-bot systems detect and block automated browsers
- CAPTCHAs interrupt page loads
- Sites load slowly and time out within the 2-minute budget
- The homepage URL derivation might construct a wrong URL entirely

The session established a strict invariant: **Nemotron synthesis always runs, even when browser research fails.** The implementation achieves this by separating extraction and synthesis:

```typescript
let content: ExtractedContent = { homepageData: null, subpageData: [] };

try {
  content = await conductBrowserResearch(job, stagehand, homepageUrl, userId);
} catch (err) {
  await logAgentError(userId, jobId, `Browser research failed: ${String(err)}`);
  // content remains the empty default
}

// always runs, even if content is empty
const dossier = await synthesizeDossier(content, job, profile);
```

When `content.homepageData` is null, `synthesizeDossier()` calls Nemotron with only the job description and user profile. The dossier will lack company-specific website data but still contains AI-generated analysis of the role, the user's fit, gaps to address, and smart interview questions — derived from the job posting itself.

The user gets a useful result in every case.

---

## 6. Stagehand's `extract()` signature — the positional argument correction

During implementation, the `context/library-docs.md` documented `stagehand.extract()` with the object argument form:

```typescript
// WRONG — what the docs originally said
stagehand.extract({ instruction: "...", schema: z.object({...}) })
```

Reading the actual installed TypeScript types revealed the correct positional form:

```typescript
// CORRECT — actual V3 API
stagehand.extract(
  "instruction string",   // positional arg 1
  z.object({...}),        // positional arg 2
  options?,               // optional positional arg 3
)
```

This is a critical distinction: the object form would fail at runtime with a type error (or silently pass the wrong argument). The session established the rule to always read `node_modules` `.d.ts` files before writing code that calls third-party APIs, because SDK documentation can lag the installed version.

---

## 7. Why `captureServerEvent` instead of calling PostHog directly

`createPostHogServer()` returns `PostHog | null` — it returns `null` when the API key is not set in the environment (to safely no-op in environments without analytics configured).

The API route originally called `.capture()` on the result directly:

```typescript
const posthog = createPostHogServer();
posthog.capture({ ... }); // TypeScript error: posthog is possibly null
```

TypeScript correctly rejects this because `posthog` might be `null`. The fix is to use `captureServerEvent()`, a helper in `lib/posthog-server.ts` that already handles the null check, calls `shutdown()` in a `finally` block, and returns a promise:

```typescript
await captureServerEvent({
  distinctId: userId,
  event: "company_researched",
  properties: { userId, jobId },
});
```

This is consistent with how all other server-side PostHog events fire in this project. The build failure surfaced a pattern inconsistency that was easy to fix once identified.

---

## 8. Architecture boundary: why `researchCompany()` lives in `agent/`, not `app/api/`

The project's architecture rule is: API routes in `app/api/` handle request/auth/response only; all business logic lives in `agent/`. This boundary matters for several reasons:

**Testability:** `agent/research.ts` functions can be tested in isolation without an HTTP context. Unit tests call `researchCompany()` directly without spinning up a Next.js server.

**Reusability:** If future features need to trigger research programmatically (e.g. a cron job), they import from `agent/research.ts` — not from an API route, which is HTTP-bound.

**Single responsibility:** The API route knows about HTTP (request bodies, status codes, NextResponse). The agent knows about browsers, AI, and databases. Mixing them creates a function that knows too much about both layers.

The invariant is strict: `agent/` code never imports from `components/` or `actions/`. This prevents accidental coupling between the agent layer and the UI layer.
