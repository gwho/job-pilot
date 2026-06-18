# Tutorial 05 — Database Schema: Tables, RLS, Triggers, Indexes, and TypeScript Types

**After completing this tutorial you will understand:** how the four JobPilot tables
relate to each other and to the auth system built in Tutorial 02, why `profiles.id` is
the auth UUID rather than a generated key, how Row Level Security enforces per-user data
isolation at the database layer, why the `updated_at` trigger removes a whole class of
application bugs, how composite indexes make RLS and sort work together without a
performance penalty, and how `types/index.ts` maps the three distinct type surfaces of a
database table to TypeScript.

> [!NOTE]
> **Prerequisites:** Tutorial 02 (`docs/tutorials/02-auth/README.md`) — specifically the
> auth UUID (`auth.uid()`) and the `createInsforgeServer()` pattern. Every RLS policy
> in this schema calls `auth.uid()`, which only makes sense once you understand where
> that value comes from. Open
> [`scripts/schema.sql`](../../../scripts/schema.sql) and
> [`types/index.ts`](../../../types/index.ts) alongside this tutorial — every code
> block below is pulled from those files exactly as they exist in the repo.

---

## The schema at a glance

Before any SQL, hold the shape of the four tables and how they relate:

```
auth.users  (InsForge auth system — not owned by this app)
    │
    │  profiles.id = auth.users.id  (shared primary key — 1:1)
    │  ON DELETE CASCADE
    ▼
profiles
    │
    │  agent_runs.user_id → profiles.id  (1:many — one user, many runs)
    │  ON DELETE CASCADE
    ▼
agent_runs
    │
    │  jobs.run_id → agent_runs.id   (nullable — jobs from direct URL have no run)
    │  ON DELETE SET NULL            (run deleted → job stays, run_id becomes NULL)
    ▼                         ┌──────────────────────────────────────────────┐
jobs  ◄───────────────────────  jobs.user_id → profiles.id  (1:many)         │
    │                           ON DELETE CASCADE                              │
    │                          └──────────────────────────────────────────────┘
    │  agent_logs.job_id → jobs.id    (nullable — logs can exist outside a job)
    │  ON DELETE SET NULL
    ▼
agent_logs
    │
    └──  agent_logs.user_id → profiles.id  (1:many)
         ON DELETE CASCADE
```

Three things worth noticing before reading any SQL:

1. **`profiles` is the anchor.** All other tables foreign-key to it. Delete a user's
   profile → all their runs, jobs, and logs cascade away automatically.
2. **`run_id` in `jobs` is nullable.** A job found via the agent search always has a
   run. A job added by pasting a direct URL (Feature 09, `source = 'url'`) has none.
   `ON DELETE SET NULL` means you can purge old agent runs without deleting the jobs
   they found.
3. **`user_id` appears on every table except `profiles`.** In `profiles`, `id` *is* the
   user's UUID. This distinction drives the only difference in the RLS policies.

---

## Part 1 — The `profiles` table: shared primary key vs surrogate key

Open [`scripts/schema.sql`](../../../scripts/schema.sql) lines 17–42:

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT,
  email               TEXT,
  -- ... all the profile fields ...
  is_complete         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The key line: `id UUID PRIMARY KEY REFERENCES auth.users(id)`. The same UUID that
InsForge's auth system assigns to a user (`auth.uid()` at runtime) is the primary key of
the `profiles` row. There is no separate auto-generated profile ID.

### Why not a surrogate key?

The alternative would look like this:

```sql
-- NOT what this project uses — shown for contrast only
CREATE TABLE profiles_alternative (
  id      SERIAL        PRIMARY KEY,        -- or UUID DEFAULT gen_random_uuid()
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ...
);
```

The surrogate approach has three costs:

| | Shared PK (current) | Surrogate PK (alternative) |
|---|---|---|
| Uniqueness | One row per user enforced by the PK itself | Requires a separate `UNIQUE (user_id)` constraint |
| RLS policy | `WHERE id = auth.uid()` — one column, direct | `WHERE user_id = auth.uid()` — one column, still fine |
| Downstream FKs | Other tables FK to `auth.uid()` directly | Other tables must decide: FK to `profiles.id` (the surrogate) or to `profiles.user_id` (the auth UUID) — and `auth.uid()` already knows the second value, not the first |
| Row identity | A profile IS the user — expressed by the type | A profile BELONGS TO a user — expressed by a FK, subtly different semantics |

