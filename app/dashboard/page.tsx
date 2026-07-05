import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { ProfileBanner } from "@/components/dashboard/ProfileBanner";
import { StatsBar, type StatCardConfig } from "@/components/dashboard/StatsBar";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/RecentActivity";
import { CompanyResearchChart } from "@/components/dashboard/CompanyResearchChart";
import { JobsFoundChart } from "@/components/dashboard/JobsFoundChart";
import { MatchScoreChart } from "@/components/dashboard/MatchScoreChart";
import { createInsforgeServer } from "@/lib/insforge-server";
import { getIsoTimestampDaysAgo, formatRelativeDate } from "@/lib/utils";


const mockCompanyResearchData = [
  { day: "Mon", count: 2 },
  { day: "Tue", count: 5 },
  { day: "Wed", count: 3 },
  { day: "Thu", count: 8 },
  { day: "Fri", count: 12 },
  { day: "Sat", count: 4 },
  { day: "Sun", count: 1 },
];

const mockJobsFoundData = [
  { day: "Mon", count: 15 },
  { day: "Tue", count: 32 },
  { day: "Wed", count: 28 },
  { day: "Thu", count: 48 },
  { day: "Fri", count: 85 },
  { day: "Sat", count: 52 },
  { day: "Sun", count: 18 },
];

const mockMatchScoreData = [
  { range: "50-60%", count: 5 },
  { range: "60-70%", count: 12 },
  { range: "70-80%", count: 44 },
  { range: "80-90%", count: 85 },
  { range: "90-100%", count: 32 },
];

export default async function DashboardPage() {
  const insforge = await createInsforgeServer();
  const { data: authData } = await insforge.auth.getCurrentUser();

  if (!authData.user) {
    redirect("/login");
  }

  const { data: profileData } = await insforge.database
    .from("profiles")
    .select("is_complete")
    .eq("id", authData.user.id)
    .maybeSingle();

  const isComplete = !!profileData?.is_complete;

  const sevenDaysAgo = getIsoTimestampDaysAgo(7);

  const [
    totalJobsResult,
    scoredJobsResult,
    companiesResult,
    thisWeekResult,
    agentRunsResult,
    researchJobsResult,
  ] = await Promise.all([
    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id),

    insforge.database
      .from("jobs")
      .select("match_score")
      .eq("user_id", authData.user.id)
      .not("match_score", "is", null),

    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .not("company_research", "is", null),

    insforge.database
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .gte("found_at", sevenDaysAgo),

    insforge.database
      .from("agent_runs")
      .select("id, job_title_searched, jobs_found, completed_at")
      .eq("user_id", authData.user.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(20),

    insforge.database
      .from("jobs")
      .select("id, company, company_research")
      .eq("user_id", authData.user.id)
      .not("company_research", "is", null)
      .order("found_at", { ascending: false })
      .limit(20),
  ]);

  if (totalJobsResult.error)
    console.error("[dashboard/stats] total jobs", totalJobsResult.error);
  if (scoredJobsResult.error)
    console.error("[dashboard/stats] scored jobs", scoredJobsResult.error);
  if (companiesResult.error)
    console.error("[dashboard/stats] companies researched", companiesResult.error);
  if (thisWeekResult.error)
    console.error("[dashboard/stats] jobs this week", thisWeekResult.error);
  if (agentRunsResult.error)
    console.error("[dashboard/activity] agent_runs", agentRunsResult.error);
  if (researchJobsResult.error)
    console.error("[dashboard/activity] jobs", researchJobsResult.error);

  const totalJobs = totalJobsResult.count ?? 0;
  const companiesResearched = companiesResult.count ?? 0;
  const jobsThisWeek = thisWeekResult.count ?? 0;

  const scoredRows = scoredJobsResult.data ?? [];
  const avgMatchRate =
    scoredRows.length > 0
      ? `${Math.round(
          scoredRows.reduce((sum, r) => sum + (r.match_score ?? 0), 0) /
            scoredRows.length
        )}%`
      : "—";

  const stats: StatCardConfig[] = [
    { label: "Total Jobs Found",     value: String(totalJobs),           subtitle: "All time" },
    { label: "Avg. Match Rate",      value: avgMatchRate,                subtitle: "Scored jobs only" },
    { label: "Companies Researched", value: String(companiesResearched), subtitle: "Completed research" },
    { label: "Jobs This Week",       value: String(jobsThisWeek),        subtitle: "Last 7 days" },
  ];

  type ActivityCandidate = ActivityItem & { sortTs: number };

  const searchCandidates: ActivityCandidate[] = (agentRunsResult.data ?? [])
    .filter((r) => !!r.completed_at)
    .map((r) => ({
      id: `search-${r.id}`,
      type: "search" as const,
      label: `Found ${r.jobs_found ?? 0} jobs for ${r.job_title_searched ?? "your search"}`,
      timeAgo: formatRelativeDate(r.completed_at as string),
      sortTs: new Date(r.completed_at as string).getTime(),
    }));

  const researchCandidates: ActivityCandidate[] = (researchJobsResult.data ?? [])
    .flatMap((row) => {
      const researchedAt = (row.company_research as { researchedAt?: string } | null)
        ?.researchedAt;
      if (!researchedAt) return [];
      const ts = new Date(researchedAt).getTime();
      if (isNaN(ts)) return [];
      return [
        {
          id: `research-${row.id}`,
          type: "research" as const,
          label: `Researched ${row.company ?? "company"}`,
          timeAgo: formatRelativeDate(researchedAt),
          sortTs: ts,
        },
      ];
    });

  const activityItems: ActivityItem[] = [...searchCandidates, ...researchCandidates]
    .sort((a, b) => b.sortTs - a.sortTs)
    .slice(0, 10)
    .map(({ id, type, label, timeAgo }) => ({ id, type, label, timeAgo }));

  return (
    <>
      <Navbar />
      <main className="bg-background min-h-[calc(100vh-4rem)]">
        <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
          <ProfileBanner isComplete={isComplete} />
          <StatsBar stats={stats} />
          <div className="grid grid-cols-2 gap-6 items-start">
            <RecentActivity items={activityItems} />
            <CompanyResearchChart data={mockCompanyResearchData} />
          </div>
          <div className="grid grid-cols-2 gap-6 items-start">
            <JobsFoundChart data={mockJobsFoundData} />
            <MatchScoreChart data={mockMatchScoreData} />
          </div>
        </div>
      </main>
    </>
  );
}
