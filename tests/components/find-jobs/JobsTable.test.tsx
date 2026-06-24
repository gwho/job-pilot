import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobsTable } from "@/components/find-jobs/JobsTable";
import type { Job } from "@/types/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-24T12:00:00.000Z").getTime();

function makeJob(overrides: Partial<Job> & { id: string }): Job {
  return {
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_url: null,
    external_apply_url: null,
    title: "Engineer",
    company: "Acme",
    location: null,
    salary: "$100k",
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 80,
    match_reason: null,
    matched_skills: null,
    missing_skills: null,
    company_research: null,
    found_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    ...overrides,
  };
}

/** Six jobs for a single-page scenario */
const SIX_JOBS: Job[] = [
  makeJob({ id: "j1", company: "Vercel", title: "Senior Frontend", match_score: 94, found_at: new Date(NOW - 1 * 60 * 60 * 1000).toISOString() }),
  makeJob({ id: "j2", company: "Stripe", title: "Staff UI Engineer", match_score: 88, found_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }),
  makeJob({ id: "j3", company: "Linear", title: "Product Engineer", match_score: 96, found_at: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() }),
  makeJob({ id: "j4", company: "Notion", title: "Frontend Developer", match_score: 72, found_at: new Date(NOW - 4 * 60 * 60 * 1000).toISOString() }),
  makeJob({ id: "j5", company: "OpenAI", title: "Design Engineer", match_score: 91, found_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString() }),
  makeJob({ id: "j6", company: "Figma", title: "Software Engineer", match_score: 85, found_at: new Date(NOW - 6 * 60 * 60 * 1000).toISOString() }),
];

/** Seven jobs to trigger multi-page pagination */
function makeSevenJobs(): Job[] {
  return [
    ...SIX_JOBS,
    makeJob({ id: "j7", company: "Apple", title: "iOS Engineer", match_score: 60, found_at: new Date(NOW - 7 * 60 * 60 * 1000).toISOString() }),
  ];
}

