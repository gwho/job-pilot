"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";
import { createInsforgeServer } from "@/lib/insforge-server";
import { captureServerEvent } from "@/lib/posthog-server";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";
type OAuthResult = Awaited<ReturnType<ReturnType<typeof createAuthActions>["signInWithOAuth"]>>;

async function startOAuth(provider: "google" | "github"): Promise<never> {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  let result: OAuthResult;

  try {
    result = await auth.signInWithOAuth(provider, {
      redirectTo: new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL).toString(),
      skipBrowserRedirect: true,
    });
  } catch (error) {
    console.error("[actions/auth]", error);
    redirect("/login?error=oauth");
  }

  const { data, error } = result;

  if (error || !data.url || !data.codeVerifier) {
    console.error("[actions/auth]", error ?? "OAuth init failed");
    redirect("/login?error=oauth");
  }

  cookieStore.set(CODE_VERIFIER_COOKIE, data.codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(data.url);
}

export async function signInWithGoogle(): Promise<void> {
  await startOAuth("google");
}

export async function signInWithGithub(): Promise<void> {
  await startOAuth("github");
}

export async function signOut(): Promise<never> {
  let userId: string | undefined;
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();
    userId = data.user?.id ?? undefined;
  } catch {
    // Best effort — don't block sign-out
  }

  try {
    const cookieStore = await cookies();
    const auth = createAuthActions({ cookies: cookieStore });
    const { error } = await auth.signOut();

    if (error) {
      console.error("[actions/auth]", error);
    }
  } catch (error) {
    console.error("[actions/auth]", error);
  }

  if (userId) {
    try {
      await captureServerEvent({
        distinctId: userId,
        event: "user_signed_out",
        properties: { userId },
      });
    } catch {
      // Best effort — don't block redirect
    }
  }

  redirect("/");
}
