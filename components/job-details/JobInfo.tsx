import {
  Building2,
  ExternalLink,
  DollarSign,
  MapPin,
  Briefcase,
  Calendar,
} from "lucide-react";

import { formatRelativeDate } from "@/lib/utils";
import type { Job } from "@/types/index";

function formatJobType(t: string | null): string {
  if (t === "fulltime") return "Full-time";
  if (t === "parttime") return "Part-time";
  if (t === "contract") return "Contract";
  return "—";
}

function matchBadgeClasses(score: number): string {
  if (score >= 70) return "bg-success-lightest text-success-dark";
  if (score >= 50) return "bg-warning-light text-warning";
  return "bg-surface-tertiary text-text-muted";
}

type Props = { job: Job };

export function JobInfo({ job }: Props) {
  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Logo placeholder */}
            <div className="w-10 h-10 bg-surface-tertiary border border-border rounded-lg flex items-center justify-center shrink-0">
              <Building2 size={20} className="text-text-muted" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                {job.title ?? "—"}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-text-secondary">
                  {job.company ?? "—"}
                </span>
                {job.match_score != null && (
                  <>
                    <span className="text-text-muted">·</span>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${matchBadgeClasses(job.match_score)}`}
                    >
                      {job.match_score}% Match Score
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {job.source_url && (
            <a
              href={job.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-surface border border-border text-text-primary text-sm font-medium rounded-md px-4 py-2 hover:bg-surface-secondary transition-colors shrink-0"
            >
              <ExternalLink size={14} />
              View Job Post
            </a>
          )}
        </div>
      </div>

      {/* Info cards row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 bg-success-lightest rounded-lg flex items-center justify-center shrink-0">
            <DollarSign size={16} className="text-success" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {job.salary ?? "—"}
            </p>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5">
              Salary Est.
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 bg-info-lightest rounded-lg flex items-center justify-center shrink-0">
            <MapPin size={16} className="text-info" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {job.location ?? "—"}
            </p>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5">
              Location
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 bg-accent-muted rounded-lg flex items-center justify-center shrink-0">
            <Briefcase size={16} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {formatJobType(job.job_type)}
            </p>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5">
              Job Type
            </p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <div className="w-8 h-8 bg-info-lightest rounded-lg flex items-center justify-center shrink-0">
            <Calendar size={16} className="text-info-medium" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">
              {formatRelativeDate(job.found_at)}
            </p>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mt-0.5">
              Date Found
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
