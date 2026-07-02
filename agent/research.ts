import { z } from "zod";
import OpenAI from "openai";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { HyperbrowserClient } from "@hyperbrowser/sdk";

import { createHyperbrowserSession } from "@/lib/hyperbrowser";
import type { HyperbrowserSession } from "@/lib/hyperbrowser";
import { createStagehand } from "@/lib/stagehand";
import { createInsforgeServer } from "@/lib/insforge-server";
import type { Job, Profile, CompanyResearchDossier } from "@/types/index";

// ---------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------

const HomepageSchema = z.object({
  oneLiner: z.string().describe("What the company does in one sentence").optional(),
  productSummary: z.string().describe("What they build/sell and who it's for").optional(),
  signals: z.array(z.string()).describe("Funding, notable customers, scale, mission, recent news").optional(),
  pageLinks: z.array(z.object({
    url: z.string(),
    kind: z.enum(["about", "careers", "blog", "engineering", "product", "team", "other"]),
  })).describe("Internal links worth visiting").optional(),
});

const SubpageSchema = z.object({
  keyPoints: z.array(z.string()).optional(),
  technologies: z.array(z.string()).describe("Specific languages, frameworks, tools, platforms").optional(),
  valuesOrCulture: z.array(z.string()).describe("Stated values, working style, team norms").optional(),
  notable: z.array(z.string()).describe("Customers, funding, scale, projects, awards").optional(),
});

type HomepageData = z.infer<typeof HomepageSchema>;
type SubpageData = z.infer<typeof SubpageSchema>;

interface ExtractedContent {
  homepage: HomepageData;
  subpages: SubpageData[];
  homepageUrl: string;
  visitedUrls: string[];
}

// ---------------------------------------------------------------
// URL derivation
// ---------------------------------------------------------------

const JOB_BOARD_DOMAINS = new Set([
  "jobsdb.com", "hk.jobsdb.com",
  "linkedin.com", "www.linkedin.com",
  "indeed.com", "www.indeed.com",
  "glassdoor.com", "www.glassdoor.com",
  "adzuna.com", "www.adzuna.com",
  "seek.com", "www.seek.com",
  "monster.com", "www.monster.com",
  "ziprecruiter.com", "www.ziprecruiter.com",
  "reed.co.uk", "www.reed.co.uk",
]);

const JOB_SUBDOMAINS = new Set(["careers", "jobs", "apply", "job", "work", "hiring"]);

function normalizeToRootDomain(parsed: URL): string {
  const parts = parsed.hostname.split(".");
  if (parts.length > 2 && JOB_SUBDOMAINS.has(parts[0])) {
    return `${parsed.protocol}//${parts.slice(1).join(".")}`;
  }
  return `${parsed.protocol}//${parsed.hostname}`;
}

async function deriveHomepageUrl(job: Job): Promise<string> {
  const raw = job.external_apply_url ?? job.source_url;

  if (raw) {
    // Step 1: Follow redirects, parse final URL
    try {
      const response = await fetch(raw, { redirect: "follow" });
      const parsed = new URL(response.url);
      if (!JOB_BOARD_DOMAINS.has(parsed.hostname)) {
        return normalizeToRootDomain(parsed);
      }
    } catch {
      // fall through
    }

    // Step 2: Parse original URL without following redirects
    try {
      const parsed = new URL(raw);
      if (!JOB_BOARD_DOMAINS.has(parsed.hostname)) {
        return normalizeToRootDomain(parsed);
      }
    } catch {
      // fall through
    }
  }

  // Step 3: Construct from company name
  if (job.company) {
    const cleanName = job.company
      .replace(/\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|Limited|Group|Holdings?).*$/i, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (cleanName) {
      return `https://www.${cleanName}.com`;
    }
  }

  return "";
}

// ---------------------------------------------------------------
// Agent logging
// ---------------------------------------------------------------

