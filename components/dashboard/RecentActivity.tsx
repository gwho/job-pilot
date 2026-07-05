import Link from "next/link";

export type ActivityItem = {
  id: string;
  type: "search" | "research";
  label: string;
  timeAgo: string;
};

type ActivityRowProps = ActivityItem;

function ActivityRow({ type, label, timeAgo }: ActivityRowProps) {
  const isSearch = type === "search";

  const outerRing = isSearch ? "bg-success-light" : "bg-info-light";
  const innerDot = isSearch ? "bg-success-alt" : "bg-info";

  return (
    <div className="flex items-start gap-4 py-3">
      <div
        className={`flex-shrink-0 w-4 h-4 rounded-full ${outerRing} flex items-center justify-center mt-0.5`}
        style={{ outline: "1px solid var(--color-surface)" }}
      >
        <div className={`w-2 h-2 rounded-full ${innerDot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{timeAgo}</p>
      </div>
    </div>
  );
}

type Props = {
  items: ActivityItem[];
};

export function RecentActivity({ items }: Props) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text-primary mb-2">Recent Activity</h2>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted py-3">
          No activity yet.{" "}
          <Link href="/find-jobs" className="text-accent hover:underline">
            Run a search
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <ActivityRow key={item.id} {...item} />
          ))}
        </div>
      )}
    </div>
  );
}
