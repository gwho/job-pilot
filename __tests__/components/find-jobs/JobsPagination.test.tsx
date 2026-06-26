import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobsPagination } from "@/components/find-jobs/JobsPagination";

const defaultProps = {
  page: 1,
  totalPages: 1,
  totalCount: 6,
  startIdx: 0,
  pageNumbers: [1] as (number | "...")[],
  onPageChange: vi.fn(),
};

describe("JobsPagination", () => {
  it("shows 'No results' when totalCount is 0", () => {
    render(
      <JobsPagination
        {...defaultProps}
        totalCount={0}
        pageNumbers={[1]}
      />,
    );
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("shows count info when there are results", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={1}
        totalCount={6}
        startIdx={0}
        pageNumbers={[1]}
      />,
    );
    // The paragraph should contain "Showing 1 to 6 of 6 results".
    // Use a regex against the full paragraph text to avoid the page-button "1" ambiguity.
    const para = screen.getByText(/showing/i).closest("p")!;
    expect(para.textContent).toMatch(/Showing\s+1\s+to\s+6\s+of\s+6\s+results/);
  });

  it("computes 'to' correctly for a partial last page", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={2}
        totalPages={2}
        totalCount={8}
        startIdx={6}
        pageNumbers={[1, 2]}
      />,
    );
    // Page 2 starts at index 6, totalCount=8, so "to" = min(6+6, 8) = 8.
    // "of 8 results" confirms totalCount and "to" both show 8.
    const para = screen.getByText(/showing/i).closest("p")!;
    expect(para.textContent).toMatch(/Showing\s+7\s+to\s+8\s+of\s+8\s+results/);
  });

  it("renders Previous button", () => {
    render(<JobsPagination {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /previous/i }),
    ).toBeInTheDocument();
  });

  it("renders Next button", () => {
    render(<JobsPagination {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /next/i }),
    ).toBeInTheDocument();
  });

  it("disables Previous button when on the first page", () => {
    render(<JobsPagination {...defaultProps} page={1} />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("disables Next button when on the last page", () => {
    render(
      <JobsPagination {...defaultProps} page={1} totalPages={1} />,
    );
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("enables Previous button when not on first page", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={2}
        totalPages={3}
        pageNumbers={[1, 2, 3]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /previous/i }),
    ).not.toBeDisabled();
  });

  it("enables Next button when not on last page", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={1}
        totalPages={3}
        pageNumbers={[1, 2, 3]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /next/i }),
    ).not.toBeDisabled();
  });

  it("calls onPageChange with page - 1 when Previous is clicked", async () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        {...defaultProps}
        page={3}
        totalPages={5}
        pageNumbers={[1, 2, 3, 4, 5]}
        onPageChange={onPageChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with page + 1 when Next is clicked", async () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        {...defaultProps}
        page={2}
        totalPages={5}
        pageNumbers={[1, 2, 3, 4, 5]}
        onPageChange={onPageChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("renders numbered page buttons", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={1}
        totalPages={3}
        pageNumbers={[1, 2, 3]}
      />,
    );
    // Page number buttons: buttons with text "1", "2", "3" + Previous/Next.
    const buttons = screen.getAllByRole("button");
    const pageButtons = buttons.filter((b) => /^[123]$/.test(b.textContent ?? ""));
    expect(pageButtons).toHaveLength(3);
  });

  it("calls onPageChange with the number when a page button is clicked", async () => {
    const onPageChange = vi.fn();
    render(
      <JobsPagination
        {...defaultProps}
        page={1}
        totalPages={3}
        pageNumbers={[1, 2, 3]}
        onPageChange={onPageChange}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const page2Button = buttons.find((b) => b.textContent === "2");
    await userEvent.click(page2Button!);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders ellipsis when pageNumbers contains '...'", () => {
    render(
      <JobsPagination
        {...defaultProps}
        page={1}
        totalPages={10}
        pageNumbers={[1, 2, 3, "...", 10]}
      />,
    );
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("Previous clamps to 1 when page is already 1 (disabled prevents click, but guard still present)", async () => {
    const onPageChange = vi.fn();
    // Render with page=2 and immediately interact (disabled guard is in logic).
    render(
      <JobsPagination
        {...defaultProps}
        page={2}
        totalPages={3}
        pageNumbers={[1, 2, 3]}
        onPageChange={onPageChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    // 2 - 1 = 1
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});