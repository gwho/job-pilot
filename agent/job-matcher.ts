// NOTE: The `openai` package is only the HTTP transport — it speaks the
// OpenAI-compatible wire format that OpenRouter implements. The baseURL points
// at OpenRouter and the model is Nemotron; no request reaches OpenAI. This
// matches agent/extractor.ts, agent/research.ts, and the Nemotron section of
// context/library-docs.md.
import { z } from "zod";
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

import type { Profile } from "@/types/index";

export type ScoringInput = {
  title: string;
  company: string;
  location: string;
  description: string;
};

export type JobScore = {
  matchScore: number | null; // 0-100, or null when scoring couldn't produce a real value
  matchReason: string; // one sentence
  matchedSkills: string[];
  missingSkills: string[];
};

export const UNSCORED_MATCH_REASON =
  "Not scored — matching unavailable for this job.";

const SYSTEM_PROMPT = `You are a job matching expert. You are given a candidate profile and a numbered list of jobs. Score how well each job fits THIS candidate.

Return ONLY valid JSON in this exact shape:
{
  "scores": [
    { "jobNumber": number, "matchScore": number, "matchReason": string, "matchedSkills": string[], "missingSkills": string[] }
  ]
}

Rules:
- The "scores" array MUST have exactly one entry per input job.
- jobNumber: the 1-based number of the job this entry scores, matching its "Job N:" label below. Every jobNumber must be unique and between 1 and the total number of jobs.
- matchScore: integer 0-100. Weigh the candidate's skills, current title, experience level, and years against the job's requirements.
- matchReason: one concise sentence explaining the score for this specific candidate.
- matchedSkills: skills the candidate clearly has that this job wants.
- missingSkills: skills the job wants that the candidate appears to lack.
- If the candidate profile is sparse, score conservatively from the job title and description alone — never invent candidate skills.`;

const SCORING_RETRY_SUFFIX = `

The previous response was invalid, incomplete, or truncated. Return ONLY a single JSON object matching the required shape exactly — no prose, no markdown code fences, no explanation before or after it. Every entry MUST include a unique "jobNumber" matching the numbered job it scores.`;

const SCORING_INITIAL_MAX_TOKENS = 2000;
const SCORING_RETRY_MAX_TOKENS = 2600;

// Envelope validity is checked separately from entry validity: `scores` must
// be an array, but its elements stay `unknown` here so one malformed sibling
// can never invalidate the whole response — see alignScores, which validates
// (and may discard) each entry independently.
const ScoringEnvelopeSchema = z.object({
  scores: z.array(z.unknown()),
});

const JobScoreEntrySchema = z.object({
  jobNumber: z.number().int(),
  matchScore: z.number(),
  matchReason: z.string().optional(),
  matchedSkills: z.array(z.string()).optional(),
  missingSkills: z.array(z.string()).optional(),
});

type JobScoreEntry = z.infer<typeof JobScoreEntrySchema>;

type ScoringAttemptResult =
  | { status: "parsed"; scores: unknown[] }
  | { status: "invalid" };

function unscoredJobScore(): JobScore {
  return {
    matchScore: null,
    matchReason: UNSCORED_MATCH_REASON,
    matchedSkills: [],
    missingSkills: [],
  };
}

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

// Envelope-level parsing only: finish_reason, empty content, JSON.parse, and
// the `{ scores: unknown[] }` shape. Per-entry validation happens later in
// alignScores so a single malformed entry never invalidates its siblings.
function parseScoringAttempt(
  response: ChatCompletion,
  attempt: number,
): ScoringAttemptResult {
  const choice = response.choices[0];
  const raw = choice?.message?.content;

  if (choice?.finish_reason === "length") {
    console.error("[agent/job-matcher] Scoring response was truncated at max_tokens", {
      attempt,
      contentLength: raw?.length ?? 0,
    });
    return { status: "invalid" };
  }

  if (!raw) {
    console.error("[agent/job-matcher] Scoring response returned empty content", { attempt });
    return { status: "invalid" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.error("[agent/job-matcher] Scoring response returned non-JSON content", {
      attempt,
      contentLength: raw.length,
      startsWithBrace: raw.trimStart().startsWith("{"),
      endsWithBrace: raw.trimEnd().endsWith("}"),
    });
    return { status: "invalid" };
  }

  const envelope = ScoringEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) {
    console.error("[agent/job-matcher] Scoring response envelope failed shape validation", {
      attempt,
      issueCount: envelope.error.issues.length,
      issuePaths: envelope.error.issues.map((issue) => issue.path.join(".")),
    });
    return { status: "invalid" };
  }

  return { status: "parsed", scores: envelope.data.scores };
}

