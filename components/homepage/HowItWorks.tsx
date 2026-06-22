import Image from "next/image";

type FeaturePoint = {
  title: string;
  description: string;
};

type SectionProps = {
  heading: string;
  points: FeaturePoint[];
  imageSrc: string;
  imageAlt: string;
  imageLeft?: boolean;
};

function Section({
  heading,
  points,
  imageSrc,
  imageAlt,
  imageLeft = false,
}: SectionProps) {
  const textCol = (
    <div className="flex flex-col gap-6">
      <h2 className="text-3xl font-bold text-text-primary leading-snug">
        {heading}
      </h2>
      <ul className="flex flex-col gap-4">
        {points.map((point) => (
          <li key={point.title} className="flex items-start gap-3">
            <span className="mt-1.5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                {point.title}
              </p>
              <p className="text-sm text-text-secondary">{point.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  const imageCol = (
    <div className="rounded-2xl border border-border shadow-md overflow-hidden">
      <Image
        src={imageSrc}
        alt={imageAlt}
        width={640}
        height={420}
        className="w-full h-auto"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
      {imageLeft ? (
        <>
          {imageCol}
          {textCol}
        </>
      ) : (
        <>
          {textCol}
          {imageCol}
        </>
      )}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="bg-background py-24">
      <div className="max-w-[1440px] mx-auto px-8 flex flex-col gap-24">
        <Section
          heading="Manage Your Job Search With Ease"
          points={[
            {
              title: "Find jobs that actually fit you",
              description:
                "JobPilot pulls live listings from Adzuna and scores every one against your real skills using GPT-4o — not just keyword matches.",
            },
            {
              title: "Know the companies before you apply",
              description:
                "A single click researches the company's public pages and builds a full dossier: culture, tech stack, and interview prep tailored to you.",
            },
            {
              title: "Keep track of every application",
              description:
                "Your dashboard shows every job found, scored, and researched — with analytics that improve over time.",
            },
          ]}
          imageSrc="/images/jobs-lists.png"
          imageAlt="JobPilot jobs list showing match scores and company details"
        />

        <Section
          heading="Apply With More Confidence, Every Time"
          points={[
            {
              title: "A full company dossier before every application",
              description:
                "Overview, tech stack, culture, why this role exists — all synthesized from the company's own public pages.",
            },
            {
              title: "Your edge and your gaps, surfaced clearly",
              description:
                "See exactly which of your skills match and which are missing — with a strategy for how to frame the gap honestly.",
            },
            {
              title: "One click to the real application",
              description:
                "No copy-pasting URLs. Every job links directly to the employer's application page.",
            },
          ]}
          imageSrc="/images/agnet-log.png"
          imageAlt="JobPilot company research dossier showing tech stack and culture"
          imageLeft
        />
      </div>
    </section>
  );
}
