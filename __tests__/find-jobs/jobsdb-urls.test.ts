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

describe("jobsDbSearchUrl — additional slug edge cases", () => {
  it("converts ampersand in query to 'and'", () => {
    expect(jobsDbSearchUrl("IT & consulting", "")).toBe(
      "https://hk.jobsdb.com/it-and-consulting-jobs",
    );
  });

  it("removes special characters (parentheses, slashes) from query", () => {
    // "c/c++ developer" → non-alphanumeric collapsed to single dash
    expect(jobsDbSearchUrl("c/c++ developer", "")).toMatch(
      /^https:\/\/hk\.jobsdb\.com\/c.*developer-jobs$/,
    );
  });

  it("collapses multiple spaces in query to single dash", () => {
    expect(jobsDbSearchUrl("sales  coordinator", "")).toBe(
      "https://hk.jobsdb.com/sales-coordinator-jobs",
    );
  });

  it("trims leading and trailing whitespace from query", () => {
    expect(jobsDbSearchUrl("  engineer  ", "")).toBe(
      "https://hk.jobsdb.com/engineer-jobs",
    );
  });

  it("converts location with spaces to dashes (preserving case)", () => {
    expect(jobsDbSearchUrl("developer", "New York")).toBe(
      "https://hk.jobsdb.com/developer-jobs/in-New-York",
    );
  });

  it("page=1 explicit produces the same URL as the default (no ?page=1)", () => {
    expect(jobsDbSearchUrl("engineer", "Hong Kong", 1)).toBe(
      jobsDbSearchUrl("engineer", "Hong Kong"),
    );
  });

  it("page=0 is treated the same as page=1 (no pagination suffix)", () => {
    expect(jobsDbSearchUrl("engineer", "Hong Kong", 0)).toBe(
      "https://hk.jobsdb.com/engineer-jobs/in-Hong-Kong",
    );
  });

  it("page=3 produces ?page=3 query param", () => {
    expect(jobsDbSearchUrl("sales coordinator", "Hong Kong", 3)).toBe(
      "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong?page=3",
    );
  });

  it("query is lowercased in the path slug", () => {
    expect(jobsDbSearchUrl("Frontend Engineer", "Hong Kong")).toBe(
      "https://hk.jobsdb.com/frontend-engineer-jobs/in-Hong-Kong",
    );
  });
});

describe("canonicalJobUrl — additional edge cases", () => {
  it("returns a clean URL unchanged (no query params or hash)", () => {
    expect(canonicalJobUrl("https://hk.jobsdb.com/job/12345")).toBe(
      "https://hk.jobsdb.com/job/12345",
    );
  });

  it("strips a hash fragment even when there are no query params", () => {
    expect(
      canonicalJobUrl("https://hk.jobsdb.com/job/12345#section"),
    ).toBe("https://hk.jobsdb.com/job/12345");
  });

  it("falls back to the original href when the URL is not parseable", () => {
    const invalid = "not-a-valid-url";
    expect(canonicalJobUrl(invalid)).toBe(invalid);
  });

  it("strips multiple tracking params, keeping only origin + pathname", () => {
    expect(
      canonicalJobUrl(
        "https://hk.jobsdb.com/job/99999?pos=1&ao=featured&sxsrf=xyz&ref=search",
      ),
    ).toBe("https://hk.jobsdb.com/job/99999");
  });

  it("deduplicates the same job appearing as featured and regular card", () => {
    const featured = "https://hk.jobsdb.com/job/111?pos=1&ao=featured&sxsrf=abc";
    const regular = "https://hk.jobsdb.com/job/111?pos=8&ao=regular&sxsrf=xyz";
    expect(canonicalJobUrl(featured)).toBe(canonicalJobUrl(regular));
  });
});
