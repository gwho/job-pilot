import { describe, it, expect } from "vitest";
import { MATCH_THRESHOLD } from "@/lib/utils";

describe("MATCH_THRESHOLD", () => {
  it("is exported as a number", () => {
    expect(typeof MATCH_THRESHOLD).toBe("number");
  });

  it("equals 70", () => {
    expect(MATCH_THRESHOLD).toBe(70);
  });

  it("is the boundary: a score of 70 meets or exceeds the threshold", () => {
    expect(70 >= MATCH_THRESHOLD).toBe(true);
  });

  it("is the boundary: a score of 69 falls below the threshold", () => {
    expect(69 >= MATCH_THRESHOLD).toBe(false);
  });

  it("is the boundary: a score of 71 exceeds the threshold", () => {
    expect(71 >= MATCH_THRESHOLD).toBe(true);
  });

  it("is a positive integer (valid percentage range)", () => {
    expect(MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(MATCH_THRESHOLD).toBeLessThanOrEqual(100);
    expect(Number.isInteger(MATCH_THRESHOLD)).toBe(true);
  });
});