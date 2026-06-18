# Explanation — Feature 04: Database Schema

Deep explanation of every technical decision made during this feature. Written for learning.

---

## Why `profiles.id` is the auth UUID, not a separate generated key

`profiles` is a 1:1 extension of `auth.users`. It exists to hold fields that the auth system does not store — name, skills, work history, preferences. The relationship is not "a profile belongs to a user" — it is "a profile IS the user, with more data."

The shared primary key pattern expresses this directly:
```sql
id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
```

This means `profiles.id` is always the same UUID that `auth.uid()` returns. Every query on the table is `WHERE id = auth.uid()` — no join, no lookup, no indirection. The RLS policy is a single column comparison against the auth context.

The alternative — a surrogate `SERIAL` or `uuid_generate_v4()` PK with a separate `user_id` column — would require a `UNIQUE (user_id)` constraint to enforce the 1:1 relationship (the surrogate PK alone cannot), add a redundant column, and force every downstream table to decide whether to store the profile's surrogate ID or the user's auth UUID. The auth UUID is what every system already knows, so you would always end up using `user_id` — which is exactly what the shared PK gives you as `id`.

All other tables (`jobs`, `agent_runs`, `agent_logs`) correctly use their own UUID PKs with a separate `user_id` FK. Those are 1:many relationships — one user has many jobs, many runs, many logs. Each row has its own identity independent of the user.

---

## Why the profile row is created on first save, not on signup

Feature 06 (Profile Save) creates the `profiles` row using upsert:
```sql
INSERT INTO profiles (id, email, ...)
VALUES (auth.uid(), ...)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, ...;
```

The alternative would be to create an empty profile row immediately after OAuth login, in `app/api/auth/callback/route.ts`. This would guarantee the row exists before any foreign key reference to it.

The callback approach was rejected for two reasons:

1. **Feature 02 is complete and tested.** The callback does one job — exchange the OAuth code for a session, set cookies, redirect to `/dashboard`. Adding a database write to it mixes concerns and introduces a new failure mode (what happens if the DB write fails mid-callback?).

2. **Upsert is idempotent.** Whether the profile row exists or not, `ON CONFLICT (id) DO UPDATE` handles both cases correctly. There is no need for a separate creation step.

The RLS INSERT policy (`WITH CHECK (id = auth.uid())`) ensures the upsert can only create a row for the authenticated user — no other user's profile can be created through this path.

---

## Why `updated_at` is managed by a DB trigger, not application code

The `profiles` table has `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. The default sets it correctly on INSERT. On UPDATE, the default does not fire — the column is only set to `NOW()` if application code explicitly includes it in the update payload.

Several features write to profiles: Feature 06 (save form), Feature 07 (AI extraction overwrites fields), Feature 08 (resume generation updates `resume_pdf_url`). Each of these is a separate code path. Application-level `updated_at` management requires every path to remember to include it.

The trigger removes this from application code entirely:
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

`BEFORE UPDATE` means the function receives the incoming `NEW` row before it is written. It overwrites `NEW.updated_at` with `NOW()` and returns the modified row. The database writes that row. No application code participates.

The function is defined with `CREATE OR REPLACE` so it can be updated safely without dropping the trigger. The trigger is `FOR EACH ROW`, meaning it fires once per updated row (not once per statement — relevant for bulk updates).

---

## Why RLS policies need both `USING` and `WITH CHECK`

PostgreSQL distinguishes two phases of a policy:

- **`USING`** — the visibility filter. Applied on SELECT, UPDATE (to determine which rows can be seen and modified), and DELETE (to determine which rows can be deleted).
- **`WITH CHECK`** — the write guard. Applied on INSERT and UPDATE to validate what can be written.

For a policy like:
```sql
CREATE POLICY "jobs: insert own" ON jobs
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

`WITH CHECK` prevents a user from inserting a row with a `user_id` that is not their own. Without it, a malicious client could insert `{ user_id: 'someone-elses-uuid', ... }` and create data attributed to another user.

For SELECT:
```sql
CREATE POLICY "jobs: select own" ON jobs
  FOR SELECT USING (user_id = auth.uid());
```

`USING` filters the result set. Rows where `user_id != auth.uid()` are invisible — they are not returned, not even as "access denied" errors. The user simply cannot see them.

