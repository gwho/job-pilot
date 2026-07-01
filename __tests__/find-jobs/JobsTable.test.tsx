import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { JobsTable } from "@/components/find-jobs/JobsTable";
import type { Job } from "@/types/index";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: "https://hk.jobsdb.com/job/123",
    external_apply_url: null,
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Hong Kong",
    salary: "HK$30,000",
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 75,
    match_reason: null,
    matched_skills: [],
    missing_skills: [],
    company_research: null,
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("JobsTable", () => {
  describe("empty states", () => {
    it("shows the 'run a search' message when hasNoHistory is true", () => {
      render(<JobsTable jobs={[]} hasNoHistory={true} />);
      expect(
        screen.getByText("Run a search above to find your first jobs."),
      ).toBeInTheDocument();
    });

    it("shows the 'no matches' message when hasNoHistory is false", () => {
      render(<JobsTable jobs={[]} hasNoHistory={false} />);
      expect(screen.getByText("No jobs match your filters.")).toBeInTheDocument();
    });
  });

  describe("row navigation (stretched link pattern)", () => {
    it("wraps the company name in a Link pointing to /find-jobs/[id]", () => {
      render(<JobsTable jobs={[makeJob({ id: "abc-123", company: "Acme Corp" })]} hasNoHistory={false} />);
      const link = screen.getByRole("link", { name: /Acme Corp/i });
      expect(link).toHaveAttribute("href", "/find-jobs/abc-123");
    });

    it("gives the row 'relative' positioning so the stretched link can be absolutely positioned", () => {
      render(<JobsTable jobs={[makeJob({ id: "abc-123" })]} hasNoHistory={false} />);
      const rows = screen.getAllByRole("row");
      const bodyRow = rows[1]; // rows[0] is the header row
      expect(bodyRow.className).toContain("relative");
    });

    it("gives the link an aria-label describing the destination job and company", () => {
      render(
        <JobsTable
          jobs={[makeJob({ id: "abc-123", title: "Backend Engineer", company: "Beta Inc" })]}
          hasNoHistory={false}
        />,
      );
      expect(
        screen.getByRole("link", { name: "View Backend Engineer at Beta Inc" }),
      ).toBeInTheDocument();
    });

    it("falls back to 'job'/'company' in the aria-label when title/company are null", () => {
      render(
        <JobsTable
          jobs={[makeJob({ id: "abc-123", title: null, company: null })]}
          hasNoHistory={false}
        />,
      );
      expect(screen.getByRole("link", { name: "View job at company" })).toBeInTheDocument();
    });

    it("applies the stretched pseudo-element classes to the link", () => {
      render(<JobsTable jobs={[makeJob({ id: "abc-123" })]} hasNoHistory={false} />);
      const link = screen.getByRole("link", { name: /Acme Corp/i });
      expect(link.className).toContain("after:absolute");
      expect(link.className).toContain("after:inset-0");
      expect(link.className).toContain("after:z-1");
    });
  });

  describe("row content", () => {
    it("renders company, title, salary, and provider", () => {
      render(
        <JobsTable
          jobs={[
            makeJob({
              company: "Acme Corp",
              title: "Software Engineer",
              salary: "HK$30,000",
              source_provider: "jobsdb_hk",
            }),
          ]}
          hasNoHistory={false}
        />,
      );
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
      expect(screen.getByText("Software Engineer")).toBeInTheDocument();
      expect(screen.getByText("HK$30,000")).toBeInTheDocument();
      expect(screen.getByText("jobsdb_hk")).toBeInTheDocument();
    });

    it("shows '—' for null title, salary, and provider", () => {
      render(
        <JobsTable
          jobs={[makeJob({ title: null, salary: null, source_provider: null })]}
          hasNoHistory={false}
        />,
      );
      expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    });

    it("renders a match score percentage when match_score is present", () => {
      render(<JobsTable jobs={[makeJob({ match_score: 63 })]} hasNoHistory={false} />);
      expect(screen.getByText("63%")).toBeInTheDocument();
    });

    it("shows '—' instead of 0% for a null match_score (never invents 0%)", () => {
      render(<JobsTable jobs={[makeJob({ match_score: null })]} hasNoHistory={false} />);
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("renders one row per job", () => {
      render(
        <JobsTable
          jobs={[
            makeJob({ id: "j1", company: "Company One" }),
            makeJob({ id: "j2", company: "Company Two" }),
          ]}
          hasNoHistory={false}
        />,
      );
      expect(screen.getByText("Company One")).toBeInTheDocument();
      expect(screen.getByText("Company Two")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 body rows
    });
  });
});