import { NextResponse, type NextRequest } from "next/server";

import {
  createInsforgeServer,
  InsforgeSessionRefreshError,
} from "@/lib/insforge-server";
import { discoverJobsDbJobs, toScoringInput, type JobsDbJob } from "@/agent/jobsdb";
import { scoreJobs, UNSCORED_MATCH_REASON } from "@/agent/job-matcher";
import { captureServerEvent } from "@/lib/posthog-server";
import { MATCH_THRESHOLD } from "@/lib/utils";
import type { Profile, Job, JobInsert } from "@/types/index";

// Block on actor run + dataset read — set high enough for a 10-job scrape.
// Vercel Pro max is 300s; adjust down for Hobby (60s) or self-hosted.
export const maxDuration = 300;

const LATE_WRITE_REFRESH_LEEWAY_SECONDS = 600;
const SESSION_EXPIRED_MESSAGE =
  "Session expired while saving jobs. Please sign in again and rerun the search.";

// A separate cap from TARGET_NEW (new-job discovery target) even though both
// happen to be 10 today — this one bounds how many previously-unscored
// existing rows get folded into a search's scoring batch, so it doesn't
// silently grow if TARGET_NEW ever changes for an unrelated reason.
const RESCORE_CAP = 10;

// Exact legacy sentinel written by the pre-fix agent/job-matcher.ts, which
// fabricated `matchScore: 0` instead of `null` on any scoring failure. A real
// 0% model score has a different match_reason, so checking match_reason (not
// just match_score === 0) keeps this from ever reprocessing a genuine score.
function isLegacyFallbackScore(job: Job): boolean {
  return (
    job.match_score === 0 &&
    job.match_reason === UNSCORED_MATCH_REASON &&
    (job.matched_skills?.length ?? 0) === 0 &&
    (job.missing_skills?.length ?? 0) === 0
  );
}

// Both the legacy 0-sentinel and a plain null score mean "never really
// scored" — rediscovery is a safe, natural trigger to retry either, and
// never overwrites a row that already holds a valid score.
function needsRescore(job: Job): boolean {
  return job.match_score === null || isLegacyFallbackScore(job);
}

