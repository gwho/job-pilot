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

import { CompanyResearchChart } from "@/components/dashboard/CompanyResearchChart";

const data = [
  { day: "Mon", count: 2 },
  { day: "Tue", count: 5 },
  { day: "Wed", count: 3 },
];

describe("CompanyResearchChart", () => {
  it("renders the chart title", () => {
    render(<CompanyResearchChart data={data} />);
    expect(screen.getByText("Company Research Activity")).toBeInTheDocument();
  });

  it("passes the data array through to the BarChart with a 24px bar size", () => {
    render(<CompanyResearchChart data={data} />);
    const chart = screen.getByTestId("bar-chart");
    expect(chart).toHaveAttribute("data-length", "3");
    expect(chart).toHaveAttribute("data-bar-size", "24");
  });

  it("configures the Bar with the info color and rounded top corners on the count field", () => {
    render(<CompanyResearchChart data={data} />);
    const bar = screen.getByTestId("bar");
    expect(bar).toHaveAttribute("data-datakey", "count");
    expect(bar).toHaveAttribute("data-fill", "var(--color-info)");
    expect(bar).toHaveAttribute("data-radius", JSON.stringify([4, 4, 0, 0]));
  });

  it("configures the XAxis to use the day field and the chart-axis color", () => {
    render(<CompanyResearchChart data={data} />);
    const axis = screen.getByTestId("x-axis");
    expect(axis).toHaveAttribute("data-datakey", "day");
    expect(axis).toHaveAttribute("data-fill", "var(--color-chart-axis)");
  });

  it("configures the YAxis to disallow decimals and use the chart-axis color", () => {
    render(<CompanyResearchChart data={data} />);
    const axis = screen.getByTestId("y-axis");
    expect(axis).toHaveAttribute("data-fill", "var(--color-chart-axis)");
    expect(axis).toHaveAttribute("data-allow-decimals", "false");
  });

  it("configures the CartesianGrid with the border color and no vertical lines", () => {
    render(<CompanyResearchChart data={data} />);
    const grid = screen.getByTestId("cartesian-grid");
    expect(grid).toHaveAttribute("data-stroke", "var(--color-border)");
    expect(grid).toHaveAttribute("data-vertical", "false");
  });

  it("renders without crashing when given an empty data array", () => {
    render(<CompanyResearchChart data={[]} />);
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-length", "0");
  });
});