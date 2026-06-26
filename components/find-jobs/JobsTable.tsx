"use client";

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
};

export function JobsTable({ jobs }: Props) {
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
            Date Found
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.length === 0 ? (
          <tr>
            <td
              colSpan={5}
              className="px-6 py-12 text-center text-sm text-text-muted"
            >
              No jobs match your filters.
            </td>
          </tr>
        ) : (
          jobs.map((job) => (
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
  );
}
