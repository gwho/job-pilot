import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { JobDescription } from "@/components/job-details/JobDescription";

describe("JobDescription", () => {
  it("renders the job description text", () => {
    render(<JobDescription aboutRole="We are looking for a Software Engineer." />);
    expect(
      screen.getByText("We are looking for a Software Engineer."),
    ).toBeInTheDocument();
  });

  it("renders the section header", () => {
    render(<JobDescription aboutRole="Some description." />);
    expect(screen.getByText("Job Description")).toBeInTheDocument();
  });

  it("shows fallback text when aboutRole is null", () => {
    render(<JobDescription aboutRole={null} />);
    expect(screen.getByText("No description available.")).toBeInTheDocument();
  });

  it("applies whitespace-pre-line so scraped newlines render as line breaks", () => {
    render(<JobDescription aboutRole="Line one.\nLine two." />);
    const body = screen.getByText(/Line one\./);
    expect(body.className).toContain("whitespace-pre-line");
  });

  it("renders multi-paragraph scraped text without truncation", () => {
    const longText =
      "About the Role\nWe build things.\n\nResponsibilities\n- Design\n- Implement";
    render(<JobDescription aboutRole={longText} />);
    // testing-library normalizes (collapses whitespace/newlines) the text it
    // matches against by default — the CSS whitespace-pre-line class (not the
    // DOM text content) is what actually causes newlines to render visually.
    // Compare against the normalized form to confirm no content was dropped.
    const normalized = longText.replace(/\s+/g, " ").trim();
    expect(screen.getByText((content) => content === normalized)).toBeInTheDocument();
  });

  it("does not show the fallback text when aboutRole is an empty string", () => {
    // Empty string is falsy for ?? purposes only when null/undefined — "" ?? fallback stays "".
    render(<JobDescription aboutRole="" />);
    expect(screen.queryByText("No description available.")).not.toBeInTheDocument();
  });
});