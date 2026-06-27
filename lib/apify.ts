// Apify runtime client — used by the Next.js app to call the deployed
// jobsdb-hk-actor and read its dataset. This is NOT the apify CLI; it's the
// apify-client SDK designed for programmatic server-side use.

import { ApifyClient } from "apify-client";

export type JobsDbActorInput = {
  query: string;
  location: string;
  maxItems: number;
};

export type JobsDbActorOutput = {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  jobType: string | null;
  description: string;
  sourceUrl: string;
  externalApplyUrl: string | null;
  postedAt: string | null;
};

/**
 * Start the deployed JobsDB HK actor, wait for it to finish, and return all
 * dataset items. Throws if the run does not SUCCEED — the caller marks the
 * agent_run failed and returns a 500 (mirrors the Adzuna error pattern).
 */
export async function runJobsDbActor(
  input: JobsDbActorInput,
): Promise<JobsDbActorOutput[]> {
  const client = new ApifyClient({ token: process.env.APIFY_TOKEN! });

  const run = await client
    .actor(process.env.APIFY_JOBSDB_ACTOR_ID!)
    .call(input, {
      timeout: 270, // slightly under the route's maxDuration
    });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`JobsDB actor run ${run.status} (runId: ${run.id})`);
  }

  const { items } = await client
    .dataset(run.defaultDatasetId!)
    .listItems();

  return items as JobsDbActorOutput[];
}
