import { Navbar } from "@/components/layout/Navbar";
import { ComingSoonCard } from "@/components/layout/ComingSoonCard";

export default function DashboardPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-background px-6">
        <ComingSoonCard
          title="Dashboard"
          description="Dashboard is next after the foundation auth flow is complete."
        />
      </main>
    </>
  );
}
