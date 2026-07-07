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


type ResearchWithTimestamp = { researchedAt: string };

function hasResearchedAt(v: unknown): v is ResearchWithTimestamp {
  return (
    v !== null &&
    typeof v === "object" &&
    "researchedAt" in v &&
    typeof (v as Record<string, unknown>).researchedAt === "string"
  );
}

const SCORE_RANGES = [
  { range: "50-60%", min: 50, max: 59 },
  { range: "60-70%", min: 60, max: 69 },
  { range: "70-80%", min: 70, max: 79 },
  { range: "80-90%", min: 80, max: 89 },
  { range: "90-100%", min: 90, max: 100 },
] as const;

function buildJobsFoundByDay(
  jobs: { found_at: string }[],
): { day: string; count: number }[] {
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    const ds = new Date(job.found_at).toDateString();
    const b = buckets.find((bk) => bk.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}

function buildResearchByDay(
  jobs: { company_research: unknown }[],
): { day: string; count: number }[] {
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const oldestDay = new Date();
  oldestDay.setDate(oldestDay.getDate() - 6);
  oldestDay.setHours(0, 0, 0, 0);
  const cutoff = oldestDay.getTime();

  type Bucket = { dateStr: string; day: string; count: number };
  const buckets: Bucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.push({ dateStr: d.toDateString(), day: DAY[d.getDay()], count: 0 });
  }
  for (const job of jobs) {
    if (!hasResearchedAt(job.company_research)) continue;
    const ts = new Date(job.company_research.researchedAt).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const ds = new Date(ts).toDateString();
    const b = buckets.find((bk) => bk.dateStr === ds);
    if (b) b.count++;
  }
  return buckets.map(({ day, count }) => ({ day, count }));
}

function buildMatchScoreDistribution(
  jobs: { match_score: number | null }[],
): { range: string; count: number }[] {
  const counts = new Map<string, number>(SCORE_RANGES.map((r) => [r.range, 0]));
  for (const job of jobs) {
    if (job.match_score == null) continue;
    for (const { range, min, max } of SCORE_RANGES) {
      if (job.match_score >= min && job.match_score <= max) {
        counts.set(range, (counts.get(range) ?? 0) + 1);
        break;
      }
    }
  }
  return SCORE_RANGES.map(({ range }) => ({ range, count: counts.get(range) ?? 0 }));
}

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
    recentJobsResult,
    chartResearchJobsResult,
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

    insforge.database
      .from("jobs")
      .select("found_at")
      .eq("user_id", authData.user.id)
      .gte("found_at", sevenDaysAgo)
      .order("found_at", { ascending: false }),

    insforge.database
      .from("jobs")
      .select("company_research")
      .eq("user_id", authData.user.id)
      .not("company_research", "is", null),
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
  if (recentJobsResult.error)
    console.error("[dashboard/charts] recent jobs", recentJobsResult.error);
  if (chartResearchJobsResult.error)
    console.error("[dashboard/charts] research chart", chartResearchJobsResult.error);

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
      if (!hasResearchedAt(row.company_research)) return [];
      const researchedAt = row.company_research.researchedAt;
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

  const jobsFoundData = buildJobsFoundByDay(recentJobsResult.data ?? []);
  const companyResearchData = buildResearchByDay(chartResearchJobsResult.data ?? []);
  const matchScoreData = buildMatchScoreDistribution(scoredJobsResult.data ?? []);

  return (
    <>
      <Navbar />
      <main className="bg-background min-h-[calc(100vh-4rem)]">
        <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
          <ProfileBanner isComplete={isComplete} />
          <StatsBar stats={stats} />
          <div className="grid grid-cols-2 gap-6 items-start">
            <RecentActivity items={activityItems} />
            <CompanyResearchChart data={companyResearchData} />
          </div>
          <div className="grid grid-cols-2 gap-6 items-start">
            <JobsFoundChart data={jobsFoundData} />
            <MatchScoreChart data={matchScoreData} />
          </div>
        </div>
      </main>
    </>
  );
}
