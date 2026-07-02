"use client";

import { useState } from "react";
import { Building2, Search, Loader2, RefreshCw, Code2, Users, Target, Zap, AlertCircle, BookOpen, MessageSquare, ExternalLink } from "lucide-react";

import type { CompanyResearchDossier } from "@/types/index";

type Props = {
  jobId: string;
  company: string | null;
  initialResearch: CompanyResearchDossier | null;
};

export function CompanyResearch({ jobId, company, initialResearch }: Props) {
  const [research, setResearch] = useState<CompanyResearchDossier | null>(initialResearch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResearch(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const body = await res.json() as { success: boolean; data?: { companyResearch: CompanyResearchDossier }; error?: string };
      if (body.success && body.data?.companyResearch) {
        setResearch(body.data.companyResearch);
      } else {
        setError(body.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-text-secondary" />
          <h2 className="text-base font-semibold text-text-primary">Company Research</h2>
        </div>
        <button
          type="button"
          onClick={handleResearch}
          disabled={loading}
          className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Researching…
            </>
          ) : (
            <>
              {research ? <RefreshCw size={14} /> : <Search size={14} />}
              {research ? "Re-research" : "Research Company"}
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 bg-error/10 border border-error/20 rounded-lg p-3 mb-4">
          <AlertCircle size={14} className="text-error mt-0.5 shrink-0" />
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Empty state — no research yet */}
      {!research && !loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Building2 size={32} className="text-text-muted" />
          <p className="text-sm font-medium text-text-primary">No research yet</p>
          <p className="text-xs text-text-muted text-center max-w-[200px]">
            Click &quot;Research Company&quot; to let the AI browse{" "}
            {company ?? "the company"}&apos;s public pages and build a dossier.
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && !research && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="text-accent animate-spin" />
          <p className="text-sm font-medium text-text-primary">Researching {company ?? "the company"}…</p>
          <p className="text-xs text-text-muted text-center max-w-[220px]">
            Browsing public pages and building your dossier. This takes about 30–60 seconds.
          </p>
        </div>
      )}

      {/* Dossier — rendered once research is available */}
      {research && (
        <div className="space-y-6">
          {/* Company overview */}
          {research.companyOverview && (
            <section>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">About the Company</p>
              <p className="text-sm text-text-primary leading-relaxed">{research.companyOverview}</p>
            </section>
          )}

          {/* Tech stack */}
          {research.techStack.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Code2 size={13} className="text-text-secondary" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Tech Stack</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {research.techStack.map((tech) => (
                  <span key={tech} className="bg-info-light text-info-dark text-xs font-medium px-2.5 py-1 rounded-full">
                    {tech}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Culture */}
          {research.culture.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Users size={13} className="text-text-secondary" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Culture & Values</p>
              </div>
              <ul className="space-y-1.5">
                {research.culture.map((item, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2">
                    <span className="text-text-muted shrink-0 mt-0.5">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Why this role */}
          {research.whyThisRole && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Target size={13} className="text-text-secondary" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Why This Role Exists</p>
              </div>
              <p className="text-sm text-text-primary leading-relaxed">{research.whyThisRole}</p>
            </section>
          )}

          {/* Your edge */}
          {research.yourEdge.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <Zap size={13} className="text-success" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Your Edge</p>
              </div>
              <ul className="space-y-1.5">
                {research.yourEdge.map((item, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2">
                    <span className="text-success shrink-0 mt-0.5">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Gaps to address */}
          {research.gapsToAddress.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertCircle size={13} className="text-warning" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Gaps to Address</p>
              </div>
              <ul className="space-y-1.5">
                {research.gapsToAddress.map((item, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2">
                    <span className="text-warning shrink-0 mt-0.5">·</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Smart questions */}
          {research.smartQuestions.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare size={13} className="text-text-secondary" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Smart Questions to Ask</p>
              </div>
              <ol className="space-y-1.5 list-none">
                {research.smartQuestions.map((q, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2">
                    <span className="text-text-muted shrink-0 font-medium">{i + 1}.</span>
                    {q}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Interview prep */}
          {research.interviewPrep.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <BookOpen size={13} className="text-text-secondary" />
                <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Interview Prep</p>
              </div>
              <ol className="space-y-1.5 list-none">
                {research.interviewPrep.map((item, i) => (
                  <li key={i} className="text-sm text-text-primary flex gap-2">
                    <span className="text-text-muted shrink-0 font-medium">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Sources + timestamp */}
          {(research.sources.length > 0 || research.researchedAt) && (
            <section className="pt-4 border-t border-border">
              {research.sources.length > 0 && (
                <div className="mb-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ExternalLink size={11} className="text-text-muted" />
                    <p className="text-xs text-text-muted">Sources</p>
                  </div>
                  <ul className="space-y-0.5">
                    {research.sources.map((src, i) => {
                      const isUrl = src.startsWith("http://") || src.startsWith("https://");
                      return isUrl ? (
                        <li key={i}>
                          <a
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-text-muted hover:text-text-secondary underline-offset-2 hover:underline transition-colors block truncate"
                          >
                            {src}
                          </a>
                        </li>
                      ) : (
                        <li key={i} className="text-xs text-text-muted truncate">{src}</li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {research.researchedAt && (
                <p className="text-xs text-text-muted">
                  Researched {new Date(research.researchedAt).toLocaleString()}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
