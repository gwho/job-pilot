"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import { MATCH_THRESHOLD } from "@/lib/utils";
import {
  parseMatch,
  parseSort,
  parsePage,
  parseQ,
  buildPageNumbers,
} from "@/lib/find-jobs-utils";
import { SearchControls } from "./SearchControls";
import { JobFilters, type MatchFilter, type Sort } from "./JobFilters";
import { JobsTable } from "./JobsTable";
import { JobsPagination } from "./JobsPagination";
import type { Job } from "@/types/index";

const PAGE_SIZE = 20;

type SearchStatus = {
  message: string;
  isError?: boolean;
};

type Props = {
  initialJobs: Job[];
};

export function FindJobsClient({ initialJobs }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // View state — derived from URL on every render (single source of truth)
  const match = parseMatch(searchParams.get("match"));
  const sort = parseSort(searchParams.get("sort"));
  const page = parsePage(searchParams.get("page"));
  const q = parseQ(searchParams.get("q"));

  // Agent inputs — not URL state; refreshing must not re-trigger the actor
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  // Display state — local draft for the text input only
  const [filterTextDraft, setFilterTextDraft] = useState(q);

  // Sync draft when URL q changes externally (back/forward navigation).
  // Calling setState in an effect is intentional here: we are syncing an
  // external system (the URL) to local display state. The debounce effect's
  // guard (filterTextDraft === q) prevents a URL replace loop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilterTextDraft(q);
  }, [q]);

  // Debounce draft → URL; guard prevents replace loop after back-nav sync
  useEffect(() => {
    if (filterTextDraft === q) return;
    const timeout = window.setTimeout(() => {
      replaceViewState({ q: filterTextDraft, page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
    // replaceViewState is stable (defined below in render scope) — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTextDraft]);

  function replaceViewState(updates: {
    q?: string;
    match?: MatchFilter;
    sort?: Sort;
    page?: number;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    if ("q" in updates) {
      if (updates.q) params.set("q", updates.q);
      else params.delete("q");
    }
    if ("match" in updates) params.set("match", updates.match!);
    if ("sort" in updates) params.set("sort", updates.sort!);
    if ("page" in updates) params.set("page", String(updates.page));
    router.replace(`${pathname}?${params.toString()}`);
  }

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
        setSearchStatus({
          message: (data?.error as string) ?? "Search failed. Please try again.",
          isError: true,
        });
        return;
      }

      // After an agent search, the table represents the latest search result.
      // The initial page load still shows saved history before any search runs.
      setJobs(data.jobs as Job[]);

      setSearchStatus({ message: data.successMessage as string });

      // Reset to page 1 — preserve q, match, sort
      replaceViewState({ page: 1 });
    } catch (error) {
      console.error("[FindJobsClient] search error:", error);
      setSearchStatus({
        message: "Search failed. Please try again.",
        isError: true,
      });
    } finally {
      setIsLoading(false);
    }
  }

  const filtered = useMemo(() => {
    let result = [...jobs];

    if (match === "high") {
      result = result.filter(
        (j) => j.match_score != null && j.match_score >= MATCH_THRESHOLD,
      );
    } else if (match === "low") {
      result = result.filter(
        (j) => j.match_score != null && j.match_score < MATCH_THRESHOLD,
      );
    }

    if (q.trim()) {
      const lower = q.toLowerCase();
      result = result.filter(
        (j) =>
          j.company?.toLowerCase().includes(lower) ||
          j.title?.toLowerCase().includes(lower),
      );
    }

    if (sort === "score") {
      result.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
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
  }, [jobs, match, q, sort]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const pageNumbers = useMemo(
    () => buildPageNumbers(totalPages, safePage),
    [totalPages, safePage],
  );

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
          filterText={filterTextDraft}
          matchFilter={match}
          sort={sort}
          onFilterTextChange={setFilterTextDraft}
          onMatchFilterChange={(next) =>
            replaceViewState({ match: next, page: 1 })
          }
          onSortChange={(next) => replaceViewState({ sort: next, page: 1 })}
        />
        <JobsTable jobs={pageItems} hasNoHistory={jobs.length === 0} />
        <JobsPagination
          page={safePage}
          totalPages={totalPages}
          totalCount={totalCount}
          startIdx={startIdx}
          pageNumbers={pageNumbers}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => replaceViewState({ page: p })}
        />
      </div>
    </div>
  );
}
