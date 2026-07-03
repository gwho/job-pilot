import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StatCardConfig } from "@/components/dashboard/StatsBar";
import type { ActivityItem } from "@/components/dashboard/RecentActivity";

// ── Module mocks (hoisted by Vitest before any imports) ────────────────────

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

vi.mock("@/components/layout/Navbar", () => ({
  Navbar: vi.fn(() => <div data-testid="navbar" />),
}));

vi.mock("@/components/dashboard/ProfileBanner", () => ({
  ProfileBanner: vi.fn(() => <div data-testid="profile-banner" />),
}));

vi.mock("@/components/dashboard/StatsBar", () => ({
  StatsBar: vi.fn(() => <div data-testid="stats-bar" />),
}));

vi.mock("@/components/dashboard/RecentActivity", () => ({
  RecentActivity: vi.fn(() => <div data-testid="recent-activity" />),
}));

vi.mock("@/components/dashboard/CompanyResearchChart", () => ({
  CompanyResearchChart: vi.fn(() => <div data-testid="company-research-chart" />),
}));

vi.mock("@/components/dashboard/JobsFoundChart", () => ({
  JobsFoundChart: vi.fn(() => <div data-testid="jobs-found-chart" />),
}));

vi.mock("@/components/dashboard/MatchScoreChart", () => ({
  MatchScoreChart: vi.fn(() => <div data-testid="match-score-chart" />),
}));

import { redirect } from "next/navigation";
import { createInsforgeServer } from "@/lib/insforge-server";
import { ProfileBanner } from "@/components/dashboard/ProfileBanner";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { CompanyResearchChart } from "@/components/dashboard/CompanyResearchChart";
import { JobsFoundChart } from "@/components/dashboard/JobsFoundChart";
import { MatchScoreChart } from "@/components/dashboard/MatchScoreChart";
import DashboardPage from "@/app/dashboard/page";

// ── InsForge chainable query mock ───────────────────────────────────────────

function createProfileChain(resolvedValue: { data: unknown; error: unknown }) {
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  const chain = { select, eq, maybeSingle };
  select.mockReturnValue(chain);
  eq.mockReturnValue(chain);
  return chain;
}

