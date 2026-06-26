import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchControls } from "@/components/find-jobs/SearchControls";

const defaultProps = {
  jobTitle: "",
  location: "",
  isLoading: false,
  searchStatus: null,
  onJobTitleChange: vi.fn(),
  onLocationChange: vi.fn(),
  onSearch: vi.fn(),
};

describe("SearchControls", () => {
  it("renders the job title and location inputs", () => {
    render(<SearchControls {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("Frontend Engineer"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Remote, New York..."),
    ).toBeInTheDocument();
  });

  it("renders the Find Jobs button", () => {
    render(<SearchControls {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /find jobs/i }),
    ).toBeInTheDocument();
  });

  it("displays provided jobTitle value", () => {
    render(<SearchControls {...defaultProps} jobTitle="React Developer" />);
    const input = screen.getByPlaceholderText("Frontend Engineer");
    expect(input).toHaveValue("React Developer");
  });

  it("displays provided location value", () => {
    render(<SearchControls {...defaultProps} location="London, UK" />);
    const input = screen.getByPlaceholderText("Remote, New York...");
    expect(input).toHaveValue("London, UK");
  });

  it("calls onJobTitleChange when the job title input changes", async () => {
    const onJobTitleChange = vi.fn();
    render(
      <SearchControls {...defaultProps} onJobTitleChange={onJobTitleChange} />,
    );
    const input = screen.getByPlaceholderText("Frontend Engineer");
    await userEvent.type(input, "A");
    expect(onJobTitleChange).toHaveBeenCalled();
  });

  it("calls onLocationChange when the location input changes", async () => {
    const onLocationChange = vi.fn();
    render(
      <SearchControls {...defaultProps} onLocationChange={onLocationChange} />,
    );
    const input = screen.getByPlaceholderText("Remote, New York...");
    await userEvent.type(input, "B");
    expect(onLocationChange).toHaveBeenCalled();
  });

  it("calls onSearch when the Find Jobs button is clicked", async () => {
    const onSearch = vi.fn();
    render(<SearchControls {...defaultProps} onSearch={onSearch} />);
    await userEvent.click(screen.getByRole("button", { name: /find jobs/i }));
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("shows 'Finding jobs...' text and disables inputs while loading", () => {
    render(<SearchControls {...defaultProps} isLoading={true} />);
    expect(
      screen.getByRole("button", { name: /finding jobs/i }),
    ).toBeDisabled();
    expect(screen.getByPlaceholderText("Frontend Engineer")).toBeDisabled();
    expect(screen.getByPlaceholderText("Remote, New York...")).toBeDisabled();
  });

  it("disables the search button while loading", () => {
    render(<SearchControls {...defaultProps} isLoading={true} />);
    expect(
      screen.getByRole("button", { name: /finding jobs/i }),
    ).toBeDisabled();
  });

  it("does not show the success banner when searchStatus is null", () => {
    render(<SearchControls {...defaultProps} searchStatus={null} />);
    expect(
      screen.queryByText(/found .* jobs/i),
    ).not.toBeInTheDocument();
  });

  it("shows the success banner when searchStatus is provided", () => {
    render(
      <SearchControls
        {...defaultProps}
        searchStatus={{ jobsFound: 8, strongMatches: 4 }}
      />,
    );
    expect(
      screen.getByText(/found 8 jobs and saved 4 strong matches/i),
    ).toBeInTheDocument();
  });

  it("shows accurate counts in the success banner", () => {
    render(
      <SearchControls
        {...defaultProps}
        searchStatus={{ jobsFound: 1, strongMatches: 0 }}
      />,
    );
    expect(
      screen.getByText(/found 1 jobs and saved 0 strong matches/i),
    ).toBeInTheDocument();
  });
});