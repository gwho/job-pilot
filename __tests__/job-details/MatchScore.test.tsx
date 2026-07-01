import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MatchScore } from "@/components/job-details/MatchScore";
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
    source_url: null,
    external_apply_url: null,
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Hong Kong",
    salary: null,
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 82,
    match_reason: "Strong alignment with your React and TypeScript experience.",
    matched_skills: ["React", "TypeScript"],
    missing_skills: ["Go"],
    company_research: null,
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("MatchScore", () => {
  describe("AI Match Reasoning card", () => {
    it("renders the reasoning text when match_reason is present", () => {
      render(<MatchScore job={makeJob({ match_reason: "You are a great fit." })} />);
      expect(screen.getByText("AI Match Reasoning")).toBeInTheDocument();
      expect(screen.getByText("You are a great fit.")).toBeInTheDocument();
    });

    it("is hidden entirely when match_reason is null", () => {
      render(<MatchScore job={makeJob({ match_reason: null })} />);
      expect(screen.queryByText("AI Match Reasoning")).not.toBeInTheDocument();
    });

    it("is hidden entirely when match_reason is an empty string", () => {
      render(<MatchScore job={makeJob({ match_reason: "" })} />);
      expect(screen.queryByText("AI Match Reasoning")).not.toBeInTheDocument();
    });
  });

  describe("Required Skills vs Your Profile card", () => {
    it("is always rendered, even without any reasoning", () => {
      render(<MatchScore job={makeJob({ match_reason: null })} />);
      expect(screen.getByText("Required Skills vs Your Profile")).toBeInTheDocument();
    });

    it("renders matched skills under 'You have'", () => {
      render(<MatchScore job={makeJob({ matched_skills: ["React", "Node.js"] })} />);
      expect(screen.getByText("You have")).toBeInTheDocument();
      expect(screen.getByText("React")).toBeInTheDocument();
      expect(screen.getByText("Node.js")).toBeInTheDocument();
    });

    it("renders missing skills under 'Gap skills'", () => {
      render(<MatchScore job={makeJob({ missing_skills: ["Go", "Rust"] })} />);
      expect(screen.getByText("Gap skills")).toBeInTheDocument();
      expect(screen.getByText("Go")).toBeInTheDocument();
      expect(screen.getByText("Rust")).toBeInTheDocument();
    });

    it("hides the 'You have' subsection when matched_skills is empty", () => {
      render(<MatchScore job={makeJob({ matched_skills: [], missing_skills: ["Go"] })} />);
      expect(screen.queryByText("You have")).not.toBeInTheDocument();
      expect(screen.getByText("Gap skills")).toBeInTheDocument();
    });

    it("hides the 'Gap skills' subsection when missing_skills is empty", () => {
      render(<MatchScore job={makeJob({ matched_skills: ["React"], missing_skills: [] })} />);
      expect(screen.getByText("You have")).toBeInTheDocument();
      expect(screen.queryByText("Gap skills")).not.toBeInTheDocument();
    });

    it("shows 'No skill data available.' when both arrays are empty", () => {
      render(<MatchScore job={makeJob({ matched_skills: [], missing_skills: [] })} />);
      expect(screen.getByText("No skill data available.")).toBeInTheDocument();
      expect(screen.queryByText("You have")).not.toBeInTheDocument();
      expect(screen.queryByText("Gap skills")).not.toBeInTheDocument();
    });

    it("shows 'No skill data available.' when both arrays are null", () => {
      render(<MatchScore job={makeJob({ matched_skills: null, missing_skills: null })} />);
      expect(screen.getByText("No skill data available.")).toBeInTheDocument();
    });

    it("applies top margin to the Gap skills block only when both sections render", () => {
      render(
        <MatchScore
          job={makeJob({ matched_skills: ["React"], missing_skills: ["Go"] })}
        />,
      );
      const gapLabel = screen.getByText("Gap skills");
      // Gap skills label's parent wrapper div should have mt-4 when both sections show.
      expect(gapLabel.parentElement?.className).toContain("mt-4");
    });

    it("does not apply top margin to Gap skills when it is the only section", () => {
      render(
        <MatchScore job={makeJob({ matched_skills: [], missing_skills: ["Go"] })} />,
      );
      const gapLabel = screen.getByText("Gap skills");
      expect(gapLabel.parentElement?.className).not.toContain("mt-4");
    });
  });
});