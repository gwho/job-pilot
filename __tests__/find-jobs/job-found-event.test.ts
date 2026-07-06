/**
 * Regression test for Issue #19.
 *
 * Bug: `job_found` PostHog events only fired for jobs whose match_score was
 * >= MATCH_THRESHOLD (70). A search that saved 20 jobs with only 4 strong
 * matches produced just 4 `job_found` events, even though `code-standards.md`
 * defines `job_found` as "Each job discovered and saved."
 *
 * Fix: `app/api/agent/find/route.ts` now fires `captureServerEvent({ event:
 * "job_found", ... })` unconditionally for every row in `insertedJobs`.
 * `strongMatches` is still computed, via a running counter in the same loop,
 * and returned in the response for the success message.
 *
 * Run: npm run test:run -- __tests__/find-jobs/job-found-event.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/find/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";
import { captureServerEvent } from "@/lib/posthog-server";
import type { Job } from "@/types/index";

// ── Module mocks (hoisted by Vitest before any imports) ───────────────────────

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("@/agent/jobsdb", () => ({
  discoverJobsDbJobs: vi.fn(),
  toScoringInput: (j: {
    title: string;
    company: string;
    location: string;
    description: string;
  }) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    description: j.description,
  }),
}));
vi.mock("@/agent/job-matcher", () => ({ scoreJobs: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── DB chain builder (mirrors repeated-search.test.ts / save-error.test.ts) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolvedValue: unknown): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}

// Builds the minimal InsForge client mock the find-jobs route needs. The
// second `jobs` call (the INSERT) resolves to exactly `insertResult` —
// callers control match_score on each row directly via that fixture,
// independent of whatever `scoreJobs` returns.
function buildInsforgeMock(existingJobs: Job[], insertResult: Job[]) {
  const callCounts: Record<string, number> = {};

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        callCounts[table] = (callCounts[table] ?? 0) + 1;
        const n = callCounts[table];

        if (table === "profiles") {
          return createChain({ data: null, error: null });
        }
        if (table === "agent_runs") {
          return n === 1
            ? createChain({ data: { id: "run-1" }, error: null })
            : createChain({ error: null });
        }
        if (table === "jobs") {
          // 1st call: existing-jobs SELECT; 2nd call: jobs INSERT
          return n === 1
            ? createChain({ data: existingJobs, error: null })
            : createChain({ data: insertResult, error: null });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDbJob(
  id: string,
  sourceUrl: string,
  matchScore: number | null,
): Job {
  return {
    id,
    run_id: "run-0",
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: sourceUrl,
    external_apply_url: null,
    title: `Role ${id}`,
    company: `Corp ${id}`,
    location: "Hong Kong",
    salary: null,
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: matchScore,
    match_reason: null,
    matched_skills: [],
    missing_skills: [],
    company_research: null,
    found_at: new Date().toISOString(),
  };
}

function makeActorJob(sourceUrl: string) {
  return {
    title: "Actor Role",
    company: "Actor Corp",
    location: "Hong Kong",
    salary: null,
    jobType: null,
    description: "desc",
    sourceUrl,
    externalApplyUrl: null,
    postedAt: null,
  };
}

function makePostRequest() {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobTitle: "Engineer", location: "Hong Kong" }),
  }) as unknown as Parameters<typeof POST>[0];
}

// MATCH_THRESHOLD is 70 (lib/utils.ts) — fixtures below deliberately straddle it.
const insertedJobsFixture: Job[] = [
  makeDbJob("strong-1", "https://hk.jobsdb.com/job/strong-1", 90),
  makeDbJob("weak-1", "https://hk.jobsdb.com/job/weak-1", 40),
  makeDbJob("boundary-1", "https://hk.jobsdb.com/job/boundary-1", 70), // == threshold
  makeDbJob("null-score-1", "https://hk.jobsdb.com/job/null-score-1", null),
];

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — job_found event fires for every inserted job (Issue #19 fix)", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockReset().mockResolvedValue(
      insertedJobsFixture.map((j) => makeActorJob(j.source_url!)),
    );

    // scoreJobs must return one entry per newJob — values are irrelevant here
    // because insertedJobsFixture (returned by the mocked INSERT) is what the
    // route's event loop actually reads match_score from.
    vi.mocked(scoreJobs).mockImplementation((inputs) =>
      Promise.resolve(
        inputs.map(() => ({
          matchScore: 0,
          matchReason: "",
          matchedSkills: [],
          missingSkills: [],
        })),
      ),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], insertedJobsFixture) as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires exactly one job_found event per inserted job, including jobs below MATCH_THRESHOLD", async () => {
    await POST(makePostRequest());

    const jobFoundCalls = vi
      .mocked(captureServerEvent)
      .mock.calls.filter(([arg]) => arg.event === "job_found");

    expect(jobFoundCalls).toHaveLength(insertedJobsFixture.length);
  });

  it("fires job_found for a weak match (score well below MATCH_THRESHOLD) — the bug this fixes", async () => {
    await POST(makePostRequest());

    const weakMatchCall = vi
      .mocked(captureServerEvent)
      .mock.calls.find(
        ([arg]) =>
          arg.event === "job_found" &&
          arg.properties?.company === "Corp weak-1",
      );

    expect(weakMatchCall).toBeDefined();
    expect(weakMatchCall?.[0].properties?.matchScore).toBe(40);
  });

  it("fires job_found for a job whose match_score is exactly at MATCH_THRESHOLD (boundary = 70)", async () => {
    await POST(makePostRequest());

    const boundaryCall = vi
      .mocked(captureServerEvent)
      .mock.calls.find(
        ([arg]) =>
          arg.event === "job_found" &&
          arg.properties?.company === "Corp boundary-1",
      );

    expect(boundaryCall).toBeDefined();
    expect(boundaryCall?.[0].properties?.matchScore).toBe(70);
  });

  it("fires job_found for a job with a null match_score, treating it as 0 for the threshold check", async () => {
    await POST(makePostRequest());

    const nullScoreCall = vi
      .mocked(captureServerEvent)
      .mock.calls.find(
        ([arg]) =>
          arg.event === "job_found" &&
          arg.properties?.company === "Corp null-score-1",
      );

    expect(nullScoreCall).toBeDefined();
    expect(nullScoreCall?.[0].properties?.matchScore).toBeNull();
  });

  it("includes the correct sourceProvider and source on every fired event", async () => {
    await POST(makePostRequest());

    const jobFoundCalls = vi
      .mocked(captureServerEvent)
      .mock.calls.filter(([arg]) => arg.event === "job_found");

    for (const [arg] of jobFoundCalls) {
      expect(arg.properties?.source).toBe("search");
      expect(arg.properties?.sourceProvider).toBe("jobsdb_hk");
      expect(arg.properties?.userId).toBe("user-1");
    }
  });

  it("counts strongMatches using only jobs meeting MATCH_THRESHOLD, and returns it in the response", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();

    // Only "strong-1" (90) and "boundary-1" (70) meet the >=70 threshold.
    expect(data.strongMatches).toBe(2);
  });

  it("strongMatches count does not gate whether job_found fires — event count exceeds strongMatches", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();

    const jobFoundCalls = vi
      .mocked(captureServerEvent)
      .mock.calls.filter(([arg]) => arg.event === "job_found");

    expect(jobFoundCalls.length).toBeGreaterThan(data.strongMatches);
    expect(jobFoundCalls).toHaveLength(4);
    expect(data.strongMatches).toBe(2);
  });

  it("does not fire any job_found events when there are no new jobs to insert", async () => {
    // Actor returns a job whose URL is already saved — records.length === 0,
    // so the route returns early before the insert + event loop ever runs.
    const existingUrl = "https://hk.jobsdb.com/job/already-saved";
    vi.mocked(discoverJobsDbJobs).mockReset().mockResolvedValue([
      makeActorJob(existingUrl),
    ]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(
        [makeDbJob("existing-1", existingUrl, 55)],
        [],
      ) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.newJobs).toBe(0);
    const jobFoundCalls = vi
      .mocked(captureServerEvent)
      .mock.calls.filter(([arg]) => arg.event === "job_found");
    expect(jobFoundCalls).toHaveLength(0);
  });
});