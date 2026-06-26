import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobsTable } from "@/components/find-jobs/JobsTable";
import type { Job } from "@/types/index";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_url: null,
    external_apply_url: null,
    title: "Frontend Engineer",
    company: "Acme Corp",
    location: "New York, NY",
    salary: "$120k - $150k",
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 85,
    match_reason: null,
    matched_skills: null,
    missing_skills: null,
    company_research: null,
    found_at: "2026-06-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("JobsTable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed "now" so formatRelativeDate is deterministic.
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'No jobs match your filters.' when jobs array is empty", () => {
    render(<JobsTable jobs={[]} />);
    expect(
      screen.getByText("No jobs match your filters."),
    ).toBeInTheDocument();
  });

  it("renders a row for each job", () => {
    const jobs = [
      makeJob({ id: "j1", company: "Stripe", title: "Engineer" }),
      makeJob({ id: "j2", company: "Vercel", title: "Developer" }),
    ];
    render(<JobsTable jobs={jobs} />);
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Vercel")).toBeInTheDocument();
  });

  it("renders company name", () => {
    render(<JobsTable jobs={[makeJob({ company: "Linear" })]} />);
    expect(screen.getByText("Linear")).toBeInTheDocument();
  });

  it("renders job title", () => {
    render(<JobsTable jobs={[makeJob({ title: "Staff Engineer" })]} />);
    expect(screen.getByText("Staff Engineer")).toBeInTheDocument();
  });

  it("renders salary", () => {
    render(
      <JobsTable jobs={[makeJob({ salary: "$160k - $200k" })]} />,
    );
    expect(screen.getByText("$160k - $200k")).toBeInTheDocument();
  });

  it("renders '—' when company is null", () => {
    render(<JobsTable jobs={[makeJob({ company: null })]} />);
    // The em dash should appear in the company cell.
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders '—' when title is null", () => {
    render(<JobsTable jobs={[makeJob({ title: null })]} />);
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders '—' when salary is null", () => {
    render(<JobsTable jobs={[makeJob({ salary: null })]} />);
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders match score percentage", () => {
    render(<JobsTable jobs={[makeJob({ match_score: 92 })]} />);
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("renders 0% match when match_score is null", () => {
    render(<JobsTable jobs={[makeJob({ match_score: null })]} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders relative date for found_at", () => {
    // found_at = 2026-06-25T10:00:00Z, now = 2026-06-25T12:00:00Z → 2 hours ago
    render(
      <JobsTable
        jobs={[makeJob({ found_at: "2026-06-25T10:00:00.000Z" })]}
      />,
    );
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("renders table headers: Company, Role, Match Score, Salary Est., Date Found", () => {
    render(<JobsTable jobs={[]} />);
    expect(screen.getByText(/company/i)).toBeInTheDocument();
    expect(screen.getByText(/role/i)).toBeInTheDocument();
    expect(screen.getByText(/match score/i)).toBeInTheDocument();
    expect(screen.getByText(/salary est/i)).toBeInTheDocument();
    expect(screen.getByText(/date found/i)).toBeInTheDocument();
  });

  it("renders correct number of rows (tbody tr)", () => {
    const jobs = [
      makeJob({ id: "j1" }),
      makeJob({ id: "j2" }),
      makeJob({ id: "j3" }),
    ];
    render(<JobsTable jobs={jobs} />);
    // Each data row has a unique company — just check there are 3 companies visible.
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
  });
});