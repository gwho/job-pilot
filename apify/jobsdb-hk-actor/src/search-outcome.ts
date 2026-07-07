// Pure, unit-testable helpers for classifying a JobsDB search-page result.
// Imported by main.ts to decide whether the actor should fail cleanly.

export type SearchPageInput = {
  url: string;
  cardCount: number;
  /** True when the known JobsDB/SEEK empty-results selector is present in the DOM. */
  hasKnownEmptySelector: boolean;
  /** True when no-results text is found in the page body. Secondary evidence only. */
  hasEmptyTextFallback: boolean;
};

export type SearchOutcome =
  | "ok"
  | "login-redirect"
  | "legit-empty"
  | "suspicious-empty"   // page loaded (200), zero cards, no recognised empty-state marker
  | "blocked-http";      // HTTP-level failure (403/429/etc.) — page never loaded

/**
 * Classify a search page result into one of four outcomes:
 * - "ok"               — job cards found; crawl can proceed normally
 * - "login-redirect"   — page redirected to login; session expired
 * - "legit-empty"      — zero cards but a recognised JobsDB empty-state element confirms it
 * - "suspicious-empty" — zero cards with no positive confirmation; treat as blocked/broken
 *
 * Detection priority:
 * 1. Login redirect URL (authoritative)
 * 2. Cards found → ok
 * 3. Known empty-state selector (e.g. [data-automation="searchZeroResults"]) → legit-empty
 * 4. Text fallback alone is NOT sufficient evidence → suspicious-empty
 * 5. Default zero-card with no evidence → suspicious-empty
 */
export function classifySearchPage(input: SearchPageInput): SearchOutcome {
  const { url, cardCount, hasKnownEmptySelector } = input;

  if (url.includes("/login") || url.includes("/sign-in")) {
    return "login-redirect";
  }

  if (cardCount > 0) {
    return "ok";
  }

  if (hasKnownEmptySelector) {
    return "legit-empty";
  }

  return "suspicious-empty";
}

/**
 * Decide whether the actor run should terminate with a failure status.
 * Fails when the page-1 search was suspicious or blocked AND no jobs were
 * pushed (a blocked page that somehow still produced results should not fail).
 */
export function shouldFailRun({
  page1Outcome,
  jobsPushed,
}: {
  page1Outcome: SearchOutcome;
  jobsPushed: number;
}): boolean {
  if (jobsPushed > 0) return false;
  return (
    page1Outcome === "suspicious-empty" ||
    page1Outcome === "login-redirect" ||
    page1Outcome === "blocked-http"
  );
}
