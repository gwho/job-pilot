"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthActions } from "@insforge/sdk/ssr";

const CODE_VERIFIER_COOKIE = "insforge_code_verifier";

async function startOAuth(provider: "google" | "github") {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });

  const { data, error } = await auth.signInWithOAuth(provider, {
    redirectTo: new URL("/api/auth/callback", process.env.NEXT_PUBLIC_APP_URL).toString(),
    skipBrowserRedirect: true,
  });

  if (error || !data.url || !data.codeVerifier) {
    throw new Error(error?.message ?? "OAuth init failed");
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

export async function signInWithGoogle() {
  await startOAuth("google");
}

export async function signInWithGithub() {
  await startOAuth("github");
}

export async function signOut() {
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  await auth.signOut();
  redirect("/");
}
