#!/usr/bin/env node
/**
 * Red/green repro for JobsDB actor duplicate sourceUrl bug.
 *
 * Usage:
 *   APIFY_TOKEN=xxx node scripts/test-jobsdb-duplicates.mjs <datasetId>
 *
 * Exit 0 = GREEN (no duplicates, ≥ 2 jobs returned).
 * Exit 1 = RED   (duplicates found OR fewer than 2 jobs).
 * Exit 2 = usage error.
 */

import { ApifyClient } from "apify-client";

const datasetId = process.argv[2];
if (!datasetId) {
  console.error("Usage: APIFY_TOKEN=xxx node scripts/test-jobsdb-duplicates.mjs <datasetId>");
  process.exit(2);
}

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("ERROR: APIFY_TOKEN env var is required.");
  process.exit(2);
}

const client = new ApifyClient({ token });
const { items } = await client.dataset(datasetId).listItems();

const sourceUrls = items.map((item) => item.sourceUrl).filter(Boolean);
const uniqueUrls = new Set(sourceUrls);

const failures = [];

// ── Assert 1: actor returned at least 2 jobs ─────────────────────────────────
if (items.length < 2) {
  failures.push(`Expected ≥ 2 jobs, got ${items.length}`);
}

// ── Assert 2: no job has an empty/null sourceUrl ──────────────────────────────
const emptyCount = items.filter((item) => !item.sourceUrl).length;
if (emptyCount > 0) {
  failures.push(`${emptyCount} job(s) have an empty/null sourceUrl`);
}

// ── Assert 3: all sourceUrls are unique ───────────────────────────────────────
if (uniqueUrls.size < sourceUrls.length) {
  const counts = {};
  for (const url of sourceUrls) counts[url] = (counts[url] || 0) + 1;
  const dups = Object.entries(counts).filter(([, n]) => n > 1);
  failures.push(`${sourceUrls.length - uniqueUrls.size} duplicate sourceUrl(s):`);
  for (const [url, n] of dups) {
    failures.push(`    ${url}  ×${n}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\nDataset: ${datasetId}`);
console.log(`Total items: ${items.length}  |  Unique sourceUrls: ${uniqueUrls.size}\n`);

if (failures.length === 0) {
  console.log("✓ GREEN — all assertions pass");
  console.log("\nSourceUrls:");
  for (const [i, url] of [...uniqueUrls].entries()) {
    console.log(`  [${i + 1}] ${url}`);
  }
  process.exit(0);
} else {
  console.error("✗ RED — assertion failures:");
  for (const f of failures) console.error(`  • ${f}`);
  console.error("\nAll sourceUrls (including duplicates):");
  for (const [i, url] of sourceUrls.entries()) {
    const isDup = (counts => counts[url] > 1)(
      sourceUrls.reduce((acc, u) => { acc[u] = (acc[u] || 0) + 1; return acc; }, {}),
    );
    console.error(`  [${i + 1}] ${isDup ? "DUP " : "    "}${url}`);
  }
  console.error("\nFull items (title + sourceUrl):");
  for (const item of items) {
    console.error(`  ${item.title ?? "(no title)"}  →  ${item.sourceUrl ?? "(empty)"}`);
  }
  process.exit(1);
}
