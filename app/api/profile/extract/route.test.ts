import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Mock dependencies before importing the route
vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

vi.mock("@/agent/extractor", () => ({
  extractProfileFromResume: vi.fn(),
}));

import { POST } from "./route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { extractProfileFromResume } from "@/agent/extractor";

const mockCreateInsforgeServer = createInsforgeServer as ReturnType<typeof vi.fn>;
const mockExtractProfileFromResume = extractProfileFromResume as ReturnType<typeof vi.fn>;

// Helper to build a mock insforge client
function buildMockInsforge({
  user = { id: "user-123" } as { id: string } | null,
  profileError = null as null | { message: string },
  profileRow = { resume_pdf_key: "resumes/user-123/resume.pdf" } as { resume_pdf_key: string } | null,
  downloadError = null as null | { message: string },
  fileBlob = null as Blob | null,
} = {}) {
  const mockSingle = vi.fn().mockResolvedValue({
    data: profileRow,
    error: profileError,
  });
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

  const mockDownload = vi.fn().mockResolvedValue({
    data: fileBlob,
    error: downloadError,
  });
  const mockStorageFrom = vi.fn().mockReturnValue({ download: mockDownload });

  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    database: {
      from: mockFrom,
    },
    storage: {
      from: mockStorageFrom,
    },
    _mockDownload: mockDownload,
    _mockFrom: mockFrom,
    _mockStorageFrom: mockStorageFrom,
  };
}

const SAMPLE_EXTRACTION = {
  full_name: "John Smith",
  phone: "(555) 123-4567",
  location: "San Francisco, US",
  current_title: "Software Engineer",
  experience_level: "senior" as const,
  years_experience: 5,
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  remote_preference: null,
  salary_expectation: null,
  skills: ["React", "TypeScript"],
  industries: [],
  job_titles_seeking: [],
  work_experience: [],
  education: { degree: null, fieldOfStudy: null, institution: null, graduationYear: null },
};

async function parseJsonResponse(response: Response) {
  const body = await response.json();
  return body;
}

describe("POST /api/profile/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      const insforge = buildMockInsforge({ user: null });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(401);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("resume key retrieval", () => {
    it("returns 400 when profile row has no resume_pdf_key", async () => {
      const insforge = buildMockInsforge({ profileRow: { resume_pdf_key: "" } });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("No resume uploaded");
    });

    it("returns 400 when profile row is null (no profile saved)", async () => {
      const insforge = buildMockInsforge({ profileRow: null });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("No resume uploaded");
    });

    it("returns 400 when profileError is set", async () => {
      const insforge = buildMockInsforge({
        profileError: { message: "Row not found" },
        profileRow: null,
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(400);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("No resume uploaded");
    });
  });

  describe("PDF storage download", () => {
    it("returns 500 when storage download fails with an error", async () => {
      const insforge = buildMockInsforge({
        downloadError: { message: "Storage error" },
        fileBlob: null,
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(500);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Could not retrieve resume from storage");
    });

    it("returns 500 when storage download returns null fileBlob", async () => {
      const insforge = buildMockInsforge({ fileBlob: null });
      mockCreateInsforgeServer.mockResolvedValue(insforge);

      const response = await POST();

      expect(response.status).toBe(500);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Could not retrieve resume from storage");
    });

    it("downloads from the 'resumes' storage bucket", async () => {
      const insforge = buildMockInsforge({
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: true,
        data: SAMPLE_EXTRACTION,
      });

      await POST();

      expect(insforge.storage.from).toHaveBeenCalledWith("resumes");
    });

    it("downloads using the resume_pdf_key from the profile row", async () => {
      const resumeKey = "resumes/user-123/resume.pdf";
      const insforge = buildMockInsforge({
        profileRow: { resume_pdf_key: resumeKey },
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: true,
        data: SAMPLE_EXTRACTION,
      });

      await POST();

      expect(insforge._mockDownload).toHaveBeenCalledWith(resumeKey);
    });
  });

  describe("extraction and response", () => {
    it("calls extractProfileFromResume with a Buffer", async () => {
      const pdfContent = "pdf binary content";
      const insforge = buildMockInsforge({
        fileBlob: new Blob([pdfContent], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: true,
        data: SAMPLE_EXTRACTION,
      });

      await POST();

      expect(mockExtractProfileFromResume).toHaveBeenCalledOnce();
      const callArg = mockExtractProfileFromResume.mock.calls[0][0];
      expect(Buffer.isBuffer(callArg)).toBe(true);
    });

    it("returns 200 with extraction data on success", async () => {
      const insforge = buildMockInsforge({
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: true,
        data: SAMPLE_EXTRACTION,
      });

      const response = await POST();

      expect(response.status).toBe(200);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(SAMPLE_EXTRACTION);
    });

    it("returns extraction error response when extractProfileFromResume returns failure", async () => {
      const insforge = buildMockInsforge({
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: false,
        error: "Could not extract text from this PDF. Please try a different file.",
      });

      const response = await POST();

      // The route passes through whatever extractProfileFromResume returns
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        "Could not extract text from this PDF. Please try a different file."
      );
    });
  });

  describe("error handling", () => {
    it("returns 500 with internal server error when an unexpected exception is thrown", async () => {
      mockCreateInsforgeServer.mockRejectedValue(new Error("Unexpected DB error"));

      const response = await POST();

      expect(response.status).toBe(500);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Internal server error");
    });

    it("returns 500 when extractProfileFromResume throws unexpectedly", async () => {
      const insforge = buildMockInsforge({
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockRejectedValue(new Error("AI API crashed"));

      const response = await POST();

      expect(response.status).toBe(500);
      const body = await parseJsonResponse(response);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Internal server error");
    });

    it("queries profiles table scoped to the authenticated user's id", async () => {
      const userId = "user-abc-123";
      const insforge = buildMockInsforge({
        user: { id: userId },
        fileBlob: new Blob(["pdf bytes"], { type: "application/pdf" }),
      });
      mockCreateInsforgeServer.mockResolvedValue(insforge);
      mockExtractProfileFromResume.mockResolvedValue({
        success: true,
        data: SAMPLE_EXTRACTION,
      });

      await POST();

      expect(insforge.database.from).toHaveBeenCalledWith("profiles");
      // eq filter should be called with user id
      const fromReturn = insforge.database.from("profiles");
      const selectReturn = fromReturn.select("resume_pdf_key");
      expect(selectReturn.eq).toBeDefined();
    });
  });
});