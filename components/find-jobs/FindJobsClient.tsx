"use client";

import { useState, useMemo } from "react";

import { MATCH_THRESHOLD } from "@/lib/utils";
import { SearchControls } from "./SearchControls";
import { JobFilters, type MatchFilter, type Sort } from "./JobFilters";
import { JobsTable } from "./JobsTable";
import { JobsPagination } from "./JobsPagination";
import type { Job } from "@/types/index";

const PAGE_SIZE = 6;

type SearchStatus = {
  jobsFound: number;
  strongMatches: number;
};

type Props = {
  initialJobs: Job[];
};

export function FindJobsClient({ initialJobs }: Props) {
  // Search state — owned here so a search can update the table without a reload.
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  // View state — filter / sort / pagination over the current jobs.
  const [filterText, setFilterText] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [page, setPage] = useState(1);

  async function handleSearch() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/agent/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle, location }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error("[FindJobsClient] search failed:", data?.error);
        return;
      }

      setJobs(data.jobs as Job[]);
      setSearchStatus({
        jobsFound: data.jobsFound,
        strongMatches: data.strongMatches,
      });
      setPage(1);
    } catch (error) {
      console.error("[FindJobsClient] search error:", error);
    } finally {
      setIsLoading(false);
    }
  }

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

  function handleFilterTextChange(value: string) {
    setFilterText(value);
    setPage(1);
  }

  function handleMatchFilterChange(value: MatchFilter) {
    setMatchFilter(value);
    setPage(1);
  }

  function handleSortChange(value: Sort) {
    setSort(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <SearchControls
        jobTitle={jobTitle}
        location={location}
        isLoading={isLoading}
        searchStatus={searchStatus}
        onJobTitleChange={setJobTitle}
        onLocationChange={setLocation}
        onSearch={handleSearch}
      />

      <div className="bg-surface border border-border rounded-2xl shadow-sm">
        <JobFilters
          filterText={filterText}
          matchFilter={matchFilter}
          sort={sort}
          onFilterTextChange={handleFilterTextChange}
          onMatchFilterChange={handleMatchFilterChange}
          onSortChange={handleSortChange}
        />
        <JobsTable jobs={pageItems} />
        <JobsPagination
          page={safePage}
          totalPages={totalPages}
          totalCount={totalCount}
          startIdx={startIdx}
          pageNumbers={pageNumbers}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
