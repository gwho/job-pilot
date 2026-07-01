/**
 * Tests for the Feature 12 job details route: app/find-jobs/[id]/page.tsx
 *
 * This is a Server Component that:
 *  - awaits the Next.js 16 `params` Promise
 *  - redirects unauthenticated users to /login
 *  - queries the `jobs` table filtered by BOTH id and user_id (the
 *    per-user access control boundary) and calls notFound() when either
 *    filter eliminates the row
 *  - renders the 5 job-details components with the fetched job
 *
 * External boundaries are mocked: the InsForge server client, Next's
 * redirect/notFound, and the (unrelated, pre-existing) Navbar — which is an
 * async Server Component that would break client-side `render()` if left
 * unmocked.
 *
 * Run: npm run test:run -- __tests__/find-jobs/job-details-page.test.tsx
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import JobDetailsPage from "@/app/find-jobs/[id]/page";
import { createInsforgeServer } from "@/lib/insforge-server";
import { redirect, notFound } from "next/navigation";
import type { Job } from "@/types/index";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

// Navbar is an async Server Component unrelated to this PR's scope; it must
// be stubbed so react-dom's client renderer (used by @testing-library/react)
// can render the already-awaited JSX tree synchronously.
vi.mock("@/components/layout/Navbar", () => ({
  Navbar: () => <header data-testid="navbar-stub" />,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: "https://hk.jobsdb.com/job/123",
    external_apply_url: "https://acme.taleo.net/apply/123",
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Hong Kong",
    salary: "HK$30,000",
    job_type: "fulltime",
    about_role: "Build great things.",
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 82,
    match_reason: "Strong fit.",
    matched_skills: ["React"],
    missing_skills: ["Go"],
    company_research: null,
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

// Minimal chainable DB query mock: .select().eq().eq().single()
function createJobsChain(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function buildInsforgeMock(opts: {
  user?: { id: string } | null;
  authError?: unknown;
  jobResult?: { data: unknown; error: unknown };
}) {
  const { user = { id: "user-1" }, authError = null, jobResult = { data: null, error: null } } = opts;
  const jobsChain = createJobsChain(jobResult);
  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
    },
    database: {
      from: vi.fn().mockReturnValue(jobsChain),
    },
  };
}

function makeParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("JobDetailsPage", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(notFound).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to /login when the user is unauthenticated", async () => {
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ user: null }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    await expect(
      JobDetailsPage({ params: makeParams("job-1") }),
    ).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when auth returns an error", async () => {
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ user: { id: "user-1" }, authError: new Error("auth failed") }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    await expect(
      JobDetailsPage({ params: makeParams("job-1") }),
    ).rejects.toThrow("REDIRECT:/login");
  });

  it("calls notFound() when the job query returns an error (e.g. wrong user_id)", async () => {
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        jobResult: { data: null, error: { code: "PGRST116", message: "no rows" } },
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await expect(JobDetailsPage({ params: makeParams("job-1") })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalled();
  });

  it("calls notFound() when the job is null even without an explicit error", async () => {
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ jobResult: { data: null, error: null } }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    await expect(JobDetailsPage({ params: makeParams("job-1") })).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("queries the jobs table filtered by both id and the authenticated user's id", async () => {
    const job = makeJob({ id: "job-42" });
    const insforgeMock = buildInsforgeMock({
      user: { id: "user-99" },
      jobResult: { data: job, error: null },
    });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await JobDetailsPage({ params: makeParams("job-42") });

    expect(insforgeMock.database.from).toHaveBeenCalledWith("jobs");
    const jobsChain = insforgeMock.database.from.mock.results[0].value;
    expect(jobsChain.eq).toHaveBeenCalledWith("id", "job-42");
    expect(jobsChain.eq).toHaveBeenCalledWith("user_id", "user-99");
  });

  it("awaits the Next.js 16 params Promise before querying", async () => {
    const job = makeJob({ id: "job-abc" });
    const insforgeMock = buildInsforgeMock({ jobResult: { data: job, error: null } });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      insforgeMock as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await JobDetailsPage({ params: makeParams("job-abc") });

    const jobsChain = insforgeMock.database.from.mock.results[0].value;
    expect(jobsChain.eq).toHaveBeenCalledWith("id", "job-abc");
  });

  it("renders the job details components when the job is found", async () => {
    const job = makeJob({ title: "Backend Engineer", company: "Beta Inc" });
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ jobResult: { data: job, error: null } }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    const jsx = await JobDetailsPage({ params: makeParams("job-1") });
    render(jsx);

    expect(screen.getByText("Back to Jobs")).toBeInTheDocument();
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Job Description")).toBeInTheDocument();
    expect(screen.getByText("Company Research")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply Now at Beta Inc" })).toBeInTheDocument();
  });

  it("the 'Back to Jobs' link points to /find-jobs", async () => {
    const job = makeJob();
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({ jobResult: { data: job, error: null } }) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );

    const jsx = await JobDetailsPage({ params: makeParams("job-1") });
    render(jsx);

    expect(screen.getByRole("link", { name: /Back to Jobs/i })).toHaveAttribute(
      "href",
      "/find-jobs",
    );
  });
});