The rule of thumb: use a shared PK for **1:1 extension tables**. Use your own PK for
**1:many tables** where each row has its own identity separate from the user.
`agent_runs`, `jobs`, and `agent_logs` all have `id UUID PRIMARY KEY DEFAULT
gen_random_uuid()` — each row is its own thing that happens to belong to a user.

**Checkpoint:** `agent_runs` has `user_id UUID NOT NULL REFERENCES profiles(id)` — not
`REFERENCES auth.users(id)`. Why reference `profiles` rather than `auth.users` directly?
(Answer: because `agent_runs` semantically belongs to a *profile* — the enriched user
record with search preferences, skills, etc. An agent run only makes sense for a user
who has a profile set up. If `auth.users` were referenced directly, a user could
technically have agent runs with no profile, which no feature in this app supports.
The FK to `profiles` enforces that the profile must exist first.)

**Try it yourself:** Look at the `agent_logs` table definition in `schema.sql`. It
references *two* other tables: `profiles(id)` via `user_id`, and `agent_runs(id)` via
`run_id`, and `jobs(id)` via `job_id`. Open the file and confirm the `ON DELETE` behavior
for each FK:

- `user_id → profiles(id)`: ___________
- `run_id → agent_runs(id)`: ___________
- `job_id → jobs(id)`: ___________

Then explain in one sentence why `run_id` and `job_id` use `SET NULL` while `user_id`
uses `CASCADE`.

<details>
<summary>Reveal answer</summary>

- `user_id → profiles(id)`: `ON DELETE CASCADE` — if the user is deleted, all their
  logs go with them. There's no reason to keep logs from a deleted account.
- `run_id → agent_runs(id)`: `ON DELETE CASCADE` — if a run is deleted, its logs go
  with it. Logs without a run are unintelligible.
- `job_id → jobs(id)`: `ON DELETE SET NULL` — a log about a job that was later deleted
  can still be meaningful as a debugging record. The log stays; `job_id` becomes NULL.

The pattern: cascade when the child row has no standalone value without the parent. Set
null when the child row has independent value and the FK is just context.
</details>

---

## Part 2 — Row Level Security: USING vs WITH CHECK

Every table has RLS enabled and four policies. Open `schema.sql` lines 155–198. Here are
the `jobs` policies, which show both clauses:

```sql
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs: select own" ON jobs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "jobs: insert own" ON jobs
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "jobs: update own" ON jobs
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "jobs: delete own" ON jobs
  FOR DELETE USING (user_id = auth.uid());
```

PostgreSQL evaluates two distinct phases when a row is touched:

```
Incoming SQL query
      │
      ├── SELECT / UPDATE / DELETE ──▶ USING clause
      │         "Which rows am I allowed to see or target?"
      │         Rows that fail USING are invisible — not "access denied",
      │         just not returned. The query succeeds, result set is filtered.
      │
      └── INSERT / UPDATE ──────────▶ WITH CHECK clause
                "Is the data I'm writing valid?"
                Rows that fail WITH CHECK produce a policy violation error.
```

### Why `INSERT` needs `WITH CHECK`, not `USING`

`WITH CHECK` prevents a user from writing a row attributed to someone else:

```sql
-- A malicious insert attempt — without WITH CHECK, this would succeed
INSERT INTO jobs (user_id, title, source)
VALUES ('another-users-uuid', 'Fake Job', 'search');
```

With `FOR INSERT WITH CHECK (user_id = auth.uid())`, PostgreSQL rejects this: the
`user_id` being written doesn't match `auth.uid()`, policy check fails, error returned.
Without it, any authenticated user could pollute anyone else's job list.

### The gap in the UPDATE policies

Look at the current `jobs` UPDATE policy again: `FOR UPDATE USING (user_id =
auth.uid())`. It only has `USING` — no `WITH CHECK`. This means:

```sql
-- A user could do this:
UPDATE jobs SET user_id = 'another-users-uuid' WHERE id = 'my-job-id';
```

The `USING` clause lets them *target* their own row — that's correct. But without `WITH
CHECK`, PostgreSQL doesn't validate the new value being written. This is a known,
documented gap in this schema (`docs/plan/04-database-schema/ai-discussion-topics.md`
topic 6). For a solo developer's own data, the practical risk is zero — but in
production, the correct fix is:

```sql
-- What the UPDATE policy should say:
CREATE POLICY "jobs: update own" ON jobs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### The `profiles` special case

