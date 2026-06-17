"use client";

import posthog from "posthog-js";

function isPostHogReady(): boolean {
  return posthog.__loaded;
}

export function identifyPostHogUser(
  userId: string,
  email: string | null,
): void {
  if (!isPostHogReady()) {
    return;
  }

  posthog.identify(userId, email ? { email } : undefined);
}

export function resetPostHogUser(): void {
  if (!isPostHogReady()) {
    return;
  }

  posthog.reset();
}
