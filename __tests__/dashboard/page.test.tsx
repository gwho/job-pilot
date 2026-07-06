/**
 * Feature 17 — Analytics Charts Real Data.
 *
 * `app/dashboard/page.tsx` replaced three mock chart-data constants with DB
 * aggregation. This suite exercises the three module-level aggregation
 * functions (`buildJobsFoundByDay`, `buildResearchByDay`,
 * `buildMatchScoreDistribution`) and the `hasResearchedAt` type predicate
 * indirectly, by rendering the Server Component (calling the async function
 * directly, as it does no request-scoped work once its dependencies are
 * mocked) and inspecting the `data` prop each mocked chart component
 * receives.
 *
 * All child components are mocked so the test surface is limited to
 * `DashboardPage`'s own query-wiring and aggregation logic — nothing here
 * exercises `StatsBar`/`RecentActivity` internals (Feature 15/16, unchanged).
 *
 * Run: npm run test:run -- __tests__/dashboard/page.test.tsx
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Module mocks (hoisted by Vitest before any imports) ───────────────────────

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/components/layout/Navbar", () => ({
  Navbar: () => <div data-testid="navbar" />,
}));
vi.mock("@/components/dashboard/ProfileBanner", () => ({
  ProfileBanner: () => <div data-testid="profile-banner" />,
}));
vi.mock("@/components/dashboard/StatsBar", () => ({
  StatsBar: () => <div data-testid="stats-bar" />,
}));
vi.mock("@/components/dashboard/RecentActivity", () => ({
  RecentActivity: () => <div data-testid="recent-activity" />,
}));
vi.mock("@/components/dashboard/CompanyResearchChart", () => ({
  CompanyResearchChart: ({ data }: { data: unknown }) => (
    <div data-testid="company-research-chart">{JSON.stringify(data)}</div>
  ),
}));
vi.mock("@/components/dashboard/JobsFoundChart", () => ({
  JobsFoundChart: ({ data }: { data: unknown }) => (
    <div data-testid="jobs-found-chart">{JSON.stringify(data)}</div>
  ),
}));
vi.mock("@/components/dashboard/MatchScoreChart", () => ({
  MatchScoreChart: ({ data }: { data: unknown }) => (
    <div data-testid="match-score-chart">{JSON.stringify(data)}</div>
  ),
}));

import DashboardPage from "@/app/dashboard/page";
import { createInsforgeServer } from "@/lib/insforge-server";

// ── DB chain builders ──────────────────────────────────────────────────────────

// A chain whose terminal resolution never depends on the query built on it —
// used for tables/queries not under test in this suite (profiles, agent_runs,
// and the Feature 15/16 "jobs" queries that select "*" or the activity-feed
// column list).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createSimpleChain(resolvedValue: unknown): Record<string, any> {
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

type DashboardFixtures = {
  scoredJobs?: { match_score: number | null }[];
  recentJobs?: { found_at: string }[];
  recentJobsError?: { message: string } | null;
  chartResearchJobs?: { company_research: unknown }[];
  chartResearchError?: { message: string } | null;
  profileIsComplete?: boolean;
};

// A "jobs" table chain whose resolved value is determined by the exact
// `select()` field-list argument — this mirrors the real query shapes in
// page.tsx and avoids depending on Promise.all call ordering.
function makeJobsChain(fixtures: DashboardFixtures) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  let resolved: unknown = { data: null, count: 0, error: null };

  for (const m of ["eq", "not", "gte", "order", "limit", "insert", "update", "delete"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  chain.select = vi.fn().mockImplementation((fields: string) => {
    if (fields === "match_score") {
      resolved = { data: fixtures.scoredJobs ?? [], error: null };
    } else if (fields === "found_at") {
      resolved = fixtures.recentJobsError
        ? { data: null, error: fixtures.recentJobsError }
        : { data: fixtures.recentJobs ?? [], error: null };
    } else if (fields === "company_research") {
      resolved = fixtures.chartResearchError
        ? { data: null, error: fixtures.chartResearchError }
        : { data: fixtures.chartResearchJobs ?? [], error: null };
    } else if (fields === "id, company, company_research") {
      resolved = { data: [], error: null }; // Feature 16 activity feed, unchanged
    } else {
      resolved = { data: null, count: 0, error: null }; // Feature 15 stats, unchanged
    }
    return chain;
  });

  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(resolved));
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(resolved));
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolved).then(onFulfilled, onRejected);

  return chain;
}

function buildDashboardInsforgeMock(fixtures: DashboardFixtures = {}) {
  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "profiles") {
          return createSimpleChain({
            data: { is_complete: fixtures.profileIsComplete ?? true },
            error: null,
          });
        }
        if (table === "agent_runs") {
          return createSimpleChain({ data: [], error: null });
        }
        if (table === "jobs") {
          return makeJobsChain(fixtures);
        }
        return createSimpleChain({ data: null, error: null });
      }),
    },
  };
}

// ── Date helpers (mirror the bucket labeling in page.tsx using native Date,
//    not the aggregation logic under test) ─────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDaysAgoAt(n: number, hours: number, minutes = 0, seconds = 0, ms = 0): string {
  const d = daysAgo(n);
  d.setHours(hours, minutes, seconds, ms);
  return d.toISOString();
}

function expectedBucketLabels(): string[] {
  // oldest (6 days ago) → newest (today)
  return Array.from({ length: 7 }, (_, i) => DAY_NAMES[daysAgo(6 - i).getDay()]);
}

async function renderDashboard(fixtures: DashboardFixtures = {}) {
  vi.mocked(createInsforgeServer).mockResolvedValue(
    buildDashboardInsforgeMock(fixtures) as Awaited<
      ReturnType<typeof createInsforgeServer>
    >,
  );
  const ui = await DashboardPage();
  render(ui);
}

function getChartData<T>(testId: string): T {
  return JSON.parse(screen.getByTestId(testId).textContent ?? "[]") as T;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fixed "now" so calendar-day bucketing is deterministic. Wednesday.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-08T12:00:00.000"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Jobs Found Over Time — buildJobsFoundByDay
// ─────────────────────────────────────────────────────────────────────────────

describe("Jobs Found Over Time chart data (buildJobsFoundByDay)", () => {
  it("returns 7 zero-filled buckets, oldest to newest, when there are no jobs", async () => {
    await renderDashboard({ recentJobs: [] });

    const data = getChartData<{ day: string; count: number }[]>(
      "jobs-found-chart",
    );

    expect(data).toHaveLength(7);
    expect(data.map((d) => d.day)).toEqual(expectedBucketLabels());
    expect(data.every((d) => d.count === 0)).toBe(true);
  });

  it("groups jobs into the correct calendar-day bucket", async () => {
    await renderDashboard({
      recentJobs: [
        { found_at: isoDaysAgoAt(0, 9) }, // today
        { found_at: isoDaysAgoAt(2, 14) }, // 2 days ago
        { found_at: isoDaysAgoAt(2, 20) }, // 2 days ago (same day, 2nd job)
        { found_at: isoDaysAgoAt(6, 1) }, // oldest displayed day
      ],
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "jobs-found-chart",
    );
    const byLabel = new Map(data.map((d) => [d.day, d.count]));

    expect(byLabel.get(DAY_NAMES[daysAgo(0).getDay()])).toBe(1);
    expect(byLabel.get(DAY_NAMES[daysAgo(2).getDay()])).toBe(2);
    expect(byLabel.get(DAY_NAMES[daysAgo(6).getDay()])).toBe(1);
    expect(data.reduce((sum, d) => sum + d.count, 0)).toBe(4);
  });

  it("falls back to zero-filled buckets and logs an error when the query fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderDashboard({
      recentJobsError: { message: "db unavailable" },
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "jobs-found-chart",
    );

    expect(data.every((d) => d.count === 0)).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[dashboard/charts] recent jobs",
      { message: "db unavailable" },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Company Research Activity — buildResearchByDay
// ─────────────────────────────────────────────────────────────────────────────

describe("Company Research Activity chart data (buildResearchByDay)", () => {
  it("returns 7 zero-filled buckets when there is no research history", async () => {
    await renderDashboard({ chartResearchJobs: [] });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );

    expect(data).toHaveLength(7);
    expect(data.map((d) => d.day)).toEqual(expectedBucketLabels());
    expect(data.every((d) => d.count === 0)).toBe(true);
  });

  it("includes a research event at the exact start of the oldest displayed day (calendar-day cutoff)", async () => {
    // oldest bucket = 6 days ago; midnight of that day is the cutoff.
    const oldestMidnight = isoDaysAgoAt(6, 0, 0, 0, 0);

    await renderDashboard({
      chartResearchJobs: [
        { company_research: { researchedAt: oldestMidnight } },
      ],
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );
    const oldestLabel = DAY_NAMES[daysAgo(6).getDay()];
    const byLabel = new Map(data.map((d) => [d.day, d.count]));

    expect(byLabel.get(oldestLabel)).toBe(1);
  });

  it("excludes a research event 1ms before the calendar-day cutoff (midnight of the oldest displayed day)", async () => {
    const justBeforeCutoffDate = daysAgo(6);
    justBeforeCutoffDate.setHours(0, 0, 0, 0);
    justBeforeCutoffDate.setMilliseconds(-1); // 7 days ago, 23:59:59.999

    await renderDashboard({
      chartResearchJobs: [
        { company_research: { researchedAt: justBeforeCutoffDate.toISOString() } },
      ],
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );

    expect(data.every((d) => d.count === 0)).toBe(true);
  });

  it("excludes rows whose company_research has no valid researchedAt string", async () => {
    await renderDashboard({
      chartResearchJobs: [
        { company_research: null },
        { company_research: {} },
        { company_research: { researchedAt: 12345 } }, // wrong type
        { company_research: "not-an-object" },
        { company_research: { researchedAt: "not-a-real-date" } }, // unparseable
      ],
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );

    expect(data.every((d) => d.count === 0)).toBe(true);
  });

  it("counts multiple valid research events landing on the same day", async () => {
    await renderDashboard({
      chartResearchJobs: [
        { company_research: { researchedAt: isoDaysAgoAt(1, 8) } },
        { company_research: { researchedAt: isoDaysAgoAt(1, 15) } },
        { company_research: { researchedAt: isoDaysAgoAt(1, 22) } },
      ],
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );
    const byLabel = new Map(data.map((d) => [d.day, d.count]));

    expect(byLabel.get(DAY_NAMES[daysAgo(1).getDay()])).toBe(3);
  });

  it("falls back to zero-filled buckets and logs an error when the query fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderDashboard({
      chartResearchError: { message: "db unavailable" },
    });

    const data = getChartData<{ day: string; count: number }[]>(
      "company-research-chart",
    );

    expect(data.every((d) => d.count === 0)).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[dashboard/charts] research chart",
      { message: "db unavailable" },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Match Score Distribution — buildMatchScoreDistribution
// ─────────────────────────────────────────────────────────────────────────────

describe("Match Score Distribution chart data (buildMatchScoreDistribution)", () => {
  it("always returns all five fixed ranges in order, even when every bucket is empty", async () => {
    await renderDashboard({ scoredJobs: [] });

    const data = getChartData<{ range: string; count: number }[]>(
      "match-score-chart",
    );

    expect(data.map((d) => d.range)).toEqual([
      "50-60%",
      "60-70%",
      "70-80%",
      "80-90%",
      "90-100%",
    ]);
    expect(data.every((d) => d.count === 0)).toBe(true);
  });

  it("buckets scores into the correct range, inclusive of both boundaries", async () => {
    await renderDashboard({
      scoredJobs: [
        { match_score: 50 }, // "50-60%" lower bound
        { match_score: 59 }, // "50-60%" upper bound
        { match_score: 60 }, // "60-70%" lower bound
        { match_score: 69 },
        { match_score: 70 }, // "70-80%" lower bound
        { match_score: 79 },
        { match_score: 80 }, // "80-90%" lower bound
        { match_score: 89 },
        { match_score: 90 }, // "90-100%" lower bound
        { match_score: 100 }, // "90-100%" upper bound
      ],
    });

    const data = getChartData<{ range: string; count: number }[]>(
      "match-score-chart",
    );
    const byRange = new Map(data.map((d) => [d.range, d.count]));

    expect(byRange.get("50-60%")).toBe(2);
    expect(byRange.get("60-70%")).toBe(2);
    expect(byRange.get("70-80%")).toBe(2);
    expect(byRange.get("80-90%")).toBe(2);
    expect(byRange.get("90-100%")).toBe(2);
  });

  it("excludes scores below 50", async () => {
    await renderDashboard({
      scoredJobs: [
        { match_score: 0 },
        { match_score: 49 },
        { match_score: 55 },
      ],
    });

    const data = getChartData<{ range: string; count: number }[]>(
      "match-score-chart",
    );
    const total = data.reduce((sum, d) => sum + d.count, 0);

    expect(total).toBe(1); // only the 55 counts
  });

  it("excludes rows with a null match_score", async () => {
    await renderDashboard({
      scoredJobs: [{ match_score: null }, { match_score: 85 }],
    });

    const data = getChartData<{ range: string; count: number }[]>(
      "match-score-chart",
    );
    const total = data.reduce((sum, d) => sum + d.count, 0);

    expect(total).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New chart-query wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("New chart queries wiring", () => {
  it("issues a jobs query selecting only 'found_at' for the Jobs Found chart", async () => {
    const insforgeMock = buildDashboardInsforgeMock({ recentJobs: [] });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await DashboardPage();

    const fromCalls = insforgeMock.database.from.mock.calls
      .map((c) => c[0])
      .filter((t) => t === "jobs");
    expect(fromCalls.length).toBeGreaterThanOrEqual(1);

    // Every "jobs" chain independently records its own select() calls; verify
    // that at least one was invoked with the exact chart field lists.
    const selectArgs = insforgeMock.database.from.mock.results
      .map((r) => r.value)
      .filter((chain) => typeof chain?.select === "function")
      .flatMap((chain) => chain.select.mock.calls.map((c: unknown[]) => c[0]));

    expect(selectArgs).toContain("found_at");
    expect(selectArgs).toContain("company_research");
  });
});