/**
 * Supplementary edge-case tests for lib/find-jobs-utils.
 *
 * The PR's utils.test.ts covers the main happy-path and common invalid-input
 * cases. This file adds boundary, regression, and adversarial cases that
 * strengthen confidence without duplicating existing coverage.
 */
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
// parseMatch — boundary / adversarial
// ---------------------------------------------------------------------------
describe("parseMatch — additional edge cases", () => {
  it("returns 'all' for whitespace-only string", () => {
    expect(parseMatch(" ")).toBe("all");
    expect(parseMatch("  all  ")).toBe("all"); // trimmed form should NOT match
  });

  it("returns 'all' for numeric strings", () => {
    expect(parseMatch("0")).toBe("all");
    expect(parseMatch("1")).toBe("all");
  });

  it("returns 'all' for mixed-case valid strings", () => {
    expect(parseMatch("All")).toBe("all");
    expect(parseMatch("High")).toBe("all");
    expect(parseMatch("LOW")).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// parseSort — boundary / adversarial
// ---------------------------------------------------------------------------
describe("parseSort — additional edge cases", () => {
  it("returns 'score' for whitespace-only string", () => {
    expect(parseSort(" ")).toBe("score");
  });

  it("returns 'score' for mixed-case valid strings", () => {
    expect(parseSort("Score")).toBe("score");
    expect(parseSort("NEWEST")).toBe("score");
    expect(parseSort("Oldest")).toBe("score");
  });

  it("returns 'score' for a valid value with leading/trailing whitespace", () => {
    expect(parseSort(" score ")).toBe("score");
  });
});

// ---------------------------------------------------------------------------
// parsePage — boundary / adversarial
// ---------------------------------------------------------------------------
describe("parsePage — additional edge cases", () => {
  it("returns 1 for Infinity string", () => {
    expect(parsePage("Infinity")).toBe(1);
  });

  it("returns 1 for NaN string", () => {
    expect(parsePage("NaN")).toBe(1);
  });

  it("parses a large valid page number", () => {
    expect(parsePage("1000000")).toBe(1000000);
  });

  it("returns 1 for a float string (parseInt truncates, then checks > 0)", () => {
    // parseInt("1.9") === 1 which is finite and > 0, so it returns 1
    expect(parsePage("1.9")).toBe(1);
    // parseInt("0.5") === 0 which is not > 0, so it returns 1
    expect(parsePage("0.5")).toBe(1);
  });

  it("returns 1 for a string starting with a negative sign", () => {
    expect(parsePage("-100")).toBe(1);
  });

  it("handles string with leading zeros", () => {
    // parseInt("007") === 7 in non-octal contexts
    expect(parsePage("007")).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// parseQ — boundary / adversarial
// ---------------------------------------------------------------------------
describe("parseQ — additional edge cases", () => {
  it("preserves whitespace-only strings as-is", () => {
    expect(parseQ("   ")).toBe("   ");
  });

  it("preserves special characters and symbols", () => {
    expect(parseQ("C++ engineer")).toBe("C++ engineer");
    expect(parseQ("react&next.js")).toBe("react&next.js");
  });

  it("preserves Unicode characters", () => {
    expect(parseQ("软件工程师")).toBe("软件工程师");
  });

  it("preserves a very long string", () => {
    const long = "a".repeat(1000);
    expect(parseQ(long)).toBe(long);
  });
});

// ---------------------------------------------------------------------------
// buildPageNumbers — boundary / regression
// ---------------------------------------------------------------------------
describe("buildPageNumbers — additional edge cases", () => {
  it("returns [1] for a single page (totalPages=1, safePage=1)", () => {
    expect(buildPageNumbers(1, 1)).toEqual([1]);
  });

  it("returns all pages for exactly 5 pages (boundary condition)", () => {
    expect(buildPageNumbers(5, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageNumbers(5, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageNumbers(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });

  it("switches to windowed mode at exactly 6 pages", () => {
    // totalPages=6, safePage=1 → neighbours: {1, 6, 1, 0(filtered), 2} → sorted: [1,2,6]
    // gap between 2 and 6 → [1, 2, ..., 6]
    const pages = buildPageNumbers(6, 1);
    expect(pages).toContain("...");
  });

  it("current page is always present in the output regardless of position", () => {
    // Regression: old logic showed [1,2,3,...,N] — current page was absent when >3
    for (const safePage of [4, 5, 6, 7, 8]) {
      const pages = buildPageNumbers(20, safePage);
      expect(pages).toContain(safePage);
    }
  });

  it("output never has consecutive ellipsis entries", () => {
    // Algorithm should never produce ['...', '...'] adjacent
    for (const safePage of [1, 3, 7, 10, 17, 20]) {
      const pages = buildPageNumbers(20, safePage);
      for (let i = 0; i < pages.length - 1; i++) {
        expect(
          pages[i] === "..." && pages[i + 1] === "...",
          `Consecutive ellipsis at positions ${i} and ${i + 1} for safePage=${safePage}`,
        ).toBe(false);
      }
    }
  });

  it("first element is always 1 and last element is always totalPages", () => {
    for (const safePage of [1, 5, 10, 15, 20]) {
      const pages = buildPageNumbers(20, safePage);
      expect(pages[0]).toBe(1);
      expect(pages[pages.length - 1]).toBe(20);
    }
  });

  it("produces exactly [1, ..., last] for safePage=1 on a long list", () => {
    // safePage=1: neighbours={1, 20, 1, 0(filtered), 2} → [1, 2, ..., 20]
    const pages = buildPageNumbers(20, 1);
    expect(pages[0]).toBe(1);
    expect(pages[1]).toBe(2);
    expect(pages[2]).toBe("...");
    expect(pages[pages.length - 1]).toBe(20);
  });

  it("produces exactly [1, ..., last-1, last] for safePage=last on a long list", () => {
    // safePage=20: neighbours={1, 20, 20, 19, 21(filtered)} → [1, ..., 19, 20]
    const pages = buildPageNumbers(20, 20);
    expect(pages[0]).toBe(1);
    expect(pages[1]).toBe("...");
    expect(pages[pages.length - 2]).toBe(19);
    expect(pages[pages.length - 1]).toBe(20);
  });

  it("returns sorted numeric pages with no repeated numbers", () => {
    const pages = buildPageNumbers(20, 10);
    const nums = pages.filter((p) => p !== "...") as number[];
    const unique = new Set(nums);
    expect(unique.size).toBe(nums.length);
    // Verify sorted ascending
    for (let i = 0; i < nums.length - 1; i++) {
      expect(nums[i]).toBeLessThan(nums[i + 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeJobsById — boundary / ordering
// ---------------------------------------------------------------------------
describe("mergeJobsById — additional edge cases", () => {
  it("preserves the relative order of existing jobs not overwritten", () => {
    const current = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ];
    const incoming = [{ id: "d", title: "D" }];
    const result = mergeJobsById(current, incoming);
    // a, b, c come first (insertion order from Map) then d
    const ids = result.map((j) => j.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("appends incoming-only items after current items", () => {
    const current = [{ id: "a", title: "A" }];
    const incoming = [{ id: "b", title: "B" }];
    const result = mergeJobsById(current, incoming);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });

  it("does not mutate the current array", () => {
    const current = [{ id: "a", title: "A" }];
    const incoming = [{ id: "b", title: "B" }];
    const originalLength = current.length;
    mergeJobsById(current, incoming);
    expect(current).toHaveLength(originalLength);
  });

  it("does not mutate the incoming array", () => {
    const current = [{ id: "a", title: "A" }];
    const incoming = [{ id: "b", title: "B" }];
    const originalLength = incoming.length;
    mergeJobsById(current, incoming);
    expect(incoming).toHaveLength(originalLength);
  });

  it("handles both arrays empty", () => {
    expect(mergeJobsById([], [])).toEqual([]);
  });

  it("incoming duplicates last one wins when there are multiple incoming items with same id", () => {
    // Unusual but defensive: incoming array itself has duplicate ids
    const current: { id: string; title: string }[] = [];
    const incoming = [
      { id: "a", title: "First" },
      { id: "a", title: "Second" },
    ];
    const result = mergeJobsById(current, incoming);
    // Map iteration: second insert wins
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Second");
  });

  it("works with generic objects beyond Job — only requires id field", () => {
    const current = [{ id: "x", foo: 1, bar: "old" }];
    const incoming = [{ id: "x", foo: 2, bar: "new" }];
    const result = mergeJobsById(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].foo).toBe(2);
    expect(result[0].bar).toBe("new");
  });
});