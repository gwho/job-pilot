/**
 * Regression tests for the AI matching + persistence reliability fix.
 *
 * Root cause: the pre-fix scoreJobs() fabricated matchScore: 0 on any scoring
 * failure, and app/api/agent/find/route.ts wrote that unconditionally to
 * jobs.match_score — indistinguishable from a real 0% match once persisted.
 * There was also no rescore path: existingByUrl dedup meant a job that got
 * the fallback sentinel once stayed that way forever, since rediscovering the
 * same source_url only ever skipped it.
 *
 * This suite exercises the real scoreJobs() → route persistence boundary
 * (scoreJobs itself is mocked here, like the existing find-jobs route tests —
 * its internals are covered by __tests__/agent/job-matcher.test.ts) with a
 * focus on the two things route.ts itself is responsible for:
 *   1. Never inserting a fake 0% — matcher output is passed straight through.
 *   2. Rediscovered rows carrying the legacy 0-sentinel or a null score get
 *      exactly one rescore attempt, capped at 10 and oldest-first, folded
 *      into the same scoreJobs() batch as brand-new jobs, updated (never
 *      duplicated), never overwriting a row that already holds a valid
 *      score, and never re-firing job_found for a rescored row.
 *
 * Run: npm run test:run -- __tests__/find-jobs/matching-reliability.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/find/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { discoverJobsDbJobs } from "@/agent/jobsdb";
import { scoreJobs, UNSCORED_MATCH_REASON, type JobScore } from "@/agent/job-matcher";
import { captureServerEvent } from "@/lib/posthog-server";
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
vi.mock("@/agent/job-matcher", async () => {
  const actual = await vi.importActual<typeof import("@/agent/job-matcher")>(
    "@/agent/job-matcher",
  );
  return { ...actual, scoreJobs: vi.fn() };
});
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── "jobs" table mock ──────────────────────────────────────────────────────
//
// Each `.from("jobs")` call gets a fresh chain whose terminal resolution
// depends on which operation was invoked on it (select-only vs. update vs.
// insert), not on call order — the route may issue an unbounded number of
// per-candidate update() calls (one per rescore candidate, via Promise.all)
// before the final insert(), and this mock must resolve each correctly
// regardless of how many there are or what order they settle in.

type JobsMode = "select" | "update" | "insert" | null;

function buildInsforgeMock(options: {
  existingJobsResult: { data: Job[] | null; error: unknown };
  insertResult: { data: Job[] | null; error: unknown };
  updateResultsById: Map<string, { data: Job | null; error: unknown }>;
  updateSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
}) {
  const { existingJobsResult, insertResult, updateResultsById, updateSpy, insertSpy } =
    options;

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
    database: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: vi.fn().mockImplementation((table: string): any => {
        if (table === "profiles") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = {};
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
          return chain;
        }

        if (table === "agent_runs") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = {};
          chain.insert = vi.fn().mockReturnValue(chain);
          chain.update = vi.fn().mockReturnValue(chain);
          chain.select = vi.fn().mockReturnValue(chain);
          chain.eq = vi.fn().mockReturnValue(chain);
          chain.single = vi.fn().mockResolvedValue({ data: { id: "run-1" }, error: null });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chain.then = (onFulfilled: any, onRejected?: any) =>
            Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          return chain;
        }

        if (table === "jobs") {
          let mode: JobsMode = null;
          let updateId: string | null = null;
          let patch: Record<string, unknown> | null = null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = {};
          chain.select = vi.fn().mockImplementation(() => {
            if (mode === null) mode = "select";
            return chain;
          });
          chain.insert = vi.fn().mockImplementation((records: unknown) => {
            mode = "insert";
            insertSpy(records);
            return chain;
          });
          chain.update = vi.fn().mockImplementation((p: Record<string, unknown>) => {
            mode = "update";
            patch = p;
            return chain;
          });
          chain.eq = vi.fn().mockImplementation((col: string, value: string) => {
            if (mode === "update" && col === "id") updateId = value;
            return chain;
          });
          chain.single = vi.fn().mockImplementation(() => {
            updateSpy(updateId, patch);
            const result = (updateId && updateResultsById.get(updateId)) || {
              data: null,
              error: new Error(`no mock result for id ${String(updateId)}`),
            };
            return Promise.resolve(result);
          });
          chain.maybeSingle = vi.fn();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chain.then = (onFulfilled: any, onRejected?: any) => {
            const value = mode === "insert" ? insertResult : existingJobsResult;
            return Promise.resolve(value).then(onFulfilled, onRejected);
          };
          return chain;
        }

        throw new Error(`Unexpected table in test: ${table}`);
      }),
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeExistingJob(overrides: Partial<Job> & { id: string; source_url: string }): Job {
  return {
    id: overrides.id,
    run_id: "run-0",
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: overrides.source_url,
    external_apply_url: null,
    title: "Existing Role",
    company: "Existing Corp",
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
    match_reason: "Some reason",
    matched_skills: [],
    missing_skills: [],
    company_research: null,
    found_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
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

function makeLegacyFallbackJob(id: string, sourceUrl: string, foundAt: string): Job {
  return makeExistingJob({
    id,
    source_url: sourceUrl,
    match_score: 0,
    match_reason: UNSCORED_MATCH_REASON,
    matched_skills: [],
    missing_skills: [],
    found_at: foundAt,
  });
}

function realScore(matchScore: number): JobScore {
  return {
    matchScore,
    matchReason: "Rescored for real.",
    matchedSkills: ["TypeScript"],
    missingSkills: [],
  };
}

function makePostRequest() {
  return new Request("http://localhost/api/agent/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobTitle: "Engineer", location: "Hong Kong" }),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.mocked(discoverJobsDbJobs).mockReset();
  vi.mocked(scoreJobs).mockReset();
  vi.mocked(captureServerEvent).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/agent/find — matching reliability + rescore", () => {
  it("passes matcher output straight through without fabricating a score", async () => {
    const actorJobs = [makeActorJob("https://hk.jobsdb.com/job/new-1")];
    const insertResult: Job[] = [
      makeExistingJob({
        id: "new-1",
        source_url: actorJobs[0].sourceUrl,
        match_score: null,
        match_reason: UNSCORED_MATCH_REASON,
        matched_skills: [],
        missing_skills: [],
      }),
    ];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([
      { matchScore: null, matchReason: UNSCORED_MATCH_REASON, matchedSkills: [], missingSkills: [] },
    ]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [], error: null },
        insertResult: { data: insertResult, error: null },
        updateResultsById: new Map(),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.success).toBe(true);
    const insertedRecords = insertSpy.mock.calls[0][0] as Array<{ match_score: number | null }>;
    expect(insertedRecords[0].match_score).toBeNull();
  });

  it("rescores an existing row with the exact legacy fallback signature, updating not inserting", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/legacy-1";
    const existing = makeLegacyFallbackJob("legacy-1", sourceUrl, "2026-01-01T00:00:00.000Z");
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([realScore(85)]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map([
          ["legacy-1", { data: { ...existing, match_score: 85, match_reason: "Rescored for real." }, error: null }],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(vi.mocked(scoreJobs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scoreJobs).mock.calls[0][0]).toHaveLength(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      "legacy-1",
      expect.objectContaining({ match_score: 85 }),
    );
    expect(insertSpy).not.toHaveBeenCalled();
    const returnedJob = (data.jobs as Job[]).find((j) => j.source_url === sourceUrl);
    expect(returnedJob?.match_score).toBe(85);
  });

  it("does not rescore an existing row with a genuine 0% score", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/genuine-zero";
    const existing = makeExistingJob({
      id: "genuine-zero",
      source_url: sourceUrl,
      match_score: 0,
      match_reason: "Poor fit for this specific candidate.",
      matched_skills: [],
      missing_skills: ["Everything"],
    });
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map(),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(data.success).toBe(true);
    // Nothing new, nothing to rescore — scoreJobs is still called (route
    // always calls it) but with zero jobs, since this row is excluded.
    expect(vi.mocked(scoreJobs).mock.calls[0][0]).toHaveLength(0);
    expect(updateSpy).not.toHaveBeenCalled();
    const returnedJob = (data.jobs as Job[]).find((j) => j.source_url === sourceUrl);
    expect(returnedJob?.match_score).toBe(0);
    expect(returnedJob?.match_reason).toBe("Poor fit for this specific candidate.");
  });

  it("rescores an existing row whose match_score is already null", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/already-null";
    const existing = makeExistingJob({
      id: "already-null",
      source_url: sourceUrl,
      match_score: null,
      match_reason: UNSCORED_MATCH_REASON,
      matched_skills: [],
      missing_skills: [],
    });
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([realScore(72)]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map([
          ["already-null", { data: { ...existing, match_score: 72 }, error: null }],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await POST(makePostRequest());

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      "already-null",
      expect.objectContaining({ match_score: 72 }),
    );
  });

  it("never touches an existing row with a valid non-zero score", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/valid-score";
    const existing = makeExistingJob({
      id: "valid-score",
      source_url: sourceUrl,
      match_score: 75,
      match_reason: "Strong match.",
      matched_skills: ["TypeScript"],
      missing_skills: [],
    });
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map(),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(updateSpy).not.toHaveBeenCalled();
    const returnedJob = (data.jobs as Job[]).find((j) => j.source_url === sourceUrl);
    expect(returnedJob?.match_score).toBe(75);
  });

  it("folds new jobs and rescore candidates into one batch, inserting only new records and updating only rescore ids", async () => {
    const newUrl = "https://hk.jobsdb.com/job/brand-new";
    const legacyUrl1 = "https://hk.jobsdb.com/job/legacy-a";
    const legacyUrl2 = "https://hk.jobsdb.com/job/legacy-b";

    const legacyA = makeLegacyFallbackJob("legacy-a", legacyUrl1, "2026-01-01T00:00:00.000Z");
    const legacyB = makeLegacyFallbackJob("legacy-b", legacyUrl2, "2026-01-02T00:00:00.000Z");

    const actorJobs = [
      makeActorJob(newUrl),
      makeActorJob(legacyUrl1),
      makeActorJob(legacyUrl2),
    ];

    const insertResult: Job[] = [
      makeExistingJob({ id: "new-1", source_url: newUrl, match_score: 88, match_reason: "New job scored." }),
    ];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([realScore(88), realScore(70), realScore(65)]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [legacyA, legacyB], error: null },
        insertResult: { data: insertResult, error: null },
        updateResultsById: new Map([
          ["legacy-a", { data: { ...legacyA, match_score: 70 }, error: null }],
          ["legacy-b", { data: { ...legacyB, match_score: 65 }, error: null }],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await POST(makePostRequest());

    expect(vi.mocked(scoreJobs)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(scoreJobs).mock.calls[0][0]).toHaveLength(3);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect((insertSpy.mock.calls[0][0] as unknown[])).toHaveLength(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    const updatedIds = updateSpy.mock.calls.map((call) => call[0]).sort();
    expect(updatedIds).toEqual(["legacy-a", "legacy-b"]);
  });

  it("caps rescore candidates at 10, oldest found_at first", async () => {
    const legacyJobs = Array.from({ length: 13 }, (_, i) =>
      makeLegacyFallbackJob(
        `legacy-${i}`,
        `https://hk.jobsdb.com/job/legacy-${i}`,
        new Date(2026, 0, i + 1).toISOString(),
      ),
    );
    const actorJobs = legacyJobs.map((j) => makeActorJob(j.source_url!));
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockImplementation(async (inputs) =>
      inputs.map(() => realScore(50)),
    );
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: legacyJobs, error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map(
          legacyJobs.map((j) => [j.id, { data: { ...j, match_score: 50 }, error: null }]),
        ),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await POST(makePostRequest());

    expect(vi.mocked(scoreJobs).mock.calls[0][0]).toHaveLength(10);
    expect(updateSpy).toHaveBeenCalledTimes(10);
    const updatedIds = updateSpy.mock.calls.map((call) => call[0]);
    // Oldest 10 of 13 — legacy-0 through legacy-9, never legacy-10/11/12.
    expect(updatedIds).not.toContain("legacy-10");
    expect(updatedIds).not.toContain("legacy-11");
    expect(updatedIds).not.toContain("legacy-12");
  });

  it("a failed rescore DB update is non-fatal — response still succeeds", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/update-fails";
    const existing = makeLegacyFallbackJob("update-fails", sourceUrl, "2026-01-01T00:00:00.000Z");
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([realScore(90)]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map([
          ["update-fails", { data: null, error: new Error("db unavailable") }],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    const res = await POST(makePostRequest());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("normalizes a legacy 0 to null when the rescore attempt itself fails to produce a real score", async () => {
    const sourceUrl = "https://hk.jobsdb.com/job/rescore-still-fails";
    const existing = makeLegacyFallbackJob(
      "rescore-still-fails",
      sourceUrl,
      "2026-01-01T00:00:00.000Z",
    );
    const actorJobs = [makeActorJob(sourceUrl)];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([
      { matchScore: null, matchReason: UNSCORED_MATCH_REASON, matchedSkills: [], missingSkills: [] },
    ]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [existing], error: null },
        insertResult: { data: [], error: null },
        updateResultsById: new Map([
          [
            "rescore-still-fails",
            { data: { ...existing, match_score: null }, error: null },
          ],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await POST(makePostRequest());

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      "rescore-still-fails",
      expect.objectContaining({ match_score: null }),
    );
  });

  it("never fires job_found for a rescored existing row, only for newly inserted ones", async () => {
    const newUrl = "https://hk.jobsdb.com/job/brand-new-2";
    const legacyUrl = "https://hk.jobsdb.com/job/legacy-c";
    const legacy = makeLegacyFallbackJob("legacy-c", legacyUrl, "2026-01-01T00:00:00.000Z");
    const actorJobs = [makeActorJob(newUrl), makeActorJob(legacyUrl)];

    const insertResult: Job[] = [
      makeExistingJob({ id: "new-2", source_url: newUrl, match_score: 88, match_reason: "New." }),
    ];
    const updateSpy = vi.fn();
    const insertSpy = vi.fn();

    vi.mocked(discoverJobsDbJobs).mockResolvedValue(actorJobs);
    vi.mocked(scoreJobs).mockResolvedValue([realScore(88), realScore(60)]);
    vi.mocked(createInsforgeServer).mockResolvedValue(
      buildInsforgeMock({
        existingJobsResult: { data: [legacy], error: null },
        insertResult: { data: insertResult, error: null },
        updateResultsById: new Map([
          ["legacy-c", { data: { ...legacy, match_score: 60 }, error: null }],
        ]),
        updateSpy,
        insertSpy,
      }) as unknown as Awaited<ReturnType<typeof createInsforgeServer>>,
    );

    await POST(makePostRequest());

    const jobFoundCalls = vi
      .mocked(captureServerEvent)
      .mock.calls.filter((call) => call[0].event === "job_found");
    expect(jobFoundCalls).toHaveLength(1);
  });
});
