import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { JobInfo } from "@/components/job-details/JobInfo";
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
    location: "Central, Hong Kong",
    salary: "HK$30,000 - HK$40,000",
    job_type: "fulltime",
    about_role: "Build things.",
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 82,
    match_reason: "Great fit.",
    matched_skills: ["React"],
    missing_skills: ["Go"],
    company_research: null,
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("JobInfo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the job title and company", () => {
    render(<JobInfo job={makeJob({ title: "Backend Engineer", company: "Beta Inc" })} />);
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Beta Inc")).toBeInTheDocument();
  });

  it("shows '—' for a null title and company", () => {
    render(<JobInfo job={makeJob({ title: null, company: null })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  describe("match score badge", () => {
    it("is hidden entirely when match_score is null", () => {
      render(<JobInfo job={makeJob({ match_score: null })} />);
      expect(screen.queryByText(/Match Score/)).not.toBeInTheDocument();
    });

    it("renders the success classes for scores >= 70", () => {
      render(<JobInfo job={makeJob({ match_score: 82 })} />);
      const badge = screen.getByText("82% Match Score");
      expect(badge.className).toContain("bg-success-lightest");
      expect(badge.className).toContain("text-success-dark");
    });

    it("renders the warning classes for scores between 50 and 69", () => {
      render(<JobInfo job={makeJob({ match_score: 55 })} />);
      const badge = screen.getByText("55% Match Score");
      expect(badge.className).toContain("bg-warning-light");
      expect(badge.className).toContain("text-warning");
    });

    it("renders the muted classes for scores below 50", () => {
      render(<JobInfo job={makeJob({ match_score: 20 })} />);
      const badge = screen.getByText("20% Match Score");
      expect(badge.className).toContain("bg-surface-tertiary");
      expect(badge.className).toContain("text-text-muted");
    });

    it("treats the boundary values 70 and 50 as their respective tiers", () => {
      const { rerender } = render(<JobInfo job={makeJob({ match_score: 70 })} />);
      expect(screen.getByText("70% Match Score").className).toContain("bg-success-lightest");

      rerender(<JobInfo job={makeJob({ match_score: 50 })} />);
      expect(screen.getByText("50% Match Score").className).toContain("bg-warning-light");
    });
  });

  describe("View Job Post link", () => {
    it("renders when source_url is present", () => {
      render(<JobInfo job={makeJob({ source_url: "https://hk.jobsdb.com/job/999" })} />);
      const link = screen.getByRole("link", { name: /View Job Post/i });
      expect(link).toHaveAttribute("href", "https://hk.jobsdb.com/job/999");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("is hidden when source_url is null", () => {
      render(<JobInfo job={makeJob({ source_url: null })} />);
      expect(screen.queryByRole("link", { name: /View Job Post/i })).not.toBeInTheDocument();
    });
  });

  describe("info cards", () => {
    it("shows salary and location values when present", () => {
      render(<JobInfo job={makeJob({ salary: "HK$50,000", location: "Kwun Tong" })} />);
      expect(screen.getByText("HK$50,000")).toBeInTheDocument();
      expect(screen.getByText("Kwun Tong")).toBeInTheDocument();
    });

    it("shows '—' for null salary and location", () => {
      render(<JobInfo job={makeJob({ salary: null, location: null })} />);
      // Title/company are non-null in this fixture, so all remaining dashes
      // come from the info cards (salary, location, job_type not null here).
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });

    it.each([
      ["fulltime", "Full-time"],
      ["parttime", "Part-time"],
      ["contract", "Contract"],
    ] as const)("formats job_type '%s' as '%s'", (raw, expected) => {
      render(<JobInfo job={makeJob({ job_type: raw })} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("formats a null job_type as '—' rather than defaulting to Full-time", () => {
      render(<JobInfo job={makeJob({ job_type: null })} />);
      expect(screen.queryByText("Full-time")).not.toBeInTheDocument();
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    it("renders the relative date for found_at", () => {
      render(
        <JobInfo
          job={makeJob({ found_at: new Date("2026-07-01T11:30:00Z").toISOString() })}
        />,
      );
      expect(screen.getByText("Just now")).toBeInTheDocument();
    });
  });
});