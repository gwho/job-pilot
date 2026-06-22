import Link from "next/link";
import { getCtaHref } from "@/lib/auth";

export async function BottomCTA() {
  const ctaHref = await getCtaHref();

  return (
    <section
      className="w-full py-24"
      style={{
        background:
          "linear-gradient(135deg, var(--color-accent) 0%, var(--color-overlay) 100%)",
      }}
    >
      <div className="max-w-[1440px] mx-auto px-8 flex flex-col items-center text-center gap-6">
        <h2 className="text-4xl font-bold text-foreground leading-tight max-w-xl">
          Your next job search can feel a lot less overwhelming
        </h2>
        <p className="text-base text-foreground/70 max-w-lg leading-relaxed">
          Set up your profile once. JobPilot handles the discovery, scoring, and
          research — you just decide where to apply.
        </p>
        <div className="flex items-center gap-4 mt-2">
          <Link
            href={ctaHref}
            className="bg-surface text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="border border-border/30 text-foreground text-sm font-medium px-6 py-3 rounded-md hover:bg-surface/10 transition-colors"
          >
            See How It Works
          </Link>
        </div>
      </div>
    </section>
  );
}
