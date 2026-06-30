"use client";

import { Search, MapPin, Sparkles, AlertCircle, Loader2 } from "lucide-react";

type SearchStatus = {
  message: string;
  isError?: boolean;
};

type Props = {
  jobTitle: string;
  location: string;
  isLoading: boolean;
  searchStatus: SearchStatus | null;
  onJobTitleChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onSearch: () => void;
};

const inputCls =
  "w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60";

export function SearchControls({
  jobTitle,
  location,
  isLoading,
  searchStatus,
  onJobTitleChange,
  onLocationChange,
  onSearch,
}: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
            Job title or keywords
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
              onChange={(e) => onJobTitleChange(e.target.value)}
              disabled={isLoading}
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
              onChange={(e) => onLocationChange(e.target.value)}
              disabled={isLoading}
              className={inputCls}
            />
          </div>
        </div>

        <button
          onClick={onSearch}
          disabled={isLoading}
          className="flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          {isLoading ? "Finding jobs..." : "Find Jobs"}
        </button>
      </div>

      {searchStatus && (
        <div
          className={`mt-4 flex items-center gap-2 text-sm rounded-md px-4 py-2 ${
            searchStatus.isError
              ? "bg-error/10 text-error"
              : "bg-success-lightest text-success-foreground"
          }`}
        >
          {searchStatus.isError ? <AlertCircle size={14} /> : <Sparkles size={14} />}
          {searchStatus.message}
        </div>
      )}
    </div>
  );
}
