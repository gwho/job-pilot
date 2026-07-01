type Props = {
  company: string | null;
  externalApplyUrl: string | null;
  sourceUrl: string | null;
};

export function JobActions({ company, externalApplyUrl, sourceUrl }: Props) {
  // For JobsDB jobs, externalApplyUrl is the company's direct apply link.
  // For future Adzuna jobs where externalApplyUrl may be null, fall back to sourceUrl.
  const applyHref = externalApplyUrl ?? sourceUrl;
  const label = `Apply Now at ${company ?? "Company"}`;

  if (applyHref) {
    return (
      <a
        href={applyHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center w-full bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-3 hover:bg-accent-dark transition-colors"
      >
        {label}
      </a>
    );
  }

  return (
    <button
      disabled
      className="flex items-center justify-center w-full bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-3 opacity-50 cursor-not-allowed"
    >
      {label}
    </button>
  );
}