async function requestScoring(
  openai: OpenAI,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<ChatCompletion> {
  const params: ChatCompletionCreateParamsNonStreaming = {
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    response_format: { type: "json_object" },
    stream: false,
    temperature: 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  return openai.chat.completions.create(params);
}

// Wraps the request itself so a thrown network/provider error is treated
// exactly like an invalid response — both are whole-response failures and
// both get the one bounded retry.
async function attemptScoring(
  openai: OpenAI,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  attempt: number,
): Promise<ScoringAttemptResult> {
  try {
    const response = await requestScoring(openai, systemPrompt, userPrompt, maxTokens);
    return parseScoringAttempt(response, attempt);
  } catch (error) {
    console.error("[agent/job-matcher] Scoring request failed", {
      attempt,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "invalid" };
  }
}

// Per-entry alignment by jobNumber, run only once the envelope itself parsed.
// - A malformed entry (fails JobScoreEntrySchema) is dropped, not fatal.
// - A missing jobNumber leaves that one job unscored.
// - A jobNumber claimed by more than one entry is ambiguous and left
//   unscored too — no first-wins, since silently picking one would persist
//   a value the model contradicted itself on.
function alignScores(jobs: ScoringInput[], rawEntries: unknown[]): JobScore[] {
  const entriesByNumber = new Map<number, JobScoreEntry[]>();

  for (const raw of rawEntries) {
    const parsed = JobScoreEntrySchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[agent/job-matcher] Dropping malformed scoring entry", {
        issuePaths: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      continue;
    }
    const existing = entriesByNumber.get(parsed.data.jobNumber);
    if (existing) {
      existing.push(parsed.data);
    } else {
      entriesByNumber.set(parsed.data.jobNumber, [parsed.data]);
    }
  }

  return jobs.map((_, i) => {
    const jobNumber = i + 1;
    const candidates = entriesByNumber.get(jobNumber);

    if (!candidates || candidates.length === 0) {
      console.error("[agent/job-matcher] No scoring entry for job — leaving unscored", { jobNumber });
      return unscoredJobScore();
    }

    if (candidates.length > 1) {
      console.error("[agent/job-matcher] Duplicate scoring entries for job — leaving unscored", {
        jobNumber,
        count: candidates.length,
      });
      return unscoredJobScore();
    }

    const entry = candidates[0];
    return {
      matchScore: Math.max(0, Math.min(100, Math.round(entry.matchScore))),
      matchReason: entry.matchReason ?? "",
      matchedSkills: entry.matchedSkills ?? [],
      missingSkills: entry.missingSkills ?? [],
    };
  });
}

/**
 * Score every job against the candidate profile in one Nemotron call,
 * retried once as a whole on any whole-response failure (request error,
 * truncation, empty/non-JSON content, or an invalid envelope). Individual
 * malformed, missing, or duplicated entries never trigger that retry — they
 * only leave their own job unscored (matchScore: null), never a fabricated 0.
 *
 * Best-effort: a null/sparse profile still produces scores.
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

  let result = await attemptScoring(openai, SYSTEM_PROMPT, userPrompt, SCORING_INITIAL_MAX_TOKENS, 1);

  if (result.status === "invalid") {
    result = await attemptScoring(
      openai,
      `${SYSTEM_PROMPT}${SCORING_RETRY_SUFFIX}`,
      userPrompt,
      SCORING_RETRY_MAX_TOKENS,
      2,
    );
  }

  if (result.status === "invalid") {
    console.error("[agent/job-matcher] Scoring exhausted retry — batch left unscored", {
      jobCount: jobs.length,
    });
    return jobs.map(() => unscoredJobScore());
  }

  return alignScores(jobs, result.scores);
}
