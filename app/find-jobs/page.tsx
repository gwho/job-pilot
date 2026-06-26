import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { FindJobsClient } from "@/components/find-jobs/FindJobsClient";
import { createInsforgeServer } from "@/lib/insforge-server";
import type { Job } from "@/types/index";

// Per-user, frequently-mutated list — never serve a cached render.
export const dynamic = "force-dynamic";

export default async function FindJobsPage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } =
    await insforge.auth.getCurrentUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const { data: jobs } = await insforge.database
    .from("jobs")
    .select("*")
    .eq("user_id", authData.user.id)
    .order("found_at", { ascending: false });

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8">
          <FindJobsClient initialJobs={(jobs as Job[]) ?? []} />
        </div>
      </main>
    </>
  );
}
