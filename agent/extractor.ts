import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { PDFParse } from "pdf-parse";
import { z } from "zod";

const WorkExperienceEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  current: z.boolean(),
  responsibilities: z.string(),
});

const EducationSchema = z.object({
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  institution: z.string().nullable(),
  graduationYear: z.string().nullable(),
});

const ProfileExtractionSchema = z.object({
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  current_title: z.string().nullable().optional(),
  experience_level: z.enum(["junior", "mid", "senior", "lead"]).nullable().optional(),
  years_experience: z.number().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  portfolio_url: z.string().nullable().optional(),
  work_authorization: z
    .enum(["citizen", "permanent_resident", "visa_required"])
    .nullable()
    .optional(),
  remote_preference: z.enum(["remote", "onsite", "hybrid", "any"]).nullable().optional(),
  salary_expectation: z.string().nullable().optional(),
  skills: z.array(z.string()).optional(),
  industries: z.array(z.string()).optional(),
  job_titles_seeking: z.array(z.string()).optional(),
  work_experience: z.array(WorkExperienceEntrySchema).optional(),
  education: EducationSchema.optional(),
});

export type ProfileExtraction = z.infer<typeof ProfileExtractionSchema>;

export const EXTRACTION_FAILED_MESSAGE =
  "Could not extract structured profile data from this resume. Please try again or enter details manually.";

type ExtractionResult =
  | { success: true; data: ProfileExtraction }
  | { success: false; error: string };

type CompletionParseResult =
  | { status: "parsed"; data: ProfileExtraction }
  | { status: "failed"; error: string }
  | { status: "truncated" };

const INITIAL_MAX_TOKENS = 2500;
const RETRY_MAX_TOKENS = 3000;
const MAX_RESUME_TEXT_CHARS = 18000;

const SYSTEM_PROMPT = `You extract profile information from resume text. Return ONLY valid JSON matching the exact shape below — no prose, no explanation, no markdown code fences (no \`\`\`). Your entire response must be a single JSON object, starting with { and ending with }. Use null for any field you cannot confidently extract — never guess. Allowed enum values are listed exactly.

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
- work_experience startDate / endDate: use "YYYY-MM" format where possible, plain year string otherwise
- work_experience: return at most 3 roles; use the most recent or most relevant roles
- responsibilities: one compact sentence per role, maximum 180 characters
- skills: return at most 25 items
- industries: return at most 8 items
- job_titles_seeking: return at most 6 items

Respond with the JSON object only. Do not include any text before or after it.`;

const COMPACT_RETRY_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

The previous response was too long and was truncated. Return a smaller JSON object:
- Keep only the strongest extracted facts.
- Use at most 2 work_experience entries.
- Keep each responsibilities string under 120 characters.
- Use at most 15 skills.
- Do not include explanatory text anywhere.`;

function safeParseProfileExtraction(raw: string): CompletionParseResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    console.error("[agent/extractor] Model returned non-JSON content", {
      contentLength: raw.length,
      startsWithJsonObject: raw.trimStart().startsWith("{"),
    });
    return { status: "failed", error: EXTRACTION_FAILED_MESSAGE };
  }

  const result = ProfileExtractionSchema.safeParse(parsedJson);
  if (!result.success) {
    console.error("[agent/extractor] Model JSON failed shape validation", {
      issueCount: result.error.issues.length,
      issuePaths: result.error.issues.map((issue) => issue.path.join(".")),
    });
    return { status: "failed", error: EXTRACTION_FAILED_MESSAGE };
  }

  return { status: "parsed", data: result.data };
}

async function requestProfileExtraction(
  openai: OpenAI,
  systemPrompt: string,
  text: string,
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
      { role: "user", content: `RESUME TEXT:\n${text}` },
    ],
  };

  return openai.chat.completions.create(params);
}

function parseCompletion(response: ChatCompletion): CompletionParseResult {
  const choice = response.choices[0];
  const raw = choice?.message?.content;

  if (choice?.finish_reason === "length") {
    console.error("[agent/extractor] Nemotron response was truncated at max_tokens", {
      contentLength: raw?.length ?? 0,
    });
    return { status: "truncated" };
  }

  if (!raw) {
    console.error(
      "[agent/extractor] Nemotron returned empty content — model may be unavailable or rate-limited",
    );
    return { status: "failed", error: EXTRACTION_FAILED_MESSAGE };
  }

  return safeParseProfileExtraction(raw);
}

export async function extractProfileFromResume(buffer: Buffer): Promise<ExtractionResult> {
  try {
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

    // Step 2 — structured extraction via Nemotron
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://job-pilot.app",
        "X-Title": "JobPilot",
      },
    });

    const boundedText = text.slice(0, MAX_RESUME_TEXT_CHARS);
    const response = await requestProfileExtraction(
      openai,
      SYSTEM_PROMPT,
      boundedText,
      INITIAL_MAX_TOKENS,
    );
    const parsed = parseCompletion(response);

    if (parsed.status === "parsed") {
      return { success: true, data: parsed.data };
    }

    if (parsed.status === "failed") {
      return { success: false, error: parsed.error };
    }

    const retryResponse = await requestProfileExtraction(
      openai,
      COMPACT_RETRY_SYSTEM_PROMPT,
      boundedText,
      RETRY_MAX_TOKENS,
    );
    const retryParsed = parseCompletion(retryResponse);

    if (retryParsed.status === "parsed") {
      return { success: true, data: retryParsed.data };
    }

    return { success: false, error: EXTRACTION_FAILED_MESSAGE };
  } catch (error) {
    console.error("[agent/extractor]", error);
    return { success: false, error: EXTRACTION_FAILED_MESSAGE };
  }
}
