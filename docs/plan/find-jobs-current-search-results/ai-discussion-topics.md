# AI Discussion Topics

- Should Find Jobs eventually show separate tabs for "Latest search" and "Saved history"?
- Should `/api/agent/find` expose both `displayJobs` and `insertedJobs`, instead of overloading `jobs` as the display array?
- Should `agent_runs.jobs_found` mean discovered jobs or newly saved jobs?
- Should repeated searches refresh match scores for already-saved jobs, or preserve the original score?
- Should the JobsDB actor return a stable search-run ID or trace metadata for UI debugging?
- Should the actor validate result relevance before scoring, for example by requiring at least one query token in title/description?
- Should future actor tests run a live canary query like `sales coordinator` after every Apify deploy?