For UPDATE, both apply: `USING` controls which rows can be targeted, and `WITH CHECK` (if specified) validates the modified values. In this schema, the UPDATE policies only use `USING` — meaning a user can update their own rows to any valid value, including changing `user_id`. In production, adding `WITH CHECK (user_id = auth.uid())` to UPDATE policies would prevent a user from re-attributing a row to another user's account.

---

## How composite indexes serve both RLS and sort operations

Feature 11 sorts `jobs` by `found_at` (newest/oldest) and by `match_score`. Both queries filter by `user_id` first (via RLS) and then sort.

Without the composite index, the query planner must:
1. Use `idx_jobs_user_id` to find all rows where `user_id = auth.uid()` — returns, say, 500 rows
2. Load those 500 rows into memory
3. Sort them by `found_at DESC`
4. Return the first 20

With `idx_jobs_user_found_at ON jobs(user_id, found_at DESC)`:
1. Scan the composite index starting at `(user_id, MAX_FOUND_AT)` and walk in descending order
2. Return rows in order as they come from the index — no separate sort step
3. Stop after 20 rows — no need to read all 500

The index encodes the sort order. The query planner can traverse it in the desired direction and stop early. This is called an "index scan" vs a "sort on fetch" — for paginated queries returning a small subset, the difference in latency is significant.

The leftmost column of a composite index must match the filter. `(user_id, found_at DESC)` can serve `WHERE user_id = $1 ORDER BY found_at DESC` — user_id is filtered as equality, found_at is the sort key. It cannot serve `WHERE found_at > $1` alone (user_id is not in the query) or `ORDER BY found_at DESC` without a user_id filter.

---

## How `scripts/schema.sql` and the live database relate

`scripts/schema.sql` is a reference document, not a migration system. It was written first and then executed against the live database via `run-raw-sql`. The two are in sync at the time of Feature 04.

They will diverge the moment any `ALTER TABLE` is run directly without updating the file — adding a column, changing a default, dropping an index. The file has no enforcement mechanism.

For the current project stage (solo developer, initial schema), this is acceptable. The trade-off is known and documented in the file header. When the project needs a second environment or a second developer, the correct response is to introduce a migration system (Supabase CLI migrations, Prisma Migrate) rather than to rely on keeping the file current by hand.

---

## Why `types/index.ts` includes `Insert` variants

A database table has three distinct type surfaces:

1. **Row** — what a SELECT query returns. All NOT NULL columns are always present. Nullable columns may be null.
2. **Insert** — what an INSERT requires. Columns with DB defaults (`id DEFAULT gen_random_uuid()`, `created_at DEFAULT NOW()`) are optional — the database fills them. Columns without defaults that are NOT NULL are required.
3. **Update** — what an UPDATE accepts. Every column is optional — you only send what you want to change.

Using one interface for all three is a common mistake. A `Profile` interface with `created_at: string` as required makes a TypeScript error when you try to insert a new profile without providing `created_at` — but the database would have set it automatically. The `ProfileInsert` type makes `created_at` optional, reflecting the real semantics.

The `Insert` types were derived from the live schema: required fields are those where `isNullable: NO` and `columnDefault: null` (no default). Optional fields are those where either `isNullable: YES` or `columnDefault` is set.

---

## Why literal union types instead of plain `string`

Columns like `experience_level`, `source`, `status`, and `level` accept only a fixed set of values. The database stores them as `TEXT` — no constraint is enforced at the DB level. TypeScript can enforce this instead:

```typescript
export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead'
```

With `experience_level: ExperienceLevel | null` in the `Profile` interface, TypeScript will catch:
```typescript
const profile: ProfileInsert = {
  experience_level: 'expert' // TypeScript error — not in the union
}
```

Without the union type, `experience_level: string` accepts any string. The bug would only surface at runtime when the UI renders an unexpected value or a query filters on it.

Union types also enable exhaustive checks in switch statements:
```typescript
switch (profile.experience_level) {
  case 'junior': ...
  case 'mid': ...
  case 'senior': ...
  case 'lead': ...
  default:
    const _: never = profile.experience_level // TypeScript error if a case is missing
}
```

If a new level is added to the union later, every switch statement without a case for it becomes a compile error — the compiler tells you every place in the codebase that needs updating.
