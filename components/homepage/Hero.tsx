import Image from "next/image";
import Link from "next/link";
import { getCtaHref } from "@/lib/auth";

export async function Hero() {
  const ctaHref = await getCtaHref();

  return (
    <section className="w-full bg-background pt-20 pb-0">
      <div className="max-w-[1440px] mx-auto px-8 flex flex-col items-center text-center">
        <span className="inline-flex items-center bg-accent-muted text-accent text-xs font-medium px-3 py-1 rounded-full mb-6">
          AI-Powered Job Search
        </span>

        <h1 className="text-5xl font-bold text-text-primary leading-tight max-w-2xl mb-5">
          Job hunting is hard.
          <br />
          Your tools shouldn&apos;t be.
        </h1>

        <p className="text-base text-text-secondary max-w-xl leading-relaxed mb-8">
          Set up your profile once. JobPilot automatically discovers relevant
          jobs, scores them against your skills, and researches every company —
          so you arrive fully prepared.
        </p>

        <div className="flex items-center gap-4 mb-14">
          <Link
            href={ctaHref}
            className="bg-accent text-accent-foreground text-sm font-medium px-6 py-3 rounded-md hover:bg-accent-dark transition-colors"
          >
            Get Started
          </Link>
          <Link
            href={ctaHref}
            className="bg-surface border border-border text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors"
          >
            Find Your First Match
          </Link>
        </div>

        <div className="w-full max-w-5xl rounded-2xl border border-border shadow-lg overflow-hidden">
          <Image
            src="/images/dashboard-demo.png"
            alt="JobPilot dashboard showing job matches and analytics"
            width={1200}
            height={700}
            className="w-full h-auto"
            priority
          />
        </div>
      </div>
    </section>
  );
}
