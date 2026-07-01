import { Building2, Search } from "lucide-react";

type Props = { company: string | null };

export function CompanyResearch({ company }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-text-secondary" />
          <h2 className="text-base font-semibold text-text-primary">
            Company Research
          </h2>
        </div>
        {/* Feature 13 will replace this with a wired Client Component */}
        <button
          disabled
          className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 opacity-50 cursor-not-allowed"
        >
          <Search size={14} />
          Research Company
        </button>
      </div>

      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <Building2 size={32} className="text-text-muted" />
        <p className="text-sm font-medium text-text-primary">No research yet</p>
        <p className="text-xs text-text-muted text-center max-w-[200px]">
          Click &quot;Research Company&quot; to let the AI browse{" "}
          {company ?? "the company"}&apos;s public pages and build a dossier.
        </p>
      </div>
    </div>
  );
}
