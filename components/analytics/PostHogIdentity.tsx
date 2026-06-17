"use client";

import { useEffect } from "react";
import { identifyPostHogUser, resetPostHogUser } from "@/lib/posthog-client";

type Props = {
  userId: string | null;
  email: string | null;
};

export function PostHogIdentity({ userId, email }: Props) {
  useEffect(() => {
    if (userId) {
      identifyPostHogUser(userId, email);
      return;
    }

    resetPostHogUser();
  }, [email, userId]);

  return null;
}
