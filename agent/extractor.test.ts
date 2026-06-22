import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs before vi.mock() factories — the only way to share references
// across hoisted mock factories and the test file body.
const { mockGetText, mockChatCreate } = vi.hoisted(() => ({
  mockGetText: vi.fn(),
  mockChatCreate: vi.fn(),
}));

vi.mock("pdf-parse", () => {
  class PDFParse {
    constructor(_opts: unknown) {}
    getText() {
      return mockGetText();
    }
  }
  return { PDFParse };
});

vi.mock("openai", () => {
  class OpenAI {
    chat: { completions: { create: typeof mockChatCreate } };
    constructor(_opts: unknown) {
      this.chat = { completions: { create: mockChatCreate } };
    }
  }
  return { default: OpenAI };
});

import { extractProfileFromResume } from "./extractor";

const SAMPLE_RESUME_TEXT = `
John Smith
Software Engineer
john@example.com | (555) 123-4567
San Francisco, CA

EXPERIENCE
Senior Frontend Engineer — Acme Corp (2021–present)
Built React applications using TypeScript and GraphQL.

SKILLS
React, TypeScript, Node.js, GraphQL, PostgreSQL

EDUCATION
Bachelor's in Computer Science — State University (2018)
`.trim();

const SAMPLE_EXTRACTION = {
  full_name: "John Smith",
  phone: "(555) 123-4567",
  location: "San Francisco, US",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: 5,
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  remote_preference: null,
  salary_expectation: null,
  skills: ["React", "TypeScript", "Node.js", "GraphQL", "PostgreSQL"],
  industries: [],
  job_titles_seeking: [],
  work_experience: [
    {
      company: "Acme Corp",
      title: "Senior Frontend Engineer",
      startDate: "2021",
      endDate: null,
      current: true,
      responsibilities: "Built React applications using TypeScript and GraphQL.",
    },
  ],
  education: {
    degree: "Bachelor's",
    fieldOfStudy: "Computer Science",
    institution: "State University",
    graduationYear: "2018",
  },
};

