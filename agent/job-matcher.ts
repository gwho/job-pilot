// NOTE: The `openai` package is only the HTTP transport — it speaks the
// OpenAI-compatible wire format that OpenRouter implements. The baseURL points
// at OpenRouter and the model is Nemotron; no request reaches OpenAI. This
// matches agent/extractor.ts and the Nemotron section of context/library-docs.md.
import OpenAI from "openai";

import type { Profile } from "@/types/index";

export type ScoringInput = {
  title: string;
  company: string;
  location: string;
  description: string;
};

export type JobScore = {
  matchScore: number; // 0-100
  matchReason: string; // one sentence
  matchedSkills: string[];
  missingSkills: string[];
};

const SYSTEM_PROMPT = `You are a job matching expert. You are given a candidate profile and a numbered list of jobs. Score how well each job fits THIS candidate.

Return ONLY valid JSON in this exact shape:
{
  "scores": [
    { "matchScore": number, "matchReason": string, "matchedSkills": string[], "missingSkills": string[] }
  ]
}

Rules:
- The "scores" array MUST have exactly one entry per input job, in the SAME ORDER as the numbered list.
- matchScore: integer 0-100. Weigh the candidate's skills, current title, experience level, and years against the job's requirements.
- matchReason: one concise sentence explaining the score for this specific candidate.
- matchedSkills: skills the candidate clearly has that this job wants.
- missingSkills: skills the job wants that the candidate appears to lack.
- If the candidate profile is sparse, score conservatively from the job title and description alone — never invent candidate skills.`;

// A neutral score used when the model omits or misaligns an entry.
const FALLBACK_SCORE: JobScore = {
  matchScore: 0,
  matchReason: "Not scored — matching unavailable for this job.",
  matchedSkills: [],
  missingSkills: [],
};

function buildProfileSummary(profile: Profile | null): string {
  if (!profile) {
    return "No profile on file. Score from the job title and description only.";
  }

  const workHistory =
    profile.work_experience
      ?.map((w) => `${w.title} at ${w.company}`)
      .join("; ") || "none listed";

  return [
    `Current title: ${profile.current_title ?? "unknown"}`,
    `Experience level: ${profile.experience_level ?? "unknown"}`,
    `Years of experience: ${profile.years_experience ?? "unknown"}`,
    `Skills: ${profile.skills?.join(", ") || "none listed"}`,
    `Industries: ${profile.industries?.join(", ") || "none listed"}`,
    `Work history: ${workHistory}`,
  ].join("\n");
}

function buildJobsList(jobs: ScoringInput[]): string {
  return jobs
    .map(
      (job, i) =>
        `Job ${i + 1}:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nDescription: ${job.description}`,
    )
    .join("\n\n");
}

/**
 * Score every job in a single Nemotron call. Returns one JobScore per input job,
 * index-aligned to `jobs`.
 *
 * Best-effort: a null/sparse profile still produces scores. On any failure
 * (API error, malformed JSON, length mismatch) the affected jobs fall back to a
 * neutral score rather than failing the whole search.
 */
export async function scoreJobs(
  jobs: ScoringInput[],
  profile: Profile | null,
): Promise<JobScore[]> {
  if (jobs.length === 0) {
    return [];
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://job-pilot.app",
      "X-Title": "JobPilot",
    },
  });

  const userPrompt = `CANDIDATE PROFILE:\n${buildProfileSummary(profile)}\n\nJOBS TO SCORE:\n${buildJobsList(jobs)}`;

  try {
    const response = await openai.chat.completions.create({
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0].message.content!;
    const parsed = JSON.parse(raw) as { scores?: JobScore[] };
    const scores = parsed.scores ?? [];

    // Batch-ordering guard — align scores to jobs by index, falling back where
    // the model returned too few entries or a malformed shape.
    return jobs.map((_, i) => {
      const s = scores[i];
      if (!s || typeof s.matchScore !== "number") {
        return FALLBACK_SCORE;
      }
      return {
        matchScore: Math.max(0, Math.min(100, Math.round(s.matchScore))),
        matchReason: s.matchReason ?? "",
        matchedSkills: Array.isArray(s.matchedSkills) ? s.matchedSkills : [],
        missingSkills: Array.isArray(s.missingSkills) ? s.missingSkills : [],
      };
    });
  } catch (error) {
    console.error("[agent/job-matcher]", error);
    // Never fail the search because scoring failed — return neutral scores.
    return jobs.map(() => FALLBACK_SCORE);
  }
}
