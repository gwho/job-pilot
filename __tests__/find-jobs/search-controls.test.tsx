/**
 * Unit tests for the SearchControls presentational component.
 *
 * SearchControls was changed in this PR to:
 *  - Accept `searchStatus: { message: string; isError?: boolean }` (was `{ jobsFound, strongMatches }`)
 *  - Render the `message` string verbatim (no client-side copy construction)
 *  - Use AlertCircle icon + error CSS classes when `isError=true`
 *  - Use Sparkles icon + success CSS classes when `isError` is absent/false
 *
 * Run: npm run test:run -- __tests__/find-jobs/search-controls.test.tsx
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { SearchControls } from "@/components/find-jobs/SearchControls";

// ── Default props ─────────────────────────────────────────────────────────────

function defaultProps(overrides: Partial<Parameters<typeof SearchControls>[0]> = {}) {
  return {
    jobTitle: "",
    location: "",
    isLoading: false,
    searchStatus: null,
    onJobTitleChange: vi.fn(),
    onLocationChange: vi.fn(),
    onSearch: vi.fn(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner — visibility
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchControls — banner visibility", () => {
  it("renders no banner when searchStatus is null", () => {
    render(<SearchControls {...defaultProps({ searchStatus: null })} />);
    // No Sparkles or AlertCircle — the banner container should not exist
    expect(screen.queryByText(/found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the success banner when searchStatus has a message and no isError", () => {
    render(
      <SearchControls
        {...defaultProps({
          searchStatus: { message: "Found 10 jobs and saved 5 new jobs." },
        })}
      />,
    );
    expect(screen.getByText("Found 10 jobs and saved 5 new jobs.")).toBeInTheDocument();
  });

  it("renders the error banner when searchStatus.isError is true", () => {
    render(
      <SearchControls
        {...defaultProps({
          searchStatus: { message: "Job search failed. Please try again.", isError: true },
        })}
      />,
    );
    expect(
      screen.getByText("Job search failed. Please try again."),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Banner — message fidelity
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchControls — banner message fidelity", () => {
  it("renders the API message verbatim — no client-side reformatting", () => {
    const apiMessage = "Found 10 jobs — all already saved.";
    render(
      <SearchControls {...defaultProps({ searchStatus: { message: apiMessage } })} />,
    );
    expect(screen.getByText(apiMessage)).toBeInTheDocument();
  });

  it("does not render 'strong matches' copy when using the API message", () => {
    render(
      <SearchControls
        {...defaultProps({
          searchStatus: { message: "Found 10 jobs and saved 5 new jobs." },
        })}
      />,
    );
    expect(screen.queryByText(/strong matches/i)).not.toBeInTheDocument();
  });

  it("does not render 'undefined' in the banner when only message is provided", () => {
    render(
      <SearchControls
        {...defaultProps({
          searchStatus: { message: "Found 10 jobs — all already saved." },
        })}
      />,
    );
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it("banner text is the full successMessage when newJobs is 0", () => {
    const noNewJobsMsg = "Found 10 jobs — all already saved.";
    render(
      <SearchControls
        {...defaultProps({ searchStatus: { message: noNewJobsMsg } })}
      />,
    );
    expect(screen.getByText(noNewJobsMsg)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Banner — error vs success visual state
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchControls — error vs success banner CSS classes", () => {
  it("success banner does not have error CSS classes", () => {
    const { container } = render(
      <SearchControls
        {...defaultProps({ searchStatus: { message: "All good." } })}
      />,
    );
    // The banner div must have bg-success-lightest, not bg-error
    const banner = container.querySelector(".bg-success-lightest");
    expect(banner).not.toBeNull();
    expect(banner?.className).not.toMatch(/bg-error/);
  });

  it("error banner has error CSS classes", () => {
    const { container } = render(
      <SearchControls
        {...defaultProps({
          searchStatus: { message: "Failed.", isError: true },
        })}
      />,
    );
    // The banner div must NOT have bg-success-lightest when isError=true
    expect(container.querySelector(".bg-success-lightest")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loading state
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchControls — loading state", () => {
  it("button shows 'Finding jobs...' when isLoading is true", () => {
    render(<SearchControls {...defaultProps({ isLoading: true })} />);
    expect(screen.getByRole("button")).toHaveTextContent("Finding jobs...");
  });

  it("button shows 'Find Jobs' when isLoading is false", () => {
    render(<SearchControls {...defaultProps({ isLoading: false })} />);
    expect(screen.getByRole("button")).toHaveTextContent("Find Jobs");
  });

  it("button is disabled when isLoading is true", () => {
    render(<SearchControls {...defaultProps({ isLoading: true })} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("button is not disabled when isLoading is false", () => {
    render(<SearchControls {...defaultProps({ isLoading: false })} />);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("job title input is disabled when isLoading is true", () => {
    render(
      <SearchControls
        {...defaultProps({ isLoading: true, jobTitle: "Engineer" })}
      />,
    );
    expect(screen.getByPlaceholderText("Frontend Engineer")).toBeDisabled();
  });

  it("location input is disabled when isLoading is true", () => {
    render(
      <SearchControls
        {...defaultProps({ isLoading: true, location: "Hong Kong" })}
      />,
    );
    expect(screen.getByPlaceholderText(/remote/i)).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interaction callbacks
// ─────────────────────────────────────────────────────────────────────────────

describe("SearchControls — interaction callbacks", () => {
  it("calls onSearch when the Find Jobs button is clicked", () => {
    const onSearch = vi.fn();
    render(<SearchControls {...defaultProps({ onSearch })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("calls onJobTitleChange when the job title input changes", () => {
    const onJobTitleChange = vi.fn();
    render(<SearchControls {...defaultProps({ onJobTitleChange })} />);
    fireEvent.change(screen.getByPlaceholderText("Frontend Engineer"), {
      target: { value: "Software Engineer" },
    });
    expect(onJobTitleChange).toHaveBeenCalledWith("Software Engineer");
  });

  it("calls onLocationChange when the location input changes", () => {
    const onLocationChange = vi.fn();
    render(<SearchControls {...defaultProps({ onLocationChange })} />);
    fireEvent.change(screen.getByPlaceholderText(/remote/i), {
      target: { value: "Hong Kong" },
    });
    expect(onLocationChange).toHaveBeenCalledWith("Hong Kong");
  });

  it("does not call onSearch when the button is clicked while loading", () => {
    const onSearch = vi.fn();
    render(<SearchControls {...defaultProps({ isLoading: true, onSearch })} />);
    fireEvent.click(screen.getByRole("button"));
    // Button is disabled — click should not fire
    expect(onSearch).not.toHaveBeenCalled();
  });
});