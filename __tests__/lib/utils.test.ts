import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MATCH_THRESHOLD,
  getMatchBarColor,
  formatRelativeDate,
} from "@/lib/utils";

describe("MATCH_THRESHOLD", () => {
  it("equals 70", () => {
    expect(MATCH_THRESHOLD).toBe(70);
  });
});

describe("getMatchBarColor", () => {
  it("returns success color for score >= 90", () => {
    expect(getMatchBarColor(90)).toBe("var(--color-success)");
    expect(getMatchBarColor(95)).toBe("var(--color-success)");
    expect(getMatchBarColor(100)).toBe("var(--color-success)");
  });

  it("returns info-medium color for score >= 80 and < 90", () => {
    expect(getMatchBarColor(80)).toBe("var(--color-info-medium)");
    expect(getMatchBarColor(85)).toBe("var(--color-info-medium)");
    expect(getMatchBarColor(89)).toBe("var(--color-info-medium)");
  });

  it("returns warning color for score >= 50 and < 80", () => {
    expect(getMatchBarColor(50)).toBe("var(--color-warning)");
    expect(getMatchBarColor(70)).toBe("var(--color-warning)");
    expect(getMatchBarColor(79)).toBe("var(--color-warning)");
  });

  it("returns text-muted color for score < 50", () => {
    expect(getMatchBarColor(0)).toBe("var(--color-text-muted)");
    expect(getMatchBarColor(49)).toBe("var(--color-text-muted)");
  });

  it("handles boundary at exactly 90", () => {
    expect(getMatchBarColor(90)).toBe("var(--color-success)");
  });

  it("handles boundary at exactly 80", () => {
    expect(getMatchBarColor(80)).toBe("var(--color-info-medium)");
  });

  it("handles boundary at exactly 50", () => {
    expect(getMatchBarColor(50)).toBe("var(--color-warning)");
  });
});

describe("formatRelativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Just now' when less than 1 hour ago", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-25T11:30:00.000Z").toISOString(); // 30 min ago
    expect(formatRelativeDate(dateStr)).toBe("Just now");
  });

  it("returns 'Just now' for zero seconds ago", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    expect(formatRelativeDate(now.toISOString())).toBe("Just now");
  });

  it("returns hours ago when 1-23 hours ago", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-25T10:00:00.000Z").toISOString(); // 2 hours ago
    expect(formatRelativeDate(dateStr)).toBe("2 hours ago");
  });

  it("returns correct hours for multiple hours", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-24T17:00:00.000Z").toISOString(); // 19 hours ago
    expect(formatRelativeDate(dateStr)).toBe("19 hours ago");
  });

  it("returns 'Yesterday' when exactly 1 day ago", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-24T12:00:00.000Z").toISOString(); // exactly 24h ago
    expect(formatRelativeDate(dateStr)).toBe("Yesterday");
  });

  it("returns days ago for multiple days", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-22T12:00:00.000Z").toISOString(); // 3 days ago
    expect(formatRelativeDate(dateStr)).toBe("3 days ago");
  });

  it("returns days ago for 2 days", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-23T12:00:00.000Z").toISOString(); // 2 days ago
    expect(formatRelativeDate(dateStr)).toBe("2 days ago");
  });

  it("handles boundary at exactly 23 hours (just under 1 day)", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    vi.setSystemTime(now);
    const dateStr = new Date("2026-06-24T13:00:00.000Z").toISOString(); // 23 hours ago
    expect(formatRelativeDate(dateStr)).toBe("23 hours ago");
  });
});