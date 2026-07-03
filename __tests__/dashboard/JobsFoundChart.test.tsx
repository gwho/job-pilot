import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock recharts so we can assert on the *props our component passes*
// rather than depending on recharts' internal SVG rendering (which
// requires real layout dimensions that jsdom does not provide). The
// <defs>/<linearGradient>/<stop> elements are plain SVG tags authored
// directly in JobsFoundChart.tsx, so they are left unmocked and are
// asserted on directly in the DOM.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-testid="area-chart" data-length={data.length}>
      {children}
    </div>
  ),
  Area: (props: {
    dataKey: string;
    stroke: string;
    strokeWidth: number;
    fill: string;
    dot: boolean;
    type: string;
  }) => (
    <div
      data-testid="area"
      data-datakey={props.dataKey}
      data-stroke={props.stroke}
      data-stroke-width={props.strokeWidth}
      data-fill={props.fill}
      data-dot={String(props.dot)}
      data-type={props.type}
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

import { JobsFoundChart } from "@/components/dashboard/JobsFoundChart";

const data = [
  { day: "Mon", count: 15 },
  { day: "Tue", count: 32 },
  { day: "Wed", count: 28 },
];

// The `stopColor`/`stopOpacity` React props may be serialized to the DOM
// as either camelCase or the hyphenated SVG attribute name depending on
// the React version. These helpers check both forms so the assertions
// don't depend on that implementation detail.
function getStopColor(el: Element): string | null {
  return el.getAttribute("stop-color") ?? el.getAttribute("stopColor") ?? el.getAttribute("stopcolor");
}
function getStopOpacity(el: Element): string | null {
  return (
    el.getAttribute("stop-opacity") ?? el.getAttribute("stopOpacity") ?? el.getAttribute("stopopacity")
  );
}

describe("JobsFoundChart", () => {
  it("renders the chart title", () => {
    render(<JobsFoundChart data={data} />);
    expect(screen.getByText("Jobs Found Over Time")).toBeInTheDocument();
  });

  it("passes the data array through to the AreaChart", () => {
    render(<JobsFoundChart data={data} />);
    expect(screen.getByTestId("area-chart")).toHaveAttribute("data-length", "3");
  });

  it("configures the Area with the accent stroke, gradient fill, and no point dots", () => {
    render(<JobsFoundChart data={data} />);
    const area = screen.getByTestId("area");
    expect(area).toHaveAttribute("data-datakey", "count");
    expect(area).toHaveAttribute("data-stroke", "var(--color-accent)");
    expect(area).toHaveAttribute("data-stroke-width", "3");
    expect(area).toHaveAttribute("data-fill", "url(#jobsGradient)");
    expect(area).toHaveAttribute("data-dot", "false");
    expect(area).toHaveAttribute("data-type", "monotone");
  });

  it("defines a jobsGradient linear gradient fading the accent color to transparent", () => {
    const { container } = render(<JobsFoundChart data={data} />);
    const gradient = container.querySelector("#jobsGradient");
    expect(gradient).toBeInTheDocument();

    const stops = container.querySelectorAll("#jobsGradient stop");
    expect(stops).toHaveLength(2);

    expect(stops[0]).toHaveAttribute("offset", "5%");
    expect(getStopColor(stops[0])).toBe("var(--color-accent)");
    expect(getStopOpacity(stops[0])).toBe("0.2");

    expect(stops[1]).toHaveAttribute("offset", "95%");
    expect(getStopColor(stops[1])).toBe("var(--color-accent)");
    expect(getStopOpacity(stops[1])).toBe("0");
  });

  it("configures the XAxis to use the day field and the chart-axis color", () => {
    render(<JobsFoundChart data={data} />);
    const axis = screen.getByTestId("x-axis");
    expect(axis).toHaveAttribute("data-datakey", "day");
    expect(axis).toHaveAttribute("data-fill", "var(--color-chart-axis)");
  });

  it("configures the CartesianGrid with the border color and no vertical lines", () => {
    render(<JobsFoundChart data={data} />);
    const grid = screen.getByTestId("cartesian-grid");
    expect(grid).toHaveAttribute("data-stroke", "var(--color-border)");
    expect(grid).toHaveAttribute("data-vertical", "false");
  });

  it("renders without crashing when given an empty data array", () => {
    render(<JobsFoundChart data={[]} />);
    expect(screen.getByTestId("area-chart")).toHaveAttribute("data-length", "0");
  });
});