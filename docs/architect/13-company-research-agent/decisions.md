# Architect Decisions — Feature 13 Company Research Agent

---

## Decision 1 — Provider: Hyperbrowser (not Browserbase)

### What it is
The cloud browser session provider for the Company Research Agent was switched from Browserbase (originally planned) to Hyperbrowser before any code was written.

### How it works
Hyperbrowser provides a managed Chrome instance in the cloud. You call `client.sessions.create(options)` and receive a `SessionDetail` object with:
- `wsEndpoint` — a WebSocket/CDP URL pointing to the remote Chrome instance
- `liveUrl` — a viewable browser URL for debugging

You connect to the browser via that `wsEndpoint` and issue commands through it. When done, you call `client.sessions.stop(session.id)` to terminate the cloud instance.

```typescript
const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY! });
const session = await client.sessions.create({
  useStealth: true,
  adblock: true,
  acceptCookies: true,
  timeoutMinutes: 2,
});
// session.wsEndpoint is the CDP URL
```

### Why Hyperbrowser over Browserbase
- No Browserbase code had been written — purely a provider swap decision
- Hyperbrowser's session API was simpler to reason about for the feature's scope
- The architecture stays identical from Stagehand's perspective: it connects to any CDP-compatible browser endpoint regardless of which cloud provider hosts it

### What the alternative costs
Browserbase would have required `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`, and its session creation API differs (`Browserbase.sessions.create()` vs the same pattern with different options). The decision to swap was low-risk because the abstraction point (CDP URL into Stagehand) is unchanged.

### Where it lives
`lib/hyperbrowser.ts` — a thin factory. No session logic leaks into `agent/research.ts` directly.

---

## Decision 2 — Keep Stagehand for AI extraction (not Hyperbrowser Extract/Crawl)

### What it is
Hyperbrowser offers its own Extract and Crawl APIs. The session chose to keep Stagehand for AI page control instead of replacing it.

### How it works
Stagehand connects to the Hyperbrowser CDP endpoint and provides an `extract()` API that takes a plain-English instruction and a Zod schema:

```typescript
const result = await stagehand.extract(
  "Find what this company does and who it serves",
  z.object({ oneLiner: z.string(), productSummary: z.string() })
);
```

Stagehand uses an AI model internally to understand the page and return structured data matching the schema.

### Why keep Stagehand
The build plan already defined the Zod schemas (`HomepageSchema`, `SubpageSchema`) and the extraction strategy (homepage + up to 3 sub-pages). Replacing Stagehand with Hyperbrowser's own extraction would have meant redesigning those schemas for a different API, discarding already-designed patterns, and adding complexity for no user-facing benefit.

### What the alternative costs
Hyperbrowser Extract/Crawl APIs have their own schema formats and response shapes. Switching would have required rewriting the extraction layer, updating `context/library-docs.md` with a new API pattern, and testing different output shapes. The migration cost exceeded the benefit in v1.

---

## Decision 3 — Abstraction name: `lib/hyperbrowser.ts` (not `lib/cloud-browser.ts`)

### What it is
The Hyperbrowser client factory lives in `lib/hyperbrowser.ts`, named after the specific provider rather than a generic abstraction.

### Why provider-specific naming
The project is making an intentional choice to use Hyperbrowser. A generic `cloud-browser.ts` wrapper would be premature abstraction — it implies a future need to swap providers through a single interface, which has no evidence in the current requirements. Generic abstractions add indirection cost without benefit.

### What the alternative costs
A provider-neutral abstraction (`createCloudBrowserSession()` returning a shape that both Browserbase and Hyperbrowser could satisfy) would add a type-mapping layer, a configuration surface for choosing providers, and cognitive overhead for no v1 gain. If the provider is swapped again, renaming `lib/hyperbrowser.ts` is a one-file change.

---

## Decision 4 — Homepage URL derivation: 3-step fallback chain

### What it is
The agent derives the company's public homepage from job data using a three-step chain, each step falling through to the next on failure.

### How it works

