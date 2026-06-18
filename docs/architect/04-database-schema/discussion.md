# Architect Session — Feature 04: Database Schema

This document records every decision and topic explored during the `/architect` session for Feature 04. It is written for learning — not just what was decided, but why, what the alternatives were, and what the underlying concepts mean.

---

## Decisions Made

### Decision 1 — When does the `profiles` row get created?

**The question:** A `profiles` row must exist before any other table can reference it via foreign key. When should that row be created?

**Option A — Auto-create in the OAuth callback:**
Right after a successful login, `app/api/auth/callback/route.ts` inserts a minimal profile row with just `id` and `email`. Every subsequent profile save is then always an UPDATE — the row always exists.

**Option B — Create on first profile save (chosen):**
The profile save Server Action (Feature 06) uses an upsert — `INSERT ... ON CONFLICT (id) DO UPDATE SET ...`. If no row exists, it creates one. If a row exists, it updates it.

**Why Option B:**
Feature 02 (the OAuth callback) is complete, tested, and closed. It does one job: exchange the OAuth code for a session and redirect to `/dashboard`. Adding a database write to it mixes concerns and risks breaking something that already works.

The RLS INSERT policy — `WITH CHECK (id = auth.uid())` — ensures the upsert can only create a row for the currently authenticated user.

**The invariant this creates for Feature 06:** The save action must always use upsert, never a plain INSERT followed by a separate UPDATE path.

---

### Decision 2 — Are TypeScript types in scope for Feature 04?

**The question:** `types/index.ts` does not exist. Should it be created as part of Feature 04 (immediately after the schema is created), or deferred until the first feature that needs it?

**Why now:**
The right moment to define types is immediately after the schema exists, when every column's name, type, and nullability is fresh and confirmed from a real database. Deferring means either:
- Each feature defines its own ad-hoc types, which diverge and become inconsistent
- Or someone writes types from memory later, getting nullability wrong

Types written from the live `get-table-schema` output are the most accurate types possible. That window is now.

**What was added beyond simple row types:**
- Literal union types for constrained text columns (`ExperienceLevel`, `JobSource`, `AgentRunStatus`, etc.) so TypeScript catches invalid values at compile time, not at runtime
- Named sub-types for JSONB columns (`WorkExperienceEntry`, `Education`, `CompanyResearchDossier`) so JSON blobs are typed precisely
- `Insert` variants for all four tables, with optional fields for columns that have DB defaults

---

### Decision 3 — `updated_at` via DB trigger vs application code

**The question:** The `profiles` table has an `updated_at` column. Who keeps it current?

**Option A — DB trigger (chosen):**
A `BEFORE UPDATE` trigger function runs inside the database every time a profile row is saved. No application code needs to think about it.

**Option B — Application-level:**
Every Server Action that saves a profile manually sets `updated_at: new Date().toISOString()` in the update payload.

**Why the trigger:**
Application-level is a discipline problem, not a design. Every path that saves a profile must remember to include `updated_at`. Feature 06 saves the profile. Feature 07 (AI extraction) may also save it. Feature 08 (resume generation) saves the `resume_pdf_url`. Each of those paths is a place where a developer can forget.

The trigger makes the invariant structural. The database enforces it unconditionally. No application code can skip it accidentally.

**How the trigger works:**
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
`BEFORE UPDATE` means the function runs before the row is written. It receives the incoming `NEW` row record, overwrites `updated_at` with the current time, and returns the modified record. The database then writes that record.

---

### Decision 4 — Schema execution: MCP tools directly vs migrations file

**The question:** How should the schema be created and tracked?

**Option A — Migration files in git:**
Each schema change is a sequentially numbered SQL file. A migration runner tracks which files have been applied. Replaying all files produces an identical schema on any environment.

**Option B — Direct SQL via InsForge MCP tools (chosen):**
`run-raw-sql` executes DDL directly against the database. A `scripts/schema.sql` file is kept as a reference, but it is documentation, not enforced.

**Why Option B for this project:**
JobPilot is a solo early-stage project on a BaaS platform. The schema is being created once, not evolved collaboratively across multiple environments. Migration tooling adds overhead — a CLI to configure, a process to follow, conflict resolution when two migrations land at the same time.

**The known trade-off:**
The `scripts/schema.sql` file documents the initial schema state. Future `ALTER TABLE` statements — adding a column in Feature 06, adjusting a default — are not automatically reflected there. The file and the database can diverge silently.

