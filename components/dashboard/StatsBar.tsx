export type StatCardConfig = {
  label: string;
  value: string;
  subtitle: string;
};

type StatCardProps = StatCardConfig;

function StatCard({ label, value, subtitle }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <p className="text-sm font-medium text-text-secondary mb-2">{label}</p>
      <p className="text-[30px] font-semibold leading-9 text-text-primary mb-2">{value}</p>
      <p className="text-xs text-text-muted">{subtitle}</p>
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
