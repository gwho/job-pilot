"use client";

import { useState } from "react";
import { Search, MapPin, Sparkles } from "lucide-react";

type SearchStatus = {
  jobsFound: number;
  strongMatches: number;
};

const inputCls =
  "w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent";

export function SearchControls() {
  const [jobTitle, setJobTitle] = useState("");
  const [location, setLocation] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);

  function handleSearch() {
    // Placeholder — wired to Adzuna API in Feature 10
    setSearchStatus({ jobsFound: 8, strongMatches: 4 });
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
            Job Title
          </label>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Frontend Engineer"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
            Location
          </label>
          <div className="relative">
            <MapPin
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              size={14}
            />
            <input
              type="text"
              placeholder="Remote, New York..."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <button
          onClick={handleSearch}
          className="flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors whitespace-nowrap"
        >
          <Search size={14} />
          Find Jobs
        </button>
      </div>

      {searchStatus && (
        <div className="mt-4 flex items-center gap-2 bg-success-lightest text-success-foreground text-sm rounded-md px-4 py-2">
          <Sparkles size={14} />
          Found {searchStatus.jobsFound} jobs and saved {searchStatus.strongMatches} strong matches.
        </div>
      )}
    </div>
  );
}