`profiles` uses `id` instead of `user_id`:

```sql
CREATE POLICY "profiles: select own" ON profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles: insert own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());
```

Same logic, different column name — because `profiles.id` *is* the auth UUID. Every
other table has a separate `user_id` column that holds the same value.

**Checkpoint:** What happens to a SELECT query against `jobs` when the caller is not
authenticated — i.e., `auth.uid()` returns `NULL`?

<details>
<summary>Reveal answer</summary>

`user_id = NULL` evaluates to `NULL` in SQL (not `FALSE`, not `TRUE` — NULL, because
any comparison with NULL is NULL). PostgreSQL's RLS treats NULL as "policy not
satisfied," so the USING clause filters out *every* row. The query returns an empty
result set — no error, just zero rows. An unauthenticated user literally cannot see any
data, but also doesn't get a helpful error telling them to log in. This is usually the
desired behavior: the app layer (proxy.ts in Tutorial 02) handles the "not logged in"
redirect, and the DB layer handles the "data isolation" guarantee independently.
</details>

**Try it yourself:** Find the `profiles` INSERT policy in `schema.sql` and answer: could
a user upsert a profile row with a different `id` than their own auth UUID? Then trace
where this constraint would *first* be caught — at the TypeScript layer in `types/index.ts`,
at the `WITH CHECK` policy, or both? Open both files to verify.

---

## Part 3 — The `updated_at` trigger: removing a whole class of bugs

Open `schema.sql` lines 101–112:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

### Why the DB default alone isn't enough

The `profiles` table declares `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. The
`DEFAULT` clause fires only on `INSERT` — on `UPDATE`, it does nothing. If application
code doesn't explicitly include `updated_at = NOW()` in every UPDATE payload, the column
stays frozen at its last manually-set value.

This app has multiple code paths that update profiles:

- Feature 06 — profile form save
- Feature 07 — AI extraction overwrites specific fields
- Feature 08 — resume generation updates `resume_pdf_url`

Without the trigger, every one of those code paths must remember to include
`updated_at: new Date().toISOString()`. Forget it in one path and the timestamp silently
stales — no error, wrong data.

### How `BEFORE UPDATE` works

```
Application sends UPDATE SQL
         │
         ▼
  PostgreSQL receives the statement
         │
         ├──▶ BEFORE UPDATE trigger fires
         │         receives NEW row (the incoming values)
         │         set_updated_at() overwrites NEW.updated_at = NOW()
         │         returns modified NEW row
         │
         ▼
  PostgreSQL writes the row returned by the trigger to disk
  (not the original application payload — the trigger-modified version)
         │
         ▼
  AFTER UPDATE triggers would fire here (none in this schema)
```

`BEFORE UPDATE` means the function intercepts the row *before* it's written and gets to
modify it. `RETURN NEW` hands the modified row back to PostgreSQL, which writes that
version. The application's `updated_at` value (if any was sent) is silently overwritten
— so even if a client sends a stale timestamp, the DB always wins.

### `FOR EACH ROW` vs `FOR EACH STATEMENT`

`FOR EACH ROW` fires the function once per updated row. If an UPDATE affects 50 rows,
the trigger fires 50 times and each row gets `NOW()` applied individually. `FOR EACH
STATEMENT` would fire once per statement — fine for logging, wrong for a per-row
timestamp. This project only updates one profile at a time (single-user UX), so the
distinction is moot in practice — but the correct semantics for a per-row timestamp
column is always `FOR EACH ROW`.

**Checkpoint:** The trigger is defined with `CREATE OR REPLACE FUNCTION`. Why `CREATE OR
REPLACE` instead of just `CREATE`?

<details>
<summary>Reveal answer</summary>

`CREATE FUNCTION` fails if the function already exists (e.g., you run `schema.sql` a
second time, or `schema.sql` is used to restore a schema from scratch when some
functions already exist). `CREATE OR REPLACE` updates the function in place if it
already exists, which makes the SQL idempotent — safe to run multiple times without
manual cleanup. Note that `CREATE TRIGGER` does *not* have an `OR REPLACE` equivalent in
all PostgreSQL versions — in this schema, the trigger itself is guarded by `CREATE TABLE
IF NOT EXISTS`, which prevents re-running from creating a duplicate trigger.
</details>

**Try it yourself:** In your editor, find every place in the codebase that currently
writes to the `profiles` table (search for `"profiles"` in the `agent/` and `actions/`
folders — these will be clearer once Features 06–08 are built). Confirm that none of
them include `updated_at` in their payload. The trigger makes this safe; the tutorial is
preparing you to recognise that the trigger is doing silent, correct work.

---

## Part 4 — Indexes: how composite indexes serve both RLS and sort

Open `schema.sql` lines 122–145:

```sql
-- jobs: RLS user filter
CREATE INDEX IF NOT EXISTS idx_jobs_user_id
  ON jobs(user_id);

