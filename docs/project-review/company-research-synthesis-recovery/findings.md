# Findings — Company Research Synthesis Recovery (Issue #38)

Only one finding came out of this review with any real substance — everything else was a clean pass. This file exists to explain that one finding in enough depth to recognize the same *category* of issue elsewhere, since as a single line item it looks almost too small to document.

## Finding 1 — Invariant wording vs. implementation: does the fallback need the full `profile`? (Minor — resolved, not fixed)

### What the problem was

CLAUDE.md states the invariant plainly: "Company research always returns a dossier — Nemotron synthesises from job description **+ profile** if browser research fails." `buildFallbackDossier(content: ExtractedContent, job: Job): CompanyResearchDossier` — the function that runs when synthesis itself is exhausted, not just when browser research fails — takes no `profile` parameter at all. Read as a literal contract check, the implementation doesn't match the words of the invariant.

### Why this isn't actually a defect

The invariant's wording predates this fix — it was written to describe the *original* fallback behavior (Nemotron still runs, with `profile` in its prompt, even when browser research came back empty; see `agent/research.ts`'s existing "Synthesis always runs, even with empty content" comment). This fix extends the *guarantee* ("always returns a dossier") to a new failure mode the invariant's author hadn't considered — synthesis itself failing — without necessarily preserving the exact mechanism ("Nemotron always sees the full profile") the original wording assumed, because that mechanism (a Nemotron call) is precisely the thing that's failed by the time this new fallback path runs.

The substantive question isn't "does the code call a function named the same as the profile parameter" — it's "does the fallback dossier still reflect the candidate, or is it generic." It does: `job.matched_skills` and `job.missing_skills` are not raw job-posting fields, they are the *output* of the matching agent comparing the full candidate profile against this specific job, computed earlier in the pipeline (before company research ever runs). The profile's influence reaches the fallback dossier, just already distilled by an earlier stage rather than re-read from scratch.

### How to recognize this category of issue in future reviews

This is a case of an invariant written in terms of *mechanism* ("uses Nemotron with the profile") when the actual product guarantee is about *outcome* ("the dossier is grounded in this candidate, not generic"). When a new code path satisfies the outcome through a different mechanism than the one the invariant's wording literally describes, the right review move is not to force the new code to match the old wording — it's to ask the developer which one is actually load-bearing, then update the *documentation* to describe both mechanisms and when each applies, rather than silently accepting either "wrong wording, right code" or "matching wording, unnecessarily complex code."

That's exactly what happened here: the user's decision was "leave the code as-is... clarify the documentation instead," which is the correct resolution for an outcome-invariant satisfied by a new mechanism — not a code change, a documentation change. `agent/research.ts`'s `buildFallbackDossier()` comment and `context/library-docs.md` now both state explicitly that normal synthesis uses the full profile while the terminal fallback uses only the already-derived match signals, so a future reader hits the explanation instead of the ambiguity.

### What would have made this a real defect instead of a judgment call

If `job.matched_skills`/`job.missing_skills` were *not* already profile-derived — say, if they were raw keyword-matches against the job posting alone, with no actual comparison to the candidate's own skills — then the fallback dossier would have been generic, and the invariant violation would have been real, not just a wording mismatch. Worth checking in any future review of this code: are `matched_skills`/`missing_skills` still computed by comparing the full profile, or could a future refactor of the matching agent change what those fields mean without this fallback path being updated to match? That's the actual coupling this design leans on, and it's implicit rather than enforced by a type or a test.
