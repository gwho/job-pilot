"use client";

import { resetPostHogUser } from "@/lib/posthog-client";

export function SignOutPostHogResetButton() {
  return (
    <button
      type="submit"
      onClick={resetPostHogUser}
      className="bg-surface border border-border text-text-primary text-sm font-medium px-4 py-2 rounded-md hover:bg-surface-secondary transition-colors"
    >
      Sign out
    </button>
  );
}
