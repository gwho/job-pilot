import { NextResponse } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { extractProfileFromResume } from "@/agent/extractor";

export async function POST() {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData } = await insforge.auth.getCurrentUser();

    if (!authData.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Fetch resume key from profile
    const { data: profileRow, error: profileError } =
      await insforge.database
        .from("profiles")
        .select("resume_pdf_key")
        .eq("id", authData.user.id)
        .single();

    if (profileError || !profileRow?.resume_pdf_key) {
      return NextResponse.json(
        { success: false, error: "No resume uploaded" },
        { status: 400 },
      );
    }

    // Download PDF from private storage bucket
    const { data: fileBlob, error: downloadError } = await insforge.storage
      .from("resumes")
      .download(profileRow.resume_pdf_key);

    if (downloadError || !fileBlob) {
      return NextResponse.json(
        { success: false, error: "Could not retrieve resume from storage" },
        { status: 500 },
      );
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const result = await extractProfileFromResume(buffer);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/profile/extract]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
