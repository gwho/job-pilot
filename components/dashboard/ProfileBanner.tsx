import Link from "next/link";
import { AlertCircle } from "lucide-react";

type Props = {
  isComplete: boolean;
};

export function ProfileBanner({ isComplete }: Props) {
  if (isComplete) return null;

  return (
    <div className="flex items-center justify-between gap-4 bg-surface border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertCircle size={18} className="text-warning flex-shrink-0" />
        <p className="text-sm font-medium text-text-primary">
          Your profile is incomplete. Complete your profile to unlock better job matches.
        </p>
      </div>
      <Link
        href="/profile"
        className="shrink-0 bg-accent text-accent-foreground text-sm font-medium rounded-md px-4 py-2 hover:bg-accent-dark transition-colors"
      >
        Complete Profile
      </Link>
    </div>
  );
}
