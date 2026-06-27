# Explanation — Feature 10b Actor Deployment: Why Each Decision Was Made

---

## 1. Why the Dockerfile failed and what the fix teaches about Docker user ownership

The build error was:
```
npm error path /home/myuser/package-lock.json
npm error errno -13
npm error Error: EACCES: permission denied
```

The Apify base image (`apify/actor-node-playwright-chrome:20`) runs all build steps as a non-root user called `myuser` for security. When `COPY package*.json ./` ran, it copied both `package.json` and `package-lock.json` into the container. But on macOS, `npm install` creates `package-lock.json` owned by the local user (which in the Docker build context is mapped to root). The container's `myuser` couldn't open it for writing.

The fix is to `COPY package.json ./` only — omitting the lock file. Without an existing lock file in the container, `npm install` creates a fresh one as `myuser` with the correct ownership. The `package-lock.json` becomes a build artifact inside the container rather than a copied file.

The broader lesson: any file you `COPY` into a Docker image retains the ownership metadata from the build context (determined by the UID running the Docker build or the COPY instruction). When the container's working user has a different UID, those files may be unwritable. The safest pattern for files that `npm install` needs to update is to only copy the files it reads (manifests), not the files it writes (lock files, `node_modules`).

A common alternative fix is `RUN chown -R myuser:myuser .` before `npm install`, but that requires knowing the username convention of the base image. Omitting the lock file entirely is simpler and more portable.

---

## 2. Why the actor's default KV store doesn't exist before the first run

In Apify's data model, each actor *run* gets its own default KV store provisioned when the run starts. There is no persistent "actor-level" default KV store — only run-level stores. This is by design: Apify treats runs as ephemeral, isolated units. The default KV store is created on first run and can be cleaned up afterward.

This means `Actor.getValue("JOBSDB_SESSION")` reading from the actor's default store would only work if the session was uploaded *to the specific run's store after the run started*. That's impractical for a pre-configured credential.

The two correct approaches are:

**Named KV store (what we chose):** Create a KV store that exists independently of any run. The actor opens it by ID or name using `Actor.openKeyValueStore(storeId)`. The store persists indefinitely and is shared across all runs. This is the right pattern for credentials and shared configuration.

**Actor env vars:** Simpler but limited to small values. You configure them in the actor's Settings on the Apify Console. They're available as `process.env.VAR_NAME` inside the actor. A Playwright `storageState` blob is too large (multiple KB) to store as an env var.

The named KV store approach requires passing the store ID to the actor. The cleanest way to do this is via the actor's configured environment variables (`APIFY_SESSION_STORE_ID`), which are set once at the actor level (not per-run) and available to every run.

---

## 3. Why the session detection triggered on Google's OAuth page

The first capture script checked whether the URL contained `/login`, `/sign-in`, or `/account/login` and treated any other URL as "logged in." Google's OAuth URL is:

```
https://accounts.google.com/v3/signin/identifier?...
```

This URL contains `/signin/` with no `/login` substring — it doesn't match any of the exclusion patterns. The detection logic saw a non-blank, non-login URL and immediately captured the session. What it captured was Google's auth flow cookies, not JobsDB's authenticated session cookies.

The fix is to flip the detection logic: instead of "not a login page," require "on JobsDB and not on any auth provider page." The correct session has a URL that starts with `hk.jobsdb.com` and doesn't contain `/account/` or any OAuth provider hostname. This is more specific and harder to false-trigger.

The session captured on the second run landed on:
```
https://hk.jobsdb.com/oauth/signin-confirmation?...
```
which is JobsDB's own post-login page, confirming the user had completed the full OAuth flow (Google → Seek PKCE callback → JobsDB confirmation).

---

## 4. Why `COPY package*.json` is a common pattern that breaks this way

The layer-caching motivation for `COPY package*.json ./` followed by a separate `COPY . ./` is well-established: copying only manifests first lets Docker cache the `npm install` layer independently of your source changes. If `package.json` and `package-lock.json` haven't changed, Docker reuses the cached install layer and only the `COPY . ./` layer rebuilds.

