/**
 * Regression test for the "Could not save jobs" error.
 *
 * Root cause: pg_stat_statements PostgreSQL extension was not installed on the
 * InsForge database. InsForge's internals reference it during batch INSERTs,
 * causing every jobs insert to fail with:
 *   relation "pg_stat_statements" does not exist at character 76
 *
 * Fix: CREATE EXTENSION IF NOT EXISTS pg_stat_statements; (run once against DB)
 *
 * This test locks in the error-handling contract: when InsForge returns any
 * error on the jobs INSERT, the route must return status 500 with
 * { success: false, error: "Could not save jobs" } — not a 200 or crash.
 *
 * Run: npm run test:run -- __tests__/find-jobs/save-error.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/find/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";

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

// ── DB chain builder (mirrors repeated-search.test.ts) ────────────────────────

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

// InsForge mock where the jobs INSERT (2nd jobs call) returns an error.
// This simulates the pg_stat_statements extension being absent — or any other
// DB-level error that causes the batch insert to fail.
function buildInsforgeMockWithInsertError() {
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
            : createChain({ data: null, error: null });
        }
        if (table === "jobs") {
          if (n === 1) {
            // Existing-jobs SELECT — no prior jobs
            return createChain({ data: [], error: null });
          }
          // INSERT — simulates pg_stat_statements missing (or any insert error)
          return createChain({
            data: null,
            error: {
              code: "42P01",
              message:
                'relation "pg_stat_statements" does not exist at character 76',
            },
          });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — jobs insert error", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs).mockResolvedValue([
      {
        title: "Sales Coordinator",
        company: "ACME HK",
        location: "Hong Kong",
        salary: null,
        jobType: null,
        description: "Manage client accounts and coordinate sales activities.",
        sourceUrl: "https://hk.jobsdb.com/job/sales-coordinator-123",
        externalApplyUrl: null,
        postedAt: null,
      },
    ]);

    vi.mocked(scoreJobs).mockResolvedValue([
      {
        matchScore: 80,
        matchReason: "Strong sales background matches this role.",
        matchedSkills: ["communication", "CRM"],
        missingSkills: [],
      },
    ]);

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMockWithInsertError() as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns HTTP 500 when the jobs INSERT fails", async () => {
    const res = await POST(makePostRequest());
    expect(res.status).toBe(500);
  });

  it("returns success:false with 'Could not save jobs' message", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Could not save jobs");
  });

  it("does not return jobs array on insert failure", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.jobs).toBeUndefined();
  });
});
