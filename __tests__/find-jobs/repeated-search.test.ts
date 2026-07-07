/**
 * Regression test for the Find Jobs repeated-search bug.
 *
 * Bug: clicking "Find Jobs" twice with the same keyword returns
 * "all already saved" — because the route calls the Apify actor with
 * maxPages=1 every time, so page 1 is the only page ever fetched.
 * Once those ~10 jobs are in the DB, every subsequent search is a no-op.
 *
 * Fix: the route loops maxPages from 1..5 until it finds ≥10 new jobs
 * or exhausts available pages.
 *
 * Run: npm run test:run -- __tests__/find-jobs/repeated-search.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/find/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs } from "@/agent/job-matcher";
import type { Job } from "@/types/index";

// ── Module mocks (hoisted by Vitest before any imports) ───────────────────────

vi.mock("@/lib/insforge-server", () => ({ createInsforgeServer: vi.fn() }));
vi.mock("@/agent/jobsdb", () => ({
  discoverJobsDbJobs: vi.fn(),
  toScoringInput: (j: {
    title: string;
    company: string;
    location: string;
    description: string;
  }) => ({
    title: j.title,
    company: j.company,
    location: j.location,
    description: j.description,
  }),
}));
vi.mock("@/agent/job-matcher", () => ({ scoreJobs: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── DB chain builder ──────────────────────────────────────────────────────────

// Returns a chainable object whose methods all return `this`, allowing any
// InsForge query chain (select/insert/update/eq/…) to resolve via:
//   • .maybeSingle() / .single() — explicit terminal
//   • direct `await chain` — via the `then` property (thenable protocol)
function createChain(resolvedValue: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  // Make the chain directly awaitable (thenable).
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}

// Builds the minimal InsForge client mock the find-jobs route needs.
// Call-count per table is tracked inside so the right chain is returned
// for each distinct query (e.g. jobs-select vs jobs-insert).
function buildInsforgeMock(existingJobs: Job[], insertResult: Job[]) {
  const callCounts: Record<string, number> = {};

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        callCounts[table] = (callCounts[table] ?? 0) + 1;
        const n = callCounts[table];

        if (table === "profiles") {
          return createChain({ data: null, error: null });
        }
        if (table === "agent_runs") {
          // 1st call: insert([...]).select().single()
          // 2nd call: update({...}).eq().eq()  — direct await
          return n === 1
            ? createChain({ data: { id: "run-1" }, error: null })
            : createChain({ error: null });
        }
        if (table === "jobs") {
          // 1st call: select("*").eq().eq()  — direct await (existingByUrl query)
          // 2nd call: insert([...]).select() — direct await (new-jobs insert)
          return n === 1
            ? createChain({ data: existingJobs, error: null })
            : createChain({ data: insertResult, error: null });
        }
        return createChain({ data: null, error: null });
      }),
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDbJob(id: string, sourceUrl: string): Job {
  return {
    id,
    run_id: "run-0",
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: sourceUrl,
    external_apply_url: null,
    title: `Role ${id}`,
    company: `Corp ${id}`,
    location: "Hong Kong",
    salary: null,
    job_type: "fulltime",
    about_role: null,
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 60,
    match_reason: null,
    matched_skills: [],
    missing_skills: [],
    company_research: null,
    found_at: new Date().toISOString(),
  };
}

function makeActorJob(sourceUrl: string) {
  return {
    title: "Actor Role",
    company: "Actor Corp",
    location: "Hong Kong",
    salary: null,
    jobType: null,
    description: "desc",
    sourceUrl,
    externalApplyUrl: null,
    postedAt: null,
  };
}

function makePostRequest() {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobTitle: "Engineer", location: "Hong Kong" }),
  }) as unknown as Parameters<typeof POST>[0];
}

// ── Shared scenario ───────────────────────────────────────────────────────────

// 10 page-1 jobs already in the DB from a prior search.
const existingJobs = Array.from({ length: 10 }, (_, i) =>
  makeDbJob(`db-${i}`, `https://hk.jobsdb.com/job/p1-${i}`),
);
// Actor returns these same 10 URLs when called with maxPages=1.
const page1ActorJobs = existingJobs.map((j) => makeActorJob(j.source_url!));
// 10 new jobs the actor returns on page 2.
const page2NewActorJobs = Array.from({ length: 10 }, (_, i) =>
  makeActorJob(`https://hk.jobsdb.com/job/p2-${i}`),
);
// Actor returns pages 1+2 combined when called with maxPages=2.
const allPage2ActorJobs = [...page1ActorJobs, ...page2NewActorJobs];
// DB insert result for the 10 new page-2 jobs.
const insertResult: Job[] = page2NewActorJobs.map((j, i) => ({
  ...makeDbJob(`new-${i}`, j.sourceUrl),
  match_score: 50, // below MATCH_THRESHOLD=70 → no job_found events
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests — all RED on current code, GREEN after fix
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/agent/find — repeated-search pagination loop", () => {
  beforeEach(() => {
    vi.mocked(discoverJobsDbJobs)
      .mockReset()
      // call 1 (maxPages=1): actor returns only page 1 — all already in DB
      .mockResolvedValueOnce(page1ActorJobs)
      // call 2 (maxPages=2): actor returns pages 1+2 — 10 new jobs on page 2
      .mockResolvedValueOnce(allPage2ActorJobs);

    // scoreJobs must return the same length as its input — index-aligned.
    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => ({
        matchScore: 50,
        matchReason: "",
        matchedSkills: [],
        missingSkills: [],
      })),
    );

    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock(existingJobs, insertResult) as unknown as Awaited<
        ReturnType<typeof createInsforgeServer>
      >,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls discoverJobsDbJobs at least twice — page-1 only is insufficient", async () => {
    // RED: current code calls the actor once and exits with "all already saved"
    await POST(makePostRequest());
    expect(vi.mocked(discoverJobsDbJobs)).toHaveBeenCalledTimes(2);
  });

  it("second actor call uses maxPages=2 and maxItems=20", async () => {
    await POST(makePostRequest());
    const calls = vi.mocked(discoverJobsDbJobs).mock.calls;
    const lastCall = calls[calls.length - 1];
    // RED: current code only makes one call with (query, location, 10, 1)
    expect(lastCall).toEqual(["Engineer", "Hong Kong", 20, 2]);
  });

  it("response contains newJobs > 0 on a repeat search", async () => {
    // RED: current code returns { newJobs: 0, successMessage: "…all already saved." }
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.newJobs).toBeGreaterThan(0);
  });

  it('successMessage does not contain "all already saved"', async () => {
    // RED: current code returns "Found 10 jobs — all already saved."
    const res = await POST(makePostRequest());
    const data = await res.json();
    expect(data.successMessage).not.toMatch(/all already saved/i);
  });

  it("response includes jobs from page 2 (the newly discovered ones)", async () => {
    const res = await POST(makePostRequest());
    const data = await res.json();
    const urls = (data.jobs as Job[]).map((j) => j.source_url);
    // RED: current code returns no page-2 URLs
    expect(urls.some((u) => u?.includes("/job/p2-"))).toBe(true);
  });
});
