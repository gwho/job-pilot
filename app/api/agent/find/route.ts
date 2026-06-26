import { NextResponse, type NextRequest } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { searchJobs, detectCountry } from "@/lib/adzuna";
import { scoreJobs } from "@/agent/job-matcher";
import { captureServerEvent } from "@/lib/posthog-server";
import { MATCH_THRESHOLD } from "@/lib/utils";
import type { Profile, JobInsert } from "@/types/index";

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

    const country = detectCountry(location);

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

    // Adzuna search — failure marks the run failed and returns 500.
    let adzunaJobs;
    try {
      adzunaJobs = await searchJobs(jobTitle, location, country);
    } catch (error) {
      console.error("[api/agent/find] adzuna error:", error);
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

    // Batch scoring — index-aligned to adzunaJobs (best-effort, never throws).
    const scores = await scoreJobs(adzunaJobs, (profile as Profile) ?? null);

    // Build one job record per Adzuna result + its score.
    const records: JobInsert[] = adzunaJobs.map((job, i) => {
      const score = scores[i];
      const salary =
        job.salary_min && job.salary_max
          ? `$${Math.round(job.salary_min / 1000)}k - $${Math.round(job.salary_max / 1000)}k`
          : null;

      return {
        user_id: userId,
        run_id: runId,
        source: "search",
        source_url: job.redirect_url,
        external_apply_url: job.redirect_url,
        title: job.title,
        company: job.company.display_name,
        location: job.location.display_name,
        salary,
        job_type:
          job.contract_type === "part_time"
            ? "parttime"
            : job.contract_type === "contract"
              ? "contract"
              : "fulltime",
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

    // Persist all jobs in one insert, returning the saved rows for the client.
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

    const totalFound = insertedJobs.length;
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
        jobs_found: totalFound,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    return NextResponse.json({
      success: true,
      jobs: insertedJobs,
      jobsFound: totalFound,
      strongMatches,
      successMessage: `Found ${totalFound} jobs and saved ${strongMatches} strong matches.`,
    });
  } catch (error) {
    console.error("[api/agent/find]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