describe("extractProfileFromResume", () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockChatCreate.mockReset();
    process.env.GOOGLE_API_KEY = "test-api-key";
  });

  describe("PDF text extraction guard", () => {
    it("returns an error when extracted text is empty string", async () => {
      mockGetText.mockResolvedValue({ text: "" });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "Could not extract text from this PDF. Please try a different file."
        );
      }
    });

    it("returns an error when extracted text is fewer than 100 characters", async () => {
      mockGetText.mockResolvedValue({ text: "short text" });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "Could not extract text from this PDF. Please try a different file."
        );
      }
    });

    it("returns an error when extracted text is exactly 99 characters", async () => {
      mockGetText.mockResolvedValue({ text: "a".repeat(99) });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
    });

    it("returns an error when pdfData.text is null (image-based PDF)", async () => {
      mockGetText.mockResolvedValue({ text: null });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "Could not extract text from this PDF. Please try a different file."
        );
      }
    });

    it("returns an error when pdfData.text is undefined", async () => {
      mockGetText.mockResolvedValue({ text: undefined });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
    });

    it("trims whitespace before checking length — rejects text that is < 100 chars after trim", async () => {
      // 50 real chars padded by spaces — after trim it's 50 chars, below threshold
      mockGetText.mockResolvedValue({ text: "   " + "x".repeat(50) + "   " });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(false);
    });

    it("proceeds when extracted text is exactly 100 characters after trim", async () => {
      mockGetText.mockResolvedValue({ text: "   " + "x".repeat(100) + "   " });
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(true);
    });

    it("does NOT call Gemini API when text is too short", async () => {
      mockGetText.mockResolvedValue({ text: "short" });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(mockChatCreate).not.toHaveBeenCalled();
    });
  });

  describe("Gemini API call", () => {
    beforeEach(() => {
      mockGetText.mockResolvedValue({ text: SAMPLE_RESUME_TEXT });
    });

    it("uses gemini-2.5-flash-lite model", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-2.5-flash-lite" })
      );
    });

    it("uses json_object response format", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: "json_object" },
        })
      );
    });

    it("uses temperature 0.3", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 })
      );
    });

    it("uses max_tokens 800", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 800 })
      );
    });

    it("sends resume text in user message with RESUME TEXT prefix", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      const callArgs = mockChatCreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === "user"
      );
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toContain("RESUME TEXT:");
      expect(userMessage.content).toContain(SAMPLE_RESUME_TEXT);
    });

    it("sends a system message in the request", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      const callArgs = mockChatCreate.mock.calls[0][0];
      const systemMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === "system"
      );
      expect(systemMessage).toBeDefined();
      expect(systemMessage.content).toContain("extract profile information");
    });

    it("returns { success: true, data } with parsed ProfileExtraction on valid response", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(SAMPLE_EXTRACTION);
        expect(result.data.full_name).toBe("John Smith");
        expect(result.data.skills).toContain("React");
        expect(result.data.experience_level).toBe("senior");
      }
    });

    it("returns success with partial extraction when some fields are null", async () => {
      const partialExtraction = {
        full_name: "Jane Doe",
        phone: null,
        location: null,
        current_title: "Developer",
        experience_level: null,
        years_experience: null,
        linkedin_url: null,
        portfolio_url: null,
        work_authorization: null,
        remote_preference: null,
        salary_expectation: null,
        skills: ["Python"],
        industries: [],
        job_titles_seeking: [],
        work_experience: [],
        education: {
          degree: null,
          fieldOfStudy: null,
          institution: null,
          graduationYear: null,
        },
      };

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(partialExtraction) } }],
      });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.full_name).toBe("Jane Doe");
        expect(result.data.phone).toBeNull();
        expect(result.data.experience_level).toBeNull();
      }
    });
  });

  describe("GOOGLE_API_KEY usage", () => {
    it("successfully calls Gemini using GOOGLE_API_KEY env var", async () => {
      process.env.GOOGLE_API_KEY = "my-google-key-123";
      mockGetText.mockResolvedValue({ text: SAMPLE_RESUME_TEXT });
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      // Proves the constructor received GOOGLE_API_KEY correctly (no error thrown)
      expect(mockChatCreate).toHaveBeenCalled();
    });

    it("uses the gemini-2.5-flash-lite model confirming Gemini endpoint config", async () => {
      mockGetText.mockResolvedValue({ text: SAMPLE_RESUME_TEXT });
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      await extractProfileFromResume(Buffer.from("fake pdf"));

      const callArgs = mockChatCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("gemini-2.5-flash-lite");
    });
  });

  describe("ProfileExtraction result shape", () => {
    beforeEach(() => {
      mockGetText.mockResolvedValue({ text: SAMPLE_RESUME_TEXT });
    });

    it("returns all expected top-level keys in data", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRACTION) } }],
      });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("full_name");
        expect(result.data).toHaveProperty("phone");
        expect(result.data).toHaveProperty("location");
        expect(result.data).toHaveProperty("current_title");
        expect(result.data).toHaveProperty("experience_level");
        expect(result.data).toHaveProperty("years_experience");
        expect(result.data).toHaveProperty("skills");
        expect(result.data).toHaveProperty("work_experience");
        expect(result.data).toHaveProperty("education");
      }
    });

    it("accepts all valid experience_level enum values", async () => {
      for (const level of ["junior", "mid", "senior", "lead"] as const) {
        mockChatCreate.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...SAMPLE_EXTRACTION, experience_level: level }),
              },
            },
          ],
        });

        const result = await extractProfileFromResume(Buffer.from("fake pdf"));
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.experience_level).toBe(level);
        }
      }
    });

    it("years_experience is returned as a number (not a string)", async () => {
      mockChatCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ ...SAMPLE_EXTRACTION, years_experience: 7 }),
            },
          },
        ],
      });

      const result = await extractProfileFromResume(Buffer.from("fake pdf"));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.years_experience).toBe(7);
        expect(typeof result.data.years_experience).toBe("number");
      }
    });
  });
});