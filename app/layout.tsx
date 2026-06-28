import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PostHogIdentity } from "@/components/analytics/PostHogIdentity";
import { createInsforgeServer } from "@/lib/insforge-server";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "JobPilot — AI Job Hunting Assistant",
  description: "Find, score, and research jobs automatically with AI.",
};

type PostHogUser = {
  id: string;
  email: string | null;
};

async function getPostHogUser(): Promise<PostHogUser | null> {
  try {
    const insforge = await createInsforgeServer();
    const { data } = await insforge.auth.getCurrentUser();

    if (!data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getPostHogUser();

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased font-sans`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background" suppressHydrationWarning>
        <PostHogIdentity userId={user?.id ?? null} email={user?.email ?? null} />
        {children}
      </body>
    </html>
  );
}
