import type { MatchFilter, Sort } from "@/components/find-jobs/JobFilters";

export function parseMatch(raw: string | null): MatchFilter {
  return (["all", "high", "low"] as const).includes(raw as MatchFilter)
    ? (raw as MatchFilter)
    : "all";
}

export function parseSort(raw: string | null): Sort {
  return (["score", "newest", "oldest"] as const).includes(raw as Sort)
    ? (raw as Sort)
    : "score";
}

export function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function parseQ(raw: string | null): string {
  return raw ?? "";
}

export function buildPageNumbers(
  totalPages: number,
  safePage: number,
): (number | "...")[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const neighbours = new Set(
    [1, totalPages, safePage, safePage - 1, safePage + 1].filter(
      (p) => p >= 1 && p <= totalPages,
    ),
  );
  const sorted = [...neighbours].sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("...");
    result.push(sorted[i]);
  }
  return result;
}

export function mergeJobsById<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const merged = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) {
    merged.set(job.id, job);
  }
  return [...merged.values()];
}
