"use client";

import { ChevronDown, Search } from "lucide-react";

const inputCls =
  "w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent";

const selectCls =
  "appearance-none bg-surface border border-border rounded-md pl-3 pr-8 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer";

export type MatchFilter = "all" | "high" | "low";
export type Sort = "score" | "newest" | "oldest";

type Props = {
  filterText: string;
  matchFilter: MatchFilter;
  sort: Sort;
  onFilterTextChange: (value: string) => void;
  onMatchFilterChange: (value: MatchFilter) => void;
  onSortChange: (value: Sort) => void;
};

export function JobFilters({
  filterText,
  matchFilter,
  sort,
  onFilterTextChange,
  onMatchFilterChange,
  onSortChange,
}: Props) {
  return (
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
          onChange={(e) => onFilterTextChange(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="relative">
        <select
          value={matchFilter}
          onChange={(e) => onMatchFilterChange(e.target.value as MatchFilter)}
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
          onChange={(e) => onSortChange(e.target.value as Sort)}
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
  );
}