This is correct and useful, but it copies the lock file — which creates the ownership problem described in section 1. The fix that preserves caching is to copy only `package.json`:

```dockerfile
COPY package.json ./           # cache bust only when manifest changes
RUN npm install --include=dev  # layer cached if package.json unchanged
COPY . ./                      # bust on any source change
```

Without a lock file, `npm install` creates one each build — you lose reproducible installs but gain correct ownership. For actor dependencies that are already pinned by version in `package.json`, this tradeoff is acceptable. If strict reproducibility matters, the alternative is to add `--no-package-lock` to the `npm install` command, which skips creating/updating the lock file entirely.

---

## 5. Why `storageState` cookies needed `as any[]` in TypeScript

The original type assertion:
```typescript
(storageState as { cookies?: Parameters<typeof page.context.prototype.addCookies>[0] }).cookies ?? []
```

This tried to use TypeScript's `Parameters<>` utility to extract the type of `addCookies`'s argument. It worked when `storageState` came from `Actor.getValue()` (which returns `object | null`, making the assertion straightforward). When `store.getValue()` was used instead, Crawlee's generic types narrowed the return type differently, making the complex assertion fail to unify.

The simpler fix:
```typescript
const cookies = (storageState as { cookies?: unknown[] }).cookies ?? [];
await page.context().addCookies(cookies as any[]);
```

The `any[]` cast is acceptable here because:
1. The `storageState` JSON was produced by Playwright's `context.storageState()`, so the cookie shape is guaranteed to match Playwright's expected cookie format
2. The type error was in the TypeScript layer, not in the runtime behavior — at runtime, the correct cookie objects were always present
3. The alternative would be importing Playwright's internal cookie type and constructing a type-safe cast, which adds complexity for no runtime benefit

Using `any[]` at the boundary of an externally-produced JSON blob (KV store value) is the correct pragmatic choice over a complex type import chain.

---

## 6. The `--force` flag requirement and what it means

`apify push` compares timestamps between the local actor state and the deployed actor. When the env vars were updated via the REST API (`PUT /v2/acts/{id}/versions/0.1`) immediately before the push, Apify updated the actor's `modifiedAt` timestamp on the platform. The local code hadn't been modified in the same window, so the CLI saw the platform version as newer.

The `--force` flag tells the CLI to push regardless of timestamp comparison. It's safe here because we changed the platform env vars intentionally and the code changes (Dockerfile fix, cookie type fix) are what we want to become the new live version.

The risk scenario where `--force` is dangerous: if someone else modified the actor on the platform (via the Apify Console editor) between your last pull and your push. `--force` would overwrite their changes. For a solo developer project this isn't a concern, but in a team setting `--force` should always be preceded by reviewing recent builds on the Apify Console.

---

## 7. The three `.env.local` keys and their distinct roles

After this session, three Apify-related keys exist in `.env.local`:

```
APIFY_TOKEN=apify_api_...          # authenticates the apify-client SDK in lib/apify.ts
APIFY_JOBSDB_ACTOR_ID=XzcBowQgpzN8TVhse   # which actor to call
APIFY_SESSION_STORE_ID=8yzXh5w1IZdLjvZv9  # where the session is stored
```

`APIFY_TOKEN` is used in `lib/apify.ts` to authenticate API calls to Apify. It's the secret that must never be committed.

`APIFY_JOBSDB_ACTOR_ID` is the actor's permanent identifier. It doesn't change unless you create a new actor (not a new version — pushes to the same actor don't change the ID).

`APIFY_SESSION_STORE_ID` is the KV store that holds the JobsDB session. This store persists independently of actor runs. It needs to be passed to the actor at runtime so the actor knows which store to open — hence it's also set as an actor-level env var on Apify.

The actor reads `APIFY_SESSION_STORE_ID` from `process.env` at runtime (it's in the actor's configured env vars). The Next.js app reads it from `.env.local` only if the capture script needs to reference it — the app itself never uses this key, only the actor does.
