import Image from "next/image";
import Link from "next/link";

type NavbarProps = {
  ctaHref?: string;
};

export function Navbar({ ctaHref = "/login" }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 w-full bg-surface border-b border-border h-16">
      <div className="max-w-[1440px] mx-auto px-6 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="JobPilot logo" width={36} height={36} />
          <span className="text-[19px] font-bold leading-7 text-text-darkest">
            JobPilot
          </span>
        </Link>

        <nav className="flex items-center gap-8">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-text-dark hover:text-accent transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/find-jobs"
            className="text-sm font-medium text-text-dark hover:text-accent transition-colors"
          >
            Find Jobs
          </Link>
          <Link
            href="/profile"
            className="text-sm font-medium text-text-dark hover:text-accent transition-colors"
          >
            Profile
          </Link>
        </nav>

        <Link
          href={ctaHref}
          className="bg-overlay text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-overlay-dark transition-colors"
        >
          Start for free
        </Link>
      </div>
    </header>
  );
}
