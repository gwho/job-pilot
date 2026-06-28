import { describe, it, expect } from "vitest";
import {
  parseMatch,
  parseSort,
  parsePage,
  parseQ,
  buildPageNumbers,
  mergeJobsById,
} from "@/lib/find-jobs-utils";

// ---------------------------------------------------------------------------
// parseMatch
// ---------------------------------------------------------------------------
describe("parseMatch", () => {
  it("returns valid match values unchanged", () => {
    expect(parseMatch("all")).toBe("all");
    expect(parseMatch("high")).toBe("high");
    expect(parseMatch("low")).toBe("low");
  });

  it("returns 'all' for null", () => {
    expect(parseMatch(null)).toBe("all");
  });

  it("returns 'all' for invalid strings", () => {
    expect(parseMatch("medium")).toBe("all");
    expect(parseMatch("")).toBe("all");
    expect(parseMatch("HIGH")).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// parseSort
// ---------------------------------------------------------------------------
describe("parseSort", () => {
  it("returns valid sort values unchanged", () => {
    expect(parseSort("score")).toBe("score");
    expect(parseSort("newest")).toBe("newest");
    expect(parseSort("oldest")).toBe("oldest");
  });

  it("returns 'score' for null", () => {
    expect(parseSort(null)).toBe("score");
  });

  it("returns 'score' for invalid strings", () => {
    expect(parseSort("date")).toBe("score");
    expect(parseSort("")).toBe("score");
  });
});

// ---------------------------------------------------------------------------
// parsePage
// ---------------------------------------------------------------------------
describe("parsePage", () => {
  it("parses valid positive integers", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("5")).toBe(5);
    expect(parsePage("99")).toBe(99);
  });

  it("returns 1 for null", () => {
    expect(parsePage(null)).toBe(1);
  });

  it("returns 1 for zero and negative values", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-1")).toBe(1);
  });

  it("returns 1 for non-numeric strings", () => {
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("1.5")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parseQ
// ---------------------------------------------------------------------------
describe("parseQ", () => {
  it("returns the string as-is", () => {
    expect(parseQ("react")).toBe("react");
    expect(parseQ("")).toBe("");
  });

  it("returns empty string for null", () => {
    expect(parseQ(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildPageNumbers
// ---------------------------------------------------------------------------
describe("buildPageNumbers", () => {
  it("returns all pages when total is 5 or fewer", () => {
    expect(buildPageNumbers(3, 2)).toEqual([1, 2, 3]);
    expect(buildPageNumbers(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });

  it("always includes the current page", () => {
    const pages = buildPageNumbers(20, 10);
    expect(pages).toContain(10);
  });

  it("always includes page 1 and the last page", () => {
    const pages = buildPageNumbers(20, 10);
    expect(pages[0]).toBe(1);
    expect(pages[pages.length - 1]).toBe(20);
  });

  it("includes current ± 1 neighbours", () => {
    const pages = buildPageNumbers(20, 10);
    expect(pages).toContain(9);
    expect(pages).toContain(11);
  });

  it("inserts ellipsis for gaps", () => {
    const pages = buildPageNumbers(20, 10);
    expect(pages).toContain("...");
    // Should have two ellipsis groups: [1, ..., 9, 10, 11, ..., 20]
    expect(pages.filter((p) => p === "...").length).toBe(2);
  });

  it("no ellipsis when current is near page 1", () => {
    // [1, 2, 3, ..., 20] — only one gap
    const pages = buildPageNumbers(20, 2);
    expect(pages.filter((p) => p === "...").length).toBe(1);
  });

  it("no ellipsis when current is near last page", () => {
    const pages = buildPageNumbers(20, 19);
    expect(pages.filter((p) => p === "...").length).toBe(1);
  });

  it("handles single page", () => {
    expect(buildPageNumbers(1, 1)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// mergeJobsById
// ---------------------------------------------------------------------------
describe("mergeJobsById", () => {
  it("preserves existing jobs not in the incoming batch", () => {
    const current = [{ id: "a", title: "Old A" }];
    const incoming = [{ id: "b", title: "New B" }];
    const result = mergeJobsById(current, incoming);
    expect(result).toHaveLength(2);
    expect(result.find((j) => j.id === "a")).toBeTruthy();
    expect(result.find((j) => j.id === "b")).toBeTruthy();
  });

  it("overwrites existing jobs with incoming data on id collision", () => {
    const current = [{ id: "a", title: "Old A" }];
    const incoming = [{ id: "a", title: "New A" }];
    const result = mergeJobsById(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("New A");
  });

  it("handles empty current list", () => {
    const incoming = [{ id: "a", title: "A" }];
    const result = mergeJobsById([], incoming);
    expect(result).toEqual(incoming);
  });

  it("handles empty incoming list", () => {
    const current = [{ id: "a", title: "A" }];
    const result = mergeJobsById(current, []);
    expect(result).toEqual(current);
  });

  it("deduplicates multiple collisions", () => {
    const current = [
      { id: "a", title: "Old A" },
      { id: "b", title: "Old B" },
    ];
    const incoming = [
      { id: "a", title: "New A" },
      { id: "c", title: "New C" },
    ];
    const result = mergeJobsById(current, incoming);
    expect(result).toHaveLength(3);
    expect(result.find((j) => j.id === "a")?.title).toBe("New A");
    expect(result.find((j) => j.id === "b")?.title).toBe("Old B");
    expect(result.find((j) => j.id === "c")?.title).toBe("New C");
  });
});
