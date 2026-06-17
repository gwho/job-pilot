import { PostHog } from "posthog-node";

type PostHogEvent =
  | "user_signed_in"
  | "user_signed_out"
  | "job_search_started"
  | "job_found"
  | "profile_completed"
  | "company_researched";

type PostHogPropertyValue = string | number | boolean | null | undefined;

type CaptureServerEventInput = {
  distinctId: string;
  event: PostHogEvent;
  properties?: Record<string, PostHogPropertyValue>;
};

type IdentifyServerUserInput = {
  distinctId: string;
  properties?: Record<string, PostHogPropertyValue>;
};

export function createPostHogServer(): PostHog | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  if (!apiKey) {
    return null;
  }

  return new PostHog(apiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
}

export async function captureServerEvent({
  distinctId,
  event,
  properties = {},
}: CaptureServerEventInput): Promise<void> {
  const posthog = createPostHogServer();

  if (!posthog) {
    return;
  }

  try {
    posthog.capture({
      distinctId,
      event,
      properties,
    });
  } finally {
    await posthog.shutdown();
  }
}

export async function identifyServerUser({
  distinctId,
  properties = {},
}: IdentifyServerUserInput): Promise<void> {
  const posthog = createPostHogServer();

  if (!posthog) {
    return;
  }

  try {
    posthog.identify({
      distinctId,
      properties,
    });
  } finally {
    await posthog.shutdown();
  }
}
