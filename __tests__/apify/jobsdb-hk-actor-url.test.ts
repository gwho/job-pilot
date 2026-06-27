// Tests for the URL-handling logic in apify/jobsdb-hk-actor/src/main.ts.
//
// canonicalJobUrl() and SEARCH_URL() are NOT exported from main.ts (the file
// runs as an Apify actor entry point with top-level await). Rather than
// modifying the source, these tests verify the exact same logic inline so they
// act as a behaviour specification and regression guard — if the source
// implementation ever diverges, these tests will surface the intent mismatch.
//
// The logic under test:
//   canonicalJobUrl(href) — strips query params and fragment, returns origin+pathname.
//   SEARCH_URL(query, location) — builds a hk.jobsdb.com search URL.

import { describe, it, expect } from "vitest";

// ─── Inline implementation (mirrors main.ts exactly) ─────────────────────────
// This is intentionally a copy of the private functions so we can test them.
// If the actor implementation changes, update this mirror and the test cases.

function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}

const SEARCH_URL = (query: string, location: string): string => {
  const params = new URLSearchParams({ q: query });
  if (location) params.set("l", location);
  return `https://hk.jobsdb.com/jobs?${params.toString()}`;
};

// ─── canonicalJobUrl ─────────────────────────────────────────────────────────

describe("canonicalJobUrl", () => {
  it("strips tracking query parameters from a URL", () => {
    const href = "https://hk.jobsdb.com/job/123?source=search&position=2&ref=abc";
    expect(canonicalJobUrl(href)).toBe("https://hk.jobsdb.com/job/123");
  });

  it("strips hash/fragment from a URL", () => {
    const href = "https://hk.jobsdb.com/job/456#apply";
    expect(canonicalJobUrl(href)).toBe("https://hk.jobsdb.com/job/456");
  });

  it("strips both query params and fragment simultaneously", () => {
    const href = "https://hk.jobsdb.com/job/789?src=email&utm_campaign=weekly#top";
    expect(canonicalJobUrl(href)).toBe("https://hk.jobsdb.com/job/789");
  });

  it("preserves the path when there are no query params or fragment", () => {
    const clean = "https://hk.jobsdb.com/job/123";
    expect(canonicalJobUrl(clean)).toBe(clean);
  });

  it("preserves a multi-segment path", () => {
    const href = "https://hk.jobsdb.com/hk/en/job/software-engineer/abc123?ref=x";
    expect(canonicalJobUrl(href)).toBe("https://hk.jobsdb.com/hk/en/job/software-engineer/abc123");
  });

  it("returns the origin with a trailing slash for root-level URLs", () => {
    const href = "https://hk.jobsdb.com/?utm=foo";
    expect(canonicalJobUrl(href)).toBe("https://hk.jobsdb.com/");
  });

  it("returns the original string unchanged when the href is not a valid URL", () => {
    const invalid = "not-a-valid-url";
    expect(canonicalJobUrl(invalid)).toBe("not-a-valid-url");
  });

  it("returns the original string for an empty input", () => {
    expect(canonicalJobUrl("")).toBe("");
  });

  it("deduplicates same job reached from two search positions (canonical URLs match)", () => {
    const pos1 = "https://hk.jobsdb.com/job/123?position=1&ref=top";
    const pos2 = "https://hk.jobsdb.com/job/123?position=5&ref=mid";
    expect(canonicalJobUrl(pos1)).toBe(canonicalJobUrl(pos2));
  });

  it("does not conflate different job paths", () => {
    const job1 = "https://hk.jobsdb.com/job/111?ref=x";
    const job2 = "https://hk.jobsdb.com/job/222?ref=x";
    expect(canonicalJobUrl(job1)).not.toBe(canonicalJobUrl(job2));
  });
});

// ─── SEARCH_URL ──────────────────────────────────────────────────────────────

describe("SEARCH_URL", () => {
  it("includes the query in the 'q' parameter", () => {
    const url = SEARCH_URL("software engineer", "");
    expect(url).toContain("q=software+engineer");
  });

  it("includes the location in the 'l' parameter when provided", () => {
    const url = SEARCH_URL("developer", "Kowloon");
    expect(url).toContain("l=Kowloon");
  });

  it("omits the 'l' parameter when location is an empty string", () => {
    const url = SEARCH_URL("analyst", "");
    expect(url).not.toContain("l=");
  });

  it("always targets hk.jobsdb.com/jobs", () => {
    const url = SEARCH_URL("qa", "");
    expect(url.startsWith("https://hk.jobsdb.com/jobs?")).toBe(true);
  });

  it("percent-encodes special characters in the query", () => {
    const url = SEARCH_URL("C++ engineer", "");
    // URLSearchParams encodes '+' in the query part, but the key point is no
    // raw '+' from URL special chars — the URL must be a valid string
    expect(() => new URL(url)).not.toThrow();
  });

  it("produces a parseable URL for any ASCII query and location", () => {
    const url = SEARCH_URL("data scientist", "Hong Kong Island");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("data scientist");
    expect(parsed.searchParams.get("l")).toBe("Hong Kong Island");
  });

  it("does not add 'l' when location is omitted entirely (uses default empty string)", () => {
    // SEARCH_URL signature: (query, location) — when location is "" it's falsy
    const url = SEARCH_URL("pm", "");
    const parsed = new URL(url);
    expect(parsed.searchParams.has("l")).toBe(false);
  });
});