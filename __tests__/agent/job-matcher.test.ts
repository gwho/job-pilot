/**
 * Regression tests for the AI matching reliability fix (issue: AI matching,
 * match score, and skill comparison regression).
 *
 * Root cause: scoreJobs() previously had no finish_reason check, no zod
 * validation, no retry, and purely trusted array position for job/score
 * alignment. Any failure — request error, truncated/prose/wrong-shape JSON,
 * or a misaligned entry — fell back to FALLBACK_SCORE, which fabricated
 * matchScore: 0. That value is indistinguishable from a real 0% match once
 * persisted (CONTEXT.md's "Unscored job" definition explicitly says a failed
 * match must never be represented as a zero-score job).
 *
 * This suite pins down the two-level contract of the fix:
 *   - Level 1 (envelope validity): finish_reason, empty content, JSON.parse,
 *     and the `{ scores: unknown[] }` shape. Any failure here gets exactly
 *     one whole-batch retry; if the retry also fails, every job in the batch
 *     is left unscored (matchScore: null), never a fabricated 0.
 *   - Level 2 (per-entry alignment by 1-based jobNumber, only reached once
 *     the envelope itself parsed): a malformed, missing, or duplicated
 *     jobNumber leaves only that one job unscored — it never triggers a
 *     whole-batch retry, and duplicates are never resolved by first-wins.
 *
 * Run: npm run test:run -- __tests__/agent/job-matcher.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/types/index";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mocks.create } } };
  }),
}));

import { scoreJobs, UNSCORED_MATCH_REASON, type ScoringInput } from "@/agent/job-matcher";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJobs(count: number): ScoringInput[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Role ${i + 1}`,
    company: `Corp ${i + 1}`,
    location: "Hong Kong",
    description: `Description for role ${i + 1}`,
  }));
}

const MOCK_PROFILE: Profile = {
  id: "user-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  location: "Hong Kong",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: 8,
  skills: ["TypeScript", "React", "Node.js"],
  industries: ["Fintech"],
  work_experience: [],
  education: null,
  job_titles_seeking: [],
  remote_preference: "remote",
  preferred_locations: [],
  salary_expectation: null,
  cover_letter_tone: "formal",
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  resume_pdf_url: null,
  resume_pdf_key: null,
  resume_pdf_filename: null,
  linkedin_connected: false,
  is_tailored: false,
  is_complete: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function validEntry(jobNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    jobNumber,
    matchScore: 80,
    matchReason: `Good fit for job ${jobNumber}.`,
    matchedSkills: ["TypeScript"],
    missingSkills: ["Kubernetes"],
    ...overrides,
  };
}

function mockCompletion(content: string, finishReason = "stop") {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content }, finish_reason: finishReason }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mocks.create needs a full reset (not just clear) between tests: clearAllMocks
  // only resets call history, but leaves queued mockResolvedValueOnce() values
  // in place — an unconsumed second queued response from one test (e.g. when
  // the current code throws on the first call and never reaches a second)
  // would otherwise leak into the next test's first call.
  mocks.create.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scoreJobs — envelope validity (Level 1)", () => {
  it("scores every job on a well-formed first response — no retry", async () => {
    const jobs = makeJobs(2);
    mockCompletion(JSON.stringify({ scores: [validEntry(1), validEntry(2)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result).toHaveLength(2);
    expect(result[0].matchScore).toBe(80);
    expect(result[1].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response is truncated (finish_reason: length)", async () => {
    const jobs = makeJobs(1);
    mockCompletion('{"scores":[{"jobNumber":1,"matchScore":8', "length");
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("retries once when the first response is prose instead of JSON", async () => {
    const jobs = makeJobs(1);
    mockCompletion("Here are the scores you requested.", "stop");
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("retries once when the envelope shape is wrong (scores missing/not an array)", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ results: "wrong field entirely" }), "stop");
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("retries once when the request itself throws, then succeeds", async () => {
    const jobs = makeJobs(1);
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("leaves the whole batch unscored (not fabricated 0) when both attempts fail the request", async () => {
    const jobs = makeJobs(3);
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    mocks.create.mockRejectedValueOnce(new Error("network error again"));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result).toHaveLength(3);
    for (const score of result) {
      expect(score.matchScore).toBeNull();
      expect(score.matchReason).toBe(UNSCORED_MATCH_REASON);
      expect(score.matchedSkills).toEqual([]);
      expect(score.missingSkills).toEqual([]);
    }
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("leaves the whole batch unscored when both attempts return invalid envelopes", async () => {
    const jobs = makeJobs(2);
    mockCompletion("not json at all", "stop");
    mockCompletion("still not json", "stop");

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result.every((s) => s.matchScore === null)).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("never calls the model for an empty jobs array", async () => {
    const result = await scoreJobs([], MOCK_PROFILE);
    expect(result).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("scoreJobs — per-entry alignment (Level 2)", () => {
  it("a single malformed entry only unscored its own job — no batch retry", async () => {
    const jobs = makeJobs(3);
    // job 2's entry has matchScore as a string — fails JobScoreEntrySchema,
    // but jobs 1 and 3 are still well-formed and must keep their real scores.
    mockCompletion(
      JSON.stringify({
        scores: [
          validEntry(1),
          { jobNumber: 2, matchScore: "not a number", matchReason: "x" },
          validEntry(3),
        ],
      }),
    );

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(result[1].matchScore).toBeNull();
    expect(result[1].matchReason).toBe(UNSCORED_MATCH_REASON);
    expect(result[2].matchScore).toBe(80);
    // The envelope itself was well-formed — one malformed sibling must not
    // trigger the whole-batch retry.
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("a missing jobNumber only unscored that job — fewer entries than jobs", async () => {
    const jobs = makeJobs(3);
    // Only 2 entries for 3 jobs — job 2 has no claimant.
    mockCompletion(JSON.stringify({ scores: [validEntry(1), validEntry(3)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(result[1].matchScore).toBeNull();
    expect(result[2].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("a jobNumber claimed by two entries is left unscored — no first-wins", async () => {
    const jobs = makeJobs(2);
    mockCompletion(
      JSON.stringify({
        scores: [
          validEntry(1, { matchScore: 90 }),
          validEntry(1, { matchScore: 10 }), // duplicate claim on job 1
          validEntry(2),
        ],
      }),
    );

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    // Neither the first (90) nor the second (10) claimant wins — job 1 is
    // ambiguous and must be unscored, not silently resolved either way.
    expect(result[0].matchScore).toBeNull();
    expect(result[0].matchReason).toBe(UNSCORED_MATCH_REASON);
    expect(result[1].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("an out-of-range jobNumber is ignored and does not affect any real job", async () => {
    const jobs = makeJobs(2);
    mockCompletion(
      JSON.stringify({
        scores: [validEntry(1), validEntry(2), validEntry(5)], // jobNumber 5 doesn't exist
      }),
    );

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(result[1].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("clamps matchScore to 0-100 and rounds it", async () => {
    const jobs = makeJobs(2);
    mockCompletion(
      JSON.stringify({
        scores: [
          validEntry(1, { matchScore: 142.6 }),
          validEntry(2, { matchScore: -30 }),
        ],
      }),
    );

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(100);
    expect(result[1].matchScore).toBe(0);
  });

  it("defaults matchReason/matchedSkills/missingSkills when the entry omits them", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ scores: [{ jobNumber: 1, matchScore: 55 }] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(55);
    expect(result[0].matchReason).toBe("");
    expect(result[0].matchedSkills).toEqual([]);
    expect(result[0].missingSkills).toEqual([]);
  });

  it("still scores jobs with a null profile", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    const result = await scoreJobs(jobs, null);

    expect(result[0].matchScore).toBe(80);
  });
});

describe("scoreJobs — request construction and retry mechanics", () => {
  it("sends the documented model, response_format, temperature, and max_tokens on the first attempt", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    await scoreJobs(jobs, MOCK_PROFILE);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const params = mocks.create.mock.calls[0][0];
    expect(params.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(params.response_format).toEqual({ type: "json_object" });
    expect(params.stream).toBe(false);
    expect(params.temperature).toBe(0.3);
    expect(params.max_tokens).toBe(2000);
  });

  it("raises max_tokens to 2600 and appends the retry suffix to the system prompt on retry", async () => {
    const jobs = makeJobs(1);
    mockCompletion("not json", "stop");
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    await scoreJobs(jobs, MOCK_PROFILE);

    expect(mocks.create).toHaveBeenCalledTimes(2);
    const retryParams = mocks.create.mock.calls[1][0];
    expect(retryParams.max_tokens).toBe(2600);
    const systemMessage = retryParams.messages.find(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMessage.content).toContain(
      "The previous response was invalid, incomplete, or truncated.",
    );
  });

  it("keeps the user prompt identical between the first attempt and the retry — only the system prompt changes", async () => {
    const jobs = makeJobs(1);
    mockCompletion("not json", "stop");
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }));

    await scoreJobs(jobs, MOCK_PROFILE);

    const firstUser = mocks.create.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "user",
    ).content;
    const retryUser = mocks.create.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === "user",
    ).content;
    expect(retryUser).toBe(firstUser);
  });
});

describe("scoreJobs — entry-alignment edge cases", () => {
  it("rounds matchScore using standard half-up rounding at the .5 boundary", async () => {
    const jobs = makeJobs(2);
    mockCompletion(
      JSON.stringify({
        scores: [
          validEntry(1, { matchScore: 79.5 }),
          validEntry(2, { matchScore: 79.4 }),
        ],
      }),
    );

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(result[1].matchScore).toBe(79);
  });

  it("treats a jobNumber of 0 as unmatched to any real job — job 1 is left unscored, not silently claimed", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ scores: [validEntry(0)] }));

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBeNull();
    expect(result[0].matchReason).toBe(UNSCORED_MATCH_REASON);
    // The envelope itself was well-formed JSON — no retry triggered by a
    // single unmatched sibling.
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does not treat an unrelated finish_reason (e.g. content_filter) as a truncation failure when content still parses", async () => {
    const jobs = makeJobs(1);
    mockCompletion(JSON.stringify({ scores: [validEntry(1)] }), "content_filter");

    const result = await scoreJobs(jobs, MOCK_PROFILE);

    expect(result[0].matchScore).toBe(80);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
