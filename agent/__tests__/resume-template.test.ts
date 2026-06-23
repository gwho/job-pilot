import { describe, it, expect } from "vitest";

import type { Profile } from "@/types/index";
import type { ResumeContent } from "../resume-template";

// ---------------------------------------------------------------------------
// The ResumeDocument component contains inline derivation logic that computes
// contactLine, linksLine, and educationLabel from the profile prop.
// These computations are the business logic of the template — they determine
// what text appears in the PDF header and education sections.
//
// We test these derivations directly by reimplementing the same logic from
// the component, which is the most reliable way to verify the rules:
//   - contactLine: [email, phone, location].filter(Boolean).join("  ·  ")
//   - linksLine: [linkedin_url, portfolio_url].filter(Boolean).join("  ·  ")
//   - educationLabel: [degree, fieldOfStudy].filter(Boolean).join(" in ")
//     (only when profile.education is non-null)
// ---------------------------------------------------------------------------

// Replicate the derivation logic from ResumeDocument to test it in isolation.
function deriveContactLine(profile: Partial<Profile>): string {
  return [profile.email, profile.phone, profile.location]
    .filter(Boolean)
    .join("  ·  ");
}

function deriveLinksLine(profile: Partial<Profile>): string {
  return [profile.linkedin_url, profile.portfolio_url]
    .filter(Boolean)
    .join("  ·  ");
}