async function logAgentError(userId: string, jobId: string, message: string): Promise<void> {
  try {
    const insforge = await createInsforgeServer();
    await insforge.database.from("agent_logs").insert([{
      user_id: userId,
      job_id: jobId,
      message,
      level: "error",
    }]);
  } catch {
    console.error("[agent/research] Failed to write agent log:", message);
  }
}

// ---------------------------------------------------------------
// Browser research
// ---------------------------------------------------------------

async function conductBrowserResearch(
  job: Job,
  stagehand: Stagehand,
  homepageUrl: string,
  userId: string,
): Promise<ExtractedContent> {
  const content: ExtractedContent = {
    homepage: {},
    subpages: [],
    homepageUrl,
    visitedUrls: [],
  };

  try {
    const page = stagehand.context.activePage();
    if (!page) throw new Error("No active page after Stagehand init");

    await page.goto(homepageUrl);
    await page.waitForLoadState("networkidle");

    const homepageData = await stagehand.extract(
      "This is a company's homepage. Capture what the company actually does, who it's for, and any concrete signals (funding, customers, scale, mission, recent launches). Then find the internal links most worth visiting to research them as an employer.",
      HomepageSchema,
    );

    content.homepage = homepageData;
    content.visitedUrls.push(homepageUrl);

    if (!homepageData.oneLiner && !homepageData.productSummary) {
      return content;
    }

    // Visit up to 3 sub-pages, prefer substantive sections over careers
    const links = (homepageData.pageLinks ?? [])
      .filter((l) => l.kind !== "careers" && l.kind !== "other")
      .slice(0, 3);

    for (const link of links) {
      try {
        await page.goto(link.url);
        await page.waitForLoadState("networkidle");
        const subData = await stagehand.extract(
          "Extract substance that helps a candidate understand this company before applying: what they do, their values and how they work, the specific technologies and tools they use, notable projects or customers, and how the team operates. Ignore nav, footers, cookie banners, and generic marketing copy.",
          SubpageSchema,
        );
        content.subpages.push(subData);
        content.visitedUrls.push(link.url);
      } catch (subErr) {
        await logAgentError(userId, job.id, `[agent/research] Sub-page failed (${link.url}): ${String(subErr)}`);
      }
    }
  } catch (err) {
    await logAgentError(userId, job.id, `[agent/research] Homepage extraction failed: ${String(err)}`);
  }

  return content;
}

// ---------------------------------------------------------------
// Dossier synthesis
// ---------------------------------------------------------------

