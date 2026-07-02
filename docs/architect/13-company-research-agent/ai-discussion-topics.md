# AI Discussion Topics — Feature 13 Architect Session

---

## Group 1: Cloud browsers and CDP

1. What is the Chrome DevTools Protocol (CDP) and why does controlling a browser through WebSockets feel the same whether the browser is local or running in another country?
2. Why can't a Node.js server just "use a browser" to visit websites? What is it missing that a real browser has?
3. What are anti-bot measures and why do they work? What does Hyperbrowser's `useStealth` option do to make a headless browser look like a human?
4. What happens to the cloud browser session if the server crashes mid-research without calling `sessions.stop()`? Does the cloud instance keep running? What does `timeoutMinutes` protect against?
5. What is the difference between Hyperbrowser's `wsEndpoint` and `liveUrl`? Why would a developer want the `liveUrl` during debugging but not in production?

---

## Group 2: Stagehand and AI-powered extraction

6. What's the fundamental difference between scraping with CSS selectors and AI-powered extraction with Stagehand? Which is more reliable, and in what scenario does each break?
7. Why does Stagehand need a Zod schema? What does the schema actually tell Stagehand — and what happens if the page doesn't have the data the schema expects?
8. What does `env: "LOCAL"` mean in Stagehand's config? Why is this name confusing, and what is it actually telling Stagehand to do?
9. How does Stagehand use the AI model under the hood — does it see the HTML, the rendered DOM, a screenshot, or something else? How would that affect extraction accuracy?
10. Why does the extraction use two separate schemas — `HomepageSchema` and `SubpageSchema` — instead of one schema for all pages?

---

## Group 3: URL derivation and fallbacks

11. Why does following HTTP redirects with `fetch(..., { redirect: "follow" })` often give better results than trying to parse the original apply URL? What kind of redirect chains do job boards use?
12. What is subdomain normalization and why does `jobs.stripe.com` → `stripe.com` require its own logic? What would break if you just used `jobs.stripe.com` as the "homepage"?
13. Why is the company name fallback (`https://www.${cleanName}.com`) the least reliable step? What percentage of companies would it correctly reach?
14. What is a "denylist" and why does the `JOB_BOARD_DOMAINS` Set need to be a Set (not an Array)? What lookup performance difference does it make?
15. The fallback chain has 3 steps. What would a 4th step look like? Could you use a search engine API to find the company homepage? What are the trade-offs?

---

## Group 4: Resource cleanup and error safety

16. Walk through exactly what happens when `createStagehand()` throws: which variables have been assigned, which `finally` guards fire, and what does the user see?
17. Why is the cleanup order important — why must Stagehand close before the Hyperbrowser session is stopped? What error could occur if you reversed the order?
18. Why does the inner `try { } catch { }` exist inside the `finally` block? What would happen without it if `client.sessions.stop()` throws?
19. What is the TypeScript benefit of declaring variables as `null` before the try block vs. declaring them inside the try block? Why can't TypeScript infer their assignment from the try body?
20. When is it appropriate to have an empty catch `catch { }` and when is it a code smell? How does intent and context change whether an empty catch is acceptable?

---

## Group 5: Architecture and state management

21. Why does the API route return generic error messages while logging real errors server-side? What attack surface does exposing real error messages create?
22. Why is `useState(initialResearch)` the right tool for updating the dossier after the API call, instead of `router.refresh()`? When would `router.refresh()` be the right choice?
23. The `agent/` folder is not allowed to import from `components/` or `actions/`. Why? What would break architecturally if an agent function imported a React hook?
24. Why is `lib/hyperbrowser.ts` named after the specific provider rather than a generic `lib/cloud-browser.ts`? When would a provider-neutral abstraction be worth the added complexity?
25. Synthesis always runs even when browser research completely fails. Why is "never return empty" an important invariant for an AI agent feature? What is the alternative and why is it worse UX?
