import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { SearchControls } from "@/components/find-jobs/SearchControls";
import { JobsTable } from "@/components/find-jobs/JobsTable";
import { createInsforgeServer } from "@/lib/insforge-server";
import type { Job } from "@/types/index";

export default async function FindJobsPage() {
  const insforge = await createInsforgeServer();
  const { data: authData, error: authError } =
    await insforge.auth.getCurrentUser();

  if (authError || !authData.user) {
    redirect("/login");
  }

  const MOCK_JOBS: Job[] = [
    {
      id: "mock-1",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Senior Frontend Engineer",
      company: "Vercel",
      location: null,
      salary: "$160k – $200k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 94,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-24T15:00:00.000Z",
    },
    {
      id: "mock-2",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Staff UI Engineer",
      company: "Stripe",
      location: null,
      salary: "$180k – $240k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 88,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-23T15:00:00.000Z",
    },
    {
      id: "mock-3",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Product Engineer",
      company: "Linear",
      location: null,
      salary: "$150k – $190k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 96,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-23T11:00:00.000Z",
    },
    {
      id: "mock-4",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Frontend Developer",
      company: "Notion",
      location: null,
      salary: "$130k – $170k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 72,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-22T17:00:00.000Z",
    },
    {
      id: "mock-5",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Design Engineer",
      company: "OpenAI",
      location: null,
      salary: "$200k – $280k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 91,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-21T17:00:00.000Z",
    },
    {
      id: "mock-6",
      run_id: null,
      user_id: authData.user.id,
      source: "search",
      source_url: null,
      external_apply_url: null,
      title: "Software Engineer, Editor",
      company: "Figma",
      location: null,
      salary: "$170k – $220k",
      job_type: "fulltime",
      about_role: null,
      responsibilities: null,
      requirements: null,
      nice_to_have: null,
      benefits: null,
      about_company: null,
      match_score: 85,
      match_reason: null,
      matched_skills: null,
      missing_skills: null,
      company_research: null,
      found_at: "2026-06-20T17:00:00.000Z",
    },
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-6">
          <SearchControls />
          <JobsTable jobs={MOCK_JOBS} />
        </div>
      </main>
    </>
  );
}