When this trade-off matters: a second developer, a staging environment, disaster recovery from scratch. At that point, proper migration management (Supabase CLI, Prisma, Flyway) should be introduced.

---

## Topics Explored in Depth

### PostgreSQL Row Level Security and Index Performance

**What RLS does under the hood:**
A RLS policy is syntactic sugar for a WHERE clause the database appends to every query automatically. This policy:
```sql
CREATE POLICY "jobs: select own" ON jobs
  FOR SELECT USING (user_id = auth.uid());
```
turns every `SELECT * FROM jobs` into `SELECT * FROM jobs WHERE user_id = auth.uid()` at the database level. The query planner treats the RLS condition exactly like any other WHERE clause.

`auth.uid()` is called once per query, not once per row — it reads from the current session context. It adds no per-row overhead. The performance question is purely whether the WHERE condition can use an index.

**Why indexes matter for RLS:**
Without an index on `user_id`, PostgreSQL performs a sequential scan — reads every row in the table, evaluates `user_id = auth.uid()` for each one, and returns matches. For a table with 50,000 rows across all users, this is slow even if only 200 of those rows belong to the current user.

With an index on `user_id`, PostgreSQL jumps directly to the matching rows. The scan is proportional to the number of matching rows, not the total table size.

**Composite indexes for combined filter + sort:**
When a query filters by `user_id` AND sorts by a column (like `found_at` or `match_score`), a composite index on both columns eliminates a separate sort step:
```sql
CREATE INDEX idx_jobs_user_found_at ON jobs(user_id, found_at DESC);
```
PostgreSQL traverses the index in order — it finds the user's rows AND gets them in date order in a single scan. Without this index, it would find the user's rows, load them into memory, then sort them — two operations instead of one.

**Indexes added and why:**

| Index | Table | Covers |
|-------|-------|--------|
| `idx_jobs_user_id` | jobs | RLS filter |
| `idx_jobs_user_found_at` | jobs | RLS filter + Feature 11 date sort |
| `idx_jobs_user_match_score` | jobs | RLS filter + Feature 11 match sort |
| `idx_agent_logs_user_id` | agent_logs | RLS filter |
| `idx_agent_logs_run_id` | agent_logs | Fetch logs for a specific run |
| `idx_agent_runs_user_id` | agent_runs | RLS filter + Feature 16 recent activity |

`profiles` needs no additional index — its primary key (`id`) is indexed automatically, and all profile queries filter by `id = auth.uid()` which hits the PK index directly.

**Why add them now vs later:**
Indexes are cheap to add at table creation time — no data exists yet, so no rebuild cost. Adding an index to a live table with millions of rows requires a full table scan to build the index, which takes time and can lock the table. The habit of indexing foreign keys and common filter columns at schema creation is standard practice for exactly this reason.

---

### Shared Primary Key vs Surrogate Key for the `profiles` Table

**The two patterns:**

