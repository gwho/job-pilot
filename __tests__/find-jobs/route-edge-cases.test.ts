/**
 * Edge-case tests for POST /api/agent/find route.
 *
 * These complement the repeated-search regression suite and cover:
 *  - Early loop exit when the actor signals exhaustion (returns < page * 10 items)
 *  - Single actor call when all jobs on page 1 are genuinely fresh
 *  - Actor error path → 500 "Job search failed"
 *  - DB existingJobs query error → 500 "Could not check saved jobs"
 *  - Missing job title → 400
 *
 * Run: npm run test:run -- __tests__/find-jobs/route-edge-cases.test.ts
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

// ── DB chain builder (same pattern as repeated-search.test.ts) ───────────────

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

function buildInsforgeMock(
  existingJobs: Job[],
  insertResult: Job[],
  existingJobsError?: { message: string },
) {
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
          if (existingJobsError && n === 1) {
            // Simulate error on the existingJobs select query
            return createChain({ data: null, error: existingJobsError });
          }
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

function makePostRequest(body: object = { jobTitle: "Engineer", location: "Hong Kong" }) {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — exhaustion signal (actor returns < page * 10)", () => {
  // Scenario: DB has 10 existing page-1 jobs. Actor on page 1 returns 10 (all
  // existing). Actor on page 2 returns only 7 jobs (< 2*10=20) — signal that
  // JobsDB has no more pages. The loop must stop after page 2 and not call page 3.
  const existingJobs = Array.from({ length: 10 }, (_, i) =>
    makeDbJob(`db-${i}`, `https://hk.jobsdb.com/job/p1-${i}`),
  );
  const page1ActorJobs = existingJobs.map((j) => makeActorJob(j.source_url!));
  // Page 2 gives only 7 new jobs — exhaustion signal (7 < 2*10=20)
  const page2PartialJobs = Array.from({ length: 7 }, (_, i) =>
    makeActorJob(`https://hk.jobsdb.com/job/p2-${i}`),
  );
  const allPage2ActorJobs = [...page1ActorJobs, ...page2PartialJobs];
  const insertResult: Job[] = page2PartialJobs.map((j, i) => ({
    ...makeDbJob(`new-${i}`, j.sourceUrl),
    match_score: 50,
  }));

  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      .mockResolvedValueOnce(page1ActorJobs)   // page 1: 10 existing
      .mockResolvedValueOnce(allPage2ActorJobs); // page 2: 17 total (7 new, exhausted)

    vi.mocked(scoreJobs).mockImplementation((inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(existingJobs, insertResult) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("stops at page 2 and does not call page 3 (exhaustion signal respected)", async () => {
    await POST(makePostRequest());
    // Should call once for page 1 (all existing) then once for page 2 (exhausted)
    expect(vi.mocked(discoverJobsDbJobs)).toHaveBeenCalledTimes(2);
  });

  it("returns newJobs=7 from the partial page 2", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.newJobs).toBe(7);
  });

  it("successMessage reflects the partial page-2 discovery count", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).toMatch(/saved 7 new jobs/i);
  });
});

describe("POST /api/agent/find — fresh first search (no existing jobs)", () => {
  // Scenario: DB has no existing jobs. Page 1 returns 10 brand-new jobs.
  // The loop must exit after the first call (freshCount=10 >= TARGET_NEW=10).
  const freshActorJobs = Array.from({ length: 10 }, (_, i) =>
    makeActorJob(`https://hk.jobsdb.com/job/fresh-${i}`),
  );
  const insertResult: Job[] = freshActorJobs.map((j, i) => ({
    ...makeDbJob(`fresh-${i}`, j.sourceUrl),
    match_score: 50,
  }));

  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockReset().mockResolvedValueOnce(freshActorJobs);

    vi.mocked(scoreJobs).mockImplementation((inputs) =>
      inputs.map(() => ({ matchScore: 50, matchReason: "", matchedSkills: [], missingSkills: [] })),
    );

    // No existing jobs in DB
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], insertResult) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("calls the actor exactly once when page 1 yields enough fresh jobs", async () => {
    await POST(makePostRequest());
    expect(vi.mocked(discoverJobsDbJobs)).toHaveBeenCalledTimes(1);
  });

  it("first call uses maxPages=1 and maxItems=10", async () => {
    await POST(makePostRequest());
    expect(vi.mocked(discoverJobsDbJobs)).toHaveBeenCalledWith(
      "Engineer", "Hong Kong", 10, 1,
    );
  });

  it("returns newJobs=10 and a success message", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.newJobs).toBe(10);
    expect(data.successMessage).toMatch(/saved 10 new jobs/i);
  });
});

describe("POST /api/agent/find — actor throws an error", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockReset().mockRejectedValue(new Error("Apify timeout"));

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], []) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns 500 with 'Job search failed' message", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/job search failed/i);
  });
});

describe("POST /api/agent/find — existingJobs DB query error", () => {
  beforeEach(() => {
    // Actor mock not needed — error occurs before actor is called
    vi.mocked(discoverJobsDbJobs).mockReset();

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(
        [],
        [],
        { message: "DB connection failed" },
      ) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns 500 with 'Could not check saved jobs'", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Could not check saved jobs");
  });

  it("does not call the actor when the existingJobs query fails", async () => {
    await POST(makePostRequest());
    expect(vi.mocked(discoverJobsDbJobs)).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/find — missing job title", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockReset();
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock([], []) as Awaited<ReturnType<typeof createInsforgeServer>>,
    );
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns 400 when jobTitle is absent from the request body", async () => {
    const res = await POST(makePostRequest({ location: "Hong Kong" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/job title is required/i);
  });

  it("returns 400 when jobTitle is an empty string", async () => {
    const res = await POST(makePostRequest({ jobTitle: "", location: "Hong Kong" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it("returns 400 when jobTitle is all whitespace", async () => {
    const res = await POST(makePostRequest({ jobTitle: "   ", location: "Hong Kong" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });
});