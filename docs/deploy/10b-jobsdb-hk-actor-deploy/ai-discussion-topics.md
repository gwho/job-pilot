# AI Discussion Topics — Feature 10b Actor Deployment

---

## Group 1: Docker file ownership and npm install patterns

1. Why does copying `package-lock.json` into a Docker container cause a permission error when the base image runs as a non-root user? What specifically does `npm install` try to do with the lock file, and why does UID mismatch prevent it?

2. The fix was `COPY package.json ./` instead of `COPY package*.json ./`. What does this break about reproducible builds, and when would that breakage actually matter in production? How would you restore reproducibility without reintroducing the permission issue?

3. The `apify/actor-node-playwright-chrome:20` base image runs as `myuser`. Why do security-conscious Docker base images use a non-root user for build and runtime steps? What class of attacks does this prevent?

4. An alternative fix is `RUN chown -R myuser:myuser .` before `npm install`. Why is this worse than omitting the lock file copy, and what hidden assumption does it encode about the base image's user naming convention?

---

## Group 2: Apify KV store architecture

5. Why does Apify provision a default KV store per run rather than per actor? What design philosophy does this reflect about ephemeral vs. persistent state?

6. What is the difference between `Actor.getValue("KEY")` and `Actor.openKeyValueStore(storeId).getValue("KEY")`? When does each one read from, and why do they behave differently before the first run?

7. The session store ID (`8yzXh5w1IZdLjvZv9`) is passed to the actor as an env var (`APIFY_SESSION_STORE_ID`), not hardcoded in the actor code. Why is this the right approach? What would break if you hardcoded the store ID in `main.ts`?

8. An alternative to a named KV store is passing the `storageState` JSON as actor input per-run. The session capture plan explicitly rejected this. Walk through exactly why — what are the security and operational consequences of per-run credential input?

9. The API call to create the named KV store returned `"name": null` even though the request body included `"name":"jobsdb-sessions"`. The session was still uploaded and the actor found it by ID. What does this tell you about how Apify differentiates between named stores (visible in the console by name) and ID-accessed stores?

---

## Group 3: Browser session capture reliability

10. The first capture script triggered on `accounts.google.com` because the URL didn't match the "this is a login page" exclusion list. Why is an exclusion-list approach inherently fragile for detecting "logged in"? What is the more robust alternative that this session implemented?

11. The capture script polls `page.url()` every 2 seconds. What are the edge cases where this polling approach could still fail — what URLs might pass the `onJobsDb && !onAuthPage` check before the session cookies are fully established?

12. Playwright's `context.storageState()` captures both cookies and `localStorage`. For a JobsDB session, which is more critical — the cookies or localStorage? Why might the session break if one is missing but not the other?

13. The captured session has a finite lifetime (14–30 days). The actor detects expiry by checking `page.url()` after navigating to the search page. What would a more proactive expiry detection look like — one that warns before the session expires rather than failing silently on the next run?

---

## Group 4: ESM/CJS interop in capture scripts

14. The capture script is `capture-jobsdb-session.mjs` (ESM) but imports from playwright which is a CommonJS module. Why does `import { chromium } from '...playwright/index.js'` fail while `import pkg from '...playwright/index.js'; const { chromium } = pkg;` works?

15. Node.js resolves module format from the `"type"` field in `package.json`. The main project has no `"type": "module"` but the script uses `.mjs` extension. The actor directory has `"type": "module"`. How do these interact when the script imports from the actor's `node_modules`?

16. The script imports playwright from `../apify/jobsdb-hk-actor/node_modules/playwright/index.js` rather than installing it in the main project. What are the tradeoffs of this approach vs. adding playwright as a devDependency in the main project's `package.json`?

---

## Group 5: Actor versioning and platform sync

17. `apify push` failed with "Actor was modified on platform since modified locally." Why does the REST API call to set env vars count as a platform modification for timestamp comparison purposes? How would you avoid this race condition when combining API updates with CLI pushes?

18. The actor has three builds: 0.1.1 (first push, failed), 0.1.2 (Dockerfile fix), 0.1.3 (KV store + TypeScript fix). Apify keeps all build history. When does a failed build (0.1.1) matter, and could it be accidentally set as the "latest" build tag again?

19. The actor's `version` in `.actor/actor.json` is `"0.1"` but the build numbers (0.1.1, 0.1.2, 0.1.3) increment automatically. What controls the major version number (`0.1` vs `0.2`), and when would you increment it vs. letting the patch builds accumulate?
