import { NextRequest, NextResponse } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { researchCompany } from "@/agent/research";
import { captureServerEvent } from "@/lib/posthog-server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } = await insforge.auth.getCurrentUser();
    if (authError || !authData.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { jobId?: unknown };
    if (!body.jobId || typeof body.jobId !== "string") {
      return NextResponse.json({ success: false, error: "jobId is required" }, { status: 400 });
    }

    const { jobId } = body;
    const userId = authData.user.id;

    const { dossier, company } = await researchCompany(jobId, userId);

    try {
      await captureServerEvent({
        distinctId: userId,
        event: "company_researched",
        properties: { userId, jobId, company: company ?? "" },
      });
    } catch {
      console.error("[api/agent/research] PostHog capture failed — analytics only, research succeeded");
    }

    return NextResponse.json({ success: true, data: { companyResearch: dossier } });
  } catch (error) {
    console.error("[api/agent/research]", error);
    return NextResponse.json(
      { success: false, error: "Failed to research company" },
      { status: 500 },
    );
  }
}
