// Adzuna IT-jobs search client.
// Project rule: always filter category=it-jobs; omit `where` when location is empty.

export type AdzunaJob = {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  description: string; // snippet only — not the full description
  redirect_url: string; // Adzuna tracking URL → redirects to the real job post
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: "0" | "1"; // "1" means Adzuna estimated the salary
  contract_type?: string;
  created: string; // ISO date string
  category?: { tag: string; label: string };
};

type AdzunaSearchResponse = {
  results?: AdzunaJob[];
};

type Country = "gb" | "au" | "ca" | "sg" | "us";

/**
 * Map a free-text location to an Adzuna country code.
 * Keyword match only — no geolocation lookup. Defaults to "us".
 */
export function detectCountry(location: string): Country {
  const loc = location.toLowerCase();

  if (
    loc.includes("united kingdom") ||
    loc.includes("uk") ||
    loc.includes("england") ||
    loc.includes("scotland") ||
    loc.includes("wales") ||
    loc.includes("london")
  ) {
    return "gb";
  }
  if (loc.includes("australia") || loc.includes("sydney") || loc.includes("melbourne")) {
    return "au";
  }
  if (loc.includes("canada") || loc.includes("toronto") || loc.includes("vancouver")) {
    return "ca";
  }
  if (loc.includes("singapore")) {
    return "sg";
  }
  return "us";
}

/**
 * Search Adzuna IT jobs. Returns up to 10 results for page 1.
 * Throws on a non-ok response — the caller decides how to surface failure.
 */
export async function searchJobs(
  jobTitle: string,
  location: string,
  country: string = "us",
): Promise<AdzunaJob[]> {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID!,
    app_key: process.env.ADZUNA_APP_KEY!,
    what: jobTitle,
    category: "it-jobs", // always filter to IT jobs
    results_per_page: "10",
    "content-type": "application/json",
  });

  // Only add `where` if location is provided — never pass an empty value.
  if (location.trim()) {
    params.set("where", location);
  }

  const response = await fetch(
    `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error(`Adzuna API error: ${response.status}`);
  }

  const data = (await response.json()) as AdzunaSearchResponse;
  return data.results ?? [];
}
