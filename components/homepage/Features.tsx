type Feature = {
  icon: string;
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    icon: "🔍",
    title: "AI Job Discovery",
    description:
      "Finds relevant tech jobs from Adzuna automatically. No manual searching — just enter a title and location and let the agent do the work.",
  },
  {
    icon: "⚡",
    title: "Smart Scoring",
    description:
      "AI scores every job 0–100 against your actual skills profile. See matched skills in green and gaps in orange before you even open the listing.",
  },
  {
    icon: "🏢",
    title: "Company Research",
    description:
      "One click opens a Browserbase session that browses the company's real website and builds a structured dossier — culture, tech stack, and interview prep.",
  },
];

export function Features() {
  return (
    <section className="bg-surface-secondary py-16">
      <div className="max-w-[1440px] mx-auto px-8">
        <div className="grid grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-surface border border-border rounded-2xl p-6 shadow-sm"
            >
              <div className="text-2xl mb-4">{feature.icon}</div>
              <h3 className="text-base font-semibold text-text-primary mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
