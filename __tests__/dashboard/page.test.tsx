/**
 * Unit tests for app/dashboard/page.tsx.
 *
 * Feature 15 (Stats Bar — Real Data) replaced the hardcoded `mockStats`
 * constant with four InsForge SDK queries run concurrently via
 * `Promise.all`: total job count, non-null match_score rows (for a
 * JS-side average), companies-researched count, and jobs-found-in-the
 * last-7-days count. This suite covers:
 *   - the auth redirect guard
 *   - correct stat computation from query results (including the "—"
 *     no-data case and rounding)
 *   - safe fallbacks + error logging when a query fails
 *   - that each of the four queries is scoped to the current user and
 *     carries the expected filter
 *
 * All child components except StatsBar are mocked out so this suite can
 * focus on the data-fetching/derivation logic that Feature 15 introduced.
 * StatsBar is left un-mocked so the final rendered stat values can be
 * asserted end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

vi.mock("@/components/layout/Navbar", () => ({
  Navbar: () => <nav data-testid="navbar" />,
}));

vi.mock("@/components/dashboard/ProfileBanner", () => ({
  ProfileBanner: ({ isComplete }: { isComplete: boolean }) => (
    <div data-testid="profile-banner" data-complete={String(isComplete)} />
  ),
}));

vi.mock("@/components/dashboard/RecentActivity", () => ({
  RecentActivity: () => <div data-testid="recent-activity" />,
}));

vi.mock("@/components/dashboard/CompanyResearchChart", () => ({
  CompanyResearchChart: () => <div data-testid="company-chart" />,
}));

vi.mock("@/components/dashboard/JobsFoundChart", () => ({
  JobsFoundChart: () => <div data-testid="jobs-chart" />,
}));

vi.mock("@/components/dashboard/MatchScoreChart", () => ({
  MatchScoreChart: () => <div data-testid="match-chart" />,
}));

import { redirect } from "next/navigation";
import { createInsforgeServer } from "@/lib/insforge-server";
import DashboardPage from "@/app/dashboard/page";

// ── DB chain builder (matches the convention used elsewhere in this repo) ──

function createChain(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "eq", "not", "gte", "insert", "update", "delete"]) {
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

type JobsQueryResult = {
  count?: number | null;
  data?: { match_score: number | null }[];
  error?: unknown;
};

function buildInsforgeMock(
  opts: {
    user?: { id: string } | null;
    isComplete?: boolean;
    totalJobsResult?: JobsQueryResult;
    scoredJobsResult?: JobsQueryResult;
    companiesResult?: JobsQueryResult;
    thisWeekResult?: JobsQueryResult;
  } = {},
) {
  const {
    user = { id: "user-1" },
    isComplete = false,
    totalJobsResult = { count: 0, error: null },
    scoredJobsResult = { data: [], error: null },
    companiesResult = { count: 0, error: null },
    thisWeekResult = { count: 0, error: null },
  } = opts;

  // The four `jobs` queries run in this fixed source order inside
  // Promise.all: total, scored, companies, thisWeek.
  const jobsResults: JobsQueryResult[] = [
    totalJobsResult,
    scoredJobsResult,
    companiesResult,
    thisWeekResult,
  ];
  const jobsChains: ReturnType<typeof createChain>[] = [];
  let jobsCallIndex = 0;

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "profiles") {
          return createChain({ data: { is_complete: isComplete }, error: null });
        }
        if (table === "jobs") {
          const result = jobsResults[jobsCallIndex] ?? { count: 0, data: [], error: null };
          jobsCallIndex += 1;
          const chain = createChain(result);
          jobsChains.push(chain);
          return chain;
        }
        return createChain({ data: null, error: null });
      }),
    },
    jobsChains,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /login when there is no authenticated user", async () => {
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ user: null }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders real stat values computed from the database results", async () => {
    const insforgeMock = buildInsforgeMock({
      isComplete: true,
      totalJobsResult: { count: 47, error: null },
      scoredJobsResult: {
        data: [{ match_score: 80 }, { match_score: 90 }],
        error: null,
      }, // average = 85
      companiesResult: { count: 12, error: null },
      thisWeekResult: { count: 5, error: null },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText("Total Jobs Found")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("All time")).toBeInTheDocument();

    expect(screen.getByText("Avg. Match Rate")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("Scored jobs only")).toBeInTheDocument();

    expect(screen.getByText("Companies Researched")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Completed research")).toBeInTheDocument();

    expect(screen.getByText("Jobs This Week")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();

    expect(screen.getByTestId("profile-banner")).toHaveAttribute(
      "data-complete",
      "true",
    );
  });

  it('shows "—" for Avg. Match Rate when there are no scored jobs', async () => {
    const insforgeMock = buildInsforgeMock({
      scoredJobsResult: { data: [], error: null },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it('shows "—" instead of "NaN%" when scoredJobsResult.data is undefined', async () => {
    const insforgeMock = buildInsforgeMock({
      // Simulates a failed query: no data array returned at all.
      scoredJobsResult: { data: undefined, error: { message: "boom" } },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("rounds the average match rate to the nearest integer (round-half-up)", async () => {
    const insforgeMock = buildInsforgeMock({
      // average = 82.5 -> rounds to 83
      scoredJobsResult: {
        data: [{ match_score: 80 }, { match_score: 85 }],
        error: null,
      },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("defaults counts to 0 and logs each failing query independently, without throwing", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = { message: "boom" };

    const insforgeMock = buildInsforgeMock({
      totalJobsResult: { count: null, error: dbError },
      scoredJobsResult: { data: undefined, error: dbError },
      companiesResult: { count: null, error: dbError },
      thisWeekResult: { count: null, error: dbError },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    // Total Jobs Found, Companies Researched, Jobs This Week all fall back to "0".
    expect(screen.getAllByText("0")).toHaveLength(3);
    // Avg. Match Rate falls back to "—" since there are no scored rows.
    expect(screen.getByText("—")).toBeInTheDocument();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[dashboard/stats] total jobs",
      dbError,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[dashboard/stats] scored jobs",
      dbError,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[dashboard/stats] companies researched",
      dbError,
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[dashboard/stats] jobs this week",
      dbError,
    );
  });

  it("does not log any [dashboard/stats] error when all queries succeed", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const insforgeMock = buildInsforgeMock();
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await DashboardPage();

    const statsErrorCalls = consoleErrorSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("[dashboard/stats]"),
    );
    expect(statsErrorCalls).toHaveLength(0);
  });

  it("scopes all four stats queries to the current user with the expected filters", async () => {
    const insforgeMock = buildInsforgeMock();
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await DashboardPage();

    const [totalChain, scoredChain, companiesChain, thisWeekChain] =
      insforgeMock.jobsChains;

    expect(insforgeMock.jobsChains).toHaveLength(4);

    // Query 1 — total jobs: head-only count, scoped to the user.
    expect(totalChain.select).toHaveBeenCalledWith("*", {
      count: "exact",
      head: true,
    });
    expect(totalChain.eq).toHaveBeenCalledWith("user_id", "user-1");

    // Query 2 — scored jobs: selects match_score, excludes nulls.
    expect(scoredChain.select).toHaveBeenCalledWith("match_score");
    expect(scoredChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(scoredChain.not).toHaveBeenCalledWith("match_score", "is", null);

    // Query 3 — companies researched: head-only count, excludes null research.
    expect(companiesChain.select).toHaveBeenCalledWith("*", {
      count: "exact",
      head: true,
    });
    expect(companiesChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(companiesChain.not).toHaveBeenCalledWith(
      "company_research",
      "is",
      null,
    );

    // Query 4 — jobs this week: head-only count, filtered by rolling cutoff.
    expect(thisWeekChain.select).toHaveBeenCalledWith("*", {
      count: "exact",
      head: true,
    });
    expect(thisWeekChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(thisWeekChain.gte).toHaveBeenCalledWith(
      "found_at",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    );
  });

  it("reflects an incomplete profile via the isComplete prop passed to ProfileBanner", async () => {
    const insforgeMock = buildInsforgeMock({ isComplete: false });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const jsx = await DashboardPage();
    render(jsx);

    expect(screen.getByTestId("profile-banner")).toHaveAttribute(
      "data-complete",
      "false",
    );
  });
});