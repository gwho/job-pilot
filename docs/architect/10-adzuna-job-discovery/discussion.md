# Architect Session — Feature 10: Deep Discussion

This is the teaching record of the reasoning behind Feature 10's architecture. `decisions.md` states *what* was decided; this file explains *why the reasoning holds* and what each wrong turn would actually have cost in running code.

---

## 1. The sibling-state problem — the root of the whole session

Feature 09 left the Find Jobs page in this shape:

```
page.tsx (Server Component)
  ├─ <SearchControls />        // self-contained, owns jobTitle/location, stub handleSearch
  └─ <FindJobsClient jobs={MOCK_JOBS} />  // owns filter/sort/pagination over a fixed prop
```

These two are **siblings**. That was fine in Feature 09 because the search did nothing real — `handleSearch` just set a hardcoded `searchStatus`. The table rendered a static prop. No data crossed between them.

Feature 10 breaks that peace: the search must **produce** the jobs the table **consumes**. The moment two sibling components need to share a value that changes at runtime, you have exactly three options:

1. **Lift state to a common ancestor.** Whichever ancestor holds the state passes it down to both.
2. **Introduce a new ancestor** whose only job is to hold the shared state.
3. **Reach for a global store / context.** Overkill for one page with one shared array.

We chose a variant of (1): rather than lifting state up into `page.tsx` (impossible — it's an async Server Component and can't hold `useState`), we promoted `FindJobsClient` to be the client-side root that owns everything, and demoted `SearchControls` to a child of it.

Why not lift into `page.tsx`? Because Server Components don't have state. They run once on the server, render, and are done. There is no `useState`, no event handler, no re-render on interaction. Any runtime-mutable state **must** live in a client component. So the common ancestor of "search" and "table" has to be a client component — and the cheapest such ancestor is `FindJobsClient`, which is already a client component already holding derived list state.

**What option (2) would have cost:** a `FindJobsPageClient` wrapper. Now `jobs` lives in the wrapper, the *filtered view* of jobs lives in `FindJobsClient`, and the *search inputs* live in `SearchControls`. Three components, three claims on overlapping state. Six months later, someone asks "where do jobs come from?" and the answer is "well, the wrapper owns the array, but the client filters it, and the controls trigger the fetch that the wrapper handles" — a paragraph instead of a sentence. Cohesion lost for no gain.

The principle: **state belongs as close as possible to the lowest component that is a common ancestor of everything that reads or writes it.** Here that's `FindJobsClient`.

---

## 2. Why batch scoring is a real trade, not a free win

The naive read is "batch is just faster, obviously do that." It's worth being honest about what you give up.

**Sequential (10 calls):** Each job is scored in isolation. The model sees one job + the profile, returns one score. If call #4 returns garbage, calls #1–3 and #5–10 are unaffected. You can retry #4 alone. The blast radius of a bad response is one job.

**Batch (1 call):** The model sees all 10 jobs + the profile and returns an array. One round-trip, ~5× faster, one-tenth the request count against a rate-limited free tier. But now the blast radius of a malformed response is **all 10 jobs**, and a new failure mode appears that doesn't exist in the sequential design: **index drift**. If the model returns 9 scores instead of 10, or silently reorders them, every job after the drift point gets the wrong score — and nothing throws. You'd just have wrong data in the DB.

This is why decision 5 (the batch-ordering guard) exists. Batching didn't just change performance; it created a correctness obligation. The guard — "if lengths don't match, score the unmatched jobs 0 rather than failing" — is the price of admission for batching. A junior engineer adds the batch call and stops. A senior engineer adds the batch call *and the guard*, because they know the failure mode they just signed up for.

The deeper lesson: **when you collapse N operations into one, you also collapse N independent failure domains into one. Account for it.**

---

## 3. setJobs vs router.refresh — two tools that look interchangeable and aren't

Both make the table show new jobs. They are not the same operation.

`setJobs(res.jobs)`:
- Pure client-side state update.
- Uses data the API already returned — zero extra network.
- Re-renders only the React subtree that depends on `jobs`.
- Instant.

`router.refresh()`:
- Tells Next.js to re-run the Server Component for the current route.
- That Server Component re-queries the DB — a **second** read of rows we literally just wrote.
- Re-renders from the server boundary down.
- Slower, with a possible flash.

