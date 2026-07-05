/**
 * Tests for the dashboard page's Recent Activity data wiring
 * (Feature 16 — Recent Activity Real Data).
 *
 * Covers the new logic added to `app/dashboard/page.tsx`:
 *   - Two new InsForge queries (`agent_runs` completed runs, `jobs` with
 *     `company_research IS NOT NULL`) added to the existing `Promise.all`.
 *   - Normalization of each source into `ActivityItem`s with source-qualified
 *     `id`s (`search-<run.id>` / `research-<job.id>`).
 *   - Research events use `company_research.researchedAt`, never `found_at`.
 *   - `agent_runs` rows without `completed_at` are filtered out.
 *   - Research rows without a valid `researchedAt` are filtered out.
 *   - The two candidate lists are merged, sorted by recency, and capped to 10
 *     with no per-source quota.
 *   - Query failures degrade to `[]` and log with the `[dashboard/activity]`
 *     prefix instead of throwing.
 *   - The unauthenticated redirect and the (unchanged) stats calculation
 *     still work correctly now that the `Promise.all` array has grown from
 *     4 to 6 entries (a reordering bug here would silently corrupt stats).
 *
 * Run: npm run test:run -- __tests__/dashboard/page.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { redirect } from "next/navigation";
import DashboardPage from "@/app/dashboard/page";
import { createInsforgeServer } from "@/lib/insforge-server";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { formatRelativeDate } from "@/lib/utils";
import type { ActivityItem } from "@/components/dashboard/RecentActivity";
import type { StatCardConfig } from "@/components/dashboard/StatsBar";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));

vi.mock("@/components/layout/Navbar", () => ({
  Navbar: () => null,
}));
vi.mock("@/components/dashboard/ProfileBanner", () => ({
  ProfileBanner: vi.fn(() => null),
}));
vi.mock("@/components/dashboard/StatsBar", () => ({
  StatsBar: vi.fn((_props: { stats: unknown[] }) => null),
}));
vi.mock("@/components/dashboard/RecentActivity", () => ({
  RecentActivity: vi.fn((_props: { items: unknown[] }) => null),
}));
vi.mock("@/components/dashboard/CompanyResearchChart", () => ({
  CompanyResearchChart: () => null,
}));
vi.mock("@/components/dashboard/JobsFoundChart", () => ({
  JobsFoundChart: () => null,
}));
vi.mock("@/components/dashboard/MatchScoreChart", () => ({
  MatchScoreChart: () => null,
}));

// ── DB chain builder (mirrors __tests__/find-jobs/repeated-search.test.ts) ────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolvedValue: unknown): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "not", "gte", "order", "limit"]) {
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

type AgentRunRow = {
  id: string;
  job_title_searched: string | null;
  jobs_found: number | null;
  completed_at: string | null;
};

type ResearchJobRow = {
  id: string;
  company: string | null;
  company_research: Record<string, unknown> | null;
};

// Builds the InsForge mock for the dashboard page's queries. `database.from`
// call order for a single page render is:
//   profiles (1) -> jobs (1: total) -> jobs (2: scored) -> jobs (3: companies)
//   -> jobs (4: thisWeek) -> agent_runs (1) -> jobs (5: research)
// (Promise.all evaluates array elements left-to-right before awaiting.)
function buildInsforgeMock(opts: {
  userId?: string | null;
  profile?: { is_complete: boolean } | null;
  totalJobsCount?: number;
  scoredJobs?: { match_score: number | null }[];
  companiesCount?: number;
  thisWeekCount?: number;
  agentRuns?: AgentRunRow[];
  researchJobs?: ResearchJobRow[];
  agentRunsError?: { message: string } | null;
  researchJobsError?: { message: string } | null;
}) {
  const {
    userId = "user-1",
    profile = { is_complete: true },
    totalJobsCount = 0,
    scoredJobs = [],
    companiesCount = 0,
    thisWeekCount = 0,
    agentRuns = [],
    researchJobs = [],
    agentRunsError = null,
    researchJobsError = null,
  } = opts;

  const callCounts: Record<string, number> = {};

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        callCounts[table] = (callCounts[table] ?? 0) + 1;
        const n = callCounts[table];

        if (table === "profiles") {
          return createChain({ data: profile, error: null });
        }
        if (table === "agent_runs") {
          return createChain({
            data: agentRunsError ? null : agentRuns,
            error: agentRunsError,
          });
        }
        if (table === "jobs") {
          if (n === 1) return createChain({ data: null, count: totalJobsCount, error: null });
          if (n === 2) return createChain({ data: scoredJobs, error: null });
          if (n === 3) return createChain({ data: null, count: companiesCount, error: null });
          if (n === 4) return createChain({ data: null, count: thisWeekCount, error: null });
          // n === 5: research candidates query
          return createChain({
            data: researchJobsError ? null : researchJobs,
            error: researchJobsError,
          });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}

function mockInsforge(opts: Parameters<typeof buildInsforgeMock>[0] = {}) {
  vi.mocked(createInsforgeServer).mockResolvedValue(
    buildInsforgeMock(opts) as Awaited<ReturnType<typeof createInsforgeServer>>,
  );
}

// Returns the `items` prop most recently passed to the mocked RecentActivity.
function getRenderedActivityItems(): ActivityItem[] {
  const calls = vi.mocked(RecentActivity).mock.calls;
  const lastCall = calls[calls.length - 1];
  return (lastCall[0] as { items: ActivityItem[] }).items;
}

// Returns the `stats` prop most recently passed to the mocked StatsBar.
function getRenderedStats(): StatCardConfig[] {
  const calls = vi.mocked(StatsBar).mock.calls;
  const lastCall = calls[calls.length - 1];
  return (lastCall[0] as { stats: StatCardConfig[] }).stats;
}

const NOW = new Date("2026-07-05T12:00:00.000Z");

function minutesAgoIso(minutes: number) {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DashboardPage — Recent Activity data wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("redirects to /login when there is no authenticated user", async () => {
    mockInsforge({ userId: null });
    await expect(DashboardPage()).rejects.toThrow();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("passes an empty items array to RecentActivity when there is no activity", async () => {
    mockInsforge({ agentRuns: [], researchJobs: [] });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([]);
  });

  it("builds a search activity item from a completed agent_runs row", async () => {
    mockInsforge({
      agentRuns: [
        {
          id: "run-1",
          job_title_searched: "Frontend Engineer",
          jobs_found: 8,
          completed_at: minutesAgoIso(10),
        },
      ],
      researchJobs: [],
    });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([
      {
        id: "search-run-1",
        type: "search",
        label: "Found 8 jobs for Frontend Engineer",
        timeAgo: formatRelativeDate(minutesAgoIso(10)),
      },
    ]);
  });

  it("builds a research activity item using company_research.researchedAt, not found_at", async () => {
    mockInsforge({
      agentRuns: [],
      researchJobs: [
        {
          id: "job-1",
          company: "Stripe",
          company_research: { researchedAt: minutesAgoIso(60) },
        },
      ],
    });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([
      {
        id: "research-job-1",
        type: "research",
        label: "Researched Stripe",
        timeAgo: formatRelativeDate(minutesAgoIso(60)),
      },
    ]);
  });

  it("merges and sorts search and research items by recency, most recent first", async () => {
    mockInsforge({
      agentRuns: [
        {
          id: "run-old",
          job_title_searched: "Backend Engineer",
          jobs_found: 3,
          completed_at: minutesAgoIso(120),
        },
      ],
      researchJobs: [
        {
          id: "job-new",
          company: "Vercel",
          company_research: { researchedAt: minutesAgoIso(5) },
        },
      ],
    });
    render(await DashboardPage());
    const items = getRenderedActivityItems();
    expect(items.map((i) => i.id)).toEqual(["research-job-new", "search-run-old"]);
  });

  it("filters out agent_runs rows with a null completed_at", async () => {
    mockInsforge({
      agentRuns: [
        {
          id: "run-incomplete",
          job_title_searched: "Data Analyst",
          jobs_found: null,
          completed_at: null,
        },
        {
          id: "run-complete",
          job_title_searched: "Data Analyst",
          jobs_found: 4,
          completed_at: minutesAgoIso(1),
        },
      ],
      researchJobs: [],
    });
    render(await DashboardPage());
    const items = getRenderedActivityItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("search-run-complete");
  });

  it("filters out research rows missing a researchedAt field", async () => {
    mockInsforge({
      agentRuns: [],
      researchJobs: [
        { id: "job-no-timestamp", company: "Acme", company_research: {} },
        {
          id: "job-with-timestamp",
          company: "Acme",
          company_research: { researchedAt: minutesAgoIso(2) },
        },
      ],
    });
    render(await DashboardPage());
    const items = getRenderedActivityItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("research-job-with-timestamp");
  });

  it("filters out research rows with an unparseable researchedAt value", async () => {
    mockInsforge({
      agentRuns: [],
      researchJobs: [
        {
          id: "job-bad-date",
          company: "Acme",
          company_research: { researchedAt: "not-a-real-date" },
        },
      ],
    });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([]);
  });

  it("falls back to 'your search' and 0 jobs when agent_runs fields are null", async () => {
    mockInsforge({
      agentRuns: [
        {
          id: "run-null-fields",
          job_title_searched: null,
          jobs_found: null,
          completed_at: minutesAgoIso(1),
        },
      ],
      researchJobs: [],
    });
    render(await DashboardPage());
    const items = getRenderedActivityItems();
    expect(items[0].label).toBe("Found 0 jobs for your search");
  });

  it("falls back to 'company' when a research row has no company name", async () => {
    mockInsforge({
      agentRuns: [],
      researchJobs: [
        {
          id: "job-no-company",
          company: null,
          company_research: { researchedAt: minutesAgoIso(1) },
        },
      ],
    });
    render(await DashboardPage());
    const items = getRenderedActivityItems();
    expect(items[0].label).toBe("Researched company");
  });

  it("caps the merged activity feed at 10 items with no per-source quota", async () => {
    // 8 search candidates at odd minute offsets, 8 research candidates at
    // even minute offsets. Interleaved by recency: 1(s) 2(r) 3(s) 4(r) ...
    // The 10 most recent are minutes 1-10, i.e. 5 search + 5 research.
    const agentRuns: AgentRunRow[] = [1, 3, 5, 7, 9, 11, 13, 15].map((min, i) => ({
      id: `s${i + 1}`,
      job_title_searched: "Engineer",
      jobs_found: 1,
      completed_at: minutesAgoIso(min),
    }));
    const researchJobs: ResearchJobRow[] = [2, 4, 6, 8, 10, 12, 14, 16].map((min, i) => ({
      id: `r${i + 1}`,
      company: "Acme",
      company_research: { researchedAt: minutesAgoIso(min) },
    }));

    mockInsforge({ agentRuns, researchJobs });
    render(await DashboardPage());
    const items = getRenderedActivityItems();

    expect(items).toHaveLength(10);
    expect(items.map((i) => i.id)).toEqual([
      "search-s1",
      "research-r1",
      "search-s2",
      "research-r2",
      "search-s3",
      "research-r3",
      "search-s4",
      "research-r4",
      "search-s5",
      "research-r5",
    ]);
  });

  it("degrades to an empty search list and logs with [dashboard/activity] when agent_runs errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsforge({
      agentRunsError: { message: "boom" },
      researchJobs: [],
    });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[dashboard/activity] agent_runs",
      { message: "boom" },
    );
  });

  it("degrades to an empty research list and logs with [dashboard/activity] when the jobs research query errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsforge({
      agentRuns: [],
      researchJobsError: { message: "boom" },
    });
    render(await DashboardPage());
    expect(getRenderedActivityItems()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[dashboard/activity] jobs",
      { message: "boom" },
    );
  });

  it("still computes stats correctly now that the Promise.all array has 6 entries", async () => {
    mockInsforge({
      totalJobsCount: 42,
      scoredJobs: [{ match_score: 80 }, { match_score: 60 }],
      companiesCount: 5,
      thisWeekCount: 7,
    });
    render(await DashboardPage());
    const stats = getRenderedStats();
    expect(stats).toEqual([
      { label: "Total Jobs Found", value: "42", subtitle: "All time" },
      { label: "Avg. Match Rate", value: "70%", subtitle: "Scored jobs only" },
      { label: "Companies Researched", value: "5", subtitle: "Completed research" },
      { label: "Jobs This Week", value: "7", subtitle: "Last 7 days" },
    ]);
  });
});