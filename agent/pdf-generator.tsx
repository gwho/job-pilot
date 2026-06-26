import OpenAI from "openai";
import { renderToBuffer } from "@react-pdf/renderer";

import { ResumeDocument, type ResumeContent } from "./resume-template";
import type { Profile } from "@/types/index";

const SYSTEM_PROMPT = `You are a professional resume writer. Given a candidate's profile data, produce polished resume content.

Return ONLY valid JSON with this exact shape:
{
  "summary": string,
  "workExperience": [
    {
      "company": string,
      "title": string,
      "period": string,
      "bullets": string[]
    }
  ]
}

Rules:
- summary: 2-3 sentences. Open with the candidate's role and experience level, then their key strengths and value proposition.
- bullets: 3-4 per role maximum. Start each with a strong past-tense action verb (Led, Built, Reduced, Increased). Quantify impact wherever the raw data allows. Keep each bullet under 20 words.
- period: Format as "YYYY – Present" or "YYYY – YYYY". Use "Present" if current is true.
- Keep the entire output concise — it must fit on a single-page PDF.
- Return valid JSON only. No markdown fences, no extra text.`;

export async function generateResumePdf(
  profile: Profile,
): Promise<{ success: true; buffer: Buffer } | { success: false; error: string }> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://job-pilot.app",
        "X-Title": "JobPilot",
      },
    });

    const workExpText = (profile.work_experience ?? [])
      .map(
        (job) =>
          `Company: ${job.company}\nTitle: ${job.title}\nPeriod: ${job.startDate} – ${job.current ? "Present" : (job.endDate ?? "")}\nResponsibilities: ${job.responsibilities}`,
      )
      .join("\n\n");

    const educationText = profile.education
      ? `${profile.education.degree ?? ""} in ${profile.education.fieldOfStudy ?? ""}, ${profile.education.institution ?? ""}, ${profile.education.graduationYear ?? ""}`
      : "Not provided";

    const userPrompt = `NAME: ${profile.full_name ?? ""}
CURRENT TITLE: ${profile.current_title ?? ""}
EXPERIENCE LEVEL: ${profile.experience_level ?? ""}
YEARS OF EXPERIENCE: ${profile.years_experience ?? ""}
SKILLS: ${(profile.skills ?? []).join(", ")}

WORK EXPERIENCE:
${workExpText || "Not provided"}

EDUCATION: ${educationText}`;

    const response = await openai.chat.completions.create({
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0].message.content!;
    const content = JSON.parse(raw) as ResumeContent;

    const buffer = await renderToBuffer(
      <ResumeDocument profile={profile} content={content} />,
    );

    return { success: true, buffer: Buffer.from(buffer) };
  } catch (error) {
    console.error("[agent/pdf-generator] generateResumePdf error:", error);
    return { success: false, error: "Failed to generate resume PDF" };
  }
}
