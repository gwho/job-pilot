import Image from "next/image";
import Link from "next/link";
import { signInWithGithub, signInWithGoogle } from "@/app/actions/auth";

type Props = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const hasOauthError = params.error === "oauth";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8 shadow-lg">
        <Link href="/" className="flex items-center gap-2 justify-center mb-6">
          <Image src="/logo.png" alt="JobPilot logo" width={36} height={36} />
          <span className="text-[19px] font-bold leading-7 text-text-darkest">
            JobPilot
          </span>
        </Link>

        <h1 className="text-xl font-semibold text-text-primary text-center mb-1">
          Welcome back
        </h1>
        <p className="text-sm text-text-secondary text-center mb-6">
          Sign in to continue to your dashboard
        </p>

        {hasOauthError ? (
          <p className="mb-4 rounded-md border border-error bg-surface px-3 py-2 text-sm font-medium text-error">
            We could not complete sign in. Please try again.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="w-full bg-surface border border-border text-text-primary text-sm font-medium px-6 py-3 rounded-md hover:bg-surface-secondary transition-colors"
            >
              Continue with Google
            </button>
          </form>

          <form action={signInWithGithub}>
            <button
              type="submit"
              className="w-full bg-overlay text-white text-sm font-medium px-6 py-3 rounded-md hover:bg-overlay-dark transition-colors"
            >
              Continue with GitHub
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
