import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { ProfileBanner } from "@/components/dashboard/ProfileBanner";
import { StatsBar, type StatCardConfig } from "@/components/dashboard/StatsBar";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/RecentActivity";
import { CompanyResearchChart } from "@/components/dashboard/CompanyResearchChart";
import { JobsFoundChart } from "@/components/dashboard/JobsFoundChart";
import { MatchScoreChart } from "@/components/dashboard/MatchScoreChart";
import { createInsforgeServer } from "@/lib/insforge-server";
import { getIsoTimestampDaysAgo } from "@/lib/utils";


const mockActivity: ActivityItem[] = [
  {
    type: "search",
    label: "Found 8 jobs for Frontend Engineer",
    timeAgo: "10 mins ago",
  },
  {
    type: "research",
    label: "Researched Stripe",
    timeAgo: "1 hour ago",
  },
  {
    type: "search",
    label: "Found 12 jobs for React Developer",
    timeAgo: "2 hours ago",
  },
  {
    type: "research",
    label: "Researched Vercel",
    timeAgo: "Yesterday",
  },
  {
    type: "search",
    label: "Found 10 jobs for Full Stack Engineer",
    timeAgo: "Yesterday",
  },
];

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

  const [totalJobsResult, scoredJobsResult, companiesResult, thisWeekResult] =
    await Promise.all([
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
    ]);

  if (totalJobsResult.error)
    console.error("[dashboard/stats] total jobs", totalJobsResult.error);
  if (scoredJobsResult.error)
    console.error("[dashboard/stats] scored jobs", scoredJobsResult.error);
  if (companiesResult.error)
    console.error("[dashboard/stats] companies researched", companiesResult.error);
  if (thisWeekResult.error)
    console.error("[dashboard/stats] jobs this week", thisWeekResult.error);

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

  return (
    <>
      <Navbar />
      <main className="bg-background min-h-[calc(100vh-4rem)]">
        <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
          <ProfileBanner isComplete={isComplete} />
          <StatsBar stats={stats} />
          <div className="grid grid-cols-2 gap-6 items-start">
            <RecentActivity items={mockActivity} />
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
