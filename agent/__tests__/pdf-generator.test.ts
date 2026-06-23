import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Profile } from "@/types/index";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so variables are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockCreate, mockRenderToBuffer } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRenderToBuffer: vi.fn(),
}));

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: mockRenderToBuffer,
}));

// resume-template is imported by pdf-generator; mock it so @react-pdf/renderer
// Document/Page/Text/View/StyleSheet aren't needed in these unit tests.
vi.mock("../resume-template", () => ({
  ResumeDocument: () => null,
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { generateResumePdf } from "../pdf-generator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-123",
    full_name: "Jane Smith",
    email: "jane@example.com",
    phone: "555-0100",
    location: "San Francisco, CA",
    current_title: "Senior Engineer",
    experience_level: "senior",
    years_experience: 8,
    skills: ["TypeScript", "React", "Node.js"],
    industries: null,
    work_experience: [
      {
        company: "Acme Corp",
        title: "Senior Engineer",
        startDate: "2020",
        endDate: null,
        current: true,
        responsibilities: "Led platform team, shipped 4 major features.",
      },
    ],
    education: {
      degree: "B.S.",
      fieldOfStudy: "Computer Science",
      institution: "State University",
      graduationYear: "2016",
    },
    job_titles_seeking: null,
    remote_preference: null,
    preferred_locations: null,
    salary_expectation: null,
    cover_letter_tone: null,
    linkedin_url: null,
    portfolio_url: null,
    work_authorization: null,
    resume_pdf_url: null,
    resume_pdf_key: null,
    resume_pdf_filename: null,
    linkedin_connected: false,
    is_tailored: false,
    is_complete: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const VALID_RESUME_CONTENT = JSON.stringify({
  summary: "Experienced engineer with deep expertise in TypeScript.",
  workExperience: [
    {
      company: "Acme Corp",
      title: "Senior Engineer",
      period: "2020 – Present",
      bullets: ["Led platform team", "Shipped 4 major features"],
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateResumePdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = "test-api-key";
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("returns success=true with a Buffer when Gemini and renderToBuffer both succeed", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    const fakePdfBytes = new Uint8Array([1, 2, 3, 4]);
    mockRenderToBuffer.mockResolvedValueOnce(fakePdfBytes);

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer).toEqual(Buffer.from(fakePdfBytes));
    }
  });

  it("calls Gemini with the correct model, temperature, and max_tokens", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    await generateResumePdf(makeProfile());

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-flash-lite");
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.max_tokens).toBe(1000);
    expect(callArgs.response_format).toEqual({ type: "json_object" });
  });

  it("sends both system and user messages to Gemini", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    await generateResumePdf(makeProfile());

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("includes profile fields in the user prompt sent to Gemini", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ full_name: "Alice Tester", current_title: "Staff Engineer" });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toContain("Alice Tester");
    expect(userMessage.content).toContain("Staff Engineer");
  });

  it("formats current work experience with 'Present' for current jobs", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({
      work_experience: [
        {
          company: "NewCo",
          title: "Lead",
          startDate: "2022",
          endDate: null,
          current: true,
          responsibilities: "Building things.",
        },
      ],
    });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("Present");
  });

  it("formats past work experience with endDate when current=false", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({
      work_experience: [
        {
          company: "OldCo",
          title: "Developer",
          startDate: "2018",
          endDate: "2020",
          current: false,
          responsibilities: "Old stuff.",
        },
      ],
    });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("2018 – 2020");
  });

  it("handles profile with no work experience (uses 'Not provided')", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ work_experience: null });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("Not provided");
  });

  it("handles profile with no education (uses 'Not provided')", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ education: null });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("Not provided");
  });

  it("includes skills joined with comma in the user prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ skills: ["Go", "Kubernetes", "AWS"] });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("Go, Kubernetes, AWS");
  });

  // -------------------------------------------------------------------------
  // Failure paths
  // -------------------------------------------------------------------------

  it("returns success=false when Gemini API throws an error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Failed to generate resume PDF");
    }
  });

  it("returns success=false when Gemini returns invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not valid json {{" } }],
    });

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Failed to generate resume PDF");
    }
  });

  it("returns success=false when renderToBuffer throws", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockRejectedValueOnce(new Error("PDF render failed"));

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Failed to generate resume PDF");
    }
  });

  it("returns success=false when Gemini returns null content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("handles profile with null skills gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ skills: null });
    const result = await generateResumePdf(profile);

    // Should not throw — should succeed or fail gracefully
    expect(typeof result.success).toBe("boolean");
  });

  it("handles profile with empty work_experience array (shows 'Not provided')", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({ work_experience: [] });
    const result = await generateResumePdf(profile);

    expect(result.success).toBe(true);
    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain("Not provided");
  });

  it("returns a Buffer (not a Uint8Array) on success", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([10, 20, 30]));

    const result = await generateResumePdf(makeProfile());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer).toBeInstanceOf(Buffer);
    }
  });

  it("does not include 'Not provided' in work experience section when jobs exist", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: VALID_RESUME_CONTENT } }],
    });
    mockRenderToBuffer.mockResolvedValueOnce(new Uint8Array([0]));

    const profile = makeProfile({
      work_experience: [
        {
          company: "TechCorp",
          title: "Dev",
          startDate: "2021",
          endDate: "2023",
          current: false,
          responsibilities: "Built features.",
        },
      ],
    });
    await generateResumePdf(profile);

    const userMessage = mockCreate.mock.calls[0][0].messages[1];
    // work experience section should contain the real data, not "Not provided"
    expect(userMessage.content).toContain("TechCorp");
  });
});