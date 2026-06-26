/**
 * Smoke test — NVIDIA Nemotron 3 Ultra via OpenRouter
 *
 * Run: npx tsx scripts/test-ai.ts
 *
 * Covers three things in order:
 *   1. Connectivity — can we reach OpenRouter with the key?
 *   2. JSON mode — does response_format: { type: "json_object" } work?
 *   3. Realistic prompts — do the actual system prompts used in agent/ work?
 */

// Run: node --env-file=.env.local --import tsx/esm scripts/test-ai.ts
// Or:  npx tsx --env-file=.env.local scripts/test-ai.ts
import OpenAI from "openai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string) {
  passed++;
  console.log(`  ${green("✓")} ${label}`);
  if (detail) console.log(`    ${dim(detail)}`);
}

function fail(label: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ${red("✗")} ${label}`);
  console.log(`    ${red(msg)}`);
}

// ─── Client ───────────────────────────────────────────────────────────────────

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://job-pilot.app",
    "X-Title": "JobPilot",
  },
});

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testConnectivity() {
  console.log(bold("\nTest 1 — Connectivity"));
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 20,
      messages: [{ role: "user", content: "Say only the word: hello" }],
    });
    const text = res.choices[0].message.content ?? "";
    if (!text) throw new Error("Empty response content");
    pass("OpenRouter reachable, model responded", `Response: "${text.trim()}"`);
  } catch (err) {
    fail("Could not reach OpenRouter or model refused", err);
  }
}

async function testJsonMode() {
  console.log(bold("\nTest 2 — JSON mode (response_format: json_object)"));
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content:
            'Return ONLY valid JSON. Schema: { "status": string, "value": number }',
        },
        { role: "user", content: "Confirm the model is working." },
      ],
    });

    const raw = res.choices[0].message.content ?? "";
    if (!raw) throw new Error("Empty content in JSON mode response");

    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      throw new Error(`Parsed value is not an object: ${typeof parsed}`);

    pass(
      "response_format: json_object returns parseable JSON",
      `Parsed: ${JSON.stringify(parsed)}`
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      fail("Response was not valid JSON — json_object mode may not be supported", err);
    } else {
      fail("JSON mode test failed", err);
    }
  }
}

async function testExtractionPrompt() {
  console.log(bold("\nTest 3 — Extraction prompt (mirrors agent/extractor.ts)"));

  const SYSTEM = `You extract profile information from resume text. Return ONLY valid JSON matching the exact shape below. Use null for any field you cannot confidently extract — never guess.

{
  "full_name": string | null,
  "current_title": string | null,
  "experience_level": "junior" | "mid" | "senior" | "lead" | null,
  "skills": string[]
}`;

  const RESUME_SNIPPET = `
Jane Smith
Senior Frontend Engineer

Skills: React, TypeScript, Next.js, GraphQL, Tailwind CSS
5 years of experience building consumer-facing web products.
`;

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `RESUME TEXT:\n${RESUME_SNIPPET}` },
      ],
    });

    const raw = res.choices[0].message.content ?? "";
    const parsed = JSON.parse(raw) as {
      full_name: string | null;
      current_title: string | null;
      experience_level: string | null;
      skills: string[];
    };

    const checks: string[] = [];
    if (parsed.full_name) checks.push(`name="${parsed.full_name}"`);
    if (parsed.experience_level) checks.push(`level="${parsed.experience_level}"`);
    if (Array.isArray(parsed.skills) && parsed.skills.length > 0)
      checks.push(`skills=[${parsed.skills.slice(0, 3).join(", ")}…]`);

    if (checks.length === 0)
      throw new Error(`Model returned valid JSON but extracted nothing useful: ${raw}`);

    pass("Extraction prompt returns typed JSON", checks.join(", "));
  } catch (err) {
    fail("Extraction prompt test failed", err);
  }
}

async function testGenerationPrompt() {
  console.log(bold("\nTest 4 — Generation prompt (mirrors agent/pdf-generator.tsx)"));

  const SYSTEM = `You are a professional resume writer. Return ONLY valid JSON with this shape:
{
  "summary": string,
  "workExperience": [{ "company": string, "title": string, "period": string, "bullets": string[] }]
}
Keep summary to 2 sentences. One work entry with 2 bullets.`;

  const PROFILE = `NAME: Jane Smith
CURRENT TITLE: Senior Frontend Engineer
SKILLS: React, TypeScript, Next.js
WORK EXPERIENCE:
Company: Acme Corp
Title: Frontend Engineer
Period: 2020 – Present
Responsibilities: Built the main dashboard used by 50,000 daily users. Led migration from React class components to hooks.`;

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: PROFILE },
      ],
    });

    const raw = res.choices[0].message.content ?? "";
    const parsed = JSON.parse(raw) as {
      summary: string;
      workExperience: { company: string; title: string; period: string; bullets: string[] }[];
    };

    if (!parsed.summary || typeof parsed.summary !== "string")
      throw new Error("summary field missing or wrong type");
    if (!Array.isArray(parsed.workExperience) || parsed.workExperience.length === 0)
      throw new Error("workExperience array missing or empty");
    const entry = parsed.workExperience[0];
    if (!Array.isArray(entry.bullets) || entry.bullets.length === 0)
      throw new Error("bullets array missing or empty");

    pass(
      "Generation prompt returns shaped JSON",
      `summary="${parsed.summary.slice(0, 60)}…", bullets=${entry.bullets.length}`
    );
  } catch (err) {
    fail("Generation prompt test failed", err);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(bold("=== JobPilot AI Smoke Tests ==="));
  console.log(dim(`Model: ${MODEL}`));
  console.log(dim(`Key:   ${process.env.OPENROUTER_API_KEY ? "set ✓" : "MISSING ✗"}`));

  if (!process.env.OPENROUTER_API_KEY) {
    console.log(red("\nOPENROUTER_API_KEY not set in .env.local — aborting."));
    process.exit(1);
  }

  await testConnectivity();
  await testJsonMode();
  await testExtractionPrompt();
  await testGenerationPrompt();

  console.log(
    `\n${bold("Results:")} ${green(`${passed} passed`)}  ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}\n`
  );

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(red("\nUnhandled error:"), err);
  process.exit(1);
});
