import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { createInsforgeServer } from "@/lib/insforge-server";
import { Navbar } from "@/components/layout/Navbar";
import { JobInfo } from "@/components/job-details/JobInfo";
import { MatchScore } from "@/components/job-details/MatchScore";
import { JobDescription } from "@/components/job-details/JobDescription";
import { CompanyResearch } from "@/components/job-details/CompanyResearch";
import { JobActions } from "@/components/job-details/JobActions";
import type { Job } from "@/types/index";

export const dynamic = "force-dynamic";

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const insforge = await createInsforgeServer();

  const { data: authData, error: authError } =
    await insforge.auth.getCurrentUser();
  if (authError || !authData.user) redirect("/login");

  const { data: job, error } = await insforge.database
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", authData.user.id)
    .single();

  if (error || !job) notFound();

  // InsForge returns untyped query data — shape matches the jobs table Job type
  const typedJob = job as Job;

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
          <Link
            href="/find-jobs"
            className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronLeft size={16} />
            Back to Jobs
          </Link>
          <JobInfo job={typedJob} />
          <MatchScore job={typedJob} />
          <JobDescription aboutRole={typedJob.about_role} />
          <CompanyResearch company={typedJob.company} />
          <JobActions
            company={typedJob.company}
            externalApplyUrl={typedJob.external_apply_url}
            sourceUrl={typedJob.source_url}
          />
        </div>
      </main>
    </>
  );
}