-- jobs: user filter + date sort (Feature 11 sort by newest/oldest)
CREATE INDEX IF NOT EXISTS idx_jobs_user_found_at
  ON jobs(user_id, found_at DESC);

-- jobs: user filter + match score sort (Feature 11 sort by match score)
CREATE INDEX IF NOT EXISTS idx_jobs_user_match_score
  ON jobs(user_id, match_score DESC);

-- agent_logs: RLS user filter
CREATE INDEX IF NOT EXISTS idx_agent_logs_user_id
  ON agent_logs(user_id);

-- agent_logs: fetch all logs for a specific agent run
CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id
  ON agent_logs(run_id);

-- agent_runs: RLS user filter + recent activity queries (Feature 16)
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id
  ON agent_runs(user_id);
```

### The problem without composite indexes

Imagine Feature 11 runs this query to show the jobs list sorted by newest:

```sql
SELECT * FROM jobs
WHERE user_id = $1
ORDER BY found_at DESC
LIMIT 20;
```

RLS automatically appends `WHERE user_id = auth.uid()` before the query runs — so the
`WHERE user_id = $1` and the RLS filter are the same condition. Without the composite
index, PostgreSQL's query planner must:

1. Scan `idx_jobs_user_id` to find all rows where `user_id = $1` → say 500 rows
2. Load all 500 rows into working memory
3. Sort those 500 rows by `found_at DESC`
4. Return the first 20

### How the composite index eliminates the sort step

With `idx_jobs_user_found_at ON jobs(user_id, found_at DESC)`:

```
Index structure (conceptual):
  ┌──────────────────────────────────────────────────┐
  │ user_id = 'abc-123' │ found_at = 2026-06-17 ... │ → row pointer
  │ user_id = 'abc-123' │ found_at = 2026-06-15 ... │ → row pointer
  │ user_id = 'abc-123' │ found_at = 2026-06-10 ... │ → row pointer
  │ user_id = 'xyz-789' │ found_at = 2026-06-16 ... │ → row pointer
  └──────────────────────────────────────────────────┘
```

The planner can jump directly to `user_id = 'abc-123'` in the index and walk forward —
the rows come out in `found_at DESC` order because that's how the index was built. It
stops after 20 rows. No separate sort step, no reading all 500 rows.

### The leftmost prefix rule

A composite index `(user_id, found_at DESC)` can serve:
- ✅ `WHERE user_id = $1 ORDER BY found_at DESC` — perfect: equality on the first
  column, index order on the second
- ✅ `WHERE user_id = $1` alone — the leftmost column is a filter, index still helps
- ✅ `WHERE user_id = $1 ORDER BY found_at ASC` — PostgreSQL can scan the index
  backwards
- ❌ `ORDER BY found_at DESC` without a `user_id` filter — can't use the index; `user_id`
  is not in the query, so the planner can't jump to any specific section
- ❌ `WHERE found_at > $1` — same reason: the first column must be the filter

This is the **leftmost prefix rule**: a composite index is only useful for a query when
the query filters on the leftmost columns first. The filter can be equality (`=`) or
range (`>`, `<`), but equality comes first because it collapses that dimension of the
index to a single point.

**Checkpoint:** `idx_jobs_user_id` already exists as a single-column index on
`jobs(user_id)`. Would it be redundant to also keep `idx_jobs_user_found_at`? Why not
just use the single-column index and let PostgreSQL sort separately?

<details>
<summary>Reveal answer</summary>

The single-column index handles the `WHERE user_id = $1` filter but provides no
information about sort order. PostgreSQL would still have to fetch all matching rows,
sort them, and then apply `LIMIT`. The composite index makes the sort free — the data
comes out pre-ordered. For a query with a small `LIMIT` (like `LIMIT 20`) on a large
table, the composite index is dramatically faster because it can *stop early*: once 20
rows are yielded in index order, the scan is done. There's also an argument that
`idx_jobs_user_id` (single-column) is technically redundant once both composite indexes
exist, since those can serve the plain `WHERE user_id = $1` filter too. It's kept for
clarity and for queries that might not have a sort column.
</details>

---

## Part 5 — `types/index.ts`: three type surfaces of a database table

Every database table actually exposes *three* different shapes to application code. Open
[`types/index.ts`](../../../types/index.ts) and find the `AgentRun` family:

```ts
// 1. Row — what SELECT returns. All NOT NULL columns present, nullables may be null.
export interface AgentRun {
  id: string
  user_id: string
  status: AgentRunStatus
  job_title_searched: string | null
  location_searched: string | null
  jobs_found: number | null
  started_at: string
  completed_at: string | null
}

