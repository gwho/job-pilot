import { describe, expect, it } from "vitest";

import {
  canonicalJobUrl,
  jobsDbSearchUrl,
} from "@/apify/jobsdb-hk-actor/src/urls";

describe("JobsDB actor URL helpers", () => {
  it("builds SEO search URLs from the typed query and location", () => {
    expect(jobsDbSearchUrl("sales coordinator", "Hong Kong")).toBe(
      "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong",
    );
  });

  it("omits location path when no location is provided", () => {
    expect(jobsDbSearchUrl("sales coordinator", "")).toBe(
      "https://hk.jobsdb.com/sales-coordinator-jobs",
    );
  });

  it("adds pagination query params after the SEO path", () => {
    expect(jobsDbSearchUrl("sales coordinator", "Hong Kong", 2)).toBe(
      "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong?page=2",
    );
  });

  it("canonicalizes job URLs by stripping tracking params and hash fragments", () => {
    expect(
      canonicalJobUrl(
        "https://hk.jobsdb.com/job/88338570?type=standard&ref=search#sol=abc",
      ),
    ).toBe("https://hk.jobsdb.com/job/88338570");
  });
});
