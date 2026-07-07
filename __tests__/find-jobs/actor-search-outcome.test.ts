/**
 * Unit tests for the actor search-page classification helpers.
 *
 * These test the pure functions in apify/jobsdb-hk-actor/src/search-outcome.ts
 * that determine whether the actor should fail cleanly when the search page is
 * blocked, suspicious, or returns a legitimately empty result.
 *
 * Run: npm run test:run -- __tests__/find-jobs/actor-search-outcome.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  classifySearchPage,
  shouldFailRun,
  type SearchPageInput,
} from "@/apify/jobsdb-hk-actor/src/search-outcome";

describe("classifySearchPage", () => {
  const base: SearchPageInput = {
    url: "https://hk.jobsdb.com/sales-coordinator-jobs/in-Hong-Kong",
    cardCount: 0,
    hasKnownEmptySelector: false,
    hasEmptyTextFallback: false,
  };

  it("login redirect URL → 'login-redirect'", () => {
    expect(classifySearchPage({ ...base, url: "https://hk.jobsdb.com/login" })).toBe("login-redirect");
    expect(classifySearchPage({ ...base, url: "https://hk.jobsdb.com/sign-in?redirect=/jobs" })).toBe("login-redirect");
  });

  it("cards found → 'ok'", () => {
    expect(classifySearchPage({ ...base, cardCount: 10 })).toBe("ok");
    expect(classifySearchPage({ ...base, cardCount: 1 })).toBe("ok");
  });

  it("zero cards + known empty-state selector → 'legit-empty'", () => {
    expect(classifySearchPage({ ...base, hasKnownEmptySelector: true })).toBe("legit-empty");
  });

  it("zero cards + text fallback only (no known selector) → 'suspicious-empty'", () => {
    // Text fallback alone is not sufficient evidence; treat as suspicious
    expect(classifySearchPage({ ...base, hasEmptyTextFallback: true })).toBe("suspicious-empty");
  });

  it("zero cards + neither selector nor text → 'suspicious-empty'", () => {
    expect(classifySearchPage(base)).toBe("suspicious-empty");
  });
});

describe("shouldFailRun", () => {
  it("page-1 suspicious + no jobs pushed → true (should fail)", () => {
    expect(shouldFailRun({ page1Outcome: "suspicious-empty", jobsPushed: 0 })).toBe(true);
  });

  it("page-1 login-redirect + no jobs pushed → true (should fail)", () => {
    expect(shouldFailRun({ page1Outcome: "login-redirect", jobsPushed: 0 })).toBe(true);
  });

  it("page-1 ok + no jobs pushed → false (legit empty detail pages, not a page-1 failure)", () => {
    expect(shouldFailRun({ page1Outcome: "ok", jobsPushed: 0 })).toBe(false);
  });

  it("page-1 legit-empty + no jobs pushed → false (real no-results, not suspicious)", () => {
    expect(shouldFailRun({ page1Outcome: "legit-empty", jobsPushed: 0 })).toBe(false);
  });

  it("page-1 suspicious but jobs were pushed → false (search worked, details may have failed)", () => {
    // Shouldn't happen in practice; if we pushed jobs, the search wasn't truly blocked.
    expect(shouldFailRun({ page1Outcome: "suspicious-empty", jobsPushed: 3 })).toBe(false);
  });

  it("page-1 blocked-http + no jobs pushed → true (HTTP failure, no page loaded)", () => {
    expect(shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 0 })).toBe(true);
  });

  it("page-1 blocked-http but jobs were somehow pushed → false (safety valve)", () => {
    expect(shouldFailRun({ page1Outcome: "blocked-http", jobsPushed: 5 })).toBe(false);
  });
});
