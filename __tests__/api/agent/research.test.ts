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
  });
});
