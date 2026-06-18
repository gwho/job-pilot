# AI Discussion Topics — Feature 04 Architect Session

Use these prompts to go deeper on the concepts explored during this architect session.

---

## PostgreSQL Row Level Security

1. "Walk me through exactly what happens inside the PostgreSQL query planner when a RLS policy is applied to a SELECT query. At what point in query execution does the policy condition get evaluated?"

2. "What is the difference between USING and WITH CHECK in a PostgreSQL RLS policy? Why does INSERT use WITH CHECK while SELECT uses USING, and what would happen if you swapped them?"

3. "Can a PostgreSQL RLS policy be bypassed? What roles or connection settings allow bypassing RLS, and why does this matter for a BaaS platform like InsForge?"

4. "How does auth.uid() work inside a PostgreSQL RLS policy in a Supabase-compatible system? What sets this value per connection, and what happens if the JWT is missing or expired?"

5. "What are row security policies in 'permissive' vs 'restrictive' mode in PostgreSQL? When would you use restrictive policies and how do they interact with permissive ones?"

---

## PostgreSQL Indexing Strategy

6. "Explain how a B-tree index on (user_id, found_at DESC) works internally. Why does column order in a composite index matter, and what queries can and cannot use this index?"

7. "What is an index-only scan in PostgreSQL and when does it apply? Could any of the indexes in this schema benefit from covering additional columns to enable index-only scans?"

8. "PostgreSQL has several index types: B-tree, Hash, GIN, GiST, BRIN. The schema uses B-tree for all indexes. Under what circumstances would a different index type be better for a column in this schema — for example, for the skills TEXT[] column or the company_research JSONB column?"

9. "What does it mean for an index to become 'bloated' in PostgreSQL? What causes this, how does it affect query performance, and how is it addressed?"

10. "How does PostgreSQL decide whether to use an index or a sequential scan? Walk me through how the planner estimates the cost of each approach for a query like 'SELECT * FROM jobs WHERE user_id = $1 ORDER BY found_at DESC LIMIT 20'."

---

## Database Schema Design

11. "Walk me through the concept of a 'shared primary key' relationship in relational databases. What is the formal name for this pattern, and in what other real-world scenarios is it the right choice besides user profile extension tables?"

12. "The jobs table has run_id as a nullable foreign key (NULL when source = 'url'). This means a job row doesn't always have a parent run. Is this good schema design, or would a cleaner approach be to use two separate tables — one for search-discovered jobs and one for URL-discovered jobs? What are the trade-offs?"

13. "The architecture uses TEXT for columns like experience_level and source where only a fixed set of values are valid. An alternative is a PostgreSQL ENUM type. Compare TEXT with CHECK constraint vs ENUM for this use case — what are the trade-offs, especially for a BaaS platform?"

14. "The jobs table stores structured data in TEXT arrays (responsibilities, requirements, skills) and in JSONB (company_research). When should you choose JSONB over arrays, and when should you choose a separate normalized table over either?"

15. "What is the difference between ON DELETE CASCADE, ON DELETE SET NULL, and ON DELETE RESTRICT on a foreign key? Walk through how each would behave if a user account was deleted in this schema, and why each table in this schema was given its specific delete rule."

---

## Database Migrations and Schema Management

16. "Compare Supabase CLI migrations, Prisma Migrate, and Flyway as migration tools. If this project outgrows the 'direct SQL' approach, which would you recommend for a Next.js + Supabase-compatible BaaS project and why?"

17. "What is a 'zero-downtime migration' and why is it hard? Walk through the specific steps required to safely add a NOT NULL column to the jobs table in production without downtime."

18. "Explain the concept of 'schema drift' in database management. What are the most common ways drift occurs in BaaS projects, and what tooling or processes prevent it?"

19. "What is database schema versioning and how is it different from application versioning? How do tools like Flyway or Liquibase use checksums and a schema history table to manage this?"

---

## TypeScript Type Systems for Databases

20. "The Supabase CLI generates Row, Insert, and Update variants for every table. Explain why these three variants are semantically different and give a concrete example where using the wrong variant would compile but cause a runtime error."

21. "The types/index.ts file uses literal union types (e.g. 'junior' | 'mid' | 'senior' | 'lead') instead of plain string. What does TypeScript's type narrowing allow you to do with these union types that you cannot do with string? Show an example with a switch statement."

22. "Tools like Drizzle ORM, Prisma, and kysely take different approaches to TypeScript type safety for database queries. Compare their approaches — schema-first vs query-first vs type-safe query builder — and when each is the right choice."

23. "What is the difference between a TypeScript interface and a type alias for database row types? Is there a practical reason to prefer one over the other for this use case?"

---

## BaaS Architecture

24. "InsForge and Supabase are BaaS platforms with direct database access for clients via RLS. Compare this architecture to a traditional three-tier architecture (client → API server → database). What does BaaS trade away in exchange for simplicity, and at what scale do those trade-offs become significant?"

25. "The CLAUDE.md says 'all server-side InsForge writes use createInsforgeServer() — never the browser client.' Explain the security reason for this rule. What could go wrong if a Server Action used the browser client to write to the database?"
