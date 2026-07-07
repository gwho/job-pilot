/**
 * Unit tests for app/dashboard/page.tsx — the `hasResearchedAt` type-guard
 * refactor.
 *
 * This PR replaced an unsafe cast:
 *   const researchedAt = (row.company_research as { researchedAt?: string } | null)?.researchedAt;
 * with a runtime type guard:
 *   if (!hasResearchedAt(row.company_research)) return [];
 *   const researchedAt = row.company_research.researchedAt;
 *
 * These tests lock in the defensive behavior: malformed `company_research`
 * JSONB values (string, array, object missing the field, non-string field,
 * unparsable date) must be skipped instead of crashing or silently
 * corrupting the Recent Activity feed.
 *
 * Run: npm run test:run -- __tests__/dashboard/page.test.tsx
 */

import { render } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { createInsforgeServer } from "@/lib/insforge-server";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { redirect } from "next/navigation";
import DashboardPage from "@/app/dashboard/page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));

vi.mock("@/components/layout/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/dashboard/ProfileBanner", () => ({ ProfileBanner: () => null }));
vi.mock("@/components/dashboard/StatsBar", () => ({ StatsBar: () => null }));
vi.mock("@/components/dashboard/RecentActivity", () => ({ RecentActivity: vi.fn(() => null) }));
vi.mock("@/components/dashboard/CompanyResearchChart", () => ({
  CompanyResearchChart: () => null,
}));
vi.mock("@/components/dashboard/JobsFoundChart", () => ({ JobsFoundChart: () => null }));
vi.mock("@/components/dashboard/MatchScoreChart", () => ({ MatchScoreChart: () => null }));

// ── DB chain builder (mirrors the pattern used in __tests__/find-jobs/) ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolvedValue: unknown): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "eq", "not", "gte", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}

/**
 * The page issues 8 `.from()` calls in this fixed order:
 *   1. profiles                       (maybeSingle)
 *   2. jobs   — totalJobs (count)
 *   3. jobs   — scoredJobs
 *   4. jobs   — companiesResearched (count)
 *   5. jobs   — jobsThisWeek (count)
 *   6. agent_runs — recent completed runs
 *   7. jobs   — researchJobsResult (drives researchCandidates — the changed code)
 *   8. jobs   — recentJobsResult (found_at, for the jobs-found chart)
 *   9. jobs   — chartResearchJobsResult (company_research, for the research chart)
 */
function buildInsforgeMock({
  profile = { data: null, error: null },
  agentRuns = { data: [], error: null },
  researchJobsResult = { data: [], error: null },
}: {
  profile?: { data: unknown; error: unknown };
  agentRuns?: { data: unknown; error: unknown };
  researchJobsResult?: { data: unknown; error: unknown };
}) {
  let jobsCallIndex = 0;
  // jobs-table calls, in order: total, scored, companies, thisWeek, [researchJobsResult
  // injected at position 5], recentJobs, chartResearchJobs.
  const jobsResults = [
    { data: null, count: 0, error: null }, // total
    { data: [], error: null }, // scored
    { data: null, count: 0, error: null }, // companies
    { data: null, count: 0, error: null }, // thisWeek
    researchJobsResult, // ← the query under test
    { data: [], error: null }, // recentJobs (chart)
    { data: [], error: null }, // chartResearchJobs (chart)
  ];

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "profiles") return createChain(profile);
        if (table === "agent_runs") return createChain(agentRuns);
        // table === "jobs"
        const result = jobsResults[jobsCallIndex] ?? { data: [], error: null };
        jobsCallIndex++;
        return createChain(result);
      }),
    },
  };
}

async function renderDashboard(mock: ReturnType<typeof buildInsforgeMock>) {
  vi.mocked(createInsforgeServer).mockResolvedValue(
    mock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
  );
  const jsx = await DashboardPage();
  render(jsx);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage — research activity candidates (hasResearchedAt guard)", () => {
  it("includes a row whose company_research is a well-formed object with researchedAt", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [
            {
              id: "job-1",
              company: "Acme Corp",
              company_research: { researchedAt: new Date().toISOString() },
            },
          ],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "research-job-1",
      type: "research",
      label: "Researched Acme Corp",
    });
  });

  it("skips a row whose company_research is null", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [{ id: "job-1", company: "Acme Corp", company_research: null }],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("skips a row whose company_research is a plain string (malformed JSONB)", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [{ id: "job-1", company: "Acme Corp", company_research: "researched" }],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("skips a row whose company_research is an array", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [{ id: "job-1", company: "Acme Corp", company_research: ["researchedAt"] }],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("skips a row whose company_research object is missing the researchedAt field", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [{ id: "job-1", company: "Acme Corp", company_research: { summary: "..." } }],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("skips a row whose researchedAt field is not a string (e.g. a number)", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [
            { id: "job-1", company: "Acme Corp", company_research: { researchedAt: 12345 } },
          ],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("skips a row whose researchedAt string does not parse to a valid date", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [
            {
              id: "job-1",
              company: "Acme Corp",
              company_research: { researchedAt: "not-a-real-date" },
            },
          ],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });

  it("processes a mix of valid and invalid rows independently — one bad row must not drop the good ones", async () => {
    await renderDashboard(
      buildInsforgeMock({
        researchJobsResult: {
          data: [
            {
              id: "job-good-1",
              company: "Good Corp",
              company_research: { researchedAt: new Date().toISOString() },
            },
            { id: "job-bad-1", company: "Bad Corp", company_research: "oops" },
            {
              id: "job-good-2",
              company: "Another Good Corp",
              company_research: { researchedAt: new Date(Date.now() - 3600_000).toISOString() },
            },
            { id: "job-bad-2", company: "Bad Corp 2", company_research: null },
          ],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    const labels = items.map((i: { label: string }) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Researched Good Corp", "Researched Another Good Corp"]),
    );
  });

  it("merges research candidates with search candidates and sorts newest-first, capped at 10", async () => {
    const now = Date.now();
    const agentRuns = Array.from({ length: 6 }, (_, i) => ({
      id: `run-${i}`,
      job_title_searched: `Search ${i}`,
      jobs_found: 5,
      completed_at: new Date(now - i * 60_000).toISOString(),
    }));
    const researchRows = Array.from({ length: 6 }, (_, i) => ({
      id: `job-${i}`,
      company: `Corp ${i}`,
      company_research: { researchedAt: new Date(now - (i + 0.5) * 60_000).toISOString() },
    }));

    await renderDashboard(
      buildInsforgeMock({
        agentRuns: { data: agentRuns, error: null },
        researchJobsResult: { data: researchRows, error: null },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(10);
    // Interleaved sort: search-0 (t-0) then research-0 (t-0.5) then search-1 (t-1)...
    expect(items[0].id).toBe("search-run-0");
    expect(items[1].id).toBe("research-job-0");
    expect(items[2].id).toBe("search-run-1");
  });

  it("treats an agent_runs row with no completed_at as not-yet-finished and excludes it", async () => {
    await renderDashboard(
      buildInsforgeMock({
        agentRuns: {
          data: [
            { id: "run-1", job_title_searched: "Engineer", jobs_found: 3, completed_at: null },
          ],
          error: null,
        },
      }),
    );

    const items = vi.mocked(RecentActivity).mock.calls[0][0].items;
    expect(items).toHaveLength(0);
  });
});

describe("DashboardPage — auth guard", () => {
  it("redirects to /login when there is no authenticated user", async () => {
    vi.mocked(redirect).mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });

    const mock = buildInsforgeMock({});
    mock.auth.getCurrentUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      mock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});