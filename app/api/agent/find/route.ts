import { NextResponse, type NextRequest } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs, toScoringInput } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";
import { captureServerEvent } from "@/lib/posthog-server";
import { MATCH_THRESHOLD } from "@/lib/utils";
import type { Profile, JobInsert } from "@/types/index";

// Block on actor run + dataset read — set high enough for a 10-job scrape.
// Vercel Pro max is 300s; adjust down for Hobby (60s) or self-hosted.
export const maxDuration = 300;

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

    // JobsDB HK discovery via Apify actor — failure marks run failed + returns 500.
    let jobsDbJobs;
    try {
      jobsDbJobs = await discoverJobsDbJobs(jobTitle, location, 10);
    } catch (error) {
      console.error("[api/agent/find] jobsdb error:", error);
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

    // URL-based deduplication: skip any sourceUrl already in the DB for this user + provider.
    const existingUrlsResult = await insforge.database
      .from("jobs")
      .select("source_url")
      .eq("user_id", userId)
      .eq("source_provider", "jobsdb_hk");

    const existingUrls = new Set(
      (existingUrlsResult.data ?? []).map((r: { source_url: string | null }) => r.source_url).filter(Boolean),
    );

    // Also dedupe within the batch by canonical sourceUrl.
    const seenInBatch = new Set<string>();
    const newJobs = jobsDbJobs.filter((job) => {
      if (!job.sourceUrl || existingUrls.has(job.sourceUrl) || seenInBatch.has(job.sourceUrl)) {
        return false;
      }
      seenInBatch.add(job.sourceUrl);
      return true;
    });

    const totalFound = jobsDbJobs.length;

    // Batch scoring — index-aligned to newJobs (best-effort, never throws).
    const scores = await scoreJobs(
      newJobs.map(toScoringInput),
      (profile as Profile) ?? null,
    );

    // Build one job record per new job + its score.
    const records: JobInsert[] = newJobs.map((job, i) => {
      const score = scores[i];
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

    if (records.length === 0) {
      // All discovered jobs already in DB — still mark run complete.
      await insforge.database
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
        jobsFound: totalFound,
        newJobs: 0,
        successMessage: `Found ${totalFound} jobs — all already saved.`,
      });
    }

    // Persist only new jobs, returning saved rows for the client.
    const { data: insertedJobs, error: jobsError } = await insforge.database
      .from("jobs")
      .insert(records)
      .select();

    if (jobsError || !insertedJobs) {
      console.error("[api/agent/find] jobs insert error:", jobsError);
      await insforge.database
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
    const strongMatches = insertedJobs.filter(
      (j) => (j.match_score ?? 0) >= MATCH_THRESHOLD,
    ).length;

    // One job_found event per strong match.
    for (const job of insertedJobs) {
      if ((job.match_score ?? 0) >= MATCH_THRESHOLD) {
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
    }

    // Mark the run complete.
    await insforge.database
      .from("agent_runs")
      .update({
        status: "completed",
        jobs_found: newCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    return NextResponse.json({
      success: true,
      jobs: insertedJobs,
      jobsFound: totalFound,
      newJobs: newCount,
      strongMatches,
      successMessage: `Found ${totalFound} jobs and saved ${newCount} new jobs.`,
    });
  } catch (error) {
    console.error("[api/agent/find]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