async function synthesizeDossier(
  content: ExtractedContent,
  job: Job,
  profile: Profile | null,
): Promise<CompanyResearchDossier> {
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://job-pilot.app",
      "X-Title": "JobPilot",
    },
  });

  const companyResearchText = content.homepageUrl
    ? `Homepage (${content.homepageUrl}): ${JSON.stringify(content.homepage)}
${content.subpages.map((s, i) => `Sub-page ${i + 1} (${content.visitedUrls[i + 1] ?? ""}): ${JSON.stringify(s)}`).join("\n")}`
    : "No browser research available — synthesize from job posting and candidate profile only.";

  const systemPrompt = `You are a sharp career strategist preparing a candidate to apply for a specific role. You are given (a) research collected from the company's own website, (b) the job posting, and (c) the candidate's profile. Produce a concise, concrete briefing that gives this specific candidate an edge for this specific role.

Rules:
- Ground every company claim in the provided research or job posting. Never invent funding, customers, headcount, or facts. If research was thin, infer carefully from the job posting and say what's inferred.
- Be specific to THIS candidate. Connect their actual skills and past work to this company's stack, product, and values. No generic advice that would apply to anyone.
- Turn the candidate's missing skills into a strategy: how to frame the gap honestly and what adjacent experience to lean on.
- Talking points and questions must reference real things from the research, the kind of detail that signals the candidate did their homework.
- Keep every item tight: one or two sentences. No fluff.

Return ONLY valid JSON matching this shape:
{
  "companyOverview": string,
  "techStack": string[],
  "culture": string[],
  "whyThisRole": string,
  "yourEdge": string[],
  "gapsToAddress": string[],
  "smartQuestions": string[],
  "interviewPrep": string[],
  "sources": string[]
}`;

  const userPrompt = `COMPANY RESEARCH (from their website):
${companyResearchText}

JOB POSTING:
Title: ${job.title ?? "Not specified"}
Company: ${job.company ?? "Not specified"}
Description: ${job.about_role ?? "Not specified"}
Matched skills (already computed): ${(job.matched_skills ?? []).join(", ") || "None"}
Missing skills (already computed): ${(job.missing_skills ?? []).join(", ") || "None"}

CANDIDATE PROFILE:
Current title: ${profile?.current_title ?? "Not specified"}
Experience: ${profile?.years_experience ?? "?"} years, level ${profile?.experience_level ?? "Not specified"}
Skills: ${(profile?.skills ?? []).join(", ") || "None listed"}
Work history: ${JSON.stringify(profile?.work_experience ?? [])}`;

  const response = await openai.chat.completions.create({
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Nemotron returned empty content — model may be unavailable or rate-limited");
  }
  const raw = JSON.parse(rawContent) as Record<string, unknown>;

  const allSources = [
    ...((raw.sources as string[] | undefined) ?? []),
    ...content.visitedUrls,
  ].filter(Boolean);

  return {
    companyOverview: (raw.companyOverview as string) ?? "",
    techStack: (raw.techStack as string[]) ?? [],
    culture: (raw.culture as string[]) ?? [],
    whyThisRole: (raw.whyThisRole as string) ?? "",
    yourEdge: (raw.yourEdge as string[]) ?? [],
    gapsToAddress: (raw.gapsToAddress as string[]) ?? [],
    smartQuestions: (raw.smartQuestions as string[]) ?? [],
    interviewPrep: (raw.interviewPrep as string[]) ?? [],
    sources: [...new Set(allSources)],
    researchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------
// Public export
// ---------------------------------------------------------------

export async function researchCompany(
  jobId: string,
  userId: string,
): Promise<{ dossier: CompanyResearchDossier; company: string | null }> {
  const insforge = await createInsforgeServer();

  const { data: rawJob, error: jobError } = await insforge.database
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (jobError || !rawJob) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = rawJob as Job;

  const { data: rawProfile } = await insforge.database
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const profile = rawProfile as Profile | null;

  // Browser research — failures are contained, synthesis always runs
  let content: ExtractedContent = {
    homepage: {},
    subpages: [],
    homepageUrl: "",
    visitedUrls: [],
  };

  let stagehand: Stagehand | null = null;
  let session: HyperbrowserSession | null = null;
  let client: HyperbrowserClient | null = null;

  const homepageUrl = await deriveHomepageUrl(job);

  if (homepageUrl) {
    try {
      const hb = await createHyperbrowserSession();
      client = hb.client;
      session = hb.session;
      stagehand = await createStagehand(hb.session.wsEndpoint);
      content = await conductBrowserResearch(job, stagehand, homepageUrl, userId);
    } catch (err) {
      await logAgentError(userId, jobId, `[agent/research] Session setup failed: ${String(err)}`);
    } finally {
      if (stagehand) {
        try { await stagehand.close(); } catch { /* already closed */ }
      }
      if (client && session) {
        try { await client.sessions.stop(session.id); } catch { /* already stopped */ }
      }
    }
  }

  // Synthesis always runs, even with empty content
  const dossier = await synthesizeDossier(content, job, profile);

  // Save to DB
  await insforge.database
    .from("jobs")
    .update({ company_research: dossier })
    .eq("id", jobId)
    .eq("user_id", userId);

  return { dossier, company: job.company };
}
