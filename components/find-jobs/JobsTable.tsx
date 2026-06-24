"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, Building2 } from "lucide-react";

import { MATCH_THRESHOLD } from "@/lib/utils";
import type { Job } from "@/types/index";

const PAGE_SIZE = 6;

const inputCls =
  "w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent";

const selectCls =
  "appearance-none bg-surface border border-border rounded-md pl-3 pr-8 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer";

function getMatchBarColor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 80) return "var(--color-info-medium)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-text-muted)";
}

function formatRelativeDate(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${Math.floor(diffHours)} hours ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function MatchScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1 bg-border-light rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: getMatchBarColor(score) }}
        />
      </div>
      <span className="text-sm font-medium text-text-primary">{score}%</span>
    </div>
  );
}

type MatchFilter = "all" | "high" | "low";
type Sort = "score" | "newest" | "oldest";

type Props = {
  jobs: Job[];
};

export function JobsTable({ jobs }: Props) {
  const [filterText, setFilterText] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let result = [...jobs];

    if (matchFilter === "high") {
      result = result.filter((j) => (j.match_score ?? 0) >= MATCH_THRESHOLD);
    } else if (matchFilter === "low") {
      result = result.filter((j) => (j.match_score ?? 0) < MATCH_THRESHOLD);
    }

    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      result = result.filter(
        (j) =>
          j.company?.toLowerCase().includes(q) ||
          j.title?.toLowerCase().includes(q),
      );
    }

    if (sort === "score") {
      result.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
    } else if (sort === "newest") {
      result.sort(
        (a, b) =>
          new Date(b.found_at).getTime() - new Date(a.found_at).getTime(),
      );
    } else {
      result.sort(
        (a, b) =>
          new Date(a.found_at).getTime() - new Date(b.found_at).getTime(),
      );
    }

    return result;
  }, [jobs, matchFilter, filterText, sort]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const pageNumbers = useMemo((): (number | "...")[] => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    return [1, 2, 3, "...", totalPages];
  }, [totalPages]);

  function handleFilterChange(value: MatchFilter) {
    setMatchFilter(value);
    setPage(1);
  }

  function handleSortChange(value: Sort) {
    setSort(value);
    setPage(1);
  }

  function handleTextChange(value: string) {
    setFilterText(value);
    setPage(1);
  }

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm">
      {/* Filter bar */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            size={14}
          />
          <input
            type="text"
            placeholder="Filter by company or role..."
            value={filterText}
            onChange={(e) => handleTextChange(e.target.value)}
            className={inputCls}
          />
        </div>

        <div className="relative">
          <select
            value={matchFilter}
            onChange={(e) => handleFilterChange(e.target.value as MatchFilter)}
            className={selectCls}
          >
            <option value="all">All Matches</option>
            <option value="high">High Match</option>
            <option value="low">Low Match</option>
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            size={14}
          />
        </div>

        <div className="relative">
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as Sort)}
            className={selectCls}
          >
            <option value="score">Match Score</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            size={14}
          />
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
              Company
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
              Role
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
              Match Score
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
              Salary Est.
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
              Date Found
            </th>
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="px-6 py-12 text-center text-sm text-text-muted"
              >
                No jobs match your filters.
              </td>
            </tr>
          ) : (
            pageItems.map((job) => (
              <tr
                key={job.id}
                className="border-t border-border hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0">
                      <Building2 size={16} className="text-text-muted" />
                    </div>
                    <span className="text-sm font-semibold text-text-primary">
                      {job.company ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-text-primary">
                  {job.title ?? "—"}
                </td>
                <td className="px-6 py-4">
                  <MatchScoreBar score={job.match_score ?? 0} />
                </td>
                <td className="px-6 py-4 text-sm text-text-primary">
                  {job.salary ?? "—"}
                </td>
                <td className="px-6 py-4 text-sm text-text-muted">
                  {formatRelativeDate(job.found_at)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-border">
        <p className="text-sm text-text-secondary">
          {totalCount === 0 ? (
            "No results"
          ) : (
            <>
              Showing{" "}
              <span className="font-semibold text-text-primary">
                {startIdx + 1}
              </span>{" "}
              to{" "}
              <span className="font-semibold text-text-primary">
                {Math.min(startIdx + PAGE_SIZE, totalCount)}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-text-primary">
                {totalCount}
              </span>{" "}
              results
            </>
          )}
        </p>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="px-3 py-1.5 text-sm rounded-md text-text-primary hover:bg-surface-secondary transition-colors disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Previous
          </button>

          {pageNumbers.map((p, i) =>
            p === "..." ? (
              <span
                key={`ellipsis-${i}`}
                className="px-2 text-sm text-text-muted"
              >
                ...
              </span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p as number)}
                className={`w-8 h-8 text-sm rounded-md transition-colors ${
                  safePage === p
                    ? "bg-accent text-accent-foreground"
                    : "text-text-primary hover:bg-surface-secondary"
                }`}
              >
                {p}
              </button>
            ),
          )}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="px-3 py-1.5 text-sm rounded-md text-text-primary hover:bg-surface-secondary transition-colors disabled:text-text-muted disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