export async function POST(request: NextRequest) {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData } = await insforge.auth.getCurrentUser();

    if (!authData.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const userId = authData.user.id;

    const body = (await request.json()) as {
      jobTitle?: string;
      location?: string;
    };
    const jobTitle = body.jobTitle?.trim() ?? "";
    const location = body.location?.trim() ?? "";

    if (!jobTitle) {
      return NextResponse.json(
        { success: false, error: "Job title is required" },
        { status: 400 },
      );
    }

    // Profile is best-effort — a null/sparse profile still produces a search.
    const { data: profile } = await insforge.database
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    // Create the agent run record (status: running).
    const { data: run, error: runError } = await insforge.database
      .from("agent_runs")
      .insert([
        {
          user_id: userId,
          status: "running",
          job_title_searched: jobTitle,
          location_searched: location || null,
        },
      ])
      .select()
      .single();

    if (runError || !run) {
      console.error("[api/agent/find] run insert error:", runError);
      return NextResponse.json(
        { success: false, error: "Could not start job search" },
        { status: 500 },
      );
    }

    const runId = run.id as string;

    await captureServerEvent({
      distinctId: userId,
      event: "job_search_started",
      properties: { userId, jobTitle, location },
    });

    // URL-based deduplication: build existingByUrl BEFORE the actor loop so
    // each iteration can check freshness without an extra DB round-trip.
    const existingJobsResult = await insforge.database
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("source_provider", "jobsdb_hk");

    if (existingJobsResult.error) {
      console.error("[api/agent/find] existing jobs query error:", existingJobsResult.error);
      await insforge.database
        .from("agent_runs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("user_id", userId);
      return NextResponse.json(
        { success: false, error: "Could not check saved jobs" },
        { status: 500 },
      );
    }

    const existingJobs = (existingJobsResult.data ?? []) as Job[];
    const existingByUrl = new Map<string, Job>();
    for (const job of existingJobs) {
      if (job.source_url) {
        existingByUrl.set(job.source_url, job);
      }
    }

    // Paginate the actor until we have ≥TARGET_NEW new jobs not already in the
    // DB, or we exhaust MAX_PAGES. bestActorJobs tracks the monotonic maximum
    // — a later call that returns fewer URLs than bestActorJobs is treated as a
    // suspicious shrink (blocked crawl) and discarded.
    const TARGET_NEW = 10;
    const MAX_PAGES = 5;
    let bestActorJobs: JobsDbJob[] = [];
    let jobsDbError: Error | null = null;
    let searchIncomplete = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      let pageResult: JobsDbJob[];
      try {
        pageResult = await discoverJobsDbJobs(jobTitle, location, page * 10, page);
      } catch (err) {
        jobsDbError = err as Error;
        if (bestActorJobs.length > 0) searchIncomplete = true;
        break;
      }

      // Monotonic invariant: a later call must never shrink the discovered URL
      // set. If it does, the actor was likely blocked mid-crawl; retain the
      // best result accumulated so far and stop pagination.
      if (pageResult.length < bestActorJobs.length) {
        if (bestActorJobs.length > 0) searchIncomplete = true;
        break;
      }

      bestActorJobs = pageResult;

      const freshCount = bestActorJobs.filter(
        (j) => j.sourceUrl && !existingByUrl.has(j.sourceUrl),
      ).length;
      if (freshCount >= TARGET_NEW || bestActorJobs.length < page * 10) break;
    }

    // Hard failure: the actor was blocked before discovering any jobs.
    if (jobsDbError && bestActorJobs.length === 0) {
      console.error("[api/agent/find] jobsdb error:", jobsDbError);
      await insforge.database
        .from("agent_runs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("user_id", userId);
      return NextResponse.json(
        { success: false, error: "Job search failed. Please try again." },
        { status: 500 },
      );
    }

    // Soft failure: later pages were blocked but earlier ones found real jobs.
    if (jobsDbError) {
      console.warn("[api/agent/find] partial search block after discovering jobs:", jobsDbError);
    }

    // Dedupe actor results defensively and keep their order for display.
    const seenActorUrls = new Set<string>();
    const uniqueJobsDbJobs = bestActorJobs.filter((job) => {
      if (!job.sourceUrl || seenActorUrls.has(job.sourceUrl)) {
        return false;
      }
      seenActorUrls.add(job.sourceUrl);
      return true;
    });

    const newJobs = uniqueJobsDbJobs.filter(
      (job) => !existingByUrl.has(job.sourceUrl),
    );

    // Rediscovered rows still carrying an unscored signature get another
    // scoring attempt, capped and oldest-first so a large backlog drains
    // monotonically across repeated searches instead of all landing in one
    // oversized batch.
    const rescoreCandidates = uniqueJobsDbJobs
      .filter((job) => {
        const existing = existingByUrl.get(job.sourceUrl);
        return existing !== undefined && needsRescore(existing);
      })
      .sort((a, b) => {
        const foundAtA = existingByUrl.get(a.sourceUrl)!.found_at;
        const foundAtB = existingByUrl.get(b.sourceUrl)!.found_at;
        return foundAtA.localeCompare(foundAtB);
      })
      .slice(0, RESCORE_CAP);

    const totalFound = uniqueJobsDbJobs.length;
    let lateWriteInsforge: Awaited<ReturnType<typeof createInsforgeServer>> | null = null;

    async function getLateWriteInsforge(): Promise<
      Awaited<ReturnType<typeof createInsforgeServer>>
    > {
      if (!lateWriteInsforge) {
        lateWriteInsforge = await createInsforgeServer({
          refreshSession: true,
          refreshLeewaySeconds: LATE_WRITE_REFRESH_LEEWAY_SECONDS,
        });
      }
      return lateWriteInsforge;
    }

    // Genuine zero-results: the actor succeeded but found no job cards on the
    // search page (e.g. an obscure query, or the empty state was verified).
    if (totalFound === 0) {
      const writeInsforge = await getLateWriteInsforge();
      await writeInsforge.database
        .from("agent_runs")
        .update({
          status: "completed",
          jobs_found: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("user_id", userId);

      return NextResponse.json({
        success: true,
        jobs: [],
        jobsFound: 0,
        newJobs: 0,
        successMessage: "Found 0 jobs. Try different keywords.",
      });
    }

    // Batch scoring — new jobs first, then rescore candidates, so a single
    // index slice recovers each group's scores (best-effort, never throws).
    const jobsToScore = [...newJobs, ...rescoreCandidates];
    const scores = await scoreJobs(
      jobsToScore.map(toScoringInput),
      (profile as Profile) ?? null,
    );
    const newScores = scores.slice(0, newJobs.length);
    const rescoreScores = scores.slice(newJobs.length);

    // Build one job record per new job + its score.
    const records: JobInsert[] = newJobs.map((job, i) => {
      const score = newScores[i];
      const jobType =
        job.jobType?.toLowerCase().includes("part")
          ? "parttime"
          : job.jobType?.toLowerCase().includes("contract")
            ? "contract"
            : "fulltime";

      return {
        user_id: userId,
        run_id: runId,
        source: "search",
        source_provider: "jobsdb_hk",
        source_url: job.sourceUrl,
        external_apply_url: job.externalApplyUrl ?? job.sourceUrl,
        title: job.title,
        company: job.company,
        location: job.location,
        salary: job.salary ?? null,
        job_type: jobType,
        about_role: job.description,
        responsibilities: null,
        requirements: null,
        nice_to_have: null,
        benefits: null,
        about_company: null,
        match_score: score.matchScore,
        match_reason: score.matchReason,
        matched_skills: score.matchedSkills,
        missing_skills: score.missingSkills,
        company_research: null,
      };
    });

    const incompleteSuffix = searchIncomplete
      ? " Some later pages could not be searched."
      : "";

    // Rescore existing rows carrying an unscored signature. Non-fatal: a
    // failed update just leaves that row as it was, never blocks the
    // response. Written unconditionally with whatever scoreJobs returned —
    // a real score corrects the row, and a repeat scoring failure still
    // normalizes a legacy match_score: 0 to null instead of leaving the
    // fabricated sentinel in place. Never overwrites a row that wasn't
    // selected by needsRescore, and never inserts a duplicate — this only
    // updates rows already present in existingByUrl.
    const rescoredByUrl = new Map<string, Job>();
    if (rescoreCandidates.length > 0) {
      const rescoreWriteInsforge = await getLateWriteInsforge();
      await Promise.all(
        rescoreCandidates.map(async (job, i) => {
          const existing = existingByUrl.get(job.sourceUrl)!;
          const score = rescoreScores[i];
          const { data: updated, error } = await rescoreWriteInsforge.database
            .from("jobs")
            .update({
              match_score: score.matchScore,
              match_reason: score.matchReason,
              matched_skills: score.matchedSkills,
              missing_skills: score.missingSkills,
            })
            .eq("id", existing.id)
            .eq("user_id", userId)
            .select()
            .single();

          if (error || !updated) {
            console.error("[api/agent/find] rescore update failed:", {
              jobId: existing.id,
              error,
            });
            return;
          }
          rescoredByUrl.set(job.sourceUrl, updated as Job);
        }),
      );
    }

    if (records.length === 0) {
      const displayJobs = uniqueJobsDbJobs
        .map(
          (job) =>
            rescoredByUrl.get(job.sourceUrl) ?? existingByUrl.get(job.sourceUrl),
        )
        .filter((job): job is Job => Boolean(job));

      // All discovered jobs already in DB — still mark run complete.
      const writeInsforge = await getLateWriteInsforge();
      await writeInsforge.database
        .from("agent_runs")
        .update({
          status: "completed",
          jobs_found: totalFound,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("user_id", userId);

      return NextResponse.json({
        success: true,
        jobs: displayJobs,
        jobsFound: totalFound,
        newJobs: 0,
        successMessage: `Found ${totalFound} jobs — all already saved.${incompleteSuffix}`,
      });
    }

    const writeInsforge = await getLateWriteInsforge();

    // Persist only new jobs, returning saved rows for the client.
    const { data: insertedJobs, error: jobsError } = await writeInsforge.database
      .from("jobs")
      .insert(records)
      .select();

    if (jobsError || !insertedJobs) {
      console.error("[api/agent/find] jobs insert error:", jobsError);
      await writeInsforge.database
        .from("agent_runs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("user_id", userId);
      return NextResponse.json(
        { success: false, error: "Could not save jobs" },
        { status: 500 },
      );
    }

    const newCount = insertedJobs.length;
    const insertedByUrl = new Map<string, Job>();
    for (const job of insertedJobs as Job[]) {
      if (job.source_url) {
        insertedByUrl.set(job.source_url, job);
      }
    }

    const displayJobs = uniqueJobsDbJobs
      .map(
        (job) =>
          insertedByUrl.get(job.sourceUrl) ??
          rescoredByUrl.get(job.sourceUrl) ??
          existingByUrl.get(job.sourceUrl),
      )
      .filter((job): job is Job => Boolean(job));

    // job_found models discovery, not remediation — only fired for records
    // this run actually inserted, never for rediscovered rescore candidates.
    let strongMatches = 0;
    for (const job of insertedJobs) {
      if ((job.match_score ?? 0) >= MATCH_THRESHOLD) strongMatches++;
      await captureServerEvent({
        distinctId: userId,
        event: "job_found",
        properties: {
          userId,
          source: "search",
          sourceProvider: "jobsdb_hk",
          matchScore: job.match_score,
          company: job.company,
        },
      });
    }

    // Mark the run complete.
    await writeInsforge.database
      .from("agent_runs")
      .update({
        status: "completed",
        jobs_found: totalFound,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    const incompleteSuffixNew = searchIncomplete
      ? " Some later pages could not be searched, so results may be incomplete."
      : "";

    return NextResponse.json({
      success: true,
      jobs: displayJobs,
      jobsFound: totalFound,
      newJobs: newCount,
      strongMatches,
      successMessage: `Found ${totalFound} jobs and saved ${newCount} new jobs.${incompleteSuffixNew}`,
    });
  } catch (error) {
    if (error instanceof InsforgeSessionRefreshError) {
      console.error("[api/agent/find] session refresh before save failed:", error);
      return NextResponse.json(
        { success: false, error: SESSION_EXPIRED_MESSAGE },
        { status: 401 },
      );
    }

    console.error("[api/agent/find]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
