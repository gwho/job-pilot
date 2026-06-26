export const MATCH_THRESHOLD = 70;

export function getMatchBarColor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 80) return "var(--color-info-medium)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-text-muted)";
}

export function formatRelativeDate(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${Math.floor(diffHours)} hours ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}
