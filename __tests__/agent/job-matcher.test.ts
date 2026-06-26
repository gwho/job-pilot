import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdzunaJob } from "@/lib/adzuna";
import type { Profile } from "@/types/index";

// vi.hoisted() ensures these are available when vi.mock() factory runs (factories are hoisted).
const { mockCreate, MockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    static lastArgs: unknown;
    constructor(args: unknown) {
      MockOpenAI.lastArgs = args;
    }
  }
  return { mockCreate, MockOpenAI };
});

vi.mock("openai", () => ({
  default: MockOpenAI,
}));

// Import after mocking so the mock is in place.
import { scoreJobs, type JobScore } from "@/agent/job-matcher";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAdzunaJob(overrides: Partial<AdzunaJob> = {}): AdzunaJob {
  return {
    id: "adzuna-1",
    title: "Frontend Engineer",
    description: "Build React applications.",
    redirect_url: "https://example.com/job/1",
    company: { display_name: "Acme Corp" },
    location: { display_name: "New York, NY" },
    salary_min: null,
    salary_max: null,
    contract_type: null,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone: "555-1234",
    location: "New York",
    current_title: "Software Engineer",
    experience_level: "senior",
    years_experience: 7,
    skills: ["TypeScript", "React", "Node.js"],
    industries: ["tech"],
    work_experience: [
      {
        company: "TechCo",
        title: "Senior Engineer",
        startDate: "2020-01",
        endDate: null,
        current: true,
        responsibilities: "Led frontend development.",
      },
    ],
    education: {
      degree: "B.S.",
      fieldOfStudy: "Computer Science",
      institution: "State University",
      graduationYear: "2016",
    },
    job_titles_seeking: ["Frontend Engineer"],
    remote_preference: "remote",
    preferred_locations: ["New York"],
    salary_expectation: "$150k",
    cover_letter_tone: "formal",
    linkedin_url: null,
    portfolio_url: null,
    work_authorization: "citizen",
    resume_pdf_url: null,
    resume_pdf_key: null,
    resume_pdf_filename: null,
    linkedin_connected: false,
    is_tailored: false,
    is_complete: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeApiResponse(scores: Partial<JobScore>[]) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ scores }),
        },
      },
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("scoreJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  it("returns an empty array when given zero jobs", async () => {
    const result = await scoreJobs([], makeProfile());
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns one score per job, index-aligned", async () => {
    const jobs = [makeAdzunaJob({ id: "j1" }), makeAdzunaJob({ id: "j2" })];
    const apiScores: JobScore[] = [
      {
        matchScore: 85,
        matchReason: "Strong React skills.",
        matchedSkills: ["React"],
        missingSkills: ["GraphQL"],
      },
      {
        matchScore: 60,
        matchReason: "Some overlap.",
        matchedSkills: ["TypeScript"],
        missingSkills: ["Java"],
      },
    ];
    mockCreate.mockResolvedValueOnce(makeApiResponse(apiScores));

    const result = await scoreJobs(jobs, makeProfile());

    expect(result).toHaveLength(2);
    expect(result[0].matchScore).toBe(85);
    expect(result[1].matchScore).toBe(60);
  });

  it("clamps scores above 100 to 100", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 150,
          matchReason: "Perfect.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(100);
  });

  it("clamps scores below 0 to 0", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: -10,
          matchReason: "No match.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(0);
  });

  it("rounds fractional scores to the nearest integer", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 72.6,
          matchReason: "Good fit.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(73);
  });

  it("returns FALLBACK_SCORE when model returns fewer scores than jobs", async () => {
    const jobs = [makeAdzunaJob({ id: "j1" }), makeAdzunaJob({ id: "j2" })];
    // API returns only 1 score for 2 jobs.
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 80,
          matchReason: "Good match.",
          matchedSkills: ["React"],
          missingSkills: [],
        },
      ]),
    );

    const result = await scoreJobs(jobs, makeProfile());
    expect(result).toHaveLength(2);
    expect(result[0].matchScore).toBe(80);
    // Second entry falls back.
    expect(result[1].matchScore).toBe(0);
    expect(result[1].matchReason).toBe(
      "Not scored — matching unavailable for this job.",
    );
    expect(result[1].matchedSkills).toEqual([]);
    expect(result[1].missingSkills).toEqual([]);
  });

  it("returns FALLBACK_SCORE when model returns a score without matchScore as number", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            // matchScore is a string, not a number — malformed response.
            content: JSON.stringify({
              scores: [
                {
                  matchScore: "high",
                  matchReason: "Great.",
                  matchedSkills: [],
                  missingSkills: [],
                },
              ],
            }),
          },
        },
      ],
    });

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(0);
    expect(score.matchReason).toBe(
      "Not scored — matching unavailable for this job.",
    );
  });

  it("returns FALLBACK_SCORE for every job when the API throws", async () => {
    const jobs = [makeAdzunaJob({ id: "j1" }), makeAdzunaJob({ id: "j2" })];
    mockCreate.mockRejectedValueOnce(new Error("Network error"));

    const result = await scoreJobs(jobs, makeProfile());
    expect(result).toHaveLength(2);
    result.forEach((score) => {
      expect(score.matchScore).toBe(0);
      expect(score.matchReason).toBe(
        "Not scored — matching unavailable for this job.",
      );
    });
  });

  it("returns FALLBACK_SCORE for every job when JSON parsing fails", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json {{" } }],
    });

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(0);
  });

  it("handles a null profile without throwing", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 50,
          matchReason: "Limited data.",
          matchedSkills: [],
          missingSkills: ["React"],
        },
      ]),
    );

    const result = await scoreJobs(jobs, null);
    expect(result).toHaveLength(1);
    expect(result[0].matchScore).toBe(50);
  });

  it("handles model returning scores array as undefined (missing key)", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ result: [] }) } }],
    });

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchScore).toBe(0);
  });

  it("normalises non-array matchedSkills and missingSkills to empty arrays", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [
                {
                  matchScore: 80,
                  matchReason: "OK.",
                  matchedSkills: "React, TypeScript", // string instead of array
                  missingSkills: null, // null instead of array
                },
              ],
            }),
          },
        },
      ],
    });

    const [score] = await scoreJobs(jobs, makeProfile());
    expect(score.matchedSkills).toEqual([]);
    expect(score.missingSkills).toEqual([]);
  });

  it("uses 'nvidia/nemotron-3-ultra-550b-a55b:free' as the model", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 75,
          matchReason: "Good match.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    await scoreJobs(jobs, makeProfile());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      }),
    );
  });

  it("uses OpenRouter base URL in the client constructor", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 75,
          matchReason: "Good match.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    await scoreJobs(jobs, makeProfile());

    expect(MockOpenAI.lastArgs).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
    });
  });

  it("sends the system prompt and user prompt as messages", async () => {
    const jobs = [makeAdzunaJob({ title: "React Dev" })];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 70,
          matchReason: "Match.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    await scoreJobs(jobs, makeProfile());

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe("system");
    expect(callArgs.messages[1].role).toBe("user");
    expect(callArgs.messages[1].content).toContain("React Dev");
  });

  it("passes correct temperature, max_tokens and response_format", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        {
          matchScore: 70,
          matchReason: "Match.",
          matchedSkills: [],
          missingSkills: [],
        },
      ]),
    );

    await scoreJobs(jobs, makeProfile());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    );
  });

  it("includes profile skills in the user prompt when profile is provided", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        { matchScore: 80, matchReason: ".", matchedSkills: [], missingSkills: [] },
      ]),
    );

    const profile = makeProfile({ skills: ["GraphQL", "Rust"] });
    await scoreJobs(jobs, profile);

    const userPrompt = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userPrompt).toContain("GraphQL");
    expect(userPrompt).toContain("Rust");
  });

  it("includes fallback message in user prompt when profile is null", async () => {
    const jobs = [makeAdzunaJob()];
    mockCreate.mockResolvedValueOnce(
      makeApiResponse([
        { matchScore: 30, matchReason: ".", matchedSkills: [], missingSkills: [] },
      ]),
    );

    await scoreJobs(jobs, null);

    const userPrompt = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userPrompt).toContain("No profile on file");
  });
});