// 2. Insert — what INSERT accepts. DB-defaulted columns are optional.
export type AgentRunInsert = Omit<AgentRun, 'id' | 'started_at' | 'jobs_found' | 'completed_at' | 'status'> & {
  id?: string
  status?: AgentRunStatus
  jobs_found?: number
  completed_at?: string | null
}

// 3. Update — not yet defined but implied: every column is optional
// type AgentRunUpdate = Partial<AgentRun>
```

### Why one interface for all three is wrong

Consider what happens if you use `AgentRun` (the Row type) for an insert:

```ts
// Trying to insert a new agent run using the Row type
const newRun: AgentRun = {
  id: ???,            // DB generates this with DEFAULT gen_random_uuid()
  user_id: userId,
  status: 'running',  // DB default is 'running', but Row type requires it
  job_title_searched: 'Senior Engineer',
  location_searched: 'Remote',
  jobs_found: ???,    // DB default is 0, but Row type requires it
  started_at: ???,    // DB default is NOW(), but Row type requires it
  completed_at: null,
}
```

You'd have to fabricate values for `id`, `started_at`, and `jobs_found` at the
application layer even though the database would have set them correctly on its own. The
TypeScript type is lying about what the operation requires.

### How `Omit` + intersection derives Insert types

```ts
export type AgentRunInsert =
  Omit<AgentRun, 'id' | 'started_at' | 'jobs_found' | 'completed_at' | 'status'>
  & {
    id?: string          // optional: omit to let the DB generate it
    status?: AgentRunStatus   // optional: DB defaults to 'running'
    jobs_found?: number  // optional: DB defaults to 0
    completed_at?: string | null  // optional: NULL until the run finishes
  }
