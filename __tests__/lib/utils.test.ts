/**
 * Unit tests for lib/utils.ts.
 *
 * Scope: only `getIsoTimestampDaysAgo`, added in Feature 15 (Stats Bar — Real
 * Data) to compute the rolling 7-day cutoff for the "Jobs This Week" stat.
 * Pre-existing exports in this module (`getMatchBarColor`,
 * `formatRelativeDate`, `MATCH_THRESHOLD`) were not touched by this PR and
 * are intentionally left untested here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getIsoTimestampDaysAgo } from "@/lib/utils";

describe("getIsoTimestampDaysAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an ISO 8601 timestamp string", () => {
    const result = getIsoTimestampDaysAgo(7);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("returns a timestamp exactly N days before the current time", () => {
    const result = getIsoTimestampDaysAgo(7);
    expect(result).toBe("2026-06-26T12:00:00.000Z");
  });

  it("returns the current time when days is 0", () => {
    const result = getIsoTimestampDaysAgo(0);
    expect(result).toBe("2026-07-03T12:00:00.000Z");
  });

  it("handles fractional day values", () => {
    // 0.5 days = 12 hours
    const result = getIsoTimestampDaysAgo(0.5);
    expect(result).toBe("2026-07-03T00:00:00.000Z");
  });

  it("handles large day counts", () => {
    const result = getIsoTimestampDaysAgo(365);
    expect(result).toBe("2025-07-03T12:00:00.000Z");
  });

  it("produces a value parseable back into an equivalent Date", () => {
    const result = getIsoTimestampDaysAgo(1);
    expect(new Date(result).getTime()).toBe(
      new Date("2026-07-02T12:00:00.000Z").getTime(),
    );
  });

  it("moves further into the past as the day count increases", () => {
    const oneDayAgo = new Date(getIsoTimestampDaysAgo(1)).getTime();
    const sevenDaysAgo = new Date(getIsoTimestampDaysAgo(7)).getTime();
    expect(sevenDaysAgo).toBeLessThan(oneDayAgo);
  });
});