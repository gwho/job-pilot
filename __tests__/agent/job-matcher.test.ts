// Tests for agent/job-matcher.ts
// Covers: ScoringInput type contract, scoreJobs() behaviour including the
// fallback path, score clamping, and response-alignment guard.
// The OpenAI client is mocked so no network calls are made.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock openai before the module under test is imported ─────────────────────
const mockCreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { scoreJobs, type ScoringInput, type JobScore } from "@/agent/job-matcher";
import type { Profile } from "@/types/index";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    title: "Software Engineer",
    company: "Acme HK",
    location: "Hong Kong",
    description: "Build scalable APIs using Node.js and TypeScript.",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    user_id: "user-1",
    current_title: "Backend Developer",
    experience_level: "mid",
    years_experience: 3,
    skills: ["TypeScript", "Node.js", "PostgreSQL"],
    industries: ["fintech"],
    work_experience: [{ title: "Developer", company: "StartupX" }],
    ...overrides,
  } as Profile;
}

/** Build the JSON string that the mock Nemotron response returns. */
function modelResponse(scores: Partial<JobScore>[]): string {
  const full = scores.map((s) => ({
    matchScore: s.matchScore ?? 50,
    matchReason: s.matchReason ?? "Good fit.",
    matchedSkills: s.matchedSkills ?? [],
    missingSkills: s.missingSkills ?? [],
  }));
  return JSON.stringify({ scores: full });
}

function mockSuccess(scores: Partial<JobScore>[]): void {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: modelResponse(scores) } }],
  });
}

// ─── scoreJobs ────────────────────────────────────────────────────────────────

