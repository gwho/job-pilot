import { NextResponse } from "next/server";

import { createInsforgeServer } from "@/lib/insforge-server";
import { generateResumePdf } from "@/agent/pdf-generator";
import type { Profile } from "@/types/index";

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

    const userId = authData.user.id;

    const { data: profile, error: profileError } = await insforge.database
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: "Profile not found" },
        { status: 404 },
      );
    }

    if (!profile.is_complete) {
      return NextResponse.json(
        { success: false, error: "Complete your profile before generating a resume" },
        { status: 400 },
      );
    }

    const result = await generateResumePdf(profile as Profile);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 },
      );
    }

    // Remove existing file before re-uploading
    if (profile.resume_pdf_key) {
      await insforge.storage.from("resumes").remove(profile.resume_pdf_key);
    }

    const storagePath = `${userId}/resume.pdf`;
    const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/pdf" });
    const { data: uploadData, error: uploadError } = await insforge.storage
      .from("resumes")
      .upload(storagePath, blob);

    if (uploadError || !uploadData) {
      console.error("[api/resume/generate] upload error:", uploadError);
      return NextResponse.json(
        { success: false, error: "Failed to save generated resume" },
        { status: 500 },
      );
    }

    const { error: updateError } = await insforge.database
      .from("profiles")
      .upsert([
        {
          id: userId,
          resume_pdf_key: uploadData.key,
          resume_pdf_url: uploadData.url,
          resume_pdf_filename: "AI Generated Resume.pdf",
        },
      ]);

    if (updateError) {
      console.error("[api/resume/generate] db update error:", updateError);
      return NextResponse.json(
        { success: false, error: "Failed to save resume reference" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/resume/generate]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
