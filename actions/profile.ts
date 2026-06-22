"use server";

import { revalidatePath } from "next/cache";
import { createInsforgeServer } from "@/lib/insforge-server";
import { calculateCompletion } from "@/lib/profile-utils";
import { captureServerEvent } from "@/lib/posthog-server";
import type {
  ExperienceLevel,
  RemotePreference,
  CoverLetterTone,
  WorkAuthorization,
  WorkExperienceEntry,
  Education,
} from "@/types/index";

// ---------------------------------------------------------------------------
// saveProfile
// ---------------------------------------------------------------------------

export type ProfileSavePayload = {
  full_name: string;
  phone: string;
  location: string;
  current_title: string;
  experience_level: ExperienceLevel | "";
  years_experience: string;
  linkedin_url: string;
  portfolio_url: string;
  work_authorization: WorkAuthorization | "";
  remote_preference: RemotePreference | "";
  salary_expectation: string;
  cover_letter_tone: CoverLetterTone | "";
  skills: string[];
  industries: string[];
  job_titles_seeking: string[];
  preferred_locations: string[];
  work_experience: WorkExperienceEntry[];
  education: Education;
  linkedin_connected: boolean;
  is_tailored: boolean;
};

export async function saveProfile(
  payload: ProfileSavePayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } =
      await insforge.auth.getCurrentUser();

    if (authError || !authData.user) {
      return { success: false, error: "Not authenticated" };
    }

    const userId = authData.user.id;
    const email = authData.user.email;

    // Read current is_complete before upserting (PostHog gate)
    const { data: existing } = await insforge.database
      .from("profiles")
      .select("is_complete")
      .eq("id", userId)
      .maybeSingle();

    const wasComplete = existing?.is_complete ?? false;

    // Calculate new completion from the incoming payload + email
    const { missingFields } = calculateCompletion({
      full_name: payload.full_name,
      email,
      phone: payload.phone,
      location: payload.location,
      current_title: payload.current_title,
      experience_level: payload.experience_level || null,
      years_experience: payload.years_experience,
      skills: payload.skills,
      work_experience: payload.work_experience,
      education: payload.education,
    });

    const is_complete = missingFields.length === 0;

    const { error: upsertError } = await insforge.database
      .from("profiles")
      .upsert([
        {
          id: userId,
          email,
          full_name: payload.full_name || null,
          phone: payload.phone || null,
          location: payload.location || null,
          current_title: payload.current_title || null,
          experience_level: payload.experience_level || null,
          years_experience: payload.years_experience
            ? Number(payload.years_experience)
            : null,
          linkedin_url: payload.linkedin_url || null,
          portfolio_url: payload.portfolio_url || null,
          work_authorization: payload.work_authorization || null,
          remote_preference: payload.remote_preference || null,
          salary_expectation: payload.salary_expectation || null,
          cover_letter_tone: payload.cover_letter_tone || null,
          skills: payload.skills,
          industries: payload.industries,
          job_titles_seeking: payload.job_titles_seeking,
          preferred_locations: payload.preferred_locations,
          work_experience: payload.work_experience,
          education: payload.education,
          linkedin_connected: payload.linkedin_connected,
          is_tailored: payload.is_tailored,
          is_complete,
        },
      ]);

    if (upsertError) {
      console.error("[actions/profile] saveProfile upsert error:", upsertError);
      return { success: false, error: "Failed to save profile" };
    }

    // Fire profile_completed on first transition to complete
    if (!wasComplete && is_complete) {
      try {
        await captureServerEvent({
          distinctId: userId,
          event: "profile_completed",
          properties: { userId },
        });
      } catch {
        // Best effort — never block save on analytics
      }
    }

    revalidatePath("/profile");
    return { success: true };
  } catch (err) {
    console.error("[actions/profile] saveProfile unexpected error:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ---------------------------------------------------------------------------
// uploadResume
// ---------------------------------------------------------------------------

export async function uploadResume(
  formData: FormData,
): Promise<{ success: boolean; key?: string; url?: string; filename?: string; error?: string }> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } =
      await insforge.auth.getCurrentUser();

    if (authError || !authData.user) {
      return { success: false, error: "Not authenticated" };
    }

    const userId = authData.user.id;
    const file = formData.get("resume");

    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "No file provided" };
    }

    if (file.type !== "application/pdf") {
      return { success: false, error: "Only PDF files are accepted" };
    }

    // Remove existing file if one exists
    const { data: existing } = await insforge.database
      .from("profiles")
      .select("resume_pdf_key")
      .eq("id", userId)
      .maybeSingle();

    if (existing?.resume_pdf_key) {
      await insforge.storage.from("resumes").remove(existing.resume_pdf_key);
    }

    // Upload new file — path is deterministic; SDK may suffix if race condition
    const { data: uploadData, error: uploadError } = await insforge.storage
      .from("resumes")
      .upload(`${userId}/resume.pdf`, file);

    if (uploadError || !uploadData) {
      console.error("[actions/profile] uploadResume upload error:", uploadError);
      return { success: false, error: "Failed to upload resume" };
    }

    // Save key, URL, and original filename back to profile row
    const { error: updateError } = await insforge.database
      .from("profiles")
      .upsert([
        {
          id: userId,
          resume_pdf_key: uploadData.key,
          resume_pdf_url: uploadData.url,
          resume_pdf_filename: file.name,
        },
      ]);

    if (updateError) {
      console.error(
        "[actions/profile] uploadResume db update error:",
        updateError,
      );
      return { success: false, error: "Failed to save resume reference" };
    }

    revalidatePath("/profile");
    return { success: true, key: uploadData.key, url: uploadData.url, filename: file.name };
  } catch (err) {
    console.error("[actions/profile] uploadResume unexpected error:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ---------------------------------------------------------------------------
// getResumeSignedUrl
// ---------------------------------------------------------------------------

export async function getResumeSignedUrl(): Promise<{
  url?: string;
  error?: string;
}> {
  try {
    const insforge = await createInsforgeServer();
    const { data: authData, error: authError } =
      await insforge.auth.getCurrentUser();

    if (authError || !authData.user) {
      return { error: "Not authenticated" };
    }

    const { data: profile } = await insforge.database
      .from("profiles")
      .select("resume_pdf_key")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (!profile?.resume_pdf_key) {
      return { error: "No resume on file" };
    }

    const { data, error } = await insforge.storage
      .from("resumes")
      .createSignedUrl(profile.resume_pdf_key, 3600);

    if (error || !data?.signedUrl) {
      console.error("[actions/profile] getResumeSignedUrl error:", error);
      return { error: "Could not generate preview link" };
    }

    return { url: data.signedUrl };
  } catch (err) {
    console.error("[actions/profile] getResumeSignedUrl unexpected error:", err);
    return { error: "An unexpected error occurred" };
  }
}