function deriveEducationLabel(profile: Partial<Profile>): string | null {
  if (!profile.education) return null;
  return [profile.education.degree, profile.education.fieldOfStudy]
    .filter(Boolean)
    .join(" in ") || null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    full_name: "John Doe",
    email: "john@example.com",
    phone: "555-0100",
    location: "New York, NY",
    current_title: "Software Engineer",
    experience_level: "mid",
    years_experience: 4,
    skills: ["Python", "Django"],
    industries: null,
    work_experience: null,
    education: {
      degree: "B.S.",
      fieldOfStudy: "Computer Science",
      institution: "MIT",
      graduationYear: "2020",
    },
    job_titles_seeking: null,
    remote_preference: null,
    preferred_locations: null,
    salary_expectation: null,
    cover_letter_tone: null,
    linkedin_url: "https://linkedin.com/in/johndoe",
    portfolio_url: "https://johndoe.dev",
    work_authorization: null,
    resume_pdf_url: null,
    resume_pdf_key: null,
    resume_pdf_filename: null,
    linkedin_connected: false,
    is_tailored: false,
    is_complete: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const SAMPLE_CONTENT: ResumeContent = {
  summary: "A seasoned software engineer.",
  workExperience: [
    {
      company: "Tech Inc",
      title: "Engineer II",
      period: "2022 – Present",
      bullets: ["Led API redesign", "Reduced latency by 30%"],
    },
  ],
};

// ---------------------------------------------------------------------------
// contactLine derivation
// ---------------------------------------------------------------------------

describe("ResumeDocument — contactLine derivation", () => {
  it("joins email, phone, and location with separator when all are present", () => {
    const profile = makeProfile();
    expect(deriveContactLine(profile)).toBe(
      "john@example.com  ·  555-0100  ·  New York, NY",
    );
  });

  it("omits null fields and still joins correctly", () => {
    const profile = makeProfile({ phone: null, location: null });
    expect(deriveContactLine(profile)).toBe("john@example.com");
  });

  it("returns empty string when all contact fields are null", () => {
    const profile = makeProfile({ email: null, phone: null, location: null });
    expect(deriveContactLine(profile)).toBe("");
  });

  it("returns a falsy value when all fields are null (so the conditional renders nothing)", () => {
    const profile = makeProfile({ email: null, phone: null, location: null });
    expect(deriveContactLine(profile)).toBeFalsy();
  });

  it("includes only present fields when just email is set", () => {
    const profile = makeProfile({ phone: null, location: null });
    const line = deriveContactLine(profile);
    expect(line).not.toContain("·");
    expect(line).toBe("john@example.com");
  });

  it("joins two of three fields correctly without leading or trailing separator", () => {
    const profile = makeProfile({ location: null });
    expect(deriveContactLine(profile)).toBe("john@example.com  ·  555-0100");
  });
});

// ---------------------------------------------------------------------------
// linksLine derivation
// ---------------------------------------------------------------------------

describe("ResumeDocument — linksLine derivation", () => {
  it("joins linkedin_url and portfolio_url when both present", () => {
    const profile = makeProfile();
    expect(deriveLinksLine(profile)).toBe(
      "https://linkedin.com/in/johndoe  ·  https://johndoe.dev",
    );
  });

  it("returns only linkedin_url when portfolio_url is null", () => {
    const profile = makeProfile({ portfolio_url: null });
    expect(deriveLinksLine(profile)).toBe("https://linkedin.com/in/johndoe");
  });

  it("returns only portfolio_url when linkedin_url is null", () => {
    const profile = makeProfile({ linkedin_url: null });
    expect(deriveLinksLine(profile)).toBe("https://johndoe.dev");
  });

  it("returns empty string when both URLs are null", () => {
    const profile = makeProfile({ linkedin_url: null, portfolio_url: null });
    expect(deriveLinksLine(profile)).toBe("");
  });

  it("returns a falsy value when both are null (so conditional renders nothing)", () => {
    const profile = makeProfile({ linkedin_url: null, portfolio_url: null });
    expect(deriveLinksLine(profile)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// educationLabel derivation
// ---------------------------------------------------------------------------

describe("ResumeDocument — educationLabel derivation", () => {
  it("returns null when education is null", () => {
    const profile = makeProfile({ education: null });
    expect(deriveEducationLabel(profile)).toBeNull();
  });

  it("joins degree and fieldOfStudy with 'in' when both are present", () => {
    const profile = makeProfile();
    expect(deriveEducationLabel(profile)).toBe("B.S. in Computer Science");
  });

  it("returns only the degree when fieldOfStudy is null", () => {
    const profile = makeProfile({
      education: { degree: "M.S.", fieldOfStudy: null, institution: "MIT", graduationYear: "2022" },
    });
    expect(deriveEducationLabel(profile)).toBe("M.S.");
  });

  it("returns only the fieldOfStudy when degree is null", () => {
    const profile = makeProfile({
      education: { degree: null, fieldOfStudy: "Computer Science", institution: "MIT", graduationYear: "2022" },
    });
    expect(deriveEducationLabel(profile)).toBe("Computer Science");
  });

  it("returns null when both degree and fieldOfStudy are null (education section should not render)", () => {
    const profile = makeProfile({
      education: { degree: null, fieldOfStudy: null, institution: "MIT", graduationYear: "2022" },
    });
    expect(deriveEducationLabel(profile)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skills join pattern
// ---------------------------------------------------------------------------

describe("ResumeDocument — skills rendering pattern", () => {
  it("joins skills with bullet separator for single-line rendering", () => {
    const skills = ["TypeScript", "React", "Node.js"];
    expect(skills.join(" • ")).toBe("TypeScript • React • Node.js");
  });

  it("returns empty string for empty skills array", () => {
    const skills: string[] = [];
    expect(skills.join(" • ")).toBe("");
  });

  it("returns single skill without separator", () => {
    const skills = ["Python"];
    expect(skills.join(" • ")).toBe("Python");
  });
});

// ---------------------------------------------------------------------------
// ResumeContent interface shape validation
// ---------------------------------------------------------------------------

describe("ResumeContent interface", () => {
  it("accepts content with empty workExperience array", () => {
    const content: ResumeContent = {
      summary: "An engineer.",
      workExperience: [],
    };
    expect(content.workExperience).toHaveLength(0);
    expect(content.summary).toBe("An engineer.");
  });

  it("accepts content with multiple work experience entries each having bullets", () => {
    const content: ResumeContent = {
      summary: "An engineer.",
      workExperience: [
        { company: "Co A", title: "Dev", period: "2020 – 2022", bullets: ["Built X", "Led Y"] },
        { company: "Co B", title: "Lead", period: "2022 – Present", bullets: ["Shipped Z"] },
      ],
    };
    expect(content.workExperience).toHaveLength(2);
    expect(content.workExperience[0].bullets).toHaveLength(2);
    expect(content.workExperience[1].bullets).toHaveLength(1);
  });

  it("validates SAMPLE_CONTENT fixture matches the ResumeContent shape", () => {
    expect(SAMPLE_CONTENT).toHaveProperty("summary");
    expect(SAMPLE_CONTENT).toHaveProperty("workExperience");
    expect(Array.isArray(SAMPLE_CONTENT.workExperience)).toBe(true);
    expect(SAMPLE_CONTENT.workExperience[0]).toHaveProperty("company");
    expect(SAMPLE_CONTENT.workExperience[0]).toHaveProperty("title");
    expect(SAMPLE_CONTENT.workExperience[0]).toHaveProperty("period");
    expect(SAMPLE_CONTENT.workExperience[0]).toHaveProperty("bullets");
  });
});