/**
 * Unit tests for agent/research.ts — the Company Research Agent.
 *
 * Covers:
 *  - Homepage URL derivation (redirect-follow → raw-URL parse → company-name
 *    fallback), including job-board subdomain stripping.
 *  - Browser research: homepage extraction, sub-page traversal (max 3,
 *    excluding "careers"/"other" links), and graceful degradation on
 *    per-page failures.
 *  - Hyperbrowser/Stagehand resource cleanup ordering and null-guard safety.
 *  - Nemotron dossier synthesis: prompt content, defaults, source dedupe,
 *    and the "never return empty" invariant.
 *  - Persistence of the dossier back to the jobs table, scoped to the user.
 *
 * Run: npm run test:run -- __tests__/agent/research.test.ts
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Job, Profile } from "@/types/index";

// ---------------------------------------------------------------------------
// Hoisted mock fns (must exist before vi.mock factories run)
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

vi.mock("@/lib/hyperbrowser", () => ({
  createHyperbrowserSession: vi.fn(),
}));

vi.mock("@/lib/stagehand", () => ({
  createStagehand: vi.fn(),
}));

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(),
}));

import { researchCompany } from "@/agent/research";
import { createHyperbrowserSession } from "@/lib/hyperbrowser";
import { createStagehand } from "@/lib/stagehand";
import { createInsforgeServer } from "@/lib/insforge-server";

// ---------------------------------------------------------------------------
// DB chain helper — mirrors the thenable pattern used in
// __tests__/find-jobs/repeated-search.test.ts
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createChain(resolvedValue: unknown): Record<string, any> {
  const chain: Record<string, any> = {};
  for (const m of ["select", "insert", "update", "eq"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(resolvedValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled, onRejected);
  return chain;
}

function buildInsforgeMock(opts: {
  job?: Job | null;
  jobError?: unknown;
  profile?: Profile | null;
}) {
  const callCounts: Record<string, number> = {};

  const jobsSelectChain = createChain({ data: opts.job ?? null, error: opts.jobError ?? null });
  const jobsUpdateChain = createChain({ data: null, error: null });
  const profilesChain = createChain({ data: opts.profile ?? null, error: null });
  const agentLogsChain = createChain({ data: null, error: null });

  const from = vi.fn((table: string) => {
    callCounts[table] = (callCounts[table] ?? 0) + 1;
    if (table === "jobs") {
      return callCounts[table] === 1 ? jobsSelectChain : jobsUpdateChain;
    }
    if (table === "profiles") return profilesChain;
    if (table === "agent_logs") return agentLogsChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    insforge: { database: { from } },
    jobsSelectChain,
    jobsUpdateChain,
    profilesChain,
    agentLogsChain,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    run_id: null,
    user_id: "user-1",
    source: "search",
    source_provider: "jobsdb_hk",
    source_url: "https://hk.jobsdb.com/job/123",
    external_apply_url: null,
    title: "Software Engineer",
    company: "Stripe",
    location: "Hong Kong",
    salary: null,
    job_type: "fulltime",
    about_role: "Build payments infrastructure",
    responsibilities: null,
    requirements: null,
    nice_to_have: null,
    benefits: null,
    about_company: null,
    match_score: 80,
    match_reason: null,
    matched_skills: ["TypeScript"],
    missing_skills: ["Go"],
    company_research: null,
    found_at: new Date().toISOString(),
    ...overrides,
  };
}

const FULL_DOSSIER_JSON = {
  companyOverview: "Stripe builds payment infrastructure for the internet.",
  techStack: ["Ruby", "Go"],
  culture: ["Fast-paced", "Written culture"],
  whyThisRole: "Expanding the Asia-Pacific engineering team.",
  yourEdge: ["TypeScript experience maps to their API tooling"],
  gapsToAddress: ["No direct Go experience — lean on strong typing background"],
  smartQuestions: ["What does success look like in the first 90 days?"],
  interviewPrep: ["Study Stripe's API design philosophy"],
  sources: ["https://stripe.com"],
};

function makeFakeStagehand() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
  };
  const stagehand = {
    context: { activePage: vi.fn(() => page) },
    extract: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { stagehand, page };
}

function makeFakeHyperbrowser() {
  const client = { sessions: { stop: vi.fn().mockResolvedValue(undefined) } };
  const session = { id: "session-1", wsEndpoint: "wss://cdp.hyperbrowser.example/session-1" };
  return { client, session };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";

  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(FULL_DOSSIER_JSON) } }],
  });

  global.fetch = vi.fn().mockRejectedValue(new Error("fetch not mocked for this test"));
});

// ---------------------------------------------------------------------------
// Job lookup
// ---------------------------------------------------------------------------

describe("researchCompany — job lookup", () => {
  it("throws when the job is not found", async () => {
    const { insforge } = buildInsforgeMock({ job: null, jobError: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await expect(researchCompany("job-1", "user-1")).rejects.toThrow("Job not found: job-1");
  });

  it("throws when the DB returns an error alongside a null job", async () => {
    const { insforge } = buildInsforgeMock({ job: null, jobError: { message: "db down" } });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await expect(researchCompany("job-1", "user-1")).rejects.toThrow("Job not found: job-1");
  });

  it("scopes the job query to the given id and user_id", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge, jobsSelectChain } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await researchCompany("job-1", "user-1");

    const eqCalls = jobsSelectChain.eq.mock.calls;
    expect(eqCalls).toContainEqual(["id", "job-1"]);
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });
});

// ---------------------------------------------------------------------------
// Homepage URL derivation (tested indirectly via page.goto call args)
// ---------------------------------------------------------------------------

describe("researchCompany — homepage URL derivation", () => {
  it("skips browser research entirely when no URL can be derived", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await researchCompany("job-1", "user-1");

    expect(createHyperbrowserSession).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("No browser research available");
  });

  it("falls back to a homepage constructed from the company name when no URLs exist", async () => {
    const job = makeJob({ company: "Acme Inc.", external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    const { stagehand, page } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(page.goto).toHaveBeenCalledWith("https://www.acme.com");
  });

  it("follows redirects and strips a job-board subdomain from the resolved URL", async () => {
    const job = makeJob({ external_apply_url: "https://track.someboard.com/redirect?x=1", source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    global.fetch = vi.fn().mockResolvedValue({ url: "https://jobs.stripe.com/careers/123" });

    const { stagehand, page } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(page.goto).toHaveBeenCalledWith("https://stripe.com");
  });

  it("falls back to parsing the original URL when the redirect fetch throws", async () => {
    const job = makeJob({ external_apply_url: "https://careers.acme.io/apply/123", source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const { stagehand, page } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(page.goto).toHaveBeenCalledWith("https://acme.io");
  });

  it("falls back to the company name when both redirect and raw URL resolve to job-board domains", async () => {
    const job = makeJob({
      company: "Beta Corp",
      external_apply_url: "https://www.linkedin.com/jobs/view/123",
      source_url: null,
    });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    global.fetch = vi.fn().mockResolvedValue({ url: "https://www.linkedin.com/jobs/view/123" });

    const { stagehand, page } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(page.goto).toHaveBeenCalledWith("https://www.beta.com");
  });

  it("prefers external_apply_url over source_url when both are present", async () => {
    const job = makeJob({
      company: null,
      external_apply_url: "https://www.applyhere.example",
      source_url: "https://hk.jobsdb.com/job/999",
    });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    global.fetch = vi.fn().mockResolvedValue({ url: "https://www.applyhere.example" });

    const { stagehand, page } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(page.goto).toHaveBeenCalledWith("https://www.applyhere.example");
  });
});

// ---------------------------------------------------------------------------
// Browser research — homepage + sub-page traversal
// ---------------------------------------------------------------------------

describe("researchCompany — browser research traversal", () => {
  function setupWithHomepage(company = "Acme") {
    const job = makeJob({ company, external_apply_url: null, source_url: null });
    const { insforge, agentLogsChain } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    return { job, agentLogsChain };
  }

  it("visits at most 3 sub-pages, excluding 'careers' and 'other' kind links", async () => {
    setupWithHomepage();
    const { stagehand, page } = makeFakeStagehand();
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    stagehand.extract
      .mockResolvedValueOnce({
        oneLiner: "We build things",
        productSummary: "A SaaS platform",
        pageLinks: [
          { url: "https://www.acme.com/careers", kind: "careers" },
          { url: "https://www.acme.com/about", kind: "about" },
          { url: "https://www.acme.com/blog", kind: "blog" },
          { url: "https://www.acme.com/eng", kind: "engineering" },
          { url: "https://www.acme.com/product", kind: "product" },
          { url: "https://www.acme.com/misc", kind: "other" },
        ],
      })
      .mockResolvedValueOnce({ keyPoints: ["A"], technologies: ["Node"] })
      .mockResolvedValueOnce({ keyPoints: ["B"], technologies: ["Go"] })
      .mockResolvedValueOnce({ keyPoints: ["C"], technologies: ["Rust"] });

    await researchCompany("job-1", "user-1");

    expect(stagehand.extract).toHaveBeenCalledTimes(4);
    const visited = page.goto.mock.calls.map((c: unknown[]) => c[0]);
    expect(visited).toEqual([
      "https://www.acme.com",
      "https://www.acme.com/about",
      "https://www.acme.com/blog",
      "https://www.acme.com/eng",
    ]);
    // Never visits careers, other, or the 4th eligible link (product)
    expect(visited).not.toContain("https://www.acme.com/careers");
    expect(visited).not.toContain("https://www.acme.com/misc");
    expect(visited).not.toContain("https://www.acme.com/product");
  });

  it("stops after the homepage when oneLiner and productSummary are both empty", async () => {
    setupWithHomepage();
    const { stagehand } = makeFakeStagehand();
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    stagehand.extract.mockResolvedValueOnce({
      pageLinks: [{ url: "https://www.acme.com/about", kind: "about" }],
    });

    await researchCompany("job-1", "user-1");

    // Homepage extract only — no sub-page follow-up
    expect(stagehand.extract).toHaveBeenCalledTimes(1);
  });

  it("logs an agent error and continues when a sub-page extraction fails", async () => {
    const { agentLogsChain } = setupWithHomepage();
    const { stagehand } = makeFakeStagehand();
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    stagehand.extract
      .mockResolvedValueOnce({
        oneLiner: "We build things",
        productSummary: "A SaaS platform",
        pageLinks: [
          { url: "https://www.acme.com/about", kind: "about" },
          { url: "https://www.acme.com/blog", kind: "blog" },
        ],
      })
      .mockRejectedValueOnce(new Error("page crashed"))
      .mockResolvedValueOnce({ keyPoints: ["B"], technologies: ["Go"] });

    await researchCompany("job-1", "user-1");

    const insertedMessages = agentLogsChain.insert.mock.calls.map(
      (c: unknown[]) => (c[0] as { message: string }[])[0].message,
    );
    expect(insertedMessages.some((m: string) => m.includes("Sub-page failed"))).toBe(true);
    expect(insertedMessages.some((m: string) => m.includes("https://www.acme.com/about"))).toBe(true);
  });

  it("logs an agent error and still synthesizes a dossier when homepage extraction throws", async () => {
    const { agentLogsChain } = setupWithHomepage();
    const { stagehand } = makeFakeStagehand();
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    stagehand.extract.mockRejectedValue(new Error("timed out"));

    const result = await researchCompany("job-1", "user-1");

    expect(result.dossier).toBeTruthy();
    const insertedMessages = agentLogsChain.insert.mock.calls.map(
      (c: unknown[]) => (c[0] as { message: string }[])[0].message,
    );
    expect(insertedMessages.some((m: string) => m.includes("Homepage extraction failed"))).toBe(true);

    // homepageUrl is set before the extraction attempt, so the synthesis prompt
    // still references it even though extraction failed.
    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("Homepage (https://www.acme.com)");
  });

  it("contains a missing active-page error and still returns a dossier", async () => {
    const { agentLogsChain } = setupWithHomepage();
    const stagehand = {
      context: { activePage: vi.fn(() => undefined) },
      extract: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    // Should not throw out of researchCompany — contained and logged, synthesis still runs.
    const result = await researchCompany("job-1", "user-1");
    expect(result.dossier).toBeTruthy();
    expect(stagehand.extract).not.toHaveBeenCalled();

    const insertedMessages = agentLogsChain.insert.mock.calls.map(
      (c: unknown[]) => (c[0] as { message: string }[])[0].message,
    );
    expect(insertedMessages.some((m: string) => m.includes("No active page"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resource cleanup
// ---------------------------------------------------------------------------

describe("researchCompany — Hyperbrowser/Stagehand cleanup", () => {
  function setupWithHomepage() {
    const job = makeJob({ company: "Acme", external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);
    return { job };
  }

  it("closes Stagehand before stopping the Hyperbrowser session", async () => {
    setupWithHomepage();
    const order: string[] = [];
    const { stagehand } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    stagehand.close = vi.fn().mockImplementation(async () => {
      order.push("stagehand.close");
    });

    const { client, session } = makeFakeHyperbrowser();
    client.sessions.stop = vi.fn().mockImplementation(async () => {
      order.push("session.stop");
    });

    vi.mocked(createHyperbrowserSession).mockResolvedValue({ client, session } as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await researchCompany("job-1", "user-1");

    expect(order).toEqual(["stagehand.close", "session.stop"]);
  });

  it("does not throw when stagehand.close() rejects", async () => {
    setupWithHomepage();
    const { stagehand } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    stagehand.close = vi.fn().mockRejectedValue(new Error("already closed"));

    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await expect(researchCompany("job-1", "user-1")).resolves.toBeTruthy();
  });

  it("does not throw when client.sessions.stop() rejects", async () => {
    setupWithHomepage();
    const { stagehand } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});

    const { client, session } = makeFakeHyperbrowser();
    client.sessions.stop = vi.fn().mockRejectedValue(new Error("already stopped"));

    vi.mocked(createHyperbrowserSession).mockResolvedValue({ client, session } as never);
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    await expect(researchCompany("job-1", "user-1")).resolves.toBeTruthy();
  });

  it("logs an error and skips browser research entirely when session creation fails", async () => {
    const job = makeJob({ company: "Acme", external_apply_url: null, source_url: null });
    const { insforge, agentLogsChain } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    vi.mocked(createHyperbrowserSession).mockRejectedValue(new Error("Hyperbrowser unavailable"));

    await researchCompany("job-1", "user-1");

    expect(createStagehand).not.toHaveBeenCalled();
    const insertedMessages = agentLogsChain.insert.mock.calls.map(
      (c: unknown[]) => (c[0] as { message: string }[])[0].message,
    );
    expect(insertedMessages.some((m: string) => m.includes("Session setup failed"))).toBe(true);

    // Content stays fully empty (homepageUrl reset to "") — synthesis falls back.
    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("No browser research available");
  });

  it("still stops the Hyperbrowser session when Stagehand initialization fails (null-guard safety)", async () => {
    const job = makeJob({ company: "Acme", external_apply_url: null, source_url: null });
    const { insforge, agentLogsChain } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    const { client, session } = makeFakeHyperbrowser();
    vi.mocked(createHyperbrowserSession).mockResolvedValue({ client, session } as never);
    vi.mocked(createStagehand).mockRejectedValue(new Error("CDP connection refused"));

    await expect(researchCompany("job-1", "user-1")).resolves.toBeTruthy();

    expect(client.sessions.stop).toHaveBeenCalledWith("session-1");
    const insertedMessages = agentLogsChain.insert.mock.calls.map(
      (c: unknown[]) => (c[0] as { message: string }[])[0].message,
    );
    expect(insertedMessages.some((m: string) => m.includes("Session setup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dossier synthesis
// ---------------------------------------------------------------------------

describe("researchCompany — dossier synthesis", () => {
  it("calls Nemotron with the correct model, temperature, max_tokens, and response_format", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await researchCompany("job-1", "user-1");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        temperature: 0.4,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    );
  });

  it("throws when Nemotron returns empty content", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

    await expect(researchCompany("job-1", "user-1")).rejects.toThrow(/Nemotron returned empty content/);
  });

  it("fills in default empty values for fields omitted from Nemotron's response", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    mockCreate.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(dossier.companyOverview).toBe("");
    expect(dossier.whyThisRole).toBe("");
    expect(dossier.techStack).toEqual([]);
    expect(dossier.culture).toEqual([]);
    expect(dossier.yourEdge).toEqual([]);
    expect(dossier.gapsToAddress).toEqual([]);
    expect(dossier.smartQuestions).toEqual([]);
    expect(dossier.interviewPrep).toEqual([]);
    expect(dossier.sources).toEqual([]);
  });

  it("dedupes sources between Nemotron's output and visited URLs", async () => {
    const job = makeJob({ company: "Acme", external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);

    const { stagehand } = makeFakeStagehand();
    stagehand.extract
      .mockResolvedValueOnce({
        oneLiner: "We build things",
        productSummary: "SaaS",
        pageLinks: [{ url: "https://www.acme.com/about", kind: "about" }],
      })
      .mockResolvedValueOnce({ keyPoints: ["A"] });
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...FULL_DOSSIER_JSON,
              sources: ["https://www.acme.com", "https://www.acme.com/about"],
            }),
          },
        },
      ],
    });

    const { dossier } = await researchCompany("job-1", "user-1");

    const occurrences = dossier.sources.filter((s) => s === "https://www.acme.com").length;
    expect(occurrences).toBe(1);
    expect(dossier.sources).toContain("https://www.acme.com/about");
  });

  it("sets researchedAt to a fresh ISO timestamp", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    const before = Date.now();
    const { dossier } = await researchCompany("job-1", "user-1");
    const after = Date.now();

    const timestamp = new Date(dossier.researchedAt!).getTime();
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("includes job and profile fields in the synthesis prompt", async () => {
    const job = makeJob({
      company: null,
      external_apply_url: null,
      source_url: null,
      title: "Backend Engineer",
      matched_skills: ["Node.js"],
      missing_skills: ["Kotlin"],
    });
    const profile: Profile = {
      id: "user-1",
      full_name: "Jane Doe",
      email: null,
      phone: null,
      location: null,
      current_title: "Software Engineer",
      experience_level: "mid",
      years_experience: 4,
      skills: ["Node.js", "TypeScript"],
      industries: null,
      work_experience: null,
      education: null,
      job_titles_seeking: null,
      remote_preference: null,
      preferred_locations: null,
      salary_expectation: null,
      cover_letter_tone: null,
      linkedin_url: null,
      portfolio_url: null,
      work_authorization: null,
      resume_pdf_url: null,
      resume_pdf_key: null,
      resume_pdf_filename: null,
      linkedin_connected: false,
      is_tailored: false,
      is_complete: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { insforge } = buildInsforgeMock({ job, profile });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    await researchCompany("job-1", "user-1");

    const userMessage = mockCreate.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("Backend Engineer");
    expect(userMessage).toContain("Node.js");
    expect(userMessage).toContain("Kotlin");
    expect(userMessage).toContain("Software Engineer"); // profile.current_title
    expect(userMessage).toContain("4 years");
  });
});

// ---------------------------------------------------------------------------
// Persistence + return value
// ---------------------------------------------------------------------------

describe("researchCompany — persistence and return value", () => {
  it("persists the dossier to jobs.company_research scoped by id and user_id", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge, jobsUpdateChain } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    const { dossier } = await researchCompany("job-1", "user-1");

    expect(jobsUpdateChain.update).toHaveBeenCalledWith({ company_research: dossier });
    const eqCalls = jobsUpdateChain.eq.mock.calls;
    expect(eqCalls).toContainEqual(["id", "job-1"]);
    expect(eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("returns the dossier and the company name from the job record", async () => {
    const job = makeJob({ company: "Stripe", external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);
    vi.mocked(createHyperbrowserSession).mockResolvedValue(makeFakeHyperbrowser() as never);
    const { stagehand } = makeFakeStagehand();
    stagehand.extract.mockResolvedValue({});
    vi.mocked(createStagehand).mockResolvedValue(stagehand as never);

    const result = await researchCompany("job-1", "user-1");

    expect(result.company).toBe("Stripe");
    expect(result.dossier.companyOverview).toBe(FULL_DOSSIER_JSON.companyOverview);
  });

  it("returns company: null when the job has no company set", async () => {
    const job = makeJob({ company: null, external_apply_url: null, source_url: null });
    const { insforge } = buildInsforgeMock({ job, profile: null });
    vi.mocked(createInsforgeServer).mockResolvedValue(insforge as never);

    const result = await researchCompany("job-1", "user-1");

    expect(result.company).toBeNull();
  });
});