/**
 * Unit tests for components/dashboard/StatsBar.tsx.
 *
 * Feature 15 (Stats Bar — Real Data) simplified `StatCardConfig`: the
 * optional `trend` field was removed and `subtitle` was promoted to
 * required. The trend badge (green pill + TrendingUp icon) rendering
 * branch was removed from `StatCard` — every card now renders a plain
 * label / value / subtitle, always.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsBar, type StatCardConfig } from "@/components/dashboard/StatsBar";

const baseStats: StatCardConfig[] = [
  { label: "Total Jobs Found", value: "47", subtitle: "All time" },
  { label: "Avg. Match Rate", value: "82%", subtitle: "Scored jobs only" },
  { label: "Companies Researched", value: "12", subtitle: "Completed research" },
  { label: "Jobs This Week", value: "5", subtitle: "Last 7 days" },
];

describe("StatsBar", () => {
  it("renders one card per stat entry with label, value, and subtitle", () => {
    render(<StatsBar stats={baseStats} />);

    for (const stat of baseStats) {
      expect(screen.getByText(stat.label)).toBeInTheDocument();
      expect(screen.getByText(stat.value)).toBeInTheDocument();
      expect(screen.getByText(stat.subtitle)).toBeInTheDocument();
    }
  });

  it("renders exactly as many cards as entries in the stats array", () => {
    const { container } = render(<StatsBar stats={baseStats} />);
    const grid = container.querySelector(".grid");
    expect(grid?.children).toHaveLength(4);
  });

  it("renders an empty grid when given an empty stats array", () => {
    const { container } = render(<StatsBar stats={[]} />);
    const grid = container.querySelector(".grid");
    expect(grid?.children).toHaveLength(0);
  });

  it("renders the subtitle even when the value is a dash (no-data state)", () => {
    render(
      <StatsBar
        stats={[{ label: "Avg. Match Rate", value: "—", subtitle: "Scored jobs only" }]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Scored jobs only")).toBeInTheDocument();
  });

  it("does not render any trend indicator (icon or badge) — the trend concept was removed", () => {
    const { container } = render(<StatsBar stats={baseStats} />);
    // The old trend badge rendered a lucide TrendingUp <svg> icon. StatCard
    // no longer imports or renders any icon.
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("does not render comparative trend text like 'vs last week'", () => {
    render(<StatsBar stats={baseStats} />);
    expect(screen.queryByText(/vs last week/i)).not.toBeInTheDocument();
  });

  it("supports a single stat card", () => {
    render(<StatsBar stats={[baseStats[0]]} />);
    expect(screen.getByText("Total Jobs Found")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders duplicate values across different cards independently", () => {
    const stats: StatCardConfig[] = [
      { label: "Total Jobs Found", value: "0", subtitle: "All time" },
      { label: "Jobs This Week", value: "0", subtitle: "Last 7 days" },
    ];
    render(<StatsBar stats={stats} />);
    expect(screen.getAllByText("0")).toHaveLength(2);
  });
});