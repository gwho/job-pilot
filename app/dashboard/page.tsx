import { redirect } from "next/navigation";

import { Navbar } from "@/components/layout/Navbar";
import { ProfileBanner } from "@/components/dashboard/ProfileBanner";
import { StatsBar, type StatCardConfig } from "@/components/dashboard/StatsBar";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/RecentActivity";
import { CompanyResearchChart } from "@/components/dashboard/CompanyResearchChart";
import { JobsFoundChart } from "@/components/dashboard/JobsFoundChart";
import { MatchScoreChart } from "@/components/dashboard/MatchScoreChart";
import { createInsforgeServer } from "@/lib/insforge-server";

const mockStats: StatCardConfig[] = [
  {
    label: "Total Jobs Found",
    value: "284",
    trend: { value: "+12%", label: "vs last week" },
  },
  {
    label: "Avg. Match Rate",
    value: "82%",
    trend: { value: "+3%", label: "vs last week" },
  },
  {
    label: "Companies Researched",
    value: "35",
    subtitle: "Total researched",
  },
  {
    label: "Jobs This Week",
    value: "28",
    subtitle: "New this week",
  },
];

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

  return (
    <>
      <Navbar />
      <main className="bg-background min-h-[calc(100vh-4rem)]">
        <div className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
          <ProfileBanner isComplete={isComplete} />
          <StatsBar stats={mockStats} />
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