Shared primary key (what `profiles` uses):
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ...
);
```
`profiles.id` is the user's auth UUID. The row's identity and the user's identity are the same value.

Surrogate key (the alternative):
```sql
CREATE TABLE profiles (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ...
);
```
`profiles` has its own identity (`id = 1, 2, 3`) and separately points at a user via `user_id`.

**Why shared PK is correct for a 1:1 relationship:**

1. **The 1:1 constraint is enforced for free.** A surrogate key requires `UNIQUE (user_id)` to prevent two profile rows for the same user. The shared PK enforces this through the primary key constraint — you cannot insert a second row with the same `id`.

2. **The surrogate key column is redundant.** For a 1:1 table, you have two columns (`id` and `user_id`) that both identify the same entity. One of them is not earning its place.

3. **The semantic is more accurate.** `profiles` is an extension of `auth.users` — it holds fields the auth system doesn't store. Shared PK says "this row IS the user, with more data." Surrogate key says "this row HAS a user." The first framing is accurate for an extension table.

4. **RLS and joins use the same UUID throughout.** Every query on profiles uses `WHERE id = auth.uid()`. Every downstream table (`jobs`, `agent_runs`) stores `user_id` which is the same UUID. There is no ambiguity about which column to join on.

5. **No orphan row risk.** With a shared PK referencing `auth.users(id)`, the profile row cannot exist without a valid auth user. The foreign key constraint enforces this. With a surrogate key, a misconfigured INSERT could create a profile row with a null or invalid `user_id` if the FK constraint is missing.

**Where surrogate keys are correct:**
`jobs`, `agent_runs`, and `agent_logs` all have their own UUID PKs with separate `user_id` FKs. That is right — those are 1:many relationships. One user has many jobs. A job has its own identity independent of the user. The shared PK pattern applies only to strict 1:1 extension tables.

---

### Direct SQL Schema Management vs Migration Files (expanded)

**Migration files — the full model:**

Migration tools (Supabase CLI, Flyway, Prisma, Liquibase) track which SQL files have been applied to each database environment. The workflow is:
1. Developer creates `migrations/001_create_profiles.sql`
2. Tool applies it to the target database and records it as applied
3. Next time the tool runs, it only applies new files — `001` is skipped
4. A new environment gets the full history applied in order

Benefits:
- **Reproducibility** — any environment can be built from scratch by replaying the sequence
- **History** — every schema change is a git diff with a commit message
- **Collaboration** — multiple developers can make schema changes without stepping on each other
- **Rollback** — down migrations allow reverting to any prior state
- **CI/CD** — migrations run automatically as part of deploy; production is never behind the code

Costs:
- Migration tooling must be configured and maintained
- Every schema change must go through the migration process — discipline required
- Sequence number conflicts when two developers create migrations simultaneously

**Direct SQL — what you give up:**

The `scripts/schema.sql` file documents the initial state. It has no enforcement mechanism. If an `ALTER TABLE` is run directly and the file is not updated, the file and the real database diverge silently. The only way to know the real schema is to query the database.

There is no rollback path — mistakes require a corrective `ALTER TABLE`. There is no history beyond what git shows for the initial file. Setting up a second environment requires manually running the SQL against a fresh database, which requires the file to be current and accurate.

---

### TypeScript Type Generation vs Manual Types

**How automatic generation works:**

Type generation tools (Supabase CLI `gen types typescript`, Prisma `db pull`, kysely-codegen) connect to a live PostgreSQL database, read the information schema, and produce TypeScript types that exactly match what the database contains. No human writes them — the database is the source of truth.

The Supabase CLI (relevant since InsForge is Supabase-compatible) generates:
```typescript
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; full_name: string | null; ... }
        Insert: { id: string; full_name?: string | null; ... }
        Update: { id?: string; full_name?: string | null; ... }
      }
    }
  }
}
```
Three variants per table: `Row` (what SELECT returns), `Insert` (what INSERT requires), `Update` (all fields optional for partial updates).

**Benefits of generation:**
- **Schema is the single source of truth.** Adding a column in SQL automatically surfaces as a TypeScript error on the next regeneration — everywhere that column should be handled but isn't.
- **Nullability is always correct.** Generated types read the `isNullable` constraint from the DB. Manual types frequently get this wrong — writing `salary: string` when the column is `TEXT NULL`.
- **No maintenance burden.** Types cannot drift from the schema if they are always generated from it.
- **Three variants per table.** `Row`, `Insert`, `Update` reflect the real semantics of each operation. Manual types typically use one interface for all three, which is semantically wrong.

**What manual types trade away:**
Every future schema change requires manually updating `types/index.ts`. If a column is added and the file is not updated, TypeScript does not know the column exists — code that could use it won't, and there is no compile-time signal that anything is wrong. The types and the schema can diverge quietly.

**Why manual types were chosen here:**
The schema is being defined once, not evolving rapidly. The types were written immediately after the live schema was verified via `get-table-schema`, so they are anchored to the real schema rather than a documentation file. For a solo project at this stage, the overhead of configuring and running a generation tool on every schema change is not justified.

When generation becomes worth it: when the schema is changing frequently, when multiple developers are making schema changes, or when the drift between types and schema has caused a bug once.

---

## How These Decisions Connect

All four decisions reinforce each other:

- Shared PK on `profiles` means the upsert in Feature 06 targets `id` — the same UUID already in `auth.uid()`. No separate lookup needed.
- The upsert approach (Decision 1) means the INSERT RLS policy must allow `auth.uid() = id`, which it does.
- The DB trigger (Decision 3) means no `Insert` type for profiles needs to include `updated_at` — the DB handles it.
- The types (Decision 2) include `Insert` variants that reflect these DB defaults, so Feature 06's save action can omit `created_at`, `updated_at`, and `is_complete` from the insert payload without TypeScript complaining.
- The indexes ensure that when Feature 06's profile save triggers a page revalidation and the dashboard re-queries `jobs`, `agent_runs`, and `agent_logs`, the RLS filter does not scan the full table.