```
Step 1 — Follow HTTP redirects:
  fetch(external_apply_url ?? source_url, { redirect: "follow" })
  → parse response.url with new URL()
  → strip known job-board subdomains (e.g. jobs.stripe.com → stripe.com)
  → return https://rootDomain

Step 2 — Parse the original URL directly:
  (same normalization applied to the raw URL, not the redirect destination)

Step 3 — Construct from company name:
  https://www.${cleanName}.com
  where cleanName = company field, lowercased, spaces→hyphens, no special chars
```

The amendment from the architect review added redirect-following as Step 1 — originally the plan started at Step 2. Following redirects first is more reliable because job board listing URLs often redirect through CDN layers before reaching the employer's actual apply page.

### Why not guess the homepage from the company name directly
Company names don't reliably map to `.com` domains: some use `.io`, `.co`, or country TLDs. A direct guess has a higher failure rate than following the apply URL's redirects, which typically land on the employer's canonical domain.

### What the alternative costs
Relying solely on the company name produces wrong URLs for ~30% of companies (e.g. "Stripe" → correct, "Deliveroo" → wrong TLD). Following redirects degrades gracefully: if the redirect still points to a job board, Step 2 applies normalization and Step 3 constructs from the name.

---

## Decision 5 — UI state update via `useState` (not `router.refresh()`)

### What it is
After the research API call returns the dossier, the component calls `setResearch(dossier)` to update the UI immediately. It does not call `router.refresh()`.

### How it works
The component initialises state from the server-loaded prop:

```typescript
const [research, setResearch] = useState<CompanyResearchDossier | null>(initialResearch);
```

When the API call returns, `setResearch(body.data.companyResearch)` triggers a re-render with the new dossier immediately, in the same client-side tick.

### Why not `router.refresh()`
`router.refresh()` would reload the page's Server Component data from the DB, which adds a server round-trip after the API already returned the dossier in its response body. The user would see a flash-of-empty-state → reload → dossier renders, instead of dossier appearing directly after the API call.

### What the alternative costs
`router.refresh()` is the right tool when you need page data to reflect a write made without a return value (e.g. a Server Action that calls `revalidatePath`). Here the API route returns the dossier directly — `useState` update is the exact right mechanism.

---

## Decision 6 — Nullable variable pattern in `finally`

### What it is
All external resources (`stagehand`, `session`, `client`) are declared as `null` before the try block, assigned inside it, and guarded in `finally`.

### How it works

```typescript
let stagehand: Stagehand | null = null;
let session: HyperbrowserSession | null = null;
let client: HyperbrowserClient | null = null;

try {
  ({ client, session } = await createHyperbrowserSession());
  stagehand = await createStagehand(session.wsEndpoint);
  // ... research logic ...
} finally {
  if (stagehand) { try { await stagehand.close(); } catch { } }
  if (client && session) { try { await client.sessions.stop(session.id); } catch { } }
}
```

The cleanup order is Stagehand first, then Hyperbrowser session — because Stagehand may still have an active connection to the browser during teardown, and closing the session underneath it could cause errors.

### Why this over try/catch/finally without null guards
If `createHyperbrowserSession()` succeeds but `createStagehand()` throws, `stagehand` is still `null`. A `finally` block that assumes `stagehand` is always assigned would throw a null reference error — a second error on top of the original one, masking the root cause. Null guards make partial-initialization failures safe.

This amendment was added during the architect review after reviewing how the original plan handled cleanup.

---

## Decision 7 — Generic error messages from the API route

### What it is
The API route's catch block logs the real error server-side but returns only a generic message to the client.

### How it works

```typescript
} catch (error) {
  console.error("[api/agent/research]", error);
  return NextResponse.json(
    { success: false, error: "Failed to research company" },
    { status: 500 },
  );
}
```

### Why never expose internal errors to clients
Internal error messages can leak: stack traces, file paths, DB query details, API endpoint shapes, or third-party error messages that hint at infrastructure. These are useful to attackers and confusing to users. The server log has the full error for debugging; the client gets a message it can safely display.

### What the alternative costs
Forwarding the real error (`error.message`) to the client is tempting during development but creates a habit that's dangerous in production. The project's code standards mandate generic API errors.