describe("scoreJobs", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // Empty-input fast-path
  it("returns an empty array when no jobs are provided (no API call)", async () => {
    const result = await scoreJobs([], makeProfile());
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns an empty array for empty jobs with null profile (no API call)", async () => {
    const result = await scoreJobs([], null);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Happy-path: model returns well-formed JSON
  it("returns one JobScore per input job in the same order", async () => {
    const jobs = [makeJob({ title: "Backend Dev" }), makeJob({ title: "Frontend Dev" })];
    mockSuccess([
      { matchScore: 80, matchReason: "Strong backend match.", matchedSkills: ["Node.js"], missingSkills: [] },
      { matchScore: 40, matchReason: "Partial match.", matchedSkills: [], missingSkills: ["React"] },
    ]);

    const scores = await scoreJobs(jobs, makeProfile());
    expect(scores).toHaveLength(2);
    expect(scores[0].matchScore).toBe(80);
    expect(scores[1].matchScore).toBe(40);
  });

  it("populates matchReason, matchedSkills, and missingSkills from model output", async () => {
    mockSuccess([
      {
        matchScore: 72,
        matchReason: "Candidate skills align well.",
        matchedSkills: ["TypeScript", "Node.js"],
        missingSkills: ["Kubernetes"],
      },
    ]);

    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchReason).toBe("Candidate skills align well.");
    expect(score.matchedSkills).toEqual(["TypeScript", "Node.js"]);
    expect(score.missingSkills).toEqual(["Kubernetes"]);
  });

  it("works with a null profile (sparse scoring mode)", async () => {
    mockSuccess([{ matchScore: 30, matchReason: "Score from title only.", matchedSkills: [], missingSkills: [] }]);
    const [score] = await scoreJobs([makeJob()], null);
    expect(score.matchScore).toBe(30);
    expect(score.matchReason).toBe("Score from title only.");
  });

  // Score clamping
  it("clamps matchScore above 100 to 100", async () => {
    mockSuccess([{ matchScore: 150 }]);
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchScore).toBe(100);
  });

  it("clamps matchScore below 0 to 0", async () => {
    mockSuccess([{ matchScore: -10 }]);
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchScore).toBe(0);
  });

  it("rounds fractional matchScore to nearest integer", async () => {
    mockSuccess([{ matchScore: 72.7 }]);
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchScore).toBe(73);
  });

  it("round-trips a matchScore of exactly 0 without clamping", async () => {
    mockSuccess([{ matchScore: 0 }]);
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchScore).toBe(0);
  });

  it("round-trips a matchScore of exactly 100 without clamping", async () => {
    mockSuccess([{ matchScore: 100 }]);
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchScore).toBe(100);
  });

  // Fallback — API error
  it("returns neutral fallback scores for all jobs when the API call throws", async () => {
    mockCreate.mockRejectedValue(new Error("Network error"));
    const jobs = [makeJob(), makeJob()];
    const scores = await scoreJobs(jobs, makeProfile());
    expect(scores).toHaveLength(2);
    scores.forEach((s) => {
      expect(s.matchScore).toBe(0);
      expect(s.matchReason).toBe("Not scored — matching unavailable for this job.");
      expect(s.matchedSkills).toEqual([]);
      expect(s.missingSkills).toEqual([]);
    });
  });

  // Fallback — malformed JSON
  it("returns neutral fallback scores when the model returns invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json at all {{{" } }],
    });
    const scores = await scoreJobs([makeJob()], makeProfile());
    expect(scores).toHaveLength(1);
    expect(scores[0].matchScore).toBe(0);
    expect(scores[0].matchReason).toBe("Not scored — matching unavailable for this job.");
  });

  // Fallback — missing scores key
  it("returns neutral fallback when JSON has no 'scores' key", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ result: [] }) } }],
    });
    const scores = await scoreJobs([makeJob()], makeProfile());
    expect(scores[0].matchScore).toBe(0);
  });

  // Alignment guard — fewer scores than jobs
  it("falls back on entries the model omits when it returns fewer scores than jobs", async () => {
    const jobs = [makeJob({ title: "Job A" }), makeJob({ title: "Job B" }), makeJob({ title: "Job C" })];
    // Model only returns 1 score for 3 jobs
    mockSuccess([{ matchScore: 85 }]);
    const scores = await scoreJobs(jobs, makeProfile());
    expect(scores).toHaveLength(3);
    expect(scores[0].matchScore).toBe(85);
    expect(scores[1].matchScore).toBe(0); // fallback
    expect(scores[2].matchScore).toBe(0); // fallback
  });

  // Alignment guard — mismatched score shapes
  it("falls back on entries where matchScore is not a number", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [{ matchScore: "high", matchReason: "bad", matchedSkills: [], missingSkills: [] }],
            }),
          },
        },
      ],
    });
    const scores = await scoreJobs([makeJob()], makeProfile());
    expect(scores[0].matchScore).toBe(0);
    expect(scores[0].matchReason).toBe("Not scored — matching unavailable for this job.");
  });

  // Defensive: non-array matchedSkills / missingSkills
  it("coerces non-array matchedSkills to an empty array", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [{ matchScore: 55, matchReason: "ok", matchedSkills: "TypeScript", missingSkills: null }],
            }),
          },
        },
      ],
    });
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(Array.isArray(score.matchedSkills)).toBe(true);
    expect(score.matchedSkills).toEqual([]);
  });

  it("coerces non-array missingSkills to an empty array", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [{ matchScore: 55, matchReason: "ok", matchedSkills: [], missingSkills: "React" }],
            }),
          },
        },
      ],
    });
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(Array.isArray(score.missingSkills)).toBe(true);
    expect(score.missingSkills).toEqual([]);
  });

  // Regression: matchReason falls back to empty string when key missing
  it("sets matchReason to empty string when the model omits the key", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [{ matchScore: 60, matchedSkills: [], missingSkills: [] }],
            }),
          },
        },
      ],
    });
    const [score] = await scoreJobs([makeJob()], makeProfile());
    expect(score.matchReason).toBe("");
  });

  // Verify the model is called exactly once per scoreJobs invocation
  it("makes exactly one API call regardless of how many jobs are provided", async () => {
    mockSuccess([{ matchScore: 70 }, { matchScore: 65 }, { matchScore: 55 }]);
    await scoreJobs([makeJob(), makeJob(), makeJob()], makeProfile());
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});