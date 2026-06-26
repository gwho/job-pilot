import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobFilters } from "@/components/find-jobs/JobFilters";

const defaultProps = {
  filterText: "",
  matchFilter: "all" as const,
  sort: "score" as const,
  onFilterTextChange: vi.fn(),
  onMatchFilterChange: vi.fn(),
  onSortChange: vi.fn(),
};

describe("JobFilters", () => {
  it("renders the filter text input", () => {
    render(<JobFilters {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("Filter by company or role..."),
    ).toBeInTheDocument();
  });

  it("renders match filter dropdown with all options", () => {
    render(<JobFilters {...defaultProps} />);
    expect(screen.getByDisplayValue("All Matches")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All Matches" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "High Match" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Low Match" })).toBeInTheDocument();
  });

  it("renders sort dropdown with all options", () => {
    render(<JobFilters {...defaultProps} />);
    expect(screen.getByDisplayValue("Match Score")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Match Score" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Newest" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Oldest" })).toBeInTheDocument();
  });

  it("displays current filterText in the input", () => {
    render(<JobFilters {...defaultProps} filterText="stripe" />);
    expect(screen.getByDisplayValue("stripe")).toBeInTheDocument();
  });

  it("calls onFilterTextChange when the text input changes", async () => {
    const onFilterTextChange = vi.fn();
    render(
      <JobFilters {...defaultProps} onFilterTextChange={onFilterTextChange} />,
    );
    const input = screen.getByPlaceholderText("Filter by company or role...");
    await userEvent.type(input, "a");
    expect(onFilterTextChange).toHaveBeenCalledWith("a");
  });

  it("calls onMatchFilterChange when match filter select changes", async () => {
    const onMatchFilterChange = vi.fn();
    render(
      <JobFilters
        {...defaultProps}
        onMatchFilterChange={onMatchFilterChange}
      />,
    );
    await userEvent.selectOptions(
      screen.getByDisplayValue("All Matches"),
      "high",
    );
    expect(onMatchFilterChange).toHaveBeenCalledWith("high");
  });

  it("calls onSortChange when sort select changes", async () => {
    const onSortChange = vi.fn();
    render(<JobFilters {...defaultProps} onSortChange={onSortChange} />);
    await userEvent.selectOptions(
      screen.getByDisplayValue("Match Score"),
      "newest",
    );
    expect(onSortChange).toHaveBeenCalledWith("newest");
  });

  it("reflects the selected matchFilter value in the dropdown", () => {
    render(<JobFilters {...defaultProps} matchFilter="high" />);
    const select = screen.getByDisplayValue("High Match");
    expect(select).toHaveValue("high");
  });

  it("reflects the selected sort value in the dropdown", () => {
    render(<JobFilters {...defaultProps} sort="oldest" />);
    const select = screen.getByDisplayValue("Oldest");
    expect(select).toHaveValue("oldest");
  });
});