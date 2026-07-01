"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";

import { getMatchBarColor, formatRelativeDate } from "@/lib/utils";
import type { Job } from "@/types/index";

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

type Props = {
  jobs: Job[];
  hasNoHistory: boolean;
};

export function JobsTable({ jobs, hasNoHistory }: Props) {
  return (
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
            Provider
          </th>
          <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wide">
            Date Found
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              className="px-6 py-12 text-center text-sm text-text-muted"
            >
              {hasNoHistory
                ? "Run a search above to find your first jobs."
                : "No jobs match your filters."}
            </td>
          </tr>
        ) : (
          jobs.map((job) => (
            <tr
              key={job.id}
              className="relative border-t border-border hover:bg-surface-secondary transition-colors"
            >
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-surface-tertiary border border-border rounded-md flex items-center justify-center shrink-0">
                    <Building2 size={16} className="text-text-muted" />
                  </div>
                  {/* stretched link — ::after pseudo-element covers the entire row */}
                  <Link
                    href={`/find-jobs/${job.id}`}
                    className="text-sm font-semibold text-text-primary after:absolute after:inset-0 after:content-[''] after:z-1"
                    aria-label={`View ${job.title ?? "job"} at ${job.company ?? "company"}`}
                  >
                    {job.company ?? "—"}
                  </Link>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.title ?? "—"}
              </td>
              <td className="px-6 py-4">
                {job.match_score != null ? (
                  <MatchScoreBar score={job.match_score} />
                ) : (
                  <span className="text-sm text-text-muted">—</span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.salary ?? "—"}
              </td>
              <td className="px-6 py-4 text-sm text-text-primary">
                {job.source_provider ?? "—"}
              </td>
              <td className="px-6 py-4 text-sm text-text-muted">
                {formatRelativeDate(job.found_at)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
