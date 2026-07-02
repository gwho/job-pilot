import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { CompanyResearchDossier } from "@/types/index";

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

vi.mock("@/agent/research", () => ({
  researchCompany: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));

import { POST } from "@/app/api/agent/research/route";
import { createInsforgeServer } from "@/lib/insforge-server";
import { researchCompany } from "@/agent/research";
import { captureServerEvent } from "@/lib/posthog-server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_DOSSIER: CompanyResearchDossier = {
  companyOverview: "A global payments company.",
  techStack: ["Ruby", "Go"],
  culture: ["Fast-paced"],
  whyThisRole: "Expanding Asia-Pacific team.",
  yourEdge: ["TypeScript experience"],
  gapsToAddress: [],
  smartQuestions: ["What does success look like in 90 days?"],
  interviewPrep: ["Study Stripe's API design philosophy"],
  sources: ["https://stripe.com"],
  researchedAt: "2026-07-02T10:00:00.000Z",
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request("http://localhost/api/agent/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeInvalidJsonRequest(): NextRequest {
  return new Request("http://localhost/api/agent/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not valid json",
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(createInsforgeServer).mockResolvedValue({
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
  } as never);

  vi.mocked(researchCompany).mockResolvedValue({
    dossier: MOCK_DOSSIER,
    company: "Stripe",
  });

  vi.mocked(captureServerEvent).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/agent/research", () => {
  describe("analytics isolation — PostHog failure must not affect the response", () => {
    it("returns success:true with dossier even when captureServerEvent throws", async () => {
      vi.mocked(captureServerEvent).mockRejectedValue(new Error("PostHog unavailable"));

      const res = await POST(makeRequest({ jobId: "job-1" }));
      const body = await res.json() as {
        success: boolean;
        data?: { companyResearch: CompanyResearchDossier };
        error?: string;
      };

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data?.companyResearch).toEqual(MOCK_DOSSIER);
    });
  });

  describe("PostHog event properties — company derived server-side, not from client", () => {
    it("passes company from researchCompany return value to the event", async () => {
      await POST(makeRequest({ jobId: "job-1" }));

      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "company_researched",
          properties: expect.objectContaining({
            company: "Stripe",
          }),
        }),
      );
    });

    it("uses empty string when researchCompany returns null company", async () => {
      vi.mocked(researchCompany).mockResolvedValue({
        dossier: MOCK_DOSSIER,
        company: null,
      });

      await POST(makeRequest({ jobId: "job-1" }));

      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            company: "",
          }),
        }),
      );
    });

    it("includes distinctId, userId, and jobId alongside company in the event", async () => {
      await POST(makeRequest({ jobId: "job-42" }));

      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: "user-1",
        event: "company_researched",
        properties: { userId: "user-1", jobId: "job-42", company: "Stripe" },
      });
    });
  });

  describe("authentication", () => {
    it("returns 401 when getCurrentUser errors", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue({
        auth: {
          getCurrentUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: "invalid session" },
          }),
        },
      } as never);

      const res = await POST(makeRequest({ jobId: "job-1" }));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(401);
      expect(body).toEqual({ success: false, error: "Unauthorized" });
      expect(researchCompany).not.toHaveBeenCalled();
    });

    it("returns 401 when there is no authenticated user", async () => {
      vi.mocked(createInsforgeServer).mockResolvedValue({
        auth: {
          getCurrentUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      } as never);

      const res = await POST(makeRequest({ jobId: "job-1" }));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(401);
      expect(body.success).toBe(false);
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("request validation", () => {
    it("returns 400 when jobId is missing", async () => {
      const res = await POST(makeRequest({}));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body).toEqual({ success: false, error: "jobId is required" });
      expect(researchCompany).not.toHaveBeenCalled();
    });

    it("returns 400 when jobId is not a string", async () => {
      const res = await POST(makeRequest({ jobId: 123 }));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("jobId is required");
      expect(researchCompany).not.toHaveBeenCalled();
    });

    it("returns 400 when jobId is an empty string", async () => {
      const res = await POST(makeRequest({ jobId: "" }));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  describe("success path", () => {
    it("calls researchCompany with the jobId from the body and the authenticated user's id", async () => {
      await POST(makeRequest({ jobId: "job-99" }));

      expect(researchCompany).toHaveBeenCalledWith("job-99", "user-1");
    });

    it("returns the dossier wrapped in a success envelope", async () => {
      const res = await POST(makeRequest({ jobId: "job-1" }));
      const body = await res.json() as {
        success: boolean;
        data?: { companyResearch: CompanyResearchDossier };
      };

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, data: { companyResearch: MOCK_DOSSIER } });
    });
  });

  describe("error handling — internal errors are never leaked to the client", () => {
    it("returns a generic 500 message when researchCompany throws", async () => {
      vi.mocked(researchCompany).mockRejectedValue(
        new Error("Postgres connection string leaked-secret-value"),
      );
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeRequest({ jobId: "job-1" }));
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: "Failed to research company" });
      expect(JSON.stringify(body)).not.toContain("leaked-secret-value");

      consoleErrorSpy.mockRestore();
    });

    it("logs the real error server-side when researchCompany throws", async () => {
      const realError = new Error("Job not found: job-1");
      vi.mocked(researchCompany).mockRejectedValue(realError);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeRequest({ jobId: "job-1" }));

      expect(consoleErrorSpy).toHaveBeenCalledWith("[api/agent/research]", realError);
      consoleErrorSpy.mockRestore();
    });

    it("returns a generic 500 when the request body is not valid JSON", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(makeInvalidJsonRequest());
      const body = await res.json() as { success: boolean; error?: string };

      expect(res.status).toBe(500);
      expect(body).toEqual({ success: false, error: "Failed to research company" });

      consoleErrorSpy.mockRestore();
    });

    it("does not call captureServerEvent when researchCompany fails", async () => {
      vi.mocked(researchCompany).mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(makeRequest({ jobId: "job-1" }));

      expect(captureServerEvent).not.toHaveBeenCalled();
    });
  });
});