```

Step by step:
1. Start with `AgentRun` (the full Row type)
2. `Omit<AgentRun, 'id' | 'started_at' | ...>` — strip the columns that have DB defaults, making them disappear from the required fields
3. `& { id?: string, ... }` — add them back as *optional*, reflecting that you can
   provide them if you want (e.g., providing a pre-generated `id`) but don't have to

The result: `AgentRunInsert` requires only `user_id` (the one field with no default that
must come from the application). Everything else is optional.

```ts
// Valid insert — only providing what the application knows
const newRun: AgentRunInsert = {
  user_id: userId,
  job_title_searched: 'Senior Engineer',
  location_searched: 'Remote',
}
// id, status, jobs_found, started_at, completed_at all omitted → DB provides defaults
```

### `ProfileInsert` is different — `id` is required

```ts
export type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at' | 'is_complete'> & {
  is_complete?: boolean
}
```

`id` is not in the `Omit` list. That's intentional: `profiles.id` has no `DEFAULT`
clause in the schema — it's a shared primary key that the application *must* provide (it
must be `auth.uid()`, not a random UUID). If `id` were optional here, TypeScript would
allow inserting a profile without an ID, which would fail at the database layer. The type
surface accurately reflects the database constraint.

**Checkpoint:** `ProfileInsert` omits `created_at` and `updated_at` from the required
fields. But looking at the schema, both have `NOT NULL DEFAULT NOW()`. Omitting them from
the Insert type is correct — but `updated_at` also has a trigger that fires on UPDATE
(Part 3). Does the INSERT trigger also fire? If not, what sets `updated_at` on first
insert?

<details>
<summary>Reveal answer</summary>

The trigger is `BEFORE UPDATE ON profiles` — it only fires on UPDATE, not INSERT. On
INSERT, `updated_at` is set by its `DEFAULT NOW()` clause, which fires automatically.
This is why both `created_at` and `updated_at` start with the same timestamp: the
INSERT default writes the current time to both columns simultaneously. Only on subsequent
UPDATEs does the trigger step in and advance `updated_at` while `created_at` stays
frozen. This is the correct and intended behavior.
</details>

---

## Part 6 — Literal union types: catching bugs at compile time

Find the union type declarations at the top of `types/index.ts`:

```ts
export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead'
export type RemotePreference = 'remote' | 'onsite' | 'hybrid' | 'any'
export type CoverLetterTone = 'formal' | 'casual' | 'enthusiastic'
export type WorkAuthorization = 'citizen' | 'permanent_resident' | 'visa_required'
export type JobSource = 'search' | 'url'
export type JobType = 'fulltime' | 'parttime' | 'contract'
export type AgentRunStatus = 'running' | 'completed' | 'failed'
export type LogLevel = 'info' | 'success' | 'warning' | 'error'
```

The database stores all of these as `TEXT` columns. There is no `CHECK` constraint in
the schema preventing `experience_level = 'wizard'` from being written at the DB level.
TypeScript fills that gap:

```ts
// In Profile interface (line 68 of types/index.ts):
experience_level: ExperienceLevel | null

// TypeScript error at write time:
const profile: ProfileInsert = {
  id: userId,
  experience_level: 'expert',  // ❌ Type '"expert"' is not assignable to type 'ExperienceLevel | null'
}

// TypeScript accepts:
const profile: ProfileInsert = {
  id: userId,
  experience_level: 'senior',  // ✅
}
```

### Exhaustive switch: the compiler tells you what you missed

The deeper value of union types is the exhaustive switch pattern:

```ts
function badgeColor(level: ExperienceLevel): string {
  switch (level) {
    case 'junior':  return 'bg-green-100 text-green-800'
    case 'mid':     return 'bg-blue-100 text-blue-800'
    case 'senior':  return 'bg-purple-100 text-purple-800'
    case 'lead':    return 'bg-orange-100 text-orange-800'
    default:
      // If you add 'staff' to ExperienceLevel later, TypeScript flags this line
      const _exhaustiveCheck: never = level
      return 'bg-gray-100 text-gray-800'
  }
}
```

`const _: never = level` works because after all four cases are handled, TypeScript
narrows `level` to `never` (the empty type — no values can be `never`). If a new value
like `'staff'` is added to `ExperienceLevel` and you forget to add a `case 'staff':`,
TypeScript cannot narrow `level` to `never` anymore — the assignment fails with a compile
error pointing at every switch that needs updating.

**Try it yourself:** Open `types/index.ts` and temporarily add `'staff'` to
`ExperienceLevel`. Run `npx tsc --noEmit`. If there are any switch statements over
`ExperienceLevel` in the codebase (check `grep -r "ExperienceLevel" --include="*.ts"
--include="*.tsx" .`), they'll now emit type errors. Undo the change afterward.

---

## Part 7 — How the schema, types, and auth connect in a real query

Pull it all together with a concrete example: reading the current user's profile in a
Server Component. This is the pattern every Feature 06-16 will use for profile data.

```ts
// In a Server Component — not yet built, shown as illustration
import { createInsforgeServer } from '@/lib/insforge-server'
import type { Profile } from '@/types'

async function getCurrentProfile(): Promise<Profile | null> {
  const insforge = await createInsforgeServer()

  // auth.getCurrentUser() gives us the UUID → this is auth.uid() at the DB level
  const { data: { user } } = await insforge.auth.getCurrentUser()
  if (!user) return null

  // The SELECT query hits the DB. RLS appends: WHERE id = auth.uid()
  // This filters to exactly one row — the profile whose id matches the session
  const { data } = await insforge.db
    .from('profiles')
    .select('*')
    .eq('id', user.id)   // ← redundant with RLS, but explicit is readable
    .single()

  return data as Profile | null
}
```

Three layers of guarantee working together:

```
Layer 1 — auth session (Tutorial 02)
  proxy.ts already redirected unauthenticated users to /login.
  auth.getCurrentUser() returns a real user object with a real UUID.
        │
        ▼
