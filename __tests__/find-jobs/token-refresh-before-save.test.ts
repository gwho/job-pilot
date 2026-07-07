/**
 * Regression tests for long-running Find Jobs searches.
 *
 * A JobsDB actor run can take long enough for the access token captured at the
 * beginning of POST /api/agent/find to expire before jobs are inserted. The
 * route must refresh/recreate its InsForge client before late DB writes.
 *
 * Run: npm run test:run -- __tests__/find-jobs/token-refresh-before-save.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/agent/find/route";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";
import {
  createInsforgeServer,
  InsforgeSessionRefreshError,
} from "@/lib/insforge-server";
import type { Job } from "@/types/index";

vi.mock("@/lib/insforge-server", () => {
  class InsforgeSessionRefreshError extends Error {
    constructor(message = "InsForge session refresh failed") {
      super(message);
      this.name = "InsforgeSessionRefreshError";
    }
  }

  return {
    createInsforgeServer: vi.fn(),
    InsforgeSessionRefreshError,
  };
});
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

function makeInsertedJob(): Job {
  return {
    id: "job-1",
    run_id: "run-1",
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: "https://hk.jobsdb.com/job/token-refresh-1",
    external_apply_url: "https://hk.jobsdb.com/job/token-refresh-1",
    title: "Sales Coordinator",
    company: "ACME HK",
    location: "Hong Kong",
    salary: null,
    job_type: "fulltime",
    about_role: "Coordinate sales operations.",
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 82,
    match_reason: "Strong coordination match.",
    matched_skills: ["communication"],
    missing_skills: [],
    company_research: null,
    found_at: new Date().toISOString(),
  };
}

function buildInitialInsforgeMock() {
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
            ? createChain({ data: [], error: null })
            : createChain({
                data: null,
                error: {
                  error: "AUTH_UNAUTHORIZED",
                  message: "Invalid token",
                  statusCode: 401,
                },
              });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}

function buildFreshInsforgeMock(insertedJob: Job) {
  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "jobs") return createChain({ data: [insertedJob], error: null });
        if (table === "agent_runs") return createChain({ error: null });
        return createChain({ data: null, error: null });
      }),
    },
  };
}

function makePostRequest() {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobTitle: "Sales coordinator",
      location: "Hong Kong",
    }),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/agent/find — refreshes auth before late save", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockResolvedValue([
      {
        title: "Sales Coordinator",
        company: "ACME HK",
        location: "Hong Kong",
        salary: null,
        jobType: null,
        description: "Coordinate sales operations.",
        sourceUrl: "https://hk.jobsdb.com/job/token-refresh-1",
        externalApplyUrl: null,
        postedAt: null,
      },
    ]);

    vi.mocked(scoreJobs).mockResolvedValue([
      {
        matchScore: 82,
        matchReason: "Strong coordination match.",
        matchedSkills: ["communication"],
        missingSkills: [],
      },
    ]);

    vi.mocked(createInsforgeServer)
      .mockResolvedValueOnce(
        buildInitialInsforgeMock() as unknown as Awaited<
          ReturnType<typeof createInsforgeServer>
        >,
      )
      .mockResolvedValueOnce(
        buildFreshInsforgeMock(makeInsertedJob()) as unknown as Awaited<
          ReturnType<typeof createInsforgeServer>
        >,
      );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses a refreshed InsForge client before inserting jobs", async () => {
    const res = await POST(makePostRequest());

    expect(res.status).toBe(200);
    expect(createInsforgeServer).toHaveBeenNthCalledWith(2, {
      refreshSession: true,
      refreshLeewaySeconds: 600,
    });
  });

  it("saves and returns jobs instead of surfacing the stale-token insert error", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.newJobs).toBe(1);
    expect(data.jobs).toHaveLength(1);
    expect(data.error).toBeUndefined();
  });

  it("returns a session-expired response when refresh fails before save", async () => {
    vi.mocked(createInsforgeServer).mockReset();
    vi.mocked(createInsforgeServer)
      .mockResolvedValueOnce(
        buildInitialInsforgeMock() as unknown as Awaited<
          ReturnType<typeof createInsforgeServer>
        >,
      )
      .mockRejectedValueOnce(new InsforgeSessionRefreshError("Invalid refresh token"));

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/session expired/i);
  });
});
