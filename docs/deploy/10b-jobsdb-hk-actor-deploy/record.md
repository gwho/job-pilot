# Deployment Record — Feature 10b: JobsDB HK Actor Deploy

## What this session covered

After Feature 10b was implemented (code written, docs created, tutorials written), this session handled the real-world deployment work: pushing the Apify actor to the cloud, capturing a live JobsDB authenticated session, and wiring the session into the actor via a persistent Apify KV store.

---

## Chronological record

### 1. Prerequisites confirmed

- `APIFY_TOKEN` was already set in `.env.local`
- `APIFY_JOBSDB_ACTOR_ID` was empty (actor not yet deployed)
- Playwright not installed in the actor directory (`apify/jobsdb-hk-actor/node_modules/` didn't exist)

### 2. Actor dependencies installed

```bash
cd apify/jobsdb-hk-actor && npm install
npx playwright install chromium
```

Dependencies installed locally for the capture script to use (playwright, apify, crawlee).

### 3. First `apify push` — Dockerfile build failure

```bash
APIFY_TOKEN=... apify push -w 120
```

**Build failed** with `EACCES: permission denied, open '/home/myuser/package-lock.json'`.

**Root cause:** The original Dockerfile used `COPY package*.json ./` which copies both `package.json` and `package-lock.json`. The lock file was created locally as root (or a different UID), and the Apify base image runs Docker build steps as `myuser`. When `npm install` tried to update the lock file, it couldn't write to it.

**Fix:** Changed `COPY package*.json ./` → `COPY package.json ./` in `apify/jobsdb-hk-actor/Dockerfile`.

### 4. Second `apify push` — success

```
Actor build detail: https://console.apify.com/actors/XzcBowQgpzN8TVhse#/builds/0.1.2
Actor ID: XzcBowQgpzN8TVhse
```

`APIFY_JOBSDB_ACTOR_ID=XzcBowQgpzN8TVhse` added to `.env.local`.

### 5. Session capture script written

**File:** `scripts/capture-jobsdb-session.mjs`

The script:
1. Opens a real Chromium browser (using playwright from the actor's `node_modules`)
2. Navigates to `https://hk.jobsdb.com/hk/account/login`
3. Polls `page.url()` every 2 seconds watching for successful login
4. On detection, saves `context.storageState()` to `scripts/jobsdb_session.json`
5. Uploads the session JSON to Apify KV store via REST API

Import fix required: playwright exports a CJS module, so ESM import needed:
```javascript
// Wrong:
import { chromium } from '...playwright/index.js';
// Correct:
import pkg from '...playwright/index.js';
const { chromium } = pkg;
```

### 6. First capture run — wrong detection logic

Script detected login on Google's OAuth page (`accounts.google.com`) because the original check was:
```javascript
const isOnLoginPage = url.includes('/login') || url.includes('/sign-in') || url.includes('/account/login');
if (!isOnLoginPage && !url.includes('about:blank')) { /* detected */ }
```

Google's sign-in URL doesn't contain those strings, so it triggered immediately before the user finished logging in.

**Fix:** Tightened to require the URL to be on JobsDB and not on any auth provider:
```javascript
const onJobsDb = url.includes('hk.jobsdb.com') || url.includes('jobsdb.com');
const onAuthPage = url.includes('/login') || url.includes('/sign-in') || url.includes('/account/') 
  || url.includes('accounts.google.com') || url.includes('login.seek.com') || url.includes('about:blank');
if (onJobsDb && !onAuthPage) { /* detected */ }
```

### 7. Second capture run — success

User logged into JobsDB in the opened browser window. Script detected login at:
`https://hk.jobsdb.com/oauth/signin-confirmation?...`

- **68 cookies captured**
- Saved to `scripts/jobsdb_session.json`

### 8. KV store upload — actor default store unavailable

Auto-upload failed because the actor had never run, so it had no default KV store yet. The capture script tried to find the store by fetching the actor's recent runs:
```
GET /v2/acts/XzcBowQgpzN8TVhse/runs?limit=1
→ items: []  (no runs)
→ defaultKeyValueStoreId: undefined
```

### 9. Named KV store created via REST API

```bash
curl -X POST "https://api.apify.com/v2/key-value-stores?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"jobsdb-sessions"}'
→ { "id": "8yzXh5w1IZdLjvZv9", "name": null }
```

Note: the `name` field returned null — the store was created unnamed but with a stable ID `8yzXh5w1IZdLjvZv9`. The session was uploaded to it directly by ID (HTTP 201 ✓).

### 10. Actor updated to use named KV store

Changed `loadStorageState()` in `apify/jobsdb-hk-actor/src/main.ts`:

```typescript
// Before:
const raw = await Actor.getValue("JOBSDB_SESSION");

// After:
const storeId = process.env.APIFY_SESSION_STORE_ID;
const store = storeId
  ? await Actor.openKeyValueStore(storeId)
  : await Actor.openKeyValueStore(); // fallback to per-run default
const raw = await store.getValue("JOBSDB_SESSION");
```

`APIFY_SESSION_STORE_ID` env var set on the actor via REST API:
```bash
PUT /v2/acts/XzcBowQgpzN8TVhse/versions/0.1
body: { "envVars": [{ "name": "APIFY_SESSION_STORE_ID", "value": "8yzXh5w1IZdLjvZv9" }] }
→ HTTP 200
```

Also added to `.env.local`: `APIFY_SESSION_STORE_ID=8yzXh5w1IZdLjvZv9`

### 11. TypeScript error fixed

The cookie type assertion in `preNavigationHooks` broke after the KV store change because `store.getValue()` returns a different generic type than `Actor.getValue()`.

```typescript
// Before (complex, broke with store.getValue):
(storageState as { cookies?: Parameters<typeof page.context.prototype.addCookies>[0] }).cookies ?? []

// After (simpler, works):
const cookies = (storageState as { cookies?: unknown[] }).cookies ?? [];
await page.context().addCookies(cookies as any[]);
```

### 12. Final push — build 0.1.3

```bash
apify push -f -w 180  # --force needed because platform was newer than local
→ Build 0.1.3: SUCCEEDED
```

### 13. Security hardening

`scripts/jobsdb_session.json` added to `.gitignore`:
```
# session capture — contains live JobsDB cookies, never commit
scripts/jobsdb_session.json
```

---

## Final state

| Item | Value |
|------|-------|
| Actor ID | `XzcBowQgpzN8TVhse` |
| Actor build | `0.1.3` |
| Session KV store | `8yzXh5w1IZdLjvZv9` |
| Session key | `JOBSDB_SESSION` |
| Cookies captured | 68 |
| Actor env var | `APIFY_SESSION_STORE_ID=8yzXh5w1IZdLjvZv9` |

## To re-capture session (when it expires)

```bash
node scripts/capture-jobsdb-session.mjs
```

The script opens Chromium, waits for you to log into JobsDB, then automatically uploads the new session to the same KV store.
