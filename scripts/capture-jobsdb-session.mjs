/**
 * Capture a logged-in JobsDB HK session and upload it to Apify KV store.
 *
 * Usage:
 *   node scripts/capture-jobsdb-session.mjs
 *
 * Uses the real Google Chrome (not Playwright's Chromium) to avoid bot detection.
 * Chrome is much less likely to trigger CAPTCHA / "Verify you are human" challenges.
 */

import pkg from '../apify/jobsdb-hk-actor/node_modules/playwright/index.js';
const { chromium } = pkg;
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ─── Load env vars from .env.local ────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');

const env = {};
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
  });
}

const APIFY_TOKEN = env.APIFY_TOKEN;
const STORE_ID = env.APIFY_SESSION_STORE_ID;

if (!APIFY_TOKEN) {
  console.error('❌  APIFY_TOKEN not found in .env.local');
  process.exit(1);
}

const SESSION_PATH = path.join(__dirname, 'jobsdb_session.json');

// ─── Upload helper ────────────────────────────────────────────────────────────

async function uploadToApify(sessionJson) {
  if (!STORE_ID) {
    console.warn('⚠️  APIFY_SESSION_STORE_ID not set in .env.local — skipping upload.');
    console.warn(`   Session saved locally at: ${SESSION_PATH}`);
    return false;
  }

  const res = await fetch(
    `https://api.apify.com/v2/key-value-stores/${STORE_ID}/records/JOBSDB_SESSION?token=${APIFY_TOKEN}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: sessionJson,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('❌  Upload failed:', res.status, text);
    return false;
  }

  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n🌐  Launching Google Chrome for JobsDB login...\n');
console.log('   (Using real Chrome to avoid bot-detection / CAPTCHA failures)\n');

// channel: 'chrome' uses your installed Google Chrome binary, not Playwright's
// bundled Chromium. Real Chrome passes bot-detection fingerprinting that
// Playwright's Chromium fails.
let browser;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled', // hide webdriver flag
    ],
  });
} catch {
  // Fall back to Playwright's Chromium if Chrome isn't installed
  console.warn('⚠️  Google Chrome not found — falling back to Playwright Chromium.');
  console.warn('   If you see a CAPTCHA, try installing Chrome from https://chrome.google.com\n');
  browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  // Use a real Chrome user agent so JobsDB doesn't flag the session
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});

const page = await context.newPage();

// Mask the webdriver property that CAPTCHA checks look for
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

await page.goto('https://hk.jobsdb.com/hk/account/login', { waitUntil: 'domcontentloaded' });

console.log('📋  Steps:');
console.log('   1. Log into JobsDB in the browser window that just opened');
console.log('   2. You can use Google Sign-In or your JobsDB credentials');
console.log('   3. If a CAPTCHA appears — solve it normally, then continue logging in');
console.log('   4. Once you see the JobsDB homepage, this script captures automatically\n');

// Poll for login completion
let loginDetected = false;
const loginTimeout = 5 * 60 * 1000; // 5 minutes

console.log('⏳  Waiting for login (up to 5 minutes)...\n');

await new Promise((resolve) => {
  const startTime = Date.now();
  const check = async () => {
    try {
      const url = page.url();
      const onJobsDb = url.includes('hk.jobsdb.com') || url.includes('jobsdb.com');
      const onAuthPage =
        url.includes('/login') ||
        url.includes('/sign-in') ||
        url.includes('/account/') ||
        url.includes('accounts.google.com') ||
        url.includes('login.seek.com') ||
        url.includes('about:blank');
      if (onJobsDb && !onAuthPage) {
        loginDetected = true;
        console.log(`✅  Login detected! (${url})\n`);
        resolve();
        return;
      }
    } catch { /* navigating */ }

    if (Date.now() - startTime > loginTimeout) {
      console.log('⏰  5-minute timeout — capturing whatever session exists.\n');
      resolve();
      return;
    }
    setTimeout(check, 2000);
  };
  setTimeout(check, 2000);
});

// Let post-login redirects settle
await page.waitForTimeout(2000);

const storageState = await context.storageState();
await browser.close();

if (!loginDetected || !storageState.cookies?.length) {
  console.error('❌  No cookies captured. Complete the login before the 5-minute timeout.');
  process.exit(1);
}

const sessionJson = JSON.stringify(storageState, null, 2);
writeFileSync(SESSION_PATH, sessionJson, 'utf8');
console.log(`💾  Session saved: ${SESSION_PATH} (${storageState.cookies.length} cookies)\n`);

console.log('📤  Uploading to Apify KV store...');
const ok = await uploadToApify(sessionJson);

if (ok) {
  console.log(`✅  Uploaded to store ${STORE_ID} → key JOBSDB_SESSION`);
  console.log('\n🎉  Done! The actor will use this session on its next run.');
  console.log('    Re-run this script when the session expires (typically 14–30 days).\n');
} else {
  console.log(`\n📄  Session file: ${SESSION_PATH}`);
  console.log('    Upload manually via Apify Console when ready.\n');
}
