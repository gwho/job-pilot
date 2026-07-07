/**
 * Regression tests for the "blocked actor = fake success" bug family.
 *
 * Scenarios:
 * 1. Trace-2 repro   — later pagination call returns [] (blocked-but-SUCCEEDED actor).
 *                      The route must not shrink previously discovered jobs.
 * 2. Legit empty     — actor returns [] legitimately. Route says "try different keywords",
 *                      NOT "all already saved".
 * 3. Blocked upstream — first call throws. Route returns 500, marks run failed.
 * 4. Partial block (dup jobs) — call 3 throws after 20 dups found. Route returns 200
 *                               with warning suffix.
 * 5. Partial block (new jobs) — call 2 throws after some new jobs found. Route returns
 *                               200, saves new jobs, warning suffix.
 *
 * Run: npm run test:run -- __tests__/find-jobs/blocked-actor.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/find/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";
import type { Job } from "@/types/index";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("@/agent/jobsdb", () => ({
  discoverJobsDbJobs: vi.fn(),
  toScoringInput: (j: {
    title: string;
    company: string;
    location: string;
    description: string;
  }) => ({ title: j.title, company: j.company, location: j.location, description: j.description }),
}));
vi.mock("@/agent/job-matcher", () => ({ scoreJobs: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── DB chain builder ──────────────────────────────────────────────────────────

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

        if (table === "profiles") return createChain({ data: null, error: null });
        if (table === "agent_runs") {
          return n === 1
            ? createChain({ data: { id: "run-1" }, error: null })
            : createChain({ error: null });
        }
        if (table === "jobs") {
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

function makeDbJob(id: string, sourceUrl: string): Job {
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
    match_score: 60,
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

function makePostRequest(jobTitle = "Engineer", location = "Hong Kong") {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobTitle, location }),
  }) as unknown as Parameters<typeof POST>[0];
}

// 20 DB jobs for the trace-2 / partial-block-dup scenarios
const dupDbJobs = [
  ...Array.from({ length: 10 }, (_, i) => makeDbJob(`db-p1-${i}`, `https://hk.jobsdb.com/job/p1-${i}`)),
  ...Array.from({ length: 10 }, (_, i) => makeDbJob(`db-p2-${i}`, `https://hk.jobsdb.com/job/p2-${i}`)),
];

// Actor results per pagination call for dup scenarios
const page1DupActorJobs = Array.from({ length: 10 }, (_, i) =>
  makeActorJob(`https://hk.jobsdb.com/job/p1-${i}`),
);
const allPage2DupActorJobs = [
  ...page1DupActorJobs,
  ...Array.from({ length: 10 }, (_, i) => makeActorJob(`https://hk.jobsdb.com/job/p2-${i}`)),
];

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Trace-2 repro — shrink guard
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — trace-2 repro: later [] must not wipe previous results", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockResolvedValueOnce(page1DupActorJobs)   // call 1 (maxPages=1): 10 dups
      .mockResolvedValueOnce(allPage2DupActorJobs) // call 2 (maxPages=2): 20 dups
      .mockResolvedValueOnce([]);                  // call 3 (maxPages=3): blocked → []

    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(dupDbJobs, []) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("jobsFound is 20, not 0", async () => {
    // RED: current code sets allActorJobs = [] on call 3, so jobsFound = 0
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.jobsFound).toBeGreaterThanOrEqual(20);
  });

  it("successMessage does not say 'Found 0 jobs'", async () => {
    // RED: current code says "Found 0 jobs — all already saved."
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).not.toMatch(/found 0 jobs/i);
  });

  it("response is success:true (not a 500)", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Legit empty — actor genuinely found 0 jobs
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — legit empty search result", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockResolvedValueOnce([]); // call 1: actor succeeded with 0 jobs

    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], []) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("successMessage says 'try different keywords', not 'all already saved'", async () => {
    // RED: current code says "Found 0 jobs — all already saved."
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).toMatch(/try different keywords/i);
    expect(data.successMessage).not.toMatch(/all already saved/i);
  });

  it("response is success:true with jobsFound:0", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.jobsFound).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Blocked upstream — call 1 throws (existing correct behavior)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — blocked upstream (call 1 throws)", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockRejectedValueOnce(new Error("JobsDB actor run FAILED (runId: test-run)"));

    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], []) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns HTTP 500", async () => {
    const res = await POST(makePostRequest());
    expect(res.status).toBe(500);
  });

  it("returns success:false with 'Job search failed' error", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/job search failed/i);
  });

  it("does not return successMessage or jobs array", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).toBeUndefined();
    expect(data.jobs).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Partial block — call 3 throws after 20 dup jobs found
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — partial block, dup jobs discovered", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockResolvedValueOnce(page1DupActorJobs)   // call 1: 10 dups
      .mockResolvedValueOnce(allPage2DupActorJobs) // call 2: 20 dups
      .mockRejectedValueOnce(new Error("JobsDB actor run FAILED")); // call 3 blocked

    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(dupDbJobs, []) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns HTTP 200, not 500", async () => {
    // RED: current code returns 500 because jobsDbError is set
    const res = await POST(makePostRequest());
    expect(res.status).toBe(200);
  });

  it("success:true with jobsFound:20", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.jobsFound).toBeGreaterThanOrEqual(20);
  });

  it("successMessage contains 'all already saved' and 'could not be searched'", async () => {
    // RED: current code returns 500, never reaches the message
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).toMatch(/all already saved/i);
    expect(data.successMessage).toMatch(/could not be searched/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: Partial block — call 2 throws after some new jobs found
// ─────────────────────────────────────────────────────────────────────────────

// 5 DB dups + 5 new actor jobs in call 1; call 2 throws before TARGET_NEW is reached.
const mixedDbJobs = Array.from({ length: 5 }, (_, i) =>
  makeDbJob(`db-p1-${i}`, `https://hk.jobsdb.com/job/p1-${i}`),
);
const mixedActorJobs = [
  ...Array.from({ length: 5 }, (_, i) => makeActorJob(`https://hk.jobsdb.com/job/p1-${i}`)), // dups
  ...Array.from({ length: 5 }, (_, i) => makeActorJob(`https://hk.jobsdb.com/job/p2-${i}`)), // new
];
const mixedInsertResult: Job[] = Array.from({ length: 5 }, (_, i) => ({
  ...makeDbJob(`new-${i}`, `https://hk.jobsdb.com/job/p2-${i}`),
  match_score: 55,
}));

describe("POST /api/agent/find — partial block, new jobs discovered", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockResolvedValueOnce(mixedActorJobs)     // call 1: 5 dup + 5 new (freshCount=5 < 10)
      .mockRejectedValueOnce(new Error("JobsDB actor run FAILED")); // call 2 blocked

    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({ matchScore: 55, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(mixedDbJobs, mixedInsertResult) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns HTTP 200, not 500", async () => {
    // RED: current code returns 500
    const res = await POST(makePostRequest());
    expect(res.status).toBe(200);
  });

  it("newJobs > 0 — the 5 new jobs are saved", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.newJobs).toBeGreaterThan(0);
  });

  it("successMessage contains 'saved' and 'could not be searched'", async () => {
    // RED: current code returns 500, never reaches the message
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).toMatch(/saved \d+ new job/i);
    expect(data.successMessage).toMatch(/could not be searched/i);
  });
});