Layer 2 — RLS policy (Part 2 above)
  The SELECT query hits PostgreSQL. RLS fires.
  WHERE id = auth.uid() silently appends to the query.
  Even if the application forgot .eq('id', user.id), the DB would
  still return only the one row that belongs to this session.
        │
        ▼
Layer 3 — TypeScript type (Part 5 above)
  data is cast to Profile | null.
  Profile.experience_level is ExperienceLevel | null.
  Any downstream code that uses the profile gets compile-time
  guarantees about what values are possible.
```

**Checkpoint:** If `proxy.ts` is working correctly (Tutorial 02), RLS is configured
correctly (Part 2), and the TypeScript types are accurate (Parts 5–6) — what's the
minimum application code needed to safely read a profile without ever exposing someone
else's data? (Answer: the application code doesn't even need to include a `WHERE user_id
= ...` clause — RLS handles it at the database layer automatically. The three-layer
system means each layer has one job: auth session → "is this user logged in", RLS →
"which rows can this user see", TypeScript → "what shape is the data". No single layer
has to do all three jobs, and no single bug in the application layer can bypass them
all.)

---

## Self-check quiz

<details>
<summary><strong>1. `profiles.id` and `jobs.user_id` both hold the same auth UUID at runtime. Why does `profiles` use it as the primary key while `jobs` has its own generated UUID as the PK?</strong></summary>

`profiles` is a 1:1 extension of `auth.users` — one profile per user, and the profile IS
the user with more fields. Using the auth UUID as the PK expresses that identity
directly and avoids a redundant `user_id` column. `jobs` is 1:many — one user has many
jobs, and each job has its own identity (a row that represents a specific listing,
independent of which user found it). Each job needs its own PK, and `user_id` is just a
FK to establish ownership.
</details>

<details>
<summary><strong>2. What is the difference between USING and WITH CHECK in an RLS policy, and which operations each applies to?</strong></summary>

`USING` is the visibility filter — it determines which rows can be seen or targeted.
Applied on SELECT (filters result set), UPDATE (determines which rows can be changed),
and DELETE (determines which rows can be deleted). `WITH CHECK` is the write guard —
it validates the data being written. Applied on INSERT (rejects rows where the check
fails) and optionally on UPDATE (rejects writes where the new values fail the check).
The current schema uses `WITH CHECK` on INSERT policies but not UPDATE policies — meaning
a user could re-attribute their own row to another user's account, which is the known gap
noted in the plan docs.
</details>

<details>
<summary><strong>3. Why does the `updated_at` trigger use BEFORE UPDATE rather than AFTER UPDATE?</strong></summary>

`BEFORE UPDATE` receives the incoming `NEW` row before it's written to disk, can modify
`NEW`, and returns the modified version — which is what PostgreSQL actually writes. An
`AFTER UPDATE` trigger runs after the row is already written. At that point, changing
`NEW` has no effect on the persisted data; you'd have to issue a second UPDATE (which
would fire the trigger again, causing infinite recursion). `BEFORE UPDATE` is the correct
phase for modifying row values before they're committed.
</details>

<details>
<summary><strong>4. You add a new sort option to Feature 11: sort by `company` alphabetically. Would the existing indexes handle this query efficiently? What index would you add?</strong></summary>

None of the existing indexes include `company` as a sort key. The query `WHERE user_id =
$1 ORDER BY company ASC LIMIT 20` would use `idx_jobs_user_id` to filter by user, then
sort all matching rows in memory before applying the limit. To make this efficient, add:
`CREATE INDEX idx_jobs_user_company ON jobs(user_id, company ASC);` — same composite
pattern as the existing date and score indexes, with `company` as the second column.
</details>

<details>
<summary><strong>5. `AgentLogInsert` omits `id`, `created_at`, and `level` from required fields, then adds them back as optional. But `message` is NOT omitted. Why?</strong></summary>

`message TEXT NOT NULL` has no `DEFAULT` clause in the schema — the database cannot
provide a value for it. An INSERT without `message` would fail with a NOT NULL
constraint violation. `id` has `DEFAULT gen_random_uuid()`, `created_at` has `DEFAULT
NOW()`, and `level` has `DEFAULT 'info'` — the database fills those. `message` is the
application's responsibility to supply. The Insert type reflects the true semantics of
what the database requires vs. provides.
</details>

<details>
<summary><strong>6. What would the TypeScript compiler catch if a new value `'contract_to_hire'` was added to `JobType` but the component that renders a job type badge wasn't updated?</strong></summary>

Only if the badge component uses an exhaustive switch with the `never` narrowing pattern.
If it uses `if/else` or a switch without the `never` check, TypeScript would not flag
anything — the new value would fall through to a default case silently. The exhaustive
check pattern (`const _: never = value` in the default branch) is what turns "unhandled
union member" into a compile-time error. Without it, the type system widens the union
but doesn't enforce that every branch is covered.
</details>

---

## Extend it (challenges)

### Challenge 1 — Add a CHECK constraint to the database

`jobs.source` accepts only `'search'` or `'url'` but this is currently enforced only at
the TypeScript layer. Write the SQL `ALTER TABLE` statement to add a `CHECK` constraint
that enforces the same rule at the database level. Then explain: if both the TypeScript
union type and the DB CHECK constraint are enforcing the same rule, which one catches
the error first — and why does having both matter?

<details>
<summary>Hint</summary>

```sql
ALTER TABLE jobs ADD CONSTRAINT jobs_source_check
  CHECK (source IN ('search', 'url'));
