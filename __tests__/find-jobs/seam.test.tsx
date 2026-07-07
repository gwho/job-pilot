/**
 * Red/green repro for the Find Jobs UI/API seam bug.
 *
 * The bug: after searching more than once, the banner shows wrong/undefined
 * text, because the client ignores `data.successMessage` and `data.newJobs`
 * from the API and re-constructs the message using `data.strongMatches` —
 * which is absent from the "all already saved" response path.
 *
 * Run: npm run test:run -- __tests__/find-jobs/seam.test.tsx
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { FindJobsClient } from "@/components/find-jobs/FindJobsClient";
import type { Job } from "@/types/index";

// ── next/navigation mock ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/find-jobs",
}));

// ── Job fixture ───────────────────────────────────────────────────────────────

function makeJob(id: string, title = `Role ${id}`, company = `Corp ${id}`): Job {
  return {
    id,
    run_id: null,
    user_id: "u1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: `https://hk.jobsdb.com/job/${id}`,
    external_apply_url: null,
    title,
    company,
    location: "Hong Kong",
    salary: null,
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
  };
}

// ── API response helpers ──────────────────────────────────────────────────────

function mockFetch(body: object) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

// Path A: actor found jobs and all are already in DB for this user.
// The route should still return those existing rows so the UI can show the
// latest search result instead of leaving stale rows on screen.
const pathAResponse = {
  success: true,
  jobs: [makeJob("current-1", "Current Search Role", "Current Corp")],
  jobsFound: 10,
  newJobs: 0,
  successMessage: "Found 10 jobs — all already saved.",
};

// Path B: new jobs were discovered and saved.
const pathBResponse = (newCount: number, strong: number) => ({
  success: true,
  jobs: Array.from({ length: newCount }, (_, i) => makeJob(`new-${i}`, `New Role ${i}`, `Corp ${i}`)),
  jobsFound: 10,
  newJobs: newCount,
  strongMatches: strong,
  successMessage: `Found 10 jobs and saved ${newCount} new jobs.`,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function clickFindJobs() {
  const btn = screen.getByRole("button", { name: /find jobs/i });
  fireEvent.click(btn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 feedback loop — these tests go RED on current code, GREEN after fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("Find Jobs UI/API seam — success banner", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("banner must not contain 'undefined' after a repeat search (all already saved)", async () => {
    // Path A: strongMatches is absent → current code sets searchStatus.strongMatches = undefined
    // Banner renders: "Found 10 jobs and saved undefined strong matches."
    mockFetch(pathAResponse);
    render(<FindJobsClient initialJobs={[makeJob("existing-1")]} />);

    await clickFindJobs();

    await waitFor(() => {
      // Banner must appear — jobsFound is always present
      expect(screen.getByText(/found 10 jobs/i)).toBeInTheDocument();
    });

    // RED on current code — banner shows "undefined" because strongMatches is missing from API response
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it("banner must reflect the API's successMessage, not client-constructed copy", async () => {
    // API says "saved 3 new jobs". Current code ignores successMessage entirely and says
    // "saved 1 strong matches" instead (using strongMatches count, wrong field + wrong copy).
    mockFetch(pathBResponse(3, 1));
    render(<FindJobsClient initialJobs={[]} />);

    await clickFindJobs();

    await waitFor(() => {
      expect(screen.getByText(/found 10 jobs/i)).toBeInTheDocument();
    });

    // RED on current code — current banner says "1 strong matches", not "3 new jobs"
    expect(screen.getByText(/3 new jobs/i)).toBeInTheDocument();
  });

  it("banner must not say 'strong matches' — correct copy is 'new jobs'", async () => {
    mockFetch(pathBResponse(5, 3));
    render(<FindJobsClient initialJobs={[]} />);

    await clickFindJobs();

    await waitFor(() => {
      expect(screen.getByText(/found 10 jobs/i)).toBeInTheDocument();
    });

    // RED on current code — banner says "strong matches" which is wrong copy
    expect(screen.queryByText(/strong matches/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Table behavior — these document the expected behaviour after the fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("Find Jobs UI/API seam — table rows", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("replaces stale table rows with the latest search result", async () => {
    const existing = [
      makeJob("j1", "Old Sales Coordinator", "ACME"),
      makeJob("j2", "Old Account Exec", "Beta"),
    ];
    mockFetch(pathAResponse);

    render(<FindJobsClient initialJobs={existing} />);

    // Jobs visible before search
    expect(screen.getByText("Old Sales Coordinator")).toBeInTheDocument();
    expect(screen.getByText("Old Account Exec")).toBeInTheDocument();

    await clickFindJobs();

    await waitFor(() => {
      expect(screen.getByText(/found 10 jobs/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Current Search Role")).toBeInTheDocument();
    expect(screen.queryByText("Old Sales Coordinator")).not.toBeInTheDocument();
    expect(screen.queryByText("Old Account Exec")).not.toBeInTheDocument();
  });

  it("new jobs from API response replace the previous table results", async () => {
    const existing = [makeJob("old-1", "Old Role", "Old Corp")];
    mockFetch(pathBResponse(2, 1));

    render(<FindJobsClient initialJobs={existing} />);

    await clickFindJobs();

    await waitFor(() => {
      expect(screen.getByText(/found 10 jobs/i)).toBeInTheDocument();
    });

    expect(screen.queryByText("Old Role")).not.toBeInTheDocument();
    expect(screen.getByText("New Role 0")).toBeInTheDocument();
    expect(screen.getByText("New Role 1")).toBeInTheDocument();
  });

  it("second search replaces first search results — keyword B rows replace keyword A rows", async () => {
    const searchAJobs = [
      makeJob("a1", "Sales Coordinator HK", "Trade Co"),
      makeJob("a2", "Sales Coordinator MNC", "Global Corp"),
    ];
    const searchBJobs = [
      makeJob("b1", "Software Engineer Frontend", "Tech Ltd"),
      makeJob("b2", "Software Engineer Backend", "Dev Inc"),
    ];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          jobs: searchAJobs,
          jobsFound: 2,
          newJobs: 2,
          successMessage: "Found 2 jobs and saved 2 new jobs.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          jobs: searchBJobs,
          jobsFound: 2,
          newJobs: 2,
          successMessage: "Found 2 jobs and saved 2 new jobs.",
        }),
      });

    render(<FindJobsClient initialJobs={[]} />);

    // First search (keyword A)
    await clickFindJobs();
    await waitFor(() =>
      expect(screen.getByText("Sales Coordinator HK")).toBeInTheDocument(),
    );
    expect(screen.getByText("Sales Coordinator MNC")).toBeInTheDocument();

    // Second search (keyword B) — results must fully replace keyword A
    await clickFindJobs();
    await waitFor(() =>
      expect(screen.getByText("Software Engineer Frontend")).toBeInTheDocument(),
    );

    expect(screen.getByText("Software Engineer Backend")).toBeInTheDocument();
    // Keyword A must be gone
    expect(screen.queryByText("Sales Coordinator HK")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales Coordinator MNC")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error path — these document the MISSING behaviour that causes the user to
// see silent failure (old results persisting with no feedback).
// ─────────────────────────────────────────────────────────────────────────────

describe("Find Jobs UI/API seam — error handling", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows error feedback when the API returns a failure — must not be silent", async () => {
    // Current code: if (!res.ok || !data.success) { console.error(...); return; }
    // No banner update, no error state. User sees old table silently — this is the bug.
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ success: false, error: "Job search failed. Please try again." }),
    });

    render(<FindJobsClient initialJobs={[makeJob("j1", "Old Role", "Old Corp")]} />);
    expect(screen.getByText("Old Role")).toBeInTheDocument();

    await clickFindJobs();

    // RED on current code — no error banner appears; user gets no feedback
    await waitFor(() => {
      expect(
        screen.getByText(/search failed|please try again|something went wrong/i),
      ).toBeInTheDocument();
    });

    // Old results stay (correct on error — don't wipe the table)
    expect(screen.getByText("Old Role")).toBeInTheDocument();
  });

  it("clears the loading state after an API error so the button is re-enabled", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false, error: "Failed" }),
    });

    render(<FindJobsClient initialJobs={[]} />);

    await clickFindJobs();

    // After error resolves, button must not be stuck in loading/disabled state
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /find jobs/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("shows error banner when fetch rejects (network / JSON parse error)", async () => {
    // Current code: catch block only logs — no banner update. Silent failure.
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    render(<FindJobsClient initialJobs={[makeJob("j1", "Old Role", "Old Corp")]} />);
    expect(screen.getByText("Old Role")).toBeInTheDocument();

    await clickFindJobs();

    // RED on current code — catch block returns without setting searchStatus
    await waitFor(() => {
      expect(
        screen.getByText(/search failed|please try again|something went wrong/i),
      ).toBeInTheDocument();
    });

    // Old results must still be visible (don't wipe on error)
    expect(screen.getByText("Old Role")).toBeInTheDocument();
  });

  it("re-enables the Find Jobs button after a network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    render(<FindJobsClient initialJobs={[]} />);

    await clickFindJobs();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /find jobs/i });
      expect(btn).not.toBeDisabled();
    });
  });
});
