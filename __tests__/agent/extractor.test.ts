/**
 * Regression tests for the extractor's unguarded JSON.parse (SyntaxError) bug.
 *
 * Root cause: agent/extractor.ts called JSON.parse on the model's raw content
 * with no try/catch, and cast the result with `as ProfileExtraction` with no
 * runtime shape check. A model returning prose instead of JSON (ignoring
 * response_format) threw an uncaught SyntaxError that surfaced to the user
 * as a generic 500 via app/api/profile/extract/route.ts.
 *
 * Run: npm run test:run -- __tests__/agent/extractor.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getText: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mocks.create } } };
  }),
}));

vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(function () {
    return { getText: mocks.getText };
  }),
}));

import {
  extractProfileFromResume,
  EXTRACTION_FAILED_MESSAGE,
  type ProfileExtraction,
} from "@/agent/extractor";

const RESUME_TEXT = "Jane Doe — Senior Software Engineer. ".repeat(6); // > 100 chars

const VALID_EXTRACTION: ProfileExtraction = {
  full_name: "Jane Doe",
  phone: null,
  location: "Hong Kong",
  current_title: "Senior Software Engineer",
  experience_level: "senior",
  years_experience: 8,
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  remote_preference: "remote",
  salary_expectation: null,
  skills: ["TypeScript", "React"],
  industries: ["Fintech"],
  job_titles_seeking: [],
  work_experience: [
    {
      company: "Acme Corp",
      title: "Senior Software Engineer",
      startDate: "2020-01",
      endDate: null,
      current: true,
      responsibilities: "Led the platform team.",
    },
  ],
  education: {
    degree: "BSc Computer Science",
    fieldOfStudy: "Computer Science",
    institution: "HKU",
    graduationYear: "2015",
  },
};

function mockCompletion(content: string, finishReason = "stop") {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content }, finish_reason: finishReason }],
  });
}

const buffer = Buffer.from("dummy-pdf-bytes");

beforeEach(() => {
  // vi.resetAllMocks() would also clear the mockImplementation set on the
  // PDFParse/OpenAI constructor mocks inside vi.mock() above (not just
  // mocks.create/mocks.getText), causing `new PDFParse()` to return a bare
  // object with no getText method. clearAllMocks only resets call history.
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  mocks.getText.mockResolvedValue({ text: RESUME_TEXT });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractProfileFromResume", () => {
  it("returns the short-text error unchanged and never calls the model", async () => {
    mocks.getText.mockResolvedValue({ text: "too short" });

    const result = await extractProfileFromResume(buffer);

    expect(result).toEqual({
      success: false,
      error: "Could not extract text from this PDF. Please try a different file.",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns a safe failure — not a throw — when the model returns prose instead of JSON", async () => {
    mockCompletion("The candidate has 8 years of experience as a software engineer.");

    await expect(extractProfileFromResume(buffer)).resolves.toEqual({
      success: false,
      error: EXTRACTION_FAILED_MESSAGE,
    });
  });

  it("returns the same safe failure when the JSON parses but has the wrong shape", async () => {
    mockCompletion(JSON.stringify({ skills: "TypeScript, React", years_experience: "eight" }));

    await expect(extractProfileFromResume(buffer)).resolves.toEqual({
      success: false,
      error: EXTRACTION_FAILED_MESSAGE,
    });
  });

  it("retries once with compact instructions when the first response is truncated", async () => {
    mockCompletion('{"skills": ["Go", "Rust"', "length");
    mockCompletion(JSON.stringify(VALID_EXTRACTION));

    const result = await extractProfileFromResume(buffer);

    expect(result).toEqual({ success: true, data: VALID_EXTRACTION });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ max_tokens: 2500 });
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ max_tokens: 3000 });
    expect(mocks.create.mock.calls[1][0].messages[0].content).toContain(
      "The previous response was too long and was truncated",
    );
  });

  it("returns a safe failure when both the first response and retry are truncated", async () => {
    mockCompletion('{"skills": ["Go", "Rust"', "length");
    mockCompletion('{"skills": ["Go", "Rust"', "length");

    const result = await extractProfileFromResume(buffer);

    expect(result).toEqual({
      success: false,
      error: EXTRACTION_FAILED_MESSAGE,
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("returns a safe failure when the model returns empty content", async () => {
    mockCompletion("");

    await expect(extractProfileFromResume(buffer)).resolves.toEqual({
      success: false,
      error: EXTRACTION_FAILED_MESSAGE,
    });
  });

  it("returns a safe failure when the underlying call throws (PDF parse or network crash)", async () => {
    mocks.getText.mockRejectedValue(new Error("corrupt PDF"));

    await expect(extractProfileFromResume(buffer)).resolves.toEqual({
      success: false,
      error: EXTRACTION_FAILED_MESSAGE,
    });
  });

  it("returns success:true with the parsed data when the model returns well-formed matching JSON", async () => {
    mockCompletion(JSON.stringify(VALID_EXTRACTION));

    const result = await extractProfileFromResume(buffer);

    expect(result).toEqual({ success: true, data: VALID_EXTRACTION });
  });
});
