function toPathSlug(value: string): string {
  return value
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function jobsDbSearchUrl(query: string, location: string, page = 1): string {
  const querySlug = toPathSlug(query).toLowerCase();
  const locationSlug = toPathSlug(location);
  const base = locationSlug
    ? `https://hk.jobsdb.com/${querySlug}-jobs/in-${locationSlug}`
    : `https://hk.jobsdb.com/${querySlug}-jobs`;

  if (page <= 1) {
    return base;
  }

  const params = new URLSearchParams({ page: String(page) });
  return `${base}?${params.toString()}`;
}

// Strip tracking query params so the same listing discovered at different
// search positions (or across pages) deduplicates to one canonical URL.
export function canonicalJobUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return href;
  }
}
