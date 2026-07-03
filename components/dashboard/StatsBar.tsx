import { TrendingUp } from "lucide-react";

export type StatCardConfig = {
  label: string;
  value: string;
  trend?: { value: string; label: string };
  subtitle?: string;
};

type StatCardProps = StatCardConfig;

function StatCard({ label, value, trend, subtitle }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <p className="text-sm font-medium text-text-secondary mb-2">{label}</p>
      <p className="text-[30px] font-semibold leading-9 text-text-primary mb-2">{value}</p>
      {trend ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 bg-success-lightest text-success-darker text-xs font-medium px-2 py-0.5 rounded-sm">
            <TrendingUp size={11} />
            {trend.value}
          </span>
          <span className="text-xs text-text-muted">{trend.label}</span>
        </div>
      ) : (
        <p className="text-xs text-text-muted">{subtitle}</p>
      )}
    </div>
  );
}

type Props = {
  stats: StatCardConfig[];
};

export function StatsBar({ stats }: Props) {
  return (
    <div className="grid grid-cols-4 gap-6">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