// ---------------------------------------------------------------------------
// Setup: mock Date.now() to a fixed timestamp for predictable date formatting
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JobsTable", () => {
  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe("table structure", () => {
    it("renders all five column headers", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(screen.getByText("Company")).toBeInTheDocument();
      expect(screen.getByText("Role")).toBeInTheDocument();
      // "Match Score" also appears as a <option> in the sort dropdown, so use getAllByText
      expect(screen.getAllByText("Match Score").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Salary Est.")).toBeInTheDocument();
      expect(screen.getByText("Date Found")).toBeInTheDocument();
    });

    it("renders the filter text input with correct placeholder", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(
        screen.getByPlaceholderText("Filter by company or role..."),
      ).toBeInTheDocument();
    });

    it("renders the match filter dropdown", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(screen.getByDisplayValue("All Matches")).toBeInTheDocument();
    });

    it("renders the sort dropdown defaulting to Match Score", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(screen.getByDisplayValue("Match Score")).toBeInTheDocument();
    });

    it("renders a row for each job (6 jobs → 6 rows)", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      // Each row has a company name cell
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.getByText("Stripe")).toBeInTheDocument();
      expect(screen.getByText("Linear")).toBeInTheDocument();
      expect(screen.getByText("Notion")).toBeInTheDocument();
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
      expect(screen.getByText("Figma")).toBeInTheDocument();
    });

    it("renders job title in the Role column", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(screen.getByText("Senior Frontend")).toBeInTheDocument();
    });

    it("renders salary in the Salary Est. column", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      // makeJob default salary is $100k for all jobs
      const salaries = screen.getAllByText("$100k");
      expect(salaries.length).toBe(6);
    });

    it("renders '—' for null company", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", company: null })]} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders '—' for null title", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", title: null })]} />);
      // company "Acme" will be present; title "—" will appear
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders '—' for null salary", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", salary: null })]} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders 'No jobs match your filters.' when jobs array is empty", () => {
      render(<JobsTable jobs={[]} />);
      expect(
        screen.getByText("No jobs match your filters."),
      ).toBeInTheDocument();
    });

    it("renders 'No results' in the pagination row when jobs array is empty", () => {
      render(<JobsTable jobs={[]} />);
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("shows 'No jobs match your filters.' after text filter eliminates all rows", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "zzznomatch",
      );
      expect(
        screen.getByText("No jobs match your filters."),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Pagination display text
  // -----------------------------------------------------------------------

  describe("pagination text", () => {
    it("shows 'Showing 1 to 6 of 6 results' for a single page of 6 jobs", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      // The pagination paragraph contains "Showing 1 to 6 of 6 results"
      const paginationPara = screen.getByText(/showing/i).closest("p");
      expect(paginationPara).toHaveTextContent("Showing");
      expect(paginationPara).toHaveTextContent("1");
      expect(paginationPara).toHaveTextContent("6");
      expect(paginationPara).toHaveTextContent("results");
    });

    it("shows 'Showing 1 to 6 of 7 results' for the first page of 7 jobs", () => {
      render(<JobsTable jobs={makeSevenJobs()} />);
      // Total count is 7; it should appear in pagination text
      const paginationPara = screen.getByText(/showing/i).closest("p");
      expect(paginationPara).toHaveTextContent("7");
      expect(paginationPara).toHaveTextContent("results");
    });
  });

  // -----------------------------------------------------------------------
  // Pagination controls
  // -----------------------------------------------------------------------

  describe("pagination controls", () => {
    it("Previous button is disabled on the first page", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(
        screen.getByRole("button", { name: "Previous" }),
      ).toBeDisabled();
    });

    it("Next button is disabled when all items fit on one page", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    });

    it("Next button is enabled when there are more pages", () => {
      render(<JobsTable jobs={makeSevenJobs()} />);
      expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
    });

    it("clicking Next shows the second page", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      // Page 2 should show the 7th job (Apple)
      expect(screen.getByText("Apple")).toBeInTheDocument();
    });

    it("clicking Next then Previous returns to the first page", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.click(screen.getByRole("button", { name: "Previous" }));
      // First page shows Vercel (which has highest score and is sorted by score)
      expect(screen.getByText("Vercel")).toBeInTheDocument();
    });

    it("Previous button is disabled on first page after navigating back", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.click(screen.getByRole("button", { name: "Previous" }));
      expect(
        screen.getByRole("button", { name: "Previous" }),
      ).toBeDisabled();
    });

    it("Next button is disabled on the last page", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    });

    it("clicking a page number button navigates to that page", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      // Page 2 button should exist (dataset spans 2 pages)
      const pageButtons = screen.getAllByRole("button");
      const page2Button = pageButtons.find((b) => b.textContent === "2");
      expect(page2Button).toBeDefined();
      await user.click(page2Button!);
      expect(screen.getByText("Apple")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // safePage clamping
  // -----------------------------------------------------------------------

  describe("safePage clamping", () => {
    it("after navigating to page 2, applying a filter that leaves <6 items returns to page 1 display", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      // Navigate to page 2
      await user.click(screen.getByRole("button", { name: "Next" }));
      // Apply a text filter that matches only 1 job (Vercel only)
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "vercel",
      );
      // Should show Vercel on page 1 (not empty)
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.queryByText("No jobs match your filters.")).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Text filtering
  // -----------------------------------------------------------------------

  describe("text filter", () => {
    it("filters by company name (case-insensitive)", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "vercel",
      );
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });

    it("filters by company name with uppercase input", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "VERCEL",
      );
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });

    it("filters by job title", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "product engineer",
      );
      expect(screen.getByText("Product Engineer")).toBeInTheDocument();
      expect(screen.queryByText("Senior Frontend")).not.toBeInTheDocument();
    });

    it("partial company match works", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "ver",
      );
      // "Vercel" contains "ver"
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });

    it("clearing text filter shows all jobs again", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      const input = screen.getByPlaceholderText("Filter by company or role...");
      await user.type(input, "vercel");
      await user.clear(input);
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });

    it("whitespace-only text filter shows all jobs", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "   ",
      );
      // All 6 jobs should still appear
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      expect(screen.getByText("Stripe")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Match filter (High / Low / All)
  // -----------------------------------------------------------------------

  describe("match filter", () => {
    it("'High Match' shows only jobs with score >= 70 (MATCH_THRESHOLD)", async () => {
      const user = userEvent.setup();
      // Include a low-score job (score = 40 < 70)
      const jobs = [
        ...SIX_JOBS,
        makeJob({ id: "low", company: "LowCo", title: "Low Job", match_score: 40 }),
      ];
      render(<JobsTable jobs={jobs} />);
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
      expect(screen.queryByText("LowCo")).not.toBeInTheDocument();
      // All SIX_JOBS have score >= 72, so they should still appear
      expect(screen.getByText("Vercel")).toBeInTheDocument();
    });

    it("'Low Match' shows only jobs with score < 70", async () => {
      const user = userEvent.setup();
      const jobs = [
        ...SIX_JOBS,
        makeJob({ id: "low", company: "LowCo", title: "Low Job", match_score: 40 }),
      ];
      render(<JobsTable jobs={jobs} />);
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "low");
      expect(screen.getByText("LowCo")).toBeInTheDocument();
      expect(screen.queryByText("Vercel")).not.toBeInTheDocument();
    });

    it("'Low Match' with no qualifying jobs shows empty state", async () => {
      const user = userEvent.setup();
      // All SIX_JOBS have score >= 72 which is >= MATCH_THRESHOLD (70)
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "low");
      expect(
        screen.getByText("No jobs match your filters."),
      ).toBeInTheDocument();
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("'All Matches' shows all jobs regardless of score", async () => {
      const user = userEvent.setup();
      const jobs = [
        ...SIX_JOBS,
        makeJob({ id: "low", company: "LowCo", title: "Low Job", match_score: 40 }),
      ];
      render(<JobsTable jobs={jobs} />);
      // Start on high match filter (hides LowCo)
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
      expect(screen.queryByText("LowCo")).not.toBeInTheDocument();
      // Switch back to "all" — total count should become 7 again
      await user.selectOptions(screen.getByDisplayValue("High Match"), "all");
      // All 7 jobs are included; LowCo has score 40 (sorted last), sits on page 2
      // Verify total count is 7 in pagination text
      const paginationPara = screen.getByText(/showing/i).closest("p");
      expect(paginationPara).toHaveTextContent("7");
      // Page 1 still shows high-score jobs
      expect(screen.getByText("Vercel")).toBeInTheDocument();
    });

    it("job with null match_score is treated as 0 for High Match filter", async () => {
      const user = userEvent.setup();
      const jobs = [makeJob({ id: "n", company: "NullCo", match_score: null })];
      render(<JobsTable jobs={jobs} />);
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
      expect(screen.queryByText("NullCo")).not.toBeInTheDocument();
    });

    it("job with null match_score is treated as 0 for Low Match filter", async () => {
      const user = userEvent.setup();
      const jobs = [makeJob({ id: "n", company: "NullCo", match_score: null })];
      render(<JobsTable jobs={jobs} />);
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "low");
      expect(screen.getByText("NullCo")).toBeInTheDocument();
    });

    it("match filter change resets to page 1", async () => {
      const user = userEvent.setup();
      // Create 13 high-match jobs to have 3 pages
      const manyHighJobs: Job[] = Array.from({ length: 13 }, (_, i) =>
        makeJob({ id: `hj${i}`, company: `Company${i}`, match_score: 90 }),
      );
      render(<JobsTable jobs={manyHighJobs} />);
      // Navigate to page 2
      await user.click(screen.getByRole("button", { name: "Next" }));
      // Apply high match filter — should reset to page 1 (Previous should be disabled)
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
      expect(
        screen.getByRole("button", { name: "Previous" }),
      ).toBeDisabled();
    });
  });

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------

  describe("sorting", () => {
    it("default sort is by match score (highest first)", () => {
      render(<JobsTable jobs={SIX_JOBS} />);
      const rows = screen.getAllByRole("row").slice(1); // skip header
      // Linear has score 96 (highest), should be first data row
      expect(rows[0]).toHaveTextContent("Linear");
    });

    it("sort by newest puts most recently found job first", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.selectOptions(screen.getByDisplayValue("Match Score"), "newest");
      const rows = screen.getAllByRole("row").slice(1);
      // Vercel was found 1 hour ago (most recent)
      expect(rows[0]).toHaveTextContent("Vercel");
    });

    it("sort by oldest puts oldest found job first", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={SIX_JOBS} />);
      await user.selectOptions(screen.getByDisplayValue("Match Score"), "oldest");
      const rows = screen.getAllByRole("row").slice(1);
      // Figma was found 6 hours ago (oldest)
      expect(rows[0]).toHaveTextContent("Figma");
    });

    it("sort change resets to page 1", async () => {
      const user = userEvent.setup();
      render(<JobsTable jobs={makeSevenJobs()} />);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.selectOptions(screen.getByDisplayValue("Match Score"), "newest");
      expect(
        screen.getByRole("button", { name: "Previous" }),
      ).toBeDisabled();
    });
  });

  // -----------------------------------------------------------------------
  // Match score bar (MatchScoreBar)
  // -----------------------------------------------------------------------

  describe("MatchScoreBar", () => {
    it("renders the score percentage text for each job", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 94 })]} />);
      expect(screen.getByText("94%")).toBeInTheDocument();
    });

    it("renders '0%' when match_score is null", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: null })]} />);
      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("bar fill uses var(--color-success) for score >= 90", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 90 })]} />);
      // The fill div has h-full rounded-full class with inline style
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-success)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-success) for score = 96 (above 90)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 96 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-success)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-info-medium) for score = 80", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 80 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-info-medium)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-info-medium) for score = 85 (in 80–89 range)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 85 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-info-medium)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-warning) for score = 50", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 50 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-warning)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-warning) for score = 72 (in 50–79 range)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 72 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-warning)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill uses var(--color-text-muted) for score < 50", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 30 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-text-muted)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill width equals score percentage", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 75 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.width === "75%",
      );
      expect(fillDiv).toBeDefined();
    });

    it("bar fill width is 0% for null match_score", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: null })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.width === "0%",
      );
      expect(fillDiv).toBeDefined();
    });

    // Boundary: score exactly at each tier threshold
    it("score of 89 (below 90) uses var(--color-info-medium)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 89 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-info-medium)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("score of 79 (below 80) uses var(--color-warning)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 79 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-warning)",
      );
      expect(fillDiv).toBeDefined();
    });

    it("score of 49 (below 50) uses var(--color-text-muted)", () => {
      render(<JobsTable jobs={[makeJob({ id: "x", match_score: 49 })]} />);
      const fillDivs = document.querySelectorAll(".h-full.rounded-full");
      const fillDiv = Array.from(fillDivs).find(
        (el) => (el as HTMLElement).style.backgroundColor === "var(--color-text-muted)",
      );
      expect(fillDiv).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // formatRelativeDate (tested via rendered Date Found column)
  // -----------------------------------------------------------------------

  describe("formatRelativeDate", () => {
    it("shows 'Just now' for a date less than 1 hour ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 30 * 60 * 1000).toISOString(), // 30 minutes ago
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("Just now")).toBeInTheDocument();
    });

    it("shows 'X hours ago' for a date several hours ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("5 hours ago")).toBeInTheDocument();
    });

    it("shows '1 hours ago' for a date exactly 1 hour ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(), // exactly 1 hour
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("1 hours ago")).toBeInTheDocument();
    });

    it("shows 'Yesterday' for a date exactly 1 day ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("Yesterday")).toBeInTheDocument();
    });

    it("shows 'X days ago' for a date several days ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("3 days ago")).toBeInTheDocument();
    });

    it("shows '2 days ago' for a date 2 days ago", () => {
      const job = makeJob({
        id: "x",
        found_at: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      });
      render(<JobsTable jobs={[job]} />);
      expect(screen.getByText("2 days ago")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // pageNumbers: ellipsis behaviour for > 5 pages
  // -----------------------------------------------------------------------

  describe("page number buttons", () => {
    it("shows all page buttons for a 2-page dataset (≤5 pages)", () => {
      render(<JobsTable jobs={makeSevenJobs()} />);
      // Only 2 pages: buttons "1" and "2" should appear
      const pageButtons = screen
        .getAllByRole("button")
        .filter((b) => /^\d+$/.test(b.textContent ?? ""));
      expect(pageButtons.map((b) => b.textContent)).toEqual(["1", "2"]);
    });

    it("shows ellipsis for a dataset with more than 5 pages", () => {
      // 37 jobs → 7 pages (6 per page)
      const manyJobs: Job[] = Array.from({ length: 37 }, (_, i) =>
        makeJob({ id: `j${i}`, company: `Co${i}`, match_score: 80 }),
      );
      render(<JobsTable jobs={manyJobs} />);
      expect(screen.getByText("...")).toBeInTheDocument();
    });

    it("shows [1, 2, 3, last] with ellipsis for > 5 pages", () => {
      const manyJobs: Job[] = Array.from({ length: 37 }, (_, i) =>
        makeJob({ id: `j${i}`, company: `Co${i}`, match_score: 80 }),
      );
      render(<JobsTable jobs={manyJobs} />);
      // Should show buttons 1, 2, 3, ... and 7 (total 37/6 = 7 pages)
      const pageButtons = screen
        .getAllByRole("button")
        .filter((b) => /^\d+$/.test(b.textContent ?? ""))
        .map((b) => Number(b.textContent));
      expect(pageButtons).toContain(1);
      expect(pageButtons).toContain(2);
      expect(pageButtons).toContain(3);
      expect(pageButtons).toContain(7); // last page
      expect(pageButtons).not.toContain(4); // hidden by ellipsis
    });

    it("shows all page buttons for exactly 5 pages (no ellipsis)", () => {
      // 25 jobs → ceil(25/6) = 5 pages exactly
      const fivePageJobs: Job[] = Array.from({ length: 25 }, (_, i) =>
        makeJob({ id: `j${i}`, company: `Co${i}`, match_score: 80 }),
      );
      render(<JobsTable jobs={fivePageJobs} />);
      expect(screen.queryByText("...")).not.toBeInTheDocument();
      const pageButtons = screen
        .getAllByRole("button")
        .filter((b) => /^\d+$/.test(b.textContent ?? ""))
        .map((b) => Number(b.textContent));
      expect(pageButtons).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // -----------------------------------------------------------------------
  // Combined filter + sort interaction
  // -----------------------------------------------------------------------

  describe("combined filter and sort", () => {
    it("text filter and high match filter can be applied together", async () => {
      const user = userEvent.setup();
      const jobs = [
        makeJob({ id: "j1", company: "Vercel", title: "Engineer", match_score: 95 }),
        makeJob({ id: "j2", company: "Vercel", title: "Intern", match_score: 40 }),
        makeJob({ id: "j3", company: "Stripe", title: "Engineer", match_score: 90 }),
      ];
      render(<JobsTable jobs={jobs} />);
      await user.type(
        screen.getByPlaceholderText("Filter by company or role..."),
        "vercel",
      );
      await user.selectOptions(screen.getByDisplayValue("All Matches"), "high");
      // Only Vercel with score 95 (>= 70) should remain
      expect(screen.getByText("Vercel")).toBeInTheDocument();
      // Vercel intern has score 40, filtered out
      // Stripe not in text filter
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });
  });
});