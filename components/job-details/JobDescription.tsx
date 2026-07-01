import { FileText } from "lucide-react";

type Props = { aboutRole: string | null };

export function JobDescription({ aboutRole }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <FileText size={16} className="text-text-secondary" />
        <h2 className="text-base font-semibold text-text-primary">
          Job Description
        </h2>
      </div>
      {/* whitespace-pre-line preserves newlines from raw innerText scrape */}
      <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
        {aboutRole ?? "No description available."}
      </p>
    </div>
  );
}
