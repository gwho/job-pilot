import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatsBar, type StatCardConfig } from "@/components/dashboard/StatsBar";

const trendStat: StatCardConfig = {
  label: "Total Jobs Found",
  value: "284",
  trend: { value: "+12%", label: "vs last week" },
};

const subtitleStat: StatCardConfig = {
  label: "Companies Researched",
  value: "35",
  subtitle: "Total researched",
};

describe("StatsBar", () => {
  it("renders one card per stat with its label and value", () => {
    render(<StatsBar stats={[trendStat, subtitleStat]} />);
    expect(screen.getByText("Total Jobs Found")).toBeInTheDocument();
    expect(screen.getByText("284")).toBeInTheDocument();
    expect(screen.getByText("Companies Researched")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
  });

  it("renders a trend badge with the icon, trend value, and trend label when trend is present", () => {
    const { container } = render(<StatsBar stats={[trendStat]} />);
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getByText("vs last week")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("does not render a subtitle when a trend is present", () => {
    render(<StatsBar stats={[trendStat]} />);
    expect(screen.queryByText(/total researched/i)).not.toBeInTheDocument();
  });

  it("renders a subtitle instead of a trend badge when trend is absent", () => {
    const { container } = render(<StatsBar stats={[subtitleStat]} />);
    expect(screen.getByText("Total researched")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("prioritizes the trend badge over the subtitle when both are provided", () => {
    const bothStat: StatCardConfig = {
      label: "Mixed Card",
      value: "10",
      trend: { value: "+1%", label: "vs last week" },
      subtitle: "Should not show",
    };
    render(<StatsBar stats={[bothStat]} />);
    expect(screen.getByText("+1%")).toBeInTheDocument();
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
  });

  it("renders no cards when stats is an empty array", () => {
    const { container } = render(<StatsBar stats={[]} />);
    expect(container.firstElementChild).toBeEmptyDOMElement();
  });

  it("lays cards out in a 4-column grid", () => {
    const { container } = render(<StatsBar stats={[trendStat]} />);
    expect(container.firstElementChild).toHaveClass("grid", "grid-cols-4", "gap-6");
  });
});