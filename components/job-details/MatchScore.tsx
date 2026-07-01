import { Sparkles, Check, X } from "lucide-react";

import type { Job } from "@/types/index";

type Props = { job: Job };

export function MatchScore({ job }: Props) {
  const hasMatchedSkills = (job.matched_skills?.length ?? 0) > 0;
  const hasMissingSkills = (job.missing_skills?.length ?? 0) > 0;
  const hasNoSkillData = !hasMatchedSkills && !hasMissingSkills;

  return (
    <div className="space-y-4">
      {/* AI Match Reasoning — only rendered when there is a reason */}
      {job.match_reason && (
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-success" />
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              AI Match Reasoning
            </span>
          </div>
          <p className="text-sm text-text-primary leading-relaxed">
            {job.match_reason}
          </p>
        </div>
      )}

      {/* Required Skills vs Your Profile — always rendered */}
      <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
        <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-4">
          Required Skills vs Your Profile
        </p>

        {hasNoSkillData ? (
          <p className="text-sm text-text-muted">No skill data available.</p>
        ) : (
          <>
            {hasMatchedSkills && (
              <div>
                <p className="text-xs font-medium text-text-muted mb-2">
                  You have
                </p>
                <div className="flex flex-wrap gap-2">
                  {job.matched_skills!.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 bg-success-lightest text-success-dark text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      <Check size={11} strokeWidth={2.5} />
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hasMissingSkills && (
              <div className={hasMatchedSkills ? "mt-4" : ""}>
                <p className="text-xs font-medium text-text-muted mb-2">
                  Gap skills
                </p>
                <div className="flex flex-wrap gap-2">
                  {job.missing_skills!.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 bg-warning-light text-warning text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      <X size={11} strokeWidth={2.5} />
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
