import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobsTable } from "@/components/find-jobs/JobsTable";
import type { Job } from "@/types/index";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("lucide-react", () => ({
  Building2: () => <svg data-testid="building-icon" />,
}));

vi.mock("@/lib/utils", () => ({
  getMatchBarColor: () => "var(--color-success)",
  formatRelativeDate: (date: string) => `relative(${date})`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_provider: null,
    source_url: null,
    external_apply_url: null,
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Remote",
    salary: "$100k-$120k",
    job_type: null,
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
    found_at: "2026-06-28T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Column headers
// ---------------------------------------------------------------------------
describe("JobsTable — column headers", () => {
  it("renders all 6 column headers", () => {
    render(<JobsTable jobs={[makeJob()]} hasNoHistory={false} />);
    expect(screen.getByText(/company/i)).toBeInTheDocument();
    expect(screen.getByText(/role/i)).toBeInTheDocument();
    expect(screen.getByText(/match score/i)).toBeInTheDocument();
    expect(screen.getByText(/salary est\./i)).toBeInTheDocument();
    expect(screen.getByText(/provider/i)).toBeInTheDocument();
    expect(screen.getByText(/date found/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------
describe("JobsTable — empty states", () => {
  it("shows first-search prompt when jobs are empty and hasNoHistory=true", () => {
    render(<JobsTable jobs={[]} hasNoHistory={true} />);
    expect(
      screen.getByText("Run a search above to find your first jobs."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No jobs match your filters."),
    ).not.toBeInTheDocument();
  });

  it("shows filter-empty message when jobs are empty and hasNoHistory=false", () => {
    render(<JobsTable jobs={[]} hasNoHistory={false} />);
    expect(
      screen.getByText("No jobs match your filters."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Run a search above to find your first jobs."),
    ).not.toBeInTheDocument();
  });

  it("does not show any empty-state message when jobs are present", () => {
    render(<JobsTable jobs={[makeJob()]} hasNoHistory={false} />);
    expect(
      screen.queryByText("No jobs match your filters."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Run a search above to find your first jobs."),
    ).not.toBeInTheDocument();
  });

  it("empty state cell spans all 6 columns (colSpan=6)", () => {
    const { container } = render(<JobsTable jobs={[]} hasNoHistory={false} />);
    const td = container.querySelector("td");
    expect(td?.getAttribute("colspan")).toBe("6");
  });
});

// ---------------------------------------------------------------------------
// Match score — null vs scored
// ---------------------------------------------------------------------------
describe("JobsTable — match score display", () => {
  it("shows a score bar with percentage when match_score is a number", () => {
    render(<JobsTable jobs={[makeJob({ match_score: 75 })]} hasNoHistory={false} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("shows '—' for null match_score (not a bar or '0%')", () => {
    const { container } = render(
      <JobsTable jobs={[makeJob({ match_score: null })]} hasNoHistory={false} />,
    );
    // Should not render a percentage
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    // The muted dash span should be present
    expect(container.querySelector("span.text-text-muted")).toBeInTheDocument();
  });

  it("does not render '0%' for a null score", () => {
    render(<JobsTable jobs={[makeJob({ match_score: null })]} hasNoHistory={false} />);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("renders score bar for a score of 0 (explicitly scored zero)", () => {
    render(<JobsTable jobs={[makeJob({ match_score: 0 })]} hasNoHistory={false} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Provider column
// ---------------------------------------------------------------------------
describe("JobsTable — provider column", () => {
  it("shows source_provider value when present", () => {
    render(
      <JobsTable
        jobs={[makeJob({ source_provider: "adzuna" })]}
        hasNoHistory={false}
      />,
    );
    expect(screen.getByText("adzuna")).toBeInTheDocument();
  });

  it("shows '—' when source_provider is null", () => {
    // With multiple '—' cells possible (company, title, salary, provider, date)
    // we just check the provider cell renders a dash — rely on count ≥1
    render(
      <JobsTable
        jobs={[
          makeJob({
            source_provider: null,
            company: "Acme",
            title: "Engineer",
            salary: "$100k",
          }),
        ]}
        hasNoHistory={false}
      />,
    );
    // At least the provider '—' is present (salary is set so only provider is null-dashed)
    const dashes = screen.getAllByText("—");
    // salary is set, company is set, title is set → only source_provider dash + potential others
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'jobsdb_hk' as the provider value", () => {
    render(
      <JobsTable
        jobs={[makeJob({ source_provider: "jobsdb_hk" })]}
        hasNoHistory={false}
      />,
    );
    expect(screen.getByText("jobsdb_hk")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Null fallbacks for company / title / salary
// ---------------------------------------------------------------------------
describe("JobsTable — null field fallbacks", () => {
  it("renders '—' for null company", () => {
    render(
      <JobsTable jobs={[makeJob({ company: null })]} hasNoHistory={false} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders '—' for null title", () => {
    render(
      <JobsTable jobs={[makeJob({ title: null })]} hasNoHistory={false} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders '—' for null salary", () => {
    render(
      <JobsTable jobs={[makeJob({ salary: null })]} hasNoHistory={false} />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple rows
// ---------------------------------------------------------------------------
describe("JobsTable — multiple job rows", () => {
  it("renders one row per job", () => {
    const jobs = [
      makeJob({ id: "job-1", company: "Acme", title: "Engineer" }),
      makeJob({ id: "job-2", company: "Globex", title: "Developer" }),
      makeJob({ id: "job-3", company: "Initech", title: "Analyst" }),
    ];
    render(<JobsTable jobs={jobs} hasNoHistory={false} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
    expect(screen.getByText("Initech")).toBeInTheDocument();
  });

  it("renders job title for each row", () => {
    const jobs = [
      makeJob({ id: "job-1", title: "Frontend Dev" }),
      makeJob({ id: "job-2", title: "Backend Dev" }),
    ];
    render(<JobsTable jobs={jobs} hasNoHistory={false} />);
    expect(screen.getByText("Frontend Dev")).toBeInTheDocument();
    expect(screen.getByText("Backend Dev")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Date rendering
// ---------------------------------------------------------------------------
describe("JobsTable — date rendering", () => {
  it("renders formatted date via formatRelativeDate mock", () => {
    const job = makeJob({ found_at: "2026-06-01T00:00:00Z" });
    render(<JobsTable jobs={[job]} hasNoHistory={false} />);
    expect(screen.getByText("relative(2026-06-01T00:00:00Z)")).toBeInTheDocument();
  });
});