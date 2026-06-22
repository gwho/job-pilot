import OpenAI from "openai";
import { PDFParse } from "pdf-parse";

import type { WorkExperienceEntry, Education } from "@/types/index";

export type ProfileExtraction = {
  full_name?: string | null;
  phone?: string | null;
  location?: string | null;
  current_title?: string | null;
  experience_level?: "junior" | "mid" | "senior" | "lead" | null;
  years_experience?: number | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  work_authorization?: "citizen" | "permanent_resident" | "visa_required" | null;
  remote_preference?: "remote" | "onsite" | "hybrid" | "any" | null;
  salary_expectation?: string | null;
  skills?: string[];
  industries?: string[];
  job_titles_seeking?: string[];
  work_experience?: WorkExperienceEntry[];
  education?: Education;
};

const SYSTEM_PROMPT = `You extract profile information from resume text. Return ONLY valid JSON matching the exact shape below. Use null for any field you cannot confidently extract — never guess. Allowed enum values are listed exactly.

{
  "full_name": string | null,
  "phone": string | null,
  "location": string | null,
  "current_title": string | null,
  "experience_level": "junior" | "mid" | "senior" | "lead" | null,
  "years_experience": number | null,
  "linkedin_url": string | null,
  "portfolio_url": string | null,
  "work_authorization": "citizen" | "permanent_resident" | "visa_required" | null,
  "remote_preference": "remote" | "onsite" | "hybrid" | "any" | null,
  "salary_expectation": string | null,
  "skills": string[],
  "industries": string[],
  "job_titles_seeking": string[],
  "work_experience": [{ "company": string, "title": string, "startDate": string, "endDate": string | null, "current": boolean, "responsibilities": string }],
  "education": { "degree": string | null, "fieldOfStudy": string | null, "institution": string | null, "graduationYear": string | null }
}

Rules:
- location: city and country only, never a full street address
- experience_level: infer from years of experience or seniority of titles if not stated — null if unclear
- job_titles_seeking: leave empty array if not stated in resume
- skills: deduplicate across all sections; include technologies, languages, frameworks, tools
- work_experience startDate / endDate: use "YYYY-MM" format where possible, plain year string otherwise`;

export async function extractProfileFromResume(
  buffer: Buffer,
): Promise<
  { success: true; data: ProfileExtraction } | { success: false; error: string }
> {
  // Step 1 — extract raw text from PDF
  const parser = new PDFParse({ data: buffer });
  const pdfData = await parser.getText();
  const text = pdfData.text?.trim() ?? "";

  if (text.length < 100) {
    return {
      success: false,
      error:
        "Could not extract text from this PDF. Please try a different file.",
    };
  }

  // Step 2 — structured extraction via Gemini
  const openai = new OpenAI({
    apiKey: process.env.GOOGLE_API_KEY!,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });

  const response = await openai.chat.completions.create({
    model: "gemini-2.5-flash-lite",
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 800,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `RESUME TEXT:\n${text}` },
    ],
  });

  const raw = response.choices[0].message.content!;
  const data = JSON.parse(raw) as ProfileExtraction;
  return { success: true, data };
}
