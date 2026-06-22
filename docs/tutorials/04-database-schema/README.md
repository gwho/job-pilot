# Tutorial 04 — Database Schema, Row Level Security, & TypeScript Integration

**After completing this tutorial you will understand:** how to design relational database schemas on top of InsForge (PostgreSQL), why Shared Primary Keys are superior for 1:1 user profile tables, how PostgreSQL Row Level Security (RLS) gates data access at the engine layer, how indexes optimize RLS filter paths, and how to map database structures to strict TypeScript type systems.

> [!NOTE]
> **Prerequisites:** Basic knowledge of SQL (tables, primary/foreign keys), relational databases, and TypeScript interfaces. Open your editor to [scripts/schema.sql](file:///Users/jessejames/Desktop/job-pilot/scripts/schema.sql) and [types/index.ts](file:///Users/jessejames/Desktop/job-pilot/types/index.ts) to follow along.

---

## How To Use An LLM Before This Tutorial

Use an LLM to rehearse relational database basics before reading the JobPilot schema.
Ask it for tiny examples, then return here and map the ideas to `profiles`,
`agent_runs`, `jobs`, and `agent_logs`.

Prompt 1:

```text
Teach me primary keys, foreign keys, ON DELETE CASCADE, and ON DELETE SET NULL.
Use a users -> projects -> tasks example. Then quiz me on what gets deleted or kept.
```

Prompt 2:

```text
Explain PostgreSQL Row Level Security in beginner-friendly terms.
Use a table with user_id and a policy using auth.uid(). Ask me to predict which rows two
different users can see.
```

Prompt 3:

```text
Teach me why indexes matter for queries that filter by user_id and sort by created_at.
Compare a single-column index with a composite index.
```

Practice before continuing:

- Explain why a 1:1 profile table can use the auth user UUID as its primary key.
- Predict when `ON DELETE CASCADE` is safer than `ON DELETE SET NULL`.
- Say why every user-owned table needs an RLS policy.

---

## Core Architecture Diagram

This diagram shows how the database tables relate, how access is gated by RLS policies using `auth.uid()`, and how indexes speed up the database planner:

```
                  ┌───────────────────────┐
                  │      auth.users       │  (InsForge Internal)
                  └──────────┬────────────┘
                             │ (1:1 Shared PK Link)
                             ▼
                  ┌───────────────────────┐
                  │       profiles        │  ◄── RLS Check: USING (id = auth.uid())
                  └────┬──────────────┬───┘
                       │              │
                       │ (1:N FK)     │ (1:N FK)
                       ▼              ▼
  ┌───────────────────────┐        ┌───────────────────────┐
  │      agent_runs       │        │         jobs          │  ◄── RLS Check: USING (user_id = auth.uid())
  └──────────┬────────────┘        └───────────────────────┘
             │                               ▲
             │ (1:N FK)                      │ (1:N FK)
             ▼                               │
  ┌──────────────────────────────────────────┴┐
  │              agent_logs                   │  ◄── RLS Check: USING (user_id = auth.uid())
  └───────────────────────────────────────────┘

Performance Optimization:
  - idx_jobs_user_found_at (user_id, found_at DESC) -> speeds up RLS filters AND sorts matching jobs
  - idx_agent_runs_user_id (user_id) -> optimizes recent run fetches
  - idx_agent_logs_user_id (user_id) -> speeds up logging scans
```

---

## 1. Database Schema Walkthrough

Let's examine [scripts/schema.sql](file:///Users/jessejames/Desktop/job-pilot/scripts/schema.sql) to see the four tables created for the JobPilot application:

### 1.1 The User Extension: `profiles`
The `profiles` table stores detailed information about the job seeker. It has a strict 1-to-1 relationship with the authenticated user.

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT,
  email               TEXT,
  skills              TEXT[]      DEFAULT '{}',
  work_experience     JSONB       DEFAULT '[]',
  education           JSONB       DEFAULT '{}',
  is_complete         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Shared Primary Key Design Choice
Notice that the table does **not** have an auto-incrementing integer key like `serial primary key` or a generated UUID default. Instead, `id UUID PRIMARY KEY` directly references `auth.users(id)`.
* This ensures that **a user can have at most one profile** (enforced by the Primary Key uniqueness constraint).
* It eliminates joins or lookups to find a user's profile UUID; the profile ID is the exact same as the logged-in user's UUID.
* `ON DELETE CASCADE` guarantees that if a user deletes their account, their profile row is purged instantly by PostgreSQL.

---

### 1.2 The Orchestrators: `agent_runs` & `agent_logs`
When the background agent executes a job discovery or tailoring search, it needs to log its status and progress:

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'running',
  jobs_found          INTEGER     DEFAULT 0,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  level       TEXT        NOT NULL DEFAULT 'info',
  job_id      UUID        REFERENCES jobs(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
* **Foreign Keys**: `agent_runs` is owned by a specific profile (`user_id`).
* **Nullable Fields**: In `agent_logs`, `job_id` and `run_id` are nullable. If an error happens outside the context of a job or a run, the log row can still exist.
* **Cascades**: When an `agent_run` is deleted, its logs are deleted automatically (`ON DELETE CASCADE`), but if a `job` is deleted, the log entry preserves the message by setting the field to null (`ON DELETE SET NULL`).

---

### 1.3 Discovered Listings: `jobs`
The `jobs` table holds the results found by the agent, along with scoring metrics and company dossiers.

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID        REFERENCES agent_runs(id) ON DELETE SET NULL,
  user_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source              TEXT        NOT NULL, -- 'search' or 'url'
  title               TEXT,
  company             TEXT,
  match_score         INTEGER,
  match_reason        TEXT,
  company_research    JSONB,
  found_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
* `run_id` is nullable. If the user discovers a job by entering a direct URL (rather than via the Adzuna search agent), the source is set to `'url'` and `run_id` remains `NULL`.

---

## 2. Row Level Security (RLS) Mechanics

Because clients interact directly with the InsForge REST API, **anyone with the public API key can execute requests against the tables**. Without security, any user could read another user's search runs or profile.

We secure this using PostgreSQL **Row Level Security (RLS)**:

```sql
-- Enable RLS on all tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Create access policies
CREATE POLICY "jobs: select own" ON jobs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "jobs: insert own" ON jobs
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

### 💡 How the Query Planner Handles RLS
When you execute `SELECT * FROM jobs` from the client, PostgreSQL automatically modifies the query under the hood to become:
```sql
SELECT * FROM jobs WHERE user_id = auth.uid();
```
`auth.uid()` reads the User ID embedded inside the authenticated request JWT. 

### `USING` vs `WITH CHECK`
* **`USING`**: Applies to read operations (`SELECT`, `UPDATE`, `DELETE`). It filters out rows that don't match the condition.
* **`WITH CHECK`**: Applies to write operations (`INSERT`, `UPDATE`). It validates that the *new or updated data* you are attempting to write matches the condition. If you try to insert a job with a `user_id` belonging to a different user, PostgreSQL rejects the insert.

---

## 3. Database Indexing Strategy for RLS

Every query is automatically injected with `WHERE user_id = auth.uid()` or `WHERE id = auth.uid()`. 
Without indexes, PostgreSQL must perform a **Sequential Scan** (read every row in the table) to verify who owns the row. As the database grows, queries slow down.

To fix this, we created several key indexes:

```sql
-- Optimize RLS queries for jobs
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

-- Optimize RLS queries + sorting by date (Feature 11)
CREATE INDEX IF NOT EXISTS idx_jobs_user_found_at ON jobs(user_id, found_at DESC);

-- Optimize RLS queries + sorting by match score (Feature 11)
CREATE INDEX IF NOT EXISTS idx_jobs_user_match_score ON jobs(user_id, match_score DESC);
```

### Composite Indexes
The index `idx_jobs_user_found_at ON jobs(user_id, found_at DESC)` is a **composite index**. 
When Next.js runs:
```sql
SELECT * FROM jobs WHERE user_id = $1 ORDER BY found_at DESC LIMIT 20;
```
The database planner uses this index to jump directly to the user's rows AND read them in descending order in a single operation. This avoids loading the rows into memory and sorting them separately (a "File Sort").

---

## 4. The Database Trigger Pattern

To track when profiles are modified, we keep `updated_at` timestamps accurate. Instead of requiring the Next.js Server Action to manually submit `updated_at: new Date().toISOString()`, we enforce it via a database trigger:

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
* Every time an `UPDATE` executes on `profiles`, the function intercepts the row, sets `NEW.updated_at = NOW()`, and passes it to be written. This ensures the update timestamp can never drift or be omitted.

---

## 5. TypeScript Types Integration

Let's study the types in [types/index.ts](file:///Users/jessejames/Desktop/job-pilot/types/index.ts). We define three categories of types for our database schema:

### 5.1 Constrained Unions
Instead of typing fields as `string`, we define strict TypeScript union types representing database check constraints:

```typescript
export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead';
export type JobSource = 'search' | 'url';
export type AgentRunStatus = 'running' | 'completed' | 'failed';
```

### 5.2 JSONB Sub-Interfaces
For JSONB columns (which PostgreSQL stores as binary JSON blobs), we define standard TypeScript shapes:

```typescript
export interface WorkExperienceEntry {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  current: boolean;
  responsibilities: string;
}
```

### 5.3 Select (Row) vs Insert Helpers
When you fetch a row, every database column is populated. But when you **insert** a row, columns with default values (like primary key UUIDs, timestamps, booleans defaulted to false) are optional. 

We separate these concerns:

```typescript
// The SELECT shape (what database queries return)
export interface Job {
  id: string;
  run_id: string | null;
  user_id: string;
  source: JobSource;
  title: string | null;
  company: string | null;
  match_score: number | null;
  found_at: string;
}

// The INSERT shape (what you supply to create a new row)
// Columns with DB defaults ('id', 'found_at') are made optional.
export type JobInsert = Omit<Job, 'id' | 'found_at'> & {
  id?: string;
  found_at?: string;
};
```

This prevents TypeScript compile-time errors when inserting new records without manually supplying database-generated default fields.

---

## 6. Self-Check Quiz

Test your architectural understanding!

**1. Why is `id UUID PRIMARY KEY REFERENCES auth.users(id)` used on the `profiles` table instead of an auto-incrementing integer key?**

<details>
<summary>Reveal answer</summary>

It enforces a strict 1-to-1 relationship between `auth.users` and `profiles` at the database engine level (each user can have exactly one profile). It also keeps foreign key relationships simple and eliminates the need to join a separate primary key when querying profiles for an authenticated user.

</details>

---

**2. What is the execution difference between `USING` and `WITH CHECK` clauses in an RLS policy?**

<details>
<summary>Reveal answer</summary>

* **`USING`** acts as a filter query extension, checking if the current rows in the database match the criteria (used for `SELECT`, `UPDATE`, `DELETE`).
* **`WITH CHECK`** acts as a constraint validation, verifying that the new data you are attempting to write or update matches the criteria (used for `INSERT`, `UPDATE`).

</details>

---

**3. If you run `SELECT * FROM jobs ORDER BY match_score DESC` on a table of 100,000 rows, how does a composite index on `(user_id, match_score DESC)` speed this up under RLS?**

<details>
<summary>Reveal answer</summary>

The RLS policy automatically appends `WHERE user_id = auth.uid()` to the query. The composite index filters by `user_id` and has the rows pre-sorted by `match_score` in descending order. PostgreSQL can fetch the exact matching rows sorted in order without reading non-matching rows and without executing an expensive in-memory sort.

</details>

---

**4. Why is `ON DELETE SET NULL` chosen for `agent_logs.job_id` instead of `ON DELETE CASCADE`?**

<details>
<summary>Reveal answer</summary>

If a job listing is deleted, we still want to keep the historical operation logs of the agent's run intact. `ON DELETE SET NULL` clears the association on the log record but keeps the log row itself, whereas `ON DELETE CASCADE` would delete the logs.

</details>

---

**5. What is the benefit of defining `ProfileInsert` separately from the base `Profile` interface?**

<details>
<summary>Reveal answer</summary>

When inserting a new profile, we don't have columns like `created_at` or `updated_at` yet, since the database generates them automatically. Typing the payload as `ProfileInsert` allows us to omit those fields in our Server Action write calls without triggering TypeScript compilation errors.

</details>

---

## 7. Extend It (Challenges)

Test your knowledge with these database extension exercises.

---

### Challenge 1 — Design a Cover Letters Table
Write the SQL DDL statements to create a new table called `cover_letters`.
* Each row represents a tailored cover letter generated for a job.
* Core columns: `id` (UUID PK), `job_id` (UUID foreign key linking to `jobs`), `user_id` (UUID FK linking to `profiles`), `content` (TEXT), `created_at` (TIMESTAMPTZ default now).
* **Constraints**: If the associated `job` is deleted, delete the cover letter automatically.
* **RLS**: Limit SELECT/INSERT/UPDATE/DELETE actions only to the owning user.
* **Indexes**: Create a composite index to optimize retrieving cover letters for a specific user sorted by creation date.

*Draft your SQL script and verify it handles RLS and cascades correctly.*

---

### Challenge 2 — Type Mapping the Challenge
Write the TypeScript interfaces for the `cover_letters` table you designed in Challenge 1. 
* Create the `CoverLetter` interface representing the selected row.
* Create the `CoverLetterInsert` type helper showing which fields are optional when inserting a new letter.
