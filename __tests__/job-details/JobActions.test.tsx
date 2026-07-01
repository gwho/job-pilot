import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { JobActions } from "@/components/job-details/JobActions";

describe("JobActions", () => {
  it("renders a link to externalApplyUrl when present", () => {
    render(
      <JobActions
        company="Acme Corp"
        externalApplyUrl="https://acme.taleo.net/apply/123"
        sourceUrl="https://hk.jobsdb.com/job/123"
      />,
    );
    const link = screen.getByRole("link", { name: "Apply Now at Acme Corp" });
    expect(link).toHaveAttribute("href", "https://acme.taleo.net/apply/123");
  });

  it("prefers externalApplyUrl over sourceUrl when both are present", () => {
    render(
      <JobActions
        company="Acme Corp"
        externalApplyUrl="https://acme.taleo.net/apply/123"
        sourceUrl="https://hk.jobsdb.com/job/123"
      />,
    );
    const link = screen.getByRole("link", { name: "Apply Now at Acme Corp" });
    expect(link).not.toHaveAttribute("href", "https://hk.jobsdb.com/job/123");
  });

  it("falls back to sourceUrl when externalApplyUrl is null", () => {
    render(
      <JobActions
        company="Acme Corp"
        externalApplyUrl={null}
        sourceUrl="https://hk.jobsdb.com/job/123"
      />,
    );
    const link = screen.getByRole("link", { name: "Apply Now at Acme Corp" });
    expect(link).toHaveAttribute("href", "https://hk.jobsdb.com/job/123");
  });

  it("opens the apply link in a new tab with safe rel attributes", () => {
    render(
      <JobActions
        company="Acme Corp"
        externalApplyUrl="https://acme.taleo.net/apply/123"
        sourceUrl={null}
      />,
    );
    const link = screen.getByRole("link", { name: "Apply Now at Acme Corp" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a disabled button when both URLs are null", () => {
    render(<JobActions company="Acme Corp" externalApplyUrl={null} sourceUrl={null} />);
    const button = screen.getByRole("button", { name: "Apply Now at Acme Corp" });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("falls back to 'Company' in the label when company is null", () => {
    render(<JobActions company={null} externalApplyUrl={null} sourceUrl={null} />);
    expect(screen.getByRole("button", { name: "Apply Now at Company" })).toBeInTheDocument();
  });

  it("falls back to 'Company' in the label even when a URL exists", () => {
    render(
      <JobActions
        company={null}
        externalApplyUrl="https://acme.taleo.net/apply/123"
        sourceUrl={null}
      />,
    );
    expect(screen.getByRole("link", { name: "Apply Now at Company" })).toBeInTheDocument();
  });
});