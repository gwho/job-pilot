import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/RecentActivity";

const searchItem: ActivityItem = {
  type: "search",
  label: "Found 8 jobs for Frontend Engineer",
  timeAgo: "10 mins ago",
};

const researchItem: ActivityItem = {
  type: "research",
  label: "Researched Stripe",
  timeAgo: "1 hour ago",
};

describe("RecentActivity", () => {
  it("renders the section heading", () => {
    render(<RecentActivity items={[searchItem]} />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
  });

  it("renders a label and timestamp for every item", () => {
    render(<RecentActivity items={[searchItem, researchItem]} />);
    expect(screen.getByText("Found 8 jobs for Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("10 mins ago")).toBeInTheDocument();
    expect(screen.getByText("Researched Stripe")).toBeInTheDocument();
    expect(screen.getByText("1 hour ago")).toBeInTheDocument();
  });

  it("preserves the order items were given in", () => {
    render(<RecentActivity items={[searchItem, researchItem]} />);
    const labels = screen.getAllByText(/Found 8 jobs|Researched Stripe/);
    expect(labels[0]).toHaveTextContent("Found 8 jobs for Frontend Engineer");
    expect(labels[1]).toHaveTextContent("Researched Stripe");
  });

  it("renders the heading but no rows when items is empty", () => {
    render(<RecentActivity items={[]} />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.queryByText(/ago$/i)).not.toBeInTheDocument();
  });

  it("uses the green success dot tokens for 'search' activity", () => {
    const { container } = render(<RecentActivity items={[searchItem]} />);
    expect(container.querySelector(".bg-success-light")).toBeInTheDocument();
    expect(container.querySelector(".bg-success-alt")).toBeInTheDocument();
  });

  it("uses the blue info dot tokens for 'research' activity", () => {
    const { container } = render(<RecentActivity items={[researchItem]} />);
    expect(container.querySelector(".bg-info-light")).toBeInTheDocument();
    expect(container.querySelector(".bg-info")).toBeInTheDocument();
  });

  it("applies the surface-colored outline separator to the dot ring", () => {
    const { container } = render(<RecentActivity items={[searchItem]} />);
    const outerRing = container.querySelector(".bg-success-light") as HTMLElement;
    expect(outerRing.style.outline).toBe("1px solid var(--color-surface)");
  });

  it("separates rows with divide-y styling", () => {
    const { container } = render(<RecentActivity items={[searchItem, researchItem]} />);
    const rowsWrapper = container.querySelector(".divide-y");
    expect(rowsWrapper).toBeInTheDocument();
    expect(rowsWrapper).toHaveClass("divide-border");
    expect(rowsWrapper?.children).toHaveLength(2);
  });
});