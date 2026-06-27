// Tests for agent/jobsdb.ts
// Covers: discoverJobsDbJobs() normalization logic, toScoringInput() mapping.
// The external Apify actor (runJobsDbActor) is mocked so no network calls are
// made and no credentials are required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @/lib/apify before importing the module under test ─────────────────
vi.mock("@/lib/apify", () => ({
  runJobsDbActor: vi.fn(),
}));

import { discoverJobsDbJobs, toScoringInput, type JobsDbJob } from "@/agent/jobsdb";
import { runJobsDbActor } from "@/lib/apify";

const mockRunJobsDbActor = vi.mocked(runJobsDbActor);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a fully-populated JobsDbActorOutput object. */
function makeActorOutput(overrides: Partial<JobsDbJob> = {}): JobsDbJob {
  return {
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Hong Kong",
    salary: "HKD 25,000 – 35,000",
    jobType: "Full-time",
    description: "Build scalable systems.",
    sourceUrl: "https://hk.jobsdb.com/job/123",
    externalApplyUrl: "https://acme.com/careers/123",
    postedAt: "2024-01-15",
    ...overrides,
  };
}

// ─── toScoringInput ───────────────────────────────────────────────────────────

describe("toScoringInput", () => {
  it("maps all four ScoringInput fields from a fully-populated job", () => {
    const job = makeActorOutput();
    const result = toScoringInput(job);
    expect(result).toEqual({
      title: "Software Engineer",
      company: "Acme Corp",
      location: "Hong Kong",
      description: "Build scalable systems.",
    });
  });

  it("carries through empty-string fields when they are already normalised", () => {
    const job = makeActorOutput({ title: "", company: "", location: "", description: "" });
    const result = toScoringInput(job);
    expect(result).toEqual({ title: "", company: "", location: "", description: "" });
  });

  it("does NOT include salary, jobType, sourceUrl, externalApplyUrl, or postedAt", () => {
    const job = makeActorOutput();
    const result = toScoringInput(job);
    expect(result).not.toHaveProperty("salary");
    expect(result).not.toHaveProperty("jobType");
    expect(result).not.toHaveProperty("sourceUrl");
    expect(result).not.toHaveProperty("externalApplyUrl");
    expect(result).not.toHaveProperty("postedAt");
  });

  it("returns only the four required keys", () => {
    const job = makeActorOutput();
    const result = toScoringInput(job);
    expect(Object.keys(result).sort()).toEqual(["company", "description", "location", "title"]);
  });

  it("preserves multiline description text verbatim", () => {
    const description = "Line one.\nLine two.\n• Bullet point.";
    const job = makeActorOutput({ description });
    expect(toScoringInput(job).description).toBe(description);
  });
});

// ─── discoverJobsDbJobs ───────────────────────────────────────────────────────

describe("discoverJobsDbJobs", () => {
  beforeEach(() => {
    mockRunJobsDbActor.mockReset();
  });

  it("passes query, location, and maxItems to the actor", async () => {
    mockRunJobsDbActor.mockResolvedValue([]);
    await discoverJobsDbJobs("engineer", "Kowloon", 5);
    expect(mockRunJobsDbActor).toHaveBeenCalledOnce();
    expect(mockRunJobsDbActor).toHaveBeenCalledWith({
      query: "engineer",
      location: "Kowloon",
      maxItems: 5,
    });
  });

  it("uses a default maxItems of 10 when not specified", async () => {
    mockRunJobsDbActor.mockResolvedValue([]);
    await discoverJobsDbJobs("developer", "");
    expect(mockRunJobsDbActor).toHaveBeenCalledWith(
      expect.objectContaining({ maxItems: 10 }),
    );
  });

  it("returns an empty array when the actor returns no results", async () => {
    mockRunJobsDbActor.mockResolvedValue([]);
    const jobs = await discoverJobsDbJobs("niche role", "Remote");
    expect(jobs).toEqual([]);
  });

  it("returns one normalised job per actor output item", async () => {
    const actorItem = makeActorOutput();
    mockRunJobsDbActor.mockResolvedValue([actorItem]);
    const jobs = await discoverJobsDbJobs("engineer", "HK");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(actorItem); // all fields already valid — no normalisation needed
  });

  it("normalises null title to empty string", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ title: null as unknown as string })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.title).toBe("");
  });

  it("normalises null company to empty string", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ company: null as unknown as string })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.company).toBe("");
  });

  it("normalises null location to empty string", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ location: null as unknown as string })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.location).toBe("");
  });

  it("normalises null description to empty string", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ description: null as unknown as string })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.description).toBe("");
  });

  it("normalises null sourceUrl to empty string", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ sourceUrl: null as unknown as string })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.sourceUrl).toBe("");
  });

  it("preserves null salary (nullable field stays null)", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ salary: null })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.salary).toBeNull();
  });

  it("preserves null jobType (nullable field stays null)", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ jobType: null })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.jobType).toBeNull();
  });

  it("preserves null externalApplyUrl (nullable field stays null)", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ externalApplyUrl: null })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.externalApplyUrl).toBeNull();
  });

  it("preserves null postedAt (nullable field stays null)", async () => {
    mockRunJobsDbActor.mockResolvedValue([makeActorOutput({ postedAt: null })]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.postedAt).toBeNull();
  });

  it("handles a mix of null and valid fields in the same item", async () => {
    mockRunJobsDbActor.mockResolvedValue([
      makeActorOutput({
        title: null as unknown as string,
        salary: null,
        jobType: null,
        externalApplyUrl: null,
        postedAt: null,
      }),
    ]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.title).toBe("");
    expect(job.salary).toBeNull();
    expect(job.jobType).toBeNull();
    expect(job.externalApplyUrl).toBeNull();
    expect(job.postedAt).toBeNull();
  });

  it("normalises multiple items independently", async () => {
    mockRunJobsDbActor.mockResolvedValue([
      makeActorOutput({ title: "Role A" }),
      makeActorOutput({ title: null as unknown as string, company: "Acme" }),
    ]);
    const jobs = await discoverJobsDbJobs("q", "l", 2);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Role A");
    expect(jobs[1].title).toBe("");
    expect(jobs[1].company).toBe("Acme");
  });

  it("propagates errors thrown by the actor (caller handles them)", async () => {
    mockRunJobsDbActor.mockRejectedValue(new Error("Actor run FAILED (runId: abc123)"));
    await expect(discoverJobsDbJobs("q", "l")).rejects.toThrow("Actor run FAILED");
  });

  // Regression: undefined fields (actor returns partial object) normalise to '' / null
  it("normalises undefined title to empty string (regression guard)", async () => {
    const partial = makeActorOutput();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (partial as any).title;
    mockRunJobsDbActor.mockResolvedValue([partial]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.title).toBe("");
  });

  it("normalises undefined salary to null (regression guard)", async () => {
    const partial = makeActorOutput();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (partial as any).salary;
    mockRunJobsDbActor.mockResolvedValue([partial]);
    const [job] = await discoverJobsDbJobs("q", "l");
    expect(job.salary).toBeNull();
  });
});