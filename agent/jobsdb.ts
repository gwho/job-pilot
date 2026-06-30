// JobsDB HK source adapter.
// Calls the Apify actor, normalizes its output, and provides the mapping
// helpers used by the find route.

import { runJobsDbActor, type JobsDbActorOutput } from "@/lib/apify";
import type { ScoringInput } from "@/agent/job-matcher";

export type JobsDbJob = JobsDbActorOutput;

/**
 * Discover up to maxItems jobs from JobsDB HK via the Apify actor.
 * Normalizes missing fields to null/'' — never throws on a bad item.
 * Throws if the actor run itself fails (caller handles the error).
 */
export async function discoverJobsDbJobs(
  query: string,
  location: string,
  maxItems = 10,
  maxPages = 1,
): Promise<JobsDbJob[]> {
  const items = await runJobsDbActor({ query, location, maxItems, maxPages });

  return items.map((item) => ({
    title: item.title ?? "",
    company: item.company ?? "",
    location: item.location ?? "",
    salary: item.salary ?? null,
    jobType: item.jobType ?? null,
    description: item.description ?? "",
    sourceUrl: item.sourceUrl ?? "",
    externalApplyUrl: item.externalApplyUrl ?? null,
    postedAt: item.postedAt ?? null,
  }));
}

/** Map a JobsDbJob to the flat shape scoreJobs expects. */
export function toScoringInput(job: JobsDbJob): ScoringInput {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
  };
}
