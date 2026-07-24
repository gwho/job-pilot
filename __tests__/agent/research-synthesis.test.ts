/**
 * Regression tests for company research synthesis's unguarded JSON.parse.
 *
 * Root cause under investigation: agent/research.ts's synthesizeDossier() calls
 * JSON.parse() directly on Nemotron's raw content with no try/catch, no
 * finish_reason check, and no runtime shape validation (cast with
 * `as Record<string, unknown>`). Real production runs have returned both
 * truncated JSON ("Unterminated string in JSON") and prose instead of JSON
 * ("Unexpected token 'T', \"The user w\"..."). Either throws a SyntaxError out of
 * synthesizeDossier(), uncaught, through researchCompany(), surfacing to the
 * user as a generic 500 ("Failed to research company") via
 * app/api/agent/research/route.ts's outer catch.
 *
 * Browser research is disabled in every fixture here (job has no company,
 * source_url, or external_apply_url, so deriveHomepageUrl() returns "") so
 * these tests reach the synthesis boundary directly without needing to mock
 * Hyperbrowser/Stagehand page interactions. lib/hyperbrowser and lib/stagehand
 * are still mocked so the suite fails loudly (rather than making a real network
 * call) if that assumption ever breaks.
 *
 * Run: npm run test:run -- __tests__/agent/research-synthesis.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyResearchDossier, Job, Profile } from "@/types/index";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createHyperbrowserSession: vi.fn(),
  createStagehand: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: mocks.create } } };
  }),
}));

vi.mock("@/lib/hyperbrowser", () => ({
  createHyperbrowserSession: mocks.createHyperbrowserSession,
}));

vi.mock("@/lib/stagehand", () => ({
  createStagehand: mocks.createStagehand,
}));

// ---------------------------------------------------------------------------
// InsForge chain mock — mirrors __tests__/find-jobs/token-refresh-before-save.test.ts
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolvedValue: unknown): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "delete", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}

const updateSpy = vi.fn().mockReturnValue(createChain({ error: null }));

function buildInsforgeMock(job: Job, profile: Profile | null) {
  return {
    database: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "jobs") {
          const chain = createChain({ data: job, error: null });
          chain.update = updateSpy;
          return chain;
        }
        if (table === "profiles") {
          return createChain({ data: profile, error: null });
        }
        if (table === "agent_logs") {
          return createChain({ data: null, error: null });
        }
        throw new Error(`Unexpected table in test: ${table}`);
      }),
    },
  };
}

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

import { researchCompany } from "@/agent/research";
import { createInsforgeServer } from "@/lib/insforge-server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_JOB: Job = {
  id: "job-1",
  run_id: "run-1",
  user_id: "user-1",
  source: "search",
  source_provider: "jobsdb_hk",
  source_url: null,
  external_apply_url: null,
  title: "Senior Software Engineer",
  company: null, // no company/URL → deriveHomepageUrl() returns "" → browser research is skipped
  location: "Hong Kong",
  salary: null,
  job_type: "fulltime",
  about_role: "Build and ship the core platform.",
  responsibilities: null,
  requirements: null,
  nice_to_have: null,
  benefits: null,
  about_company: null,
  match_score: 82,
  match_reason: "Strong skills match.",
  matched_skills: ["TypeScript", "React"],
  missing_skills: ["Kubernetes"],
  company_research: null,
  found_at: "2026-07-01T00:00:00.000Z",
};

const MOCK_PROFILE: Profile = {
  id: "user-1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  location: "Hong Kong",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: 8,
  skills: ["TypeScript", "React", "Node.js"],
  industries: ["Fintech"],
  work_experience: [],
  education: null,
  job_titles_seeking: [],
  remote_preference: "remote",
  preferred_locations: [],
  salary_expectation: null,
  cover_letter_tone: "formal",
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  resume_pdf_url: null,
  resume_pdf_key: null,
  resume_pdf_filename: null,
  linkedin_connected: false,
  is_tailored: false,
  is_complete: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const VALID_DOSSIER_JSON = {
  companyOverview: "A fast-growing fintech company.",
  techStack: ["TypeScript", "React"],
  culture: ["Fast-paced"],
  whyThisRole: "Growing the core platform team.",
  yourEdge: ["Strong TypeScript background"],
  gapsToAddress: ["Kubernetes"],
  smartQuestions: ["What does the platform roadmap look like?"],
  interviewPrep: ["Review recent product launches"],
  sources: [],
};

function mockCompletion(content: string, finishReason = "stop") {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content }, finish_reason: finishReason }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mocks.create needs a full reset (not just clear) between tests: clearAllMocks
  // only resets call history, but leaves queued mockResolvedValueOnce() values
  // in place — an unconsumed second queued response from one test (e.g. when
  // the current code throws on the first call and never reaches a second)
  // would otherwise leak into the next test's first call.
  mocks.create.mockReset();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.mocked(createInsforgeServer).mockResolvedValue(
    buildInsforgeMock(MOCK_JOB, MOCK_PROFILE) as never,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("researchCompany — synthesis boundary", () => {
  it("returns the dossier when the model returns well-formed JSON on the first attempt", async () => {
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(dossier.companyOverview).toBe(VALID_DOSSIER_JSON.companyOverview);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("recovers when the first response is truncated (finish_reason: length)", async () => {
    mockCompletion('{"companyOverview":"Example","techStack":["TypeScript"', "length");
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(dossier.companyOverview).toBe(VALID_DOSSIER_JSON.companyOverview);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("recovers when the first response is prose instead of JSON", async () => {
    mockCompletion("The user wants a company research dossier for this role.", "stop");
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(dossier.companyOverview).toBe(VALID_DOSSIER_JSON.companyOverview);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("recovers when the first response is valid JSON but the wrong shape", async () => {
    mockCompletion(JSON.stringify({ overview: "wrong field names entirely" }), "stop");
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(dossier.companyOverview).toBe(VALID_DOSSIER_JSON.companyOverview);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("never throws out of researchCompany — two invalid responses still produce a saved dossier", async () => {
    mockCompletion("The user wants a dossier.", "stop");
    mockCompletion('{"companyOverview":"Still truncated', "length");

    const result = await researchCompany("job-1", "user-1");

    expect(result.dossier).toBeDefined();
    expect(typeof result.dossier.companyOverview).toBe("string");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("builds the exhausted-retry dossier deterministically from trusted job data, not the model", async () => {
    mockCompletion("not json at all", "stop");
    mockCompletion("still not json", "stop");

    const { dossier } = await researchCompany("job-1", "user-1");

    // Deterministic fallback must be grounded in the job row already in hand —
    // matched/missing skills — not fabricated by a third model call.
    expect(dossier.techStack.length + dossier.gapsToAddress.length).toBeGreaterThan(0);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("never calls Hyperbrowser/Stagehand a second time for a synthesis retry", async () => {
    mockCompletion('{"companyOverview":"Example"', "length");
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    await researchCompany("job-1", "user-1");

    // MOCK_JOB has no company/URL, so browser research is skipped entirely (0
    // calls) — this asserts the retry doesn't newly trigger one either.
    expect(mocks.createHyperbrowserSession).not.toHaveBeenCalled();
  });

  it("saves exactly one dossier update — never a partial one from a failed attempt", async () => {
    mockCompletion('{"companyOverview":"Example","techStack":["TypeScript"', "length");
    mockCompletion(JSON.stringify(VALID_DOSSIER_JSON));

    await researchCompany("job-1", "user-1");

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const saved = updateSpy.mock.calls[0][0] as { company_research: CompanyResearchDossier };
    expect(saved.company_research.companyOverview).toBe(VALID_DOSSIER_JSON.companyOverview);
  });
});
