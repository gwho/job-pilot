import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock recharts so we can assert on the *props our component passes*
// rather than depending on recharts' internal SVG rendering (which
// requires real layout dimensions that jsdom does not provide).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({
    children,
    data,
    barSize,
  }: {
    children: ReactNode;
    data: unknown[];
    barSize: number;
  }) => (
    <div data-testid="bar-chart" data-length={data.length} data-bar-size={barSize}>
      {children}
    </div>
  ),
  Bar: (props: { dataKey: string; fill: string; radius: number[] }) => (
    <div
      data-testid="bar"
      data-datakey={props.dataKey}
      data-fill={props.fill}
      data-radius={JSON.stringify(props.radius)}
    />
  ),
  XAxis: (props: { dataKey: string; tick?: { fill?: string } }) => (
    <div data-testid="x-axis" data-datakey={props.dataKey} data-fill={props.tick?.fill} />
  ),
  YAxis: (props: { tick?: { fill?: string }; allowDecimals?: boolean }) => (
    <div
      data-testid="y-axis"
      data-fill={props.tick?.fill}
      data-allow-decimals={String(props.allowDecimals)}
    />
  ),
  CartesianGrid: (props: { stroke: string; vertical: boolean }) => (
    <div data-testid="cartesian-grid" data-stroke={props.stroke} data-vertical={String(props.vertical)} />
  ),
}));

import { MatchScoreChart } from "@/components/dashboard/MatchScoreChart";

const data = [
  { range: "50-60%", count: 5 },
  { range: "60-70%", count: 12 },
  { range: "70-80%", count: 44 },
  { range: "80-90%", count: 85 },
  { range: "90-100%", count: 32 },
];

describe("MatchScoreChart", () => {
  it("renders the chart title", () => {
    render(<MatchScoreChart data={data} />);
    expect(screen.getByText("Match Score Distribution")).toBeInTheDocument();
  });

  it("passes the data array through to the BarChart with a 36px bar size", () => {
    render(<MatchScoreChart data={data} />);
    const chart = screen.getByTestId("bar-chart");
    expect(chart).toHaveAttribute("data-length", "5");
    expect(chart).toHaveAttribute("data-bar-size", "36");
  });

  it("configures the Bar with the success color and rounded top corners on the count field", () => {
    render(<MatchScoreChart data={data} />);
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveAttribute("data-datakey", "count");
    expect(bar).toHaveAttribute("data-fill", "var(--color-success)");
    expect(bar).toHaveAttribute("data-radius", JSON.stringify([4, 4, 0, 0]));
  });

  it("configures the XAxis to use the range field and the chart-axis color", () => {
    render(<MatchScoreChart data={data} />);
    const axis = screen.getByTestId("x-axis");
    expect(axis).toHaveAttribute("data-datakey", "range");
    expect(axis).toHaveAttribute("data-fill", "var(--color-chart-axis)");
  });

  it("configures the YAxis to disallow decimals", () => {
    render(<MatchScoreChart data={data} />);
    expect(screen.getByTestId("y-axis")).toHaveAttribute("data-allow-decimals", "false");
  });

  it("configures the CartesianGrid with the border color and no vertical lines", () => {
    render(<MatchScoreChart data={data} />);
    const grid = screen.getByTestId("cartesian-grid");
    expect(grid).toHaveAttribute("data-stroke", "var(--color-border)");
    expect(grid).toHaveAttribute("data-vertical", "false");
  });

  it("renders without crashing when given an empty data array", () => {
    render(<MatchScoreChart data={[]} />);
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-length", "0");
  });
});