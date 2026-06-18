# Database & Infrastructure Architectural Decisions

This document outlines the architectural decisions for **Feature 04 — Database Schema** in the JobPilot application. It resolves the core infrastructure questions regarding InsForge database schema, storage bucket configuration, RLS policies, and global TypeScript type definitions.

---

## 1. Architectural Alignment: Question Breakdown

### 1.1 Infrastructure Provisioning: MCP Tools vs. Migrations
* **The Decision**: You suggested running raw SQL commands directly via the InsForge MCP tools (`run-raw-sql`) and creating the storage bucket via `create-bucket` instead of managing files through a local migration pipeline.
* **Explanation**: **This is the correct approach.** InsForge is a managed Backend-as-a-Service (BaaS). Unlike projects using local Docker setups or self-hosted PostgreSQL databases where local migration files (like Prisma or Knex migrations) are tracked in git, InsForge projects configure their hosted environment directly using the platform's control plane via MCP tools. This ensures the schema is immediately updated on the server and verified. 
* **Action**: Execute DDL statements using `run-raw-sql` and create the `resumes` bucket with `create-bucket`.

---

### 1.2 Row Level Security (RLS) Rules
* **The Decision**: You suggested setting up full CRUD (Create, Read, Update, Delete) policies on all four tables, gated to the authenticated user ID (`auth.uid()`).
  - For `profiles`: `WHERE id = auth.uid()`
  - For the others (`agent_runs`, `jobs`, `agent_logs`): `WHERE user_id = auth.uid()`
* **Explanation**: **This matches the architecture exactly.** 
  - Gating reads and writes to `auth.uid()` is the foundational rule of BaaS security. Without these policies, a malicious user could read or overwrite another applicant's profile, job search results, or logs.
  - Since `profiles` has a 1-to-1 relationship with the auth system (where each user has exactly one profile row), using `id` as the primary key mapped to `auth.users` means security checks must query `id = auth.uid()`.
  - The other tables contain operational logs, job search runs, and matched job details which can have multiple rows per user. They use `user_id` as a foreign key pointing to `profiles.id`, making `user_id = auth.uid()` the correct query condition.

---

### 1.3 TypeScript Types Integration (`types/index.ts`)
* **The Decision**: You asked if creating `types/index.ts` with the four table interfaces is part of Feature 04 or a separate step.
* **Explanation**: **It is highly recommended to do this as part of Feature 04.** 
  - To maintain strict TypeScript type safety, you cannot write database adapters, client-side queries, or form actions in subsequent steps without having interfaces that reflect the schema.
  - Defining the types (e.g. `Profile`, `AgentRun`, `Job`, `AgentLog`) immediately after the tables are created prevents type errors and compile failures when building the Server Actions (Feature 06) and UI layers (Feature 05 onwards).

---

### 1.4 Linkage of `profiles.id` to Auth System
* **The Decision**: You confirmed that `profiles.id` is not an auto-generated separate PK, but instead stores the user's auth UUID (`auth.users.id`). Therefore, queries use `WHERE id = auth.uid()`.
* **Explanation**: **This is correct.** 
  - Storing a separate serial primary key (like `profile_id: 1, 2, 3`) on the `profiles` table is an anti-pattern in BaaS architectures.
  - Using the auth UUID directly as the primary key simplifies joins and ensures database integrity: a profile row cannot exist without an auth account, and duplicate profiles cannot be created for a single user.

---

## 2. Recommendation: Should We Agree to All Suggestions?

**Yes, it is highly recommended to agree with all of the suggestions.** 

They align with modern development practices, follow strict database design principles, and adhere to the guidelines set in [architecture.md](file:///Users/jessejames/Desktop/job-pilot/context/architecture.md) and [AGENTS.md](file:///Users/jessejames/Desktop/job-pilot/AGENTS.md). Proceeding with these assumptions ensures:
1. **Robust Security**: No data leakage between users.
2. **Type Safety**: Compiler validation from the start.
3. **Simplicity**: No unnecessary column joining or indexing on auto-increment IDs.

---

## 3. AI Discussion Topics for Further Learning

Use these questions with your AI assistant to explore these database and security paradigms deeper:

### Topic 1: Row Level Security (RLS) Performance
> "How do PostgreSQL RLS policies affect query performance, and what indices should be added to tables (like `jobs` or `agent_logs`) to keep policies fast?"
* **What you will learn**: The importance of indexing foreign keys (`user_id`), how RLS filters are injected into the SQL execution plan, and how to avoid nested query bottlenecks in policies.

### Topic 2: Database Schemas in BaaS vs. Traditional Apps
> "What are the trade-offs of using direct SQL via MCP tools to manage database schema in BaaS platforms like InsForge compared to managing database migrations using files in git?"
* **What you will learn**: Schema drift, collaborative database syncing, rollback strategies, and environment management (dev vs. prod) in BaaS environments.

### Topic 3: 1-to-1 User Profile Relationships
> "Why is sharing the Primary Key (`auth.users.id`) on a profile table superior to creating a surrogate key (like an auto-incrementing integer) and referencing it via a foreign key?"
* **What you will learn**: Referential integrity, indexing optimization, normalization levels, and simplification of user-scoped queries.

### Topic 4: TypeScript Schema Generation
> "How can we automatically generate TypeScript types from a live PostgreSQL schema, and what are the benefits of type-generation tools compared to manual type writing?"
* **What you will learn**: Schema-to-type tools, compilation safety, handling nullability in SQL columns, and managing database type updates over time.
