# AI Discussion Topics — Feature 13-company-research-agent: Company Research Agent

---

## Group 1: Cloud browser sessions and CDP

1. Walk me through exactly what happens at the network level when Stagehand calls `page.goto("https://stripe.com")` — what protocol does it use, who executes the navigation, and why does the Hyperbrowser session terminate when the dev server crashes mid-request?
2. What does `useStealth: true` actually change about the browser's behaviour? Why do headless browsers get detected without it, and what signals do anti-bot systems look for?
3. Why does `timeoutMinutes: 2` protect the Hyperbrowser account quota even when `sessions.stop()` is never called? What would happen without this safeguard?
4. The code calls `page.waitForLoadState("networkidle")` before extracting. What does "network idle" mean, and why is it more appropriate than `"domcontentloaded"` for AI extraction that reads rendered content?

## Group 2: Stagehand API and AI extraction

5. The build plan docs originally showed `stagehand.extract({ instruction, schema })`. The actual V3 API is positional: `extract(instruction, schema)`. Why would this mistake be hard to catch before runtime — what would TypeScript actually accept, and what error would appear at runtime?
6. `stagehand.context.activePage()` returns `Page | undefined` — not `Page`. Why would the active page ever be `undefined` after a successful `stagehand.init()`, and what does the null check prevent?
7. The `HomepageSchema` marks all fields as `.optional()`. What happens in `synthesizeDossier()` if Stagehand returns `{ oneLiner: undefined, productSummary: undefined }`? Trace the effect through to the final dossier.
8. Why does the code prefer `about`, `blog`, `engineering`, and `product` sub-pages over `careers` pages? What information does a careers page typically have that makes it less useful for dossier synthesis?

## Group 3: URL derivation and the 3-step chain

9. `fetch(url, { redirect: "follow" })` resolves redirect chains server-side. What would happen if this was attempted inside the browser (via `page.goto()`) instead? When does server-side redirect resolution fail that browser-based resolution would succeed?
10. The `JOB_SUBDOMAINS` Set strips subdomains like `jobs.`, `careers.`, `apply.`. What would happen for a company whose actual product domain starts with one of those words? (e.g. a company called "Careers Inc." with domain `careers-inc.com`)
11. The company name cleanup regex strips legal suffixes: `replace(/\s*(Inc\.?|LLC|Ltd\.?|...).*$/i, "")`. What would happen for a company named "Limited Edition Games Ltd"? Would the result be usable?
12. When `deriveHomepageUrl()` returns an empty string, the browser research block is skipped entirely. Why is `if (homepageUrl)` the right guard instead of trying to visit an empty URL and catching the error?

## Group 4: Error handling and the "never empty" invariant

13. Walk through exactly what happens when `createHyperbrowserSession()` succeeds but `createStagehand()` throws: which variables are assigned, what does the `finally` block do, and what does `synthesizeDossier()` receive as its `content` argument?
14. Why are `stagehand`, `session`, and `client` declared as `null` before the `try` block rather than inside it? What TypeScript error would appear if you declared them inside and then tried to reference them in `finally`?
15. The PostHog `captureServerEvent()` call is awaited inside the `try` block. If PostHog's server is down and this call throws, what happens to the API response? Is that the right behaviour?

## Group 5: Source deduplication and dossier structure

16. `[...new Set(allSources)]` deduplicates the sources array. Why might Nemotron include a URL in `raw.sources` that is also in `content.visitedUrls`? What does the Nemotron prompt contain that would cause it to "know" which URLs were visited?
17. The dossier's `researchedAt` field is set in `synthesizeDossier()` with `new Date().toISOString()`. Why is this set here (after Nemotron returns) rather than at the start of `researchCompany()` before any browser work begins? What would storing the start time instead of the end time imply?
18. `Job.company_research` is typed as `CompanyResearchDossier | null`. When the page loads, if this field is already populated from a previous research run, `CompanyResearch.tsx` renders the dossier immediately without any API call. What React mechanism makes this work — and what would happen if `useState` didn't accept the `initialResearch` prop?
