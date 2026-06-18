# AI Discussion Topics — Feature 04: Database Schema

Use these prompts to explore the concepts from this feature more deeply.

---

## Schema Design

1. "The profiles table stores work_experience as a JSONB array and education as a JSONB object. Walk me through the trade-offs of storing this data as JSONB versus normalizing it into separate work_experience and education tables with foreign keys to profiles. When would the normalized approach become necessary?"

2. "The jobs.source column accepts only 'search' or 'url', but this is enforced by TypeScript types rather than a database constraint. Add a CHECK constraint to enforce this at the database level and explain when CHECK constraints are preferable to application-level validation."

3. "Walk me through what ON DELETE CASCADE, ON DELETE SET NULL, and ON DELETE RESTRICT mean in practice using this schema. What happens to agent_runs, jobs, and agent_logs rows when a profiles row is deleted? Is the current delete behavior correct for a production app?"

4. "The agent_logs table is described as 'append-only' but has UPDATE and DELETE RLS policies. Should an append-only log table have update/delete policies at all? What database techniques exist for truly enforcing append-only behavior?"

---

## Row Level Security

5. "Enable RLS on a hypothetical admin_view table that should be visible to users only if they have is_admin = true in their profiles row. Write the policy using a subquery and explain how PostgreSQL evaluates it."

6. "The UPDATE policies in this schema only use USING (user_id = auth.uid()) without WITH CHECK. This means a user could update their job's user_id to someone else's UUID. Write a corrected UPDATE policy that prevents this, and explain why both clauses are needed for UPDATE."

7. "What happens to a query against a RLS-protected table when the user is not authenticated (auth.uid() returns null)? Test your understanding: would the current policies allow unauthenticated reads, and why or why not?"

---

## Indexes and Query Performance

8. "Use EXPLAIN ANALYZE to examine a query like SELECT * FROM jobs WHERE user_id = $1 ORDER BY found_at DESC LIMIT 20 with and without the composite index. What does the output tell you about how PostgreSQL executed each version?"

9. "The jobs table has three indexes: idx_jobs_user_id, idx_jobs_user_found_at, and idx_jobs_user_match_score. Feature 11 also needs to filter by match_score >= 70 (high matches only). Would the existing idx_jobs_user_match_score index serve this query efficiently? If not, what index would?"

10. "What is partial index in PostgreSQL? Write a partial index for the jobs table that only indexes rows where company_research IS NOT NULL — the case used by the 'Companies Researched' stat in Feature 15. When would this be more efficient than a full index?"

---

## TypeScript Types and the Database

11. "The Insert types in types/index.ts use Omit to derive from the Row type. Rewrite AgentRunInsert without using Omit — define every field explicitly. Which approach is better for maintenance and why?"

12. "The CompanyResearchDossier interface types the company_research JSONB column. In TypeScript, how would you safely parse a value read from the database into CompanyResearchDossier? What happens if the JSONB data in the database does not match the interface shape?"

13. "What is the Zod library and how would you use it to validate that a company_research JSONB value from the database matches the CompanyResearchDossier shape at runtime? Write a Zod schema for CompanyResearchDossier."

---

## Database Migrations and Evolution

14. "The project will eventually need to add a tailored_resume_url column to the jobs table (for Feature 08 variants). Write the ALTER TABLE statement. Then describe every step of a safe zero-downtime migration to add this column to a table that already has 100,000 rows."

15. "Walk me through setting up Supabase CLI migrations for this project from scratch. What files would you create, what commands would you run, and how would the migration history table track what has been applied?"

16. "What is a 'squash migration' and when is it useful? If this project has accumulated 50 migration files and wants to reset to a clean baseline, how would you safely squash them without losing production data?"
