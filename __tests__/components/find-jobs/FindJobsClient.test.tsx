import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindJobsClient } from "@/components/find-jobs/FindJobsClient";
import type { Job } from "@/types/index";

// ── Helpers ────────────────────────────────────────────────────────────────

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
    salary: "$120k",
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
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

// Create N jobs so pagination (PAGE_SIZE=6) can be exercised.
function makeJobs(count: number, baseOverrides: Partial<Job> = {}): Job[] {
  return Array.from({ length: count }, (_, i) =>
    makeJob({
      id: `job-${i + 1}`,
      company: `Company ${i + 1}`,
      title: `Role ${i + 1}`,
      // Descending scores: 90, 85, 80, 75, 70, 65, 60…
      match_score: 90 - i * 5,
      // Newest-first timestamps (job 0 is most recent).
      found_at: new Date(Date.now() - i * 3_600_000).toISOString(),
      ...baseOverrides,
    }),
  );
}

// ── Test setup ─────────────────────────────────────────────────────────────

describe("FindJobsClient", () => {
  // NOTE: Do NOT use vi.useFakeTimers() here — userEvent relies on real timers
  // and will hang indefinitely if the clock is frozen.

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          jobs: [],
          jobsFound: 0,
          strongMatches: 0,
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Rendering ─────────────────────────────────────────────────────────

  it("renders the search controls", () => {
    render(<FindJobsClient initialJobs={[]} />);
    expect(
      screen.getByPlaceholderText("Frontend Engineer"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Remote, New York..."),
    ).toBeInTheDocument();
  });

  it("renders the filter bar", () => {
    render(<FindJobsClient initialJobs={[]} />);
    expect(
      screen.getByPlaceholderText("Filter by company or role..."),
    ).toBeInTheDocument();
  });

  it("renders the pagination component", () => {
    render(<FindJobsClient initialJobs={[]} />);
    expect(
      screen.getByRole("button", { name: /previous/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /next/i }),
    ).toBeInTheDocument();
  });

  it("shows 'No jobs match your filters.' when initialJobs is empty", () => {
    render(<FindJobsClient initialJobs={[]} />);
    expect(
      screen.getByText("No jobs match your filters."),
    ).toBeInTheDocument();
  });

  it("renders initial jobs in the table", () => {
    const jobs = [
      makeJob({ id: "j1", company: "Stripe", title: "Engineer" }),
      makeJob({ id: "j2", company: "Vercel", title: "Developer" }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Vercel")).toBeInTheDocument();
  });

  // ── Filtering by match score ───────────────────────────────────────────

  it("shows only high-match jobs (>= 70) when 'High Match' filter is selected", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({ id: "j1", company: "HighMatch", match_score: 90 }),
      makeJob({ id: "j2", company: "LowMatch", match_score: 40 }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");

    expect(screen.getByText("HighMatch")).toBeInTheDocument();
    expect(screen.queryByText("LowMatch")).not.toBeInTheDocument();
  });

  it("shows only low-match jobs (< 70) when 'Low Match' filter is selected", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({ id: "j1", company: "HighMatch", match_score: 80 }),
      makeJob({ id: "j2", company: "LowMatch", match_score: 50 }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.selectOptions(screen.getByDisplayValue("All Matches"), "low");

    expect(screen.queryByText("HighMatch")).not.toBeInTheDocument();
    expect(screen.getByText("LowMatch")).toBeInTheDocument();
  });

  it("shows all jobs when 'All Matches' is selected after switching away", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({ id: "j1", company: "HighMatch", match_score: 90 }),
      makeJob({ id: "j2", company: "LowMatch", match_score: 40 }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    // First select high, then back to all.
    await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
    await user.selectOptions(screen.getByDisplayValue("High Match"), "all");

    expect(screen.getByText("HighMatch")).toBeInTheDocument();
    expect(screen.getByText("LowMatch")).toBeInTheDocument();
  });

  // ── Text filtering ─────────────────────────────────────────────────────

  it("filters jobs by company name (case-insensitive)", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({ id: "j1", company: "Stripe", title: "Engineer" }),
      makeJob({ id: "j2", company: "Vercel", title: "Developer" }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.type(
      screen.getByPlaceholderText("Filter by company or role..."),
      "stri",
    );

    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.queryByText("Vercel")).not.toBeInTheDocument();
  });

  it("filters jobs by title (case-insensitive)", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({ id: "j1", company: "A", title: "Frontend Engineer" }),
      makeJob({ id: "j2", company: "B", title: "Backend Developer" }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.type(
      screen.getByPlaceholderText("Filter by company or role..."),
      "front",
    );

    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Backend Developer")).not.toBeInTheDocument();
  });

  // ── Sorting ────────────────────────────────────────────────────────────

  it("sorts by match score descending by default", () => {
    const jobs = [
      makeJob({ id: "j1", company: "LowScore", match_score: 40 }),
      makeJob({ id: "j2", company: "HighScore", match_score: 95 }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    const rows = document.querySelectorAll("tbody tr");
    // First row should be the high-score job.
    expect(rows[0].textContent).toContain("HighScore");
    expect(rows[1].textContent).toContain("LowScore");
  });

  it("sorts by newest date when 'Newest' is selected", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({
        id: "j1",
        company: "Older",
        found_at: "2020-01-01T00:00:00.000Z",
        match_score: 50,
      }),
      makeJob({
        id: "j2",
        company: "Newer",
        found_at: "2026-06-25T00:00:00.000Z",
        match_score: 50,
      }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.selectOptions(screen.getByDisplayValue("Match Score"), "newest");

    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Newer");
    expect(rows[1].textContent).toContain("Older");
  });

  it("sorts by oldest date when 'Oldest' is selected", async () => {
    const user = userEvent.setup();
    const jobs = [
      makeJob({
        id: "j1",
        company: "Older",
        found_at: "2020-01-01T00:00:00.000Z",
        match_score: 50,
      }),
      makeJob({
        id: "j2",
        company: "Newer",
        found_at: "2026-06-25T00:00:00.000Z",
        match_score: 50,
      }),
    ];
    render(<FindJobsClient initialJobs={jobs} />);

    await user.selectOptions(screen.getByDisplayValue("Match Score"), "oldest");

    const rows = document.querySelectorAll("tbody tr");
    expect(rows[0].textContent).toContain("Older");
    expect(rows[1].textContent).toContain("Newer");
  });

  // ── Pagination ─────────────────────────────────────────────────────────

  it("shows only 6 jobs on the first page when there are more than 6", () => {
    const jobs = makeJobs(7);
    render(<FindJobsClient initialJobs={jobs} />);
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(6);
  });

  it("shows the remaining job on page 2", async () => {
    const user = userEvent.setup();
    const jobs = makeJobs(7);
    render(<FindJobsClient initialJobs={jobs} />);

    await user.click(screen.getByRole("button", { name: /next/i }));

    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
  });

  it("renders correct page number buttons for <= 5 pages", () => {
    const jobs = makeJobs(12); // 12 / 6 = 2 pages
    render(<FindJobsClient initialJobs={jobs} />);

    const buttons = screen.getAllByRole("button");
    const pageNums = buttons.filter((b) => /^[12]$/.test(b.textContent ?? ""));
    expect(pageNums).toHaveLength(2);
  });

  it("renders ellipsis for > 5 pages", () => {
    const jobs = makeJobs(36); // 36 / 6 = 6 pages
    render(<FindJobsClient initialJobs={jobs} />);

    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("resets page to 1 when match filter changes", async () => {
    const user = userEvent.setup();
    // 7 high-match jobs (score=90) so there are 2 pages.
    const jobs = makeJobs(7, { match_score: 90 });
    render(<FindJobsClient initialJobs={jobs} />);

    // Navigate to page 2.
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Change filter — page should reset to 1.
    await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");

    // All 7 high-match jobs still visible; 6 on page 1, 1 on page 2.
    // Page 2 button should exist (2 pages total).
    // Page 1 button should now be active (have the accent class).
    const allButtons = screen.getAllByRole("button");
    const page1Button = allButtons.find((b) => b.textContent === "1");
    expect(page1Button).toHaveClass("bg-accent");
  });

  // ── Search API integration ─────────────────────────────────────────────

  it("calls /api/agent/find with jobTitle and location when search is submitted", async () => {
    const user = userEvent.setup();
    render(<FindJobsClient initialJobs={[]} />);

    await user.type(
      screen.getByPlaceholderText("Frontend Engineer"),
      "React Developer",
    );
    await user.type(
      screen.getByPlaceholderText("Remote, New York..."),
      "London",
    );

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/agent/find",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobTitle: "React Developer",
            location: "London",
          }),
        }),
      );
    });
  });

  it("shows 'Finding jobs...' while the search is in progress", async () => {
    const user = userEvent.setup();
    // Make fetch never resolve so loading state persists.
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    render(<FindJobsClient initialJobs={[]} />);

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    expect(
      screen.getByRole("button", { name: /finding jobs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /finding jobs/i }),
    ).toBeDisabled();
  });

  it("updates the jobs table after a successful search", async () => {
    const user = userEvent.setup();
    const newJobs = [
      makeJob({ id: "new-1", company: "NewCompany", title: "New Role" }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          jobs: newJobs,
          jobsFound: 1,
          strongMatches: 1,
        }),
      }),
    );

    render(<FindJobsClient initialJobs={[]} />);

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    await waitFor(() => {
      expect(screen.getByText("NewCompany")).toBeInTheDocument();
    });
  });

  it("shows the success banner after a search with results", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          jobs: [],
          jobsFound: 10,
          strongMatches: 3,
        }),
      }),
    );

    render(<FindJobsClient initialJobs={[]} />);

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/found 10 jobs and saved 3 strong matches/i),
      ).toBeInTheDocument();
    });
  });

  it("does not crash when the search API returns an error response", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: "Internal error" }),
      }),
    );

    render(<FindJobsClient initialJobs={[]} />);

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    await waitFor(() => {
      // Loading should stop, component should still be visible.
      expect(
        screen.getByRole("button", { name: /find jobs/i }),
      ).toBeInTheDocument();
    });
  });

  it("does not crash when fetch throws", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    render(<FindJobsClient initialJobs={[]} />);

    await user.click(screen.getByRole("button", { name: /find jobs/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /find jobs/i }),
      ).toBeInTheDocument();
    });
  });
});