If the API returns the jobs, `router.refresh()` is strictly wasteful — you throw away the response payload and pay for a DB query to reconstruct it. So we return the jobs and `setJobs`.

**But** — and this is the subtle part — `setJobs` only solves the *live session*. It does nothing for a user who searches, clicks away to `/dashboard`, then comes back to `/find-jobs`. That return visit is a fresh render of the Server Component, governed entirely by Next's caching. That's where `force-dynamic` comes in (next section). The two mechanisms are not redundant; they cover disjoint moments in the user's journey.

---

## 4. force-dynamic and the Next.js caching mental model

Next.js App Router caches aggressively by default. A page with no dynamic data sources can be rendered once and served statically. Our `page.tsx` *does* read per-user data, but it's worth being explicit rather than relying on Next inferring dynamism from the InsForge call.

`export const dynamic = 'force-dynamic'` says: **never cache this route's render; execute it fresh on every request.** For a per-user, frequently-mutated list like saved jobs, that's correct — caching would risk showing one user a stale list, or an empty list captured before their first search.

The mental model to carry forward:
- **In-session interactivity** (search updates the table now) → client state (`setJobs`).
- **Cross-navigation freshness** (the table is correct when you arrive) → server render policy (`force-dynamic`).

Confusing these is a common source of "it works until I reload" bugs. They are two different layers — React client state vs. the Next render cache — and each needs its own answer.

---

## 5. Best-effort scoring — designing for the empty state

A discovery feature whose first interaction is a wall ("complete your profile first") fails the new user. The whole point of Feature 10 is to let someone type a job title and see results.

So the profile is fetched with `maybeSingle()` (which returns `null` rather than throwing when no row exists), and a `null` profile flows into the scorer as empty fields. Nemotron then scores on the job title and description alone — generic, but a real, ordered list of jobs the user can act on.

This is a recurring design stance: **the empty/sparse state is a first-class path, not an error.** The same instinct shows up in the batch-ordering guard (don't fail, degrade) and in always returning a result. The product should bend before it breaks.

The alternative — gating on `is_complete` — optimises for score quality at the cost of ever getting the user to their first result. Wrong trade for a top-of-funnel feature.

---

## 6. Why the "GPT-4o" discrepancy mattered enough to stop on

The developer's notes twice said "GPT-4o." The project runs on Nemotron. This could be dismissed as a typo — but it was worth surfacing because the *source documentation itself* (`library-docs.md`) carries stale "GPT-4o synthesis" headings over code that calls Nemotron. That means the confusion is latent in the repo, not just the notes. Naming it explicitly in this session prevents a future implementer from reading "GPT-4o" in the docs and wiring up the wrong client.

The lesson is about documentation drift: **when a label and the code under it disagree, the label is a trap for the next reader.** Flag it, don't silently route around it.

---

## 7. The cleanup that rode along — removing dead UI

The Connected Accounts card had a connect/disconnect button wired to nothing. Dead UI is worse than missing UI: it implies a capability that doesn't exist and invites users to click into a void.

The careful part was the `linkedin_connected` column. The card was its only UI surface, but the column still exists in the DB and `handleSave` still writes the whole profile. Drop the card carelessly and `handleSave` might send `undefined` (or a default `false`) for `linkedin_connected`, silently flipping a stored value. The fix — `linkedin_connected: profile?.linkedin_connected ?? false` — passes the existing DB value straight back through. The UI shrinks; the data is untouched. The LinkedIn **URL** field is a different thing entirely (a real, user-edited profile field) and stays.

The principle: **removing UI is a data operation too.** Before deleting a control, trace every column it touched and make sure the save path still preserves them.

---

## Future exploration (touched briefly, not resolved here)

- **Duplicate jobs on re-search.** We accepted duplicates for Feature 10. A real dedup strategy (by `source_url`, or an upsert keyed on `user_id + external id`) is deferred — worth designing in Feature 11.
- **Streaming/progress UI for long searches.** With batch scoring at ~5s, a simple disabled-button loading state suffices. If scoring ever grows slower, a streamed "scored 3/10…" progress channel would be the next step.
- **Server-side filtering boundary.** Feature 11 moves filter/sort/pagination into DB queries. The clean line between client-side (now) and server-side (then) was assumed but not designed in this session.
