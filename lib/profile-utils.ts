import type { MissingField } from "@/types/index";

type CompletionInput = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  current_title?: string | null;
  experience_level?: string | null;
  years_experience?: number | string | null;
  skills?: string[] | null;
  work_experience?: unknown[] | null;
  education?: { degree?: string | null } | null;
};

type CompletionResult = {
  percentage: number;
  missingFields: MissingField[];
};

export function calculateCompletion(p: CompletionInput): CompletionResult {
  const missingFields: MissingField[] = [];

  if (!p.full_name?.trim()) missingFields.push("FULL NAME");
  if (!p.email?.trim()) missingFields.push("EMAIL");
  if (!p.phone?.trim()) missingFields.push("PHONE");
  if (!p.location?.trim()) missingFields.push("LOCATION");
  if (!p.current_title?.trim()) missingFields.push("CURRENT TITLE");
  if (!p.experience_level) missingFields.push("EXPERIENCE LEVEL");

  const yoe = Number(p.years_experience);
  if (!p.years_experience || isNaN(yoe) || yoe <= 0) missingFields.push("YEARS EXP");

  if (!p.skills || p.skills.length === 0) missingFields.push("SKILLS");
  if (!p.work_experience || p.work_experience.length === 0) missingFields.push("WORK EXPERIENCE");
  if (!p.education?.degree) missingFields.push("EDUCATION");

  const total = 10;
  const filled = total - missingFields.length;
  const percentage = Math.round((filled / total) * 100);

  return { percentage, missingFields };
}