```

TypeScript catches at compile time (before any data reaches the DB). The DB constraint
catches at runtime (prevents invalid data even if something bypasses the TypeScript
layer, like a direct SQL tool, a migration script, or a future code path that uses `any`
to escape type checking).
</details>

### Challenge 2 — Write a missing Update type

`types/index.ts` defines Row and Insert types but no explicit Update types (the plan
notes these as implied `Partial<Row>`). Write an explicit `ProfileUpdate` type that:

1. Makes every column optional (partial update — you only send what changed)
2. Excludes `id`, `created_at`, and `updated_at` entirely (you should never be able to
   change these in an update payload — `id` is the immutable PK, the other two are
   DB-managed)
3. Keeps the union type constraints (so you still can't set `experience_level: 'wizard'`)

<details>
<summary>Hint</summary>

```ts
export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
```

`Omit` removes the three uneditable columns. `Partial` makes everything else optional.
The union types (`ExperienceLevel | null`, etc.) are preserved because they come from the
`Profile` interface itself — `Partial` only changes required to optional, not the value
types.
</details>

### Challenge 3 — Predict the index behavior

For each query below, state whether one of the six existing indexes in `schema.sql` can
serve it efficiently (and which one), or whether a full table scan is required:

1. `SELECT * FROM jobs WHERE user_id = $1 ORDER BY match_score DESC LIMIT 10`
2. `SELECT * FROM jobs WHERE match_score >= 70`
3. `SELECT * FROM agent_logs WHERE run_id = $1 ORDER BY created_at ASC`
4. `SELECT * FROM jobs WHERE user_id = $1 AND match_score >= 70 ORDER BY found_at DESC`

<details>
<summary>Reveal answers</summary>

1. ✅ `idx_jobs_user_match_score (user_id, match_score DESC)` — perfect match.
2. ❌ No index helps — `match_score` is not the leftmost column in any index.
   Full scan or a new `(match_score DESC)` index would be needed.
3. ✅ `idx_agent_logs_run_id (run_id)` — filters to the right run. But `ORDER BY
   created_at ASC` still requires a sort on those rows unless a composite `(run_id,
   created_at ASC)` index exists — which it doesn't. Partial help.
4. ❌ No perfect index. The `(user_id, found_at DESC)` composite covers the user filter
   and the date sort but does not filter on `match_score`. PostgreSQL would use
   `idx_jobs_user_found_at` to filter by user and sort, then apply the `match_score >=
   70` condition as a post-scan filter — the index still helps with ordering, but can't
   eliminate the non-matching score rows before the scan.
</details>

---

For deeper exploration, `docs/plan/04-database-schema/ai-discussion-topics.md` has 16
prompts covering JSONB vs. normalized tables, ON DELETE behaviors, append-only
enforcement, `EXPLAIN ANALYZE` usage, migration systems, and Zod runtime validation.
Try answering each one yourself before asking an AI — the act of forming an answer is
where the understanding lands.
