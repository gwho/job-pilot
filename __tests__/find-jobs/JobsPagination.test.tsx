import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobsPagination } from "@/components/find-jobs/JobsPagination";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPagination(
  overrides: Partial<{
    page: number;
    totalPages: number;
    totalCount: number;
    startIdx: number;
    pageNumbers: (number | "...")[];
    pageSize: number;
    onPageChange: (page: number) => void;
  }> = {},
) {
  const onPageChange = overrides.onPageChange ?? vi.fn();
  const props = {
    page: 1,
    totalPages: 5,
    totalCount: 100,
    startIdx: 0,
    pageNumbers: [1, 2, 3, 4, 5] as (number | "...")[],
    pageSize: 20,
    onPageChange,
    ...overrides,
  };
  const result = render(<JobsPagination {...props} />);
  return { ...result, onPageChange };
}

// ---------------------------------------------------------------------------
// Results count display
// ---------------------------------------------------------------------------
describe("JobsPagination — results count display", () => {
  it("shows 'No results' when totalCount is 0", () => {
    renderPagination({ totalCount: 0, startIdx: 0 });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("does not show 'No results' when totalCount > 0", () => {
    renderPagination({ totalCount: 50, startIdx: 0 });
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("shows correct start, end, and total for the first page", () => {
    renderPagination({ page: 1, totalCount: 100, startIdx: 0, pageSize: 20 });
    // Showing 1 to 20 of 100 results
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("uses pageSize prop (not a hard-coded constant) for the upper bound", () => {
    // pageSize=10 on startIdx=0, totalCount=50 → showing 1 to 10
    renderPagination({ page: 1, totalCount: 50, startIdx: 0, pageSize: 10 });
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("clamps upper bound to totalCount on the last partial page", () => {
    // 3 items on the last page: startIdx=40, pageSize=20, totalCount=43 → showing 41 to 43
    renderPagination({ page: 3, totalCount: 43, startIdx: 40, pageSize: 20 });
    expect(screen.getByText("43")).toBeInTheDocument();
  });

  it("calculates upper bound as Math.min(startIdx + pageSize, totalCount)", () => {
    // Exactly a full page: startIdx=20, pageSize=20, totalCount=60 → to=40
    renderPagination({ page: 2, totalCount: 60, startIdx: 20, pageSize: 20 });
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("shows correct start index (startIdx + 1) as the lower bound", () => {
    // Page 2 with pageSize 20: startIdx=20 → showing 21 to ...
    renderPagination({ page: 2, totalCount: 100, startIdx: 20, pageSize: 20 });
    expect(screen.getByText("21")).toBeInTheDocument();
  });

  it("handles pageSize other than 20 correctly (regression: old hard-coded value)", () => {
    // If the component hard-coded PAGE_SIZE=6, this would fail when pageSize=25 is passed
    renderPagination({ page: 1, totalCount: 100, startIdx: 0, pageSize: 25 });
    expect(screen.getByText("25")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Previous button
// ---------------------------------------------------------------------------
describe("JobsPagination — Previous button", () => {
  it("is disabled on page 1", () => {
    renderPagination({ page: 1, totalPages: 5 });
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("is enabled on pages beyond page 1", () => {
    renderPagination({ page: 2, totalPages: 5 });
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();
  });

  it("calls onPageChange with page - 1 when clicked", () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        page={3}
        totalPages={5}
        totalCount={100}
        startIdx={40}
        pageNumbers={[1, 2, 3, 4, 5]}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// Next button
// ---------------------------------------------------------------------------
describe("JobsPagination — Next button", () => {
  it("is disabled on the last page", () => {
    renderPagination({ page: 5, totalPages: 5 });
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("is enabled when not on the last page", () => {
    renderPagination({ page: 3, totalPages: 5 });
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });

  it("calls onPageChange with page + 1 when clicked", () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        page={2}
        totalPages={5}
        totalCount={100}
        startIdx={20}
        pageNumbers={[1, 2, 3, 4, 5]}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

// ---------------------------------------------------------------------------
// Page number buttons
// ---------------------------------------------------------------------------
describe("JobsPagination — page number buttons", () => {
  it("renders a button for each numeric page in pageNumbers", () => {
    renderPagination({ pageNumbers: [1, 2, 3, 4, 5] });
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("button", { name: String(n) })).toBeInTheDocument();
    }
  });

  it("calls onPageChange with the page number when a numbered button is clicked", () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        page={1}
        totalPages={5}
        totalCount={100}
        startIdx={0}
        pageNumbers={[1, 2, 3, 4, 5]}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("renders ellipsis spans (not buttons) for '...' entries", () => {
    renderPagination({ pageNumbers: [1, "...", 5] });
    expect(screen.queryByRole("button", { name: "..." })).not.toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("renders multiple ellipsis entries correctly", () => {
    renderPagination({ page: 10, pageNumbers: [1, "...", 9, 10, 11, "...", 20] });
    const ellipses = screen.getAllByText("...");
    expect(ellipses).toHaveLength(2);
  });

  it("applies bg-accent class to the current page button", () => {
    const { container } = render(
      <JobsPagination
        page={3}
        totalPages={5}
        totalCount={100}
        startIdx={40}
        pageNumbers={[1, 2, 3, 4, 5]}
        pageSize={20}
        onPageChange={vi.fn()}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const page3Btn = buttons.find((b) => b.textContent === "3");
    expect(page3Btn?.className).toContain("bg-accent");
  });

  it("does not apply bg-accent to non-current page buttons", () => {
    const { container } = render(
      <JobsPagination
        page={3}
        totalPages={5}
        totalCount={100}
        startIdx={40}
        pageNumbers={[1, 2, 3, 4, 5]}
        pageSize={20}
        onPageChange={vi.fn()}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const page1Btn = buttons.find((b) => b.textContent === "1");
    expect(page1Btn?.className).not.toContain("bg-accent");
  });
});

// ---------------------------------------------------------------------------
// Single-page edge case
// ---------------------------------------------------------------------------
describe("JobsPagination — single page", () => {
  it("disables both Previous and Next on page 1 of 1", () => {
    renderPagination({ page: 1, totalPages: 1, pageNumbers: [1] });
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("shows correct count for a single page with fewer items than pageSize", () => {
    renderPagination({
      page: 1,
      totalPages: 1,
      totalCount: 7,
      startIdx: 0,
      pageNumbers: [1],
      pageSize: 20,
    });
    // "Showing 1 to 7 of 7 results" — "7" appears twice
    const sevens = screen.getAllByText("7");
    expect(sevens).toHaveLength(2);
  });
});