function buildInsforgeMock(
  user: { id: string } | null,
  profileResult: { data: unknown; error: unknown },
) {
  const chain = createProfileChain(profileResult);
  const from = vi.fn().mockReturnValue(chain);
  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    database: { from },
    chain,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardPage", () => {
  describe("auth guard", () => {
    it("redirects to /login when there is no authenticated user", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock(null, { data: null, error: null }) as never,
      );

      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(redirect).toHaveBeenCalledWith("/login");
    });
  });

  describe("profile completeness banner", () => {
    it("passes isComplete=false when no profile row exists yet (new user)", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock({ id: "user-1" }, { data: null, error: null }) as never,
      );

      const ui = await DashboardPage();
      render(ui);

      expect(screen.getByTestId("profile-banner")).toBeInTheDocument();
      expect(vi.mocked(ProfileBanner).mock.calls[0][0]).toEqual({ isComplete: false });
    });

    it("passes isComplete=false when is_complete is false", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock(
          { id: "user-1" },
          { data: { is_complete: false }, error: null },
        ) as never,
      );

      const ui = await DashboardPage();
      render(ui);

      expect(vi.mocked(ProfileBanner).mock.calls[0][0]).toEqual({ isComplete: false });
    });

    it("passes isComplete=true when is_complete is true", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock(
          { id: "user-1" },
          { data: { is_complete: true }, error: null },
        ) as never,
      );

      const ui = await DashboardPage();
      render(ui);

      expect(vi.mocked(ProfileBanner).mock.calls[0][0]).toEqual({ isComplete: true });
    });

    it("derives isComplete from the returned data even if the query also reports a non-fatal error", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock(
          { id: "user-1" },
          { data: { is_complete: true }, error: { message: "some warning" } },
        ) as never,
      );

      const ui = await DashboardPage();
      render(ui);

      expect(vi.mocked(ProfileBanner).mock.calls[0][0]).toEqual({ isComplete: true });
    });
  });

  describe("profile query shape", () => {
    it("queries the profiles table for is_complete, filtered by the authenticated user's id", async () => {
      const insforgeMock = buildInsforgeMock(
        { id: "user-42" },
        { data: { is_complete: true }, error: null },
      );
      vi.mocked(createInsforgeServer).mockResolvedValue(insforgeMock as never);

      await DashboardPage();

      expect(insforgeMock.database.from).toHaveBeenCalledWith("profiles");
      expect(insforgeMock.chain.select).toHaveBeenCalledWith("is_complete");
      expect(insforgeMock.chain.eq).toHaveBeenCalledWith("id", "user-42");
      expect(insforgeMock.chain.maybeSingle).toHaveBeenCalled();
    });
  });

  describe("mock data props", () => {
    beforeEach(() => {
      vi.mocked(createInsforgeServer).mockResolvedValue(
        buildInsforgeMock({ id: "user-1" }, { data: null, error: null }) as never,
      );
    });

    it("passes 4 stat configs to StatsBar with the expected labels, values, trends, and subtitles", async () => {
      const ui = await DashboardPage();
      render(ui);

      const props = vi.mocked(StatsBar).mock.calls[0][0] as { stats: StatCardConfig[] };
      expect(props.stats).toHaveLength(4);
      expect(props.stats.map((s) => s.label)).toEqual([
        "Total Jobs Found",
        "Avg. Match Rate",
        "Companies Researched",
        "Jobs This Week",
      ]);
      expect(props.stats[0]).toEqual({
        label: "Total Jobs Found",
        value: "284",
        trend: { value: "+12%", label: "vs last week" },
      });
      expect(props.stats[1]).toEqual({
        label: "Avg. Match Rate",
        value: "82%",
        trend: { value: "+3%", label: "vs last week" },
      });
      expect(props.stats[2]).toEqual({
        label: "Companies Researched",
        value: "35",
        subtitle: "Total researched",
      });
      expect(props.stats[3]).toEqual({
        label: "Jobs This Week",
        value: "28",
        subtitle: "New this week",
      });
    });

    it("passes 5 activity items to RecentActivity in the original order", async () => {
      const ui = await DashboardPage();
      render(ui);

      const props = vi.mocked(RecentActivity).mock.calls[0][0] as { items: ActivityItem[] };
      expect(props.items).toHaveLength(5);
      expect(props.items[0]).toEqual({
        type: "search",
        label: "Found 8 jobs for Frontend Engineer",
        timeAgo: "10 mins ago",
      });
      expect(props.items[1]).toEqual({
        type: "research",
        label: "Researched Stripe",
        timeAgo: "1 hour ago",
      });
      expect(props.items[4]).toEqual({
        type: "search",
        label: "Found 10 jobs for Full Stack Engineer",
        timeAgo: "Yesterday",
      });
    });

    it("passes 7 day-count entries to CompanyResearchChart", async () => {
      const ui = await DashboardPage();
      render(ui);

      const props = vi.mocked(CompanyResearchChart).mock.calls[0][0] as {
        data: { day: string; count: number }[];
      };
      expect(props.data).toHaveLength(7);
      expect(props.data[0]).toEqual({ day: "Mon", count: 2 });
      expect(props.data[4]).toEqual({ day: "Fri", count: 12 });
    });

    it("passes 7 day-count entries to JobsFoundChart", async () => {
      const ui = await DashboardPage();
      render(ui);

      const props = vi.mocked(JobsFoundChart).mock.calls[0][0] as {
        data: { day: string; count: number }[];
      };
      expect(props.data).toHaveLength(7);
      expect(props.data[0]).toEqual({ day: "Mon", count: 15 });
      expect(props.data[4]).toEqual({ day: "Fri", count: 85 });
    });

    it("passes 5 range-count entries to MatchScoreChart", async () => {
      const ui = await DashboardPage();
      render(ui);

      const props = vi.mocked(MatchScoreChart).mock.calls[0][0] as {
        data: { range: string; count: number }[];
      };
      expect(props.data).toEqual([
        { range: "50-60%", count: 5 },
        { range: "60-70%", count: 12 },
        { range: "70-80%", count: 44 },
        { range: "80-90%", count: 85 },
        { range: "90-100%", count: 32 },
      ]);
    });

    it("renders the Navbar", async () => {
      const ui = await DashboardPage();
      render(ui);

      expect(screen.getByTestId("navbar")).toBeInTheDocument();
    });
  });
});