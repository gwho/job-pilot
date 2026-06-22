import { describe, it, expect } from "vitest";
import { calculateCompletion } from "./profile-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPLETE_INPUT = {
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone: "555-0100",
  location: "New York, USA",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: "7",
  skills: ["TypeScript", "React"],
  work_experience: [
    {
      company: "Acme Corp",
      title: "Engineer",
      startDate: "2020",
      endDate: null,
      current: true,
      responsibilities: "Built things.",
    },
  ],
  education: { degree: "Bachelor's", fieldOfStudy: null, institution: null, graduationYear: null },
};

// ---------------------------------------------------------------------------
// calculateCompletion
// ---------------------------------------------------------------------------

describe("calculateCompletion", () => {
  // ------------------------------------------------------------------
  // 100% complete path
  // ------------------------------------------------------------------
  describe("when all required fields are present", () => {
    it("returns 100% and empty missingFields array", () => {
      const result = calculateCompletion(COMPLETE_INPUT);
      expect(result.percentage).toBe(100);
      expect(result.missingFields).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // 0% complete path
  // ------------------------------------------------------------------
  describe("when no fields are present", () => {
    it("returns 0% and all ten missing fields", () => {
      const result = calculateCompletion({});
      expect(result.percentage).toBe(0);
      expect(result.missingFields).toHaveLength(10);
      expect(result.missingFields).toContain("FULL NAME");
      expect(result.missingFields).toContain("EMAIL");
      expect(result.missingFields).toContain("PHONE");
      expect(result.missingFields).toContain("LOCATION");
      expect(result.missingFields).toContain("CURRENT TITLE");
      expect(result.missingFields).toContain("EXPERIENCE LEVEL");
      expect(result.missingFields).toContain("YEARS EXP");
      expect(result.missingFields).toContain("SKILLS");
      expect(result.missingFields).toContain("WORK EXPERIENCE");
      expect(result.missingFields).toContain("EDUCATION");
    });
  });

  // ------------------------------------------------------------------
  // Missing one field at a time — verifies each field name
  // ------------------------------------------------------------------
  describe("FULL NAME field", () => {
    it("reports FULL NAME missing when full_name is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, full_name: null });
      expect(result.missingFields).toContain("FULL NAME");
    });

    it("reports FULL NAME missing when full_name is empty string", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, full_name: "" });
      expect(result.missingFields).toContain("FULL NAME");
    });

    it("reports FULL NAME missing when full_name is whitespace only", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, full_name: "   " });
      expect(result.missingFields).toContain("FULL NAME");
    });

    it("does NOT report FULL NAME missing when full_name is present", () => {
      const result = calculateCompletion(COMPLETE_INPUT);
      expect(result.missingFields).not.toContain("FULL NAME");
    });
  });

  describe("EMAIL field", () => {
    it("reports EMAIL missing when email is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, email: null });
      expect(result.missingFields).toContain("EMAIL");
    });

    it("reports EMAIL missing when email is empty string", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, email: "" });
      expect(result.missingFields).toContain("EMAIL");
    });

    it("reports EMAIL missing when email is whitespace", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, email: "  " });
      expect(result.missingFields).toContain("EMAIL");
    });
  });

  describe("PHONE field", () => {
    it("reports PHONE missing when phone is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, phone: null });
      expect(result.missingFields).toContain("PHONE");
    });

    it("does NOT report PHONE missing when phone is present", () => {
      const result = calculateCompletion(COMPLETE_INPUT);
      expect(result.missingFields).not.toContain("PHONE");
    });
  });

  describe("LOCATION field", () => {
    it("reports LOCATION missing when location is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, location: null });
      expect(result.missingFields).toContain("LOCATION");
    });
  });

  describe("CURRENT TITLE field", () => {
    it("reports CURRENT TITLE missing when current_title is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, current_title: null });
      expect(result.missingFields).toContain("CURRENT TITLE");
    });
  });

  describe("EXPERIENCE LEVEL field", () => {
    it("reports EXPERIENCE LEVEL missing when experience_level is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, experience_level: null });
      expect(result.missingFields).toContain("EXPERIENCE LEVEL");
    });

    it("reports EXPERIENCE LEVEL missing when experience_level is empty string", () => {
      // Empty string is falsy — the gate is `!p.experience_level`
      const result = calculateCompletion({ ...COMPLETE_INPUT, experience_level: "" });
      expect(result.missingFields).toContain("EXPERIENCE LEVEL");
    });

    it("does NOT report EXPERIENCE LEVEL missing for any valid level", () => {
      for (const level of ["junior", "mid", "senior", "lead"]) {
        const result = calculateCompletion({ ...COMPLETE_INPUT, experience_level: level });
        expect(result.missingFields).not.toContain("EXPERIENCE LEVEL");
      }
    });
  });

  describe("YEARS EXP field", () => {
    it("reports YEARS EXP missing when years_experience is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: null });
      expect(result.missingFields).toContain("YEARS EXP");
    });

    it("reports YEARS EXP missing when years_experience is 0 as string", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: "0" });
      expect(result.missingFields).toContain("YEARS EXP");
    });

    it("reports YEARS EXP missing when years_experience is negative", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: "-1" });
      expect(result.missingFields).toContain("YEARS EXP");
    });

    it("reports YEARS EXP missing when years_experience is non-numeric string", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: "abc" });
      expect(result.missingFields).toContain("YEARS EXP");
    });

    it("does NOT report YEARS EXP missing when years_experience is 1 as string", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: "1" });
      expect(result.missingFields).not.toContain("YEARS EXP");
    });

    it("accepts years_experience as a number (not just string)", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, years_experience: 5 });
      expect(result.missingFields).not.toContain("YEARS EXP");
    });
  });

  describe("SKILLS field", () => {
    it("reports SKILLS missing when skills is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, skills: null });
      expect(result.missingFields).toContain("SKILLS");
    });

    it("reports SKILLS missing when skills is empty array", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, skills: [] });
      expect(result.missingFields).toContain("SKILLS");
    });

    it("does NOT report SKILLS missing when at least one skill is present", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, skills: ["React"] });
      expect(result.missingFields).not.toContain("SKILLS");
    });
  });

  describe("WORK EXPERIENCE field", () => {
    it("reports WORK EXPERIENCE missing when work_experience is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, work_experience: null });
      expect(result.missingFields).toContain("WORK EXPERIENCE");
    });

    it("reports WORK EXPERIENCE missing when work_experience is empty array", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, work_experience: [] });
      expect(result.missingFields).toContain("WORK EXPERIENCE");
    });

    it("does NOT report WORK EXPERIENCE missing when at least one entry exists", () => {
      const result = calculateCompletion(COMPLETE_INPUT);
      expect(result.missingFields).not.toContain("WORK EXPERIENCE");
    });
  });

  describe("EDUCATION field", () => {
    it("reports EDUCATION missing when education is null", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, education: null });
      expect(result.missingFields).toContain("EDUCATION");
    });

    it("reports EDUCATION missing when education.degree is null", () => {
      const result = calculateCompletion({
        ...COMPLETE_INPUT,
        education: { degree: null },
      });
      expect(result.missingFields).toContain("EDUCATION");
    });

    it("reports EDUCATION missing when education.degree is empty string", () => {
      const result = calculateCompletion({
        ...COMPLETE_INPUT,
        education: { degree: "" },
      });
      expect(result.missingFields).toContain("EDUCATION");
    });

    it("does NOT report EDUCATION missing when degree is set", () => {
      const result = calculateCompletion({
        ...COMPLETE_INPUT,
        education: { degree: "Bachelor's" },
      });
      expect(result.missingFields).not.toContain("EDUCATION");
    });
  });

  // ------------------------------------------------------------------
  // Percentage calculation
  // ------------------------------------------------------------------
  describe("percentage calculation", () => {
    it("returns 90% when exactly one field is missing (1 of 10)", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, full_name: null });
      expect(result.percentage).toBe(90);
    });

    it("returns 80% when two fields are missing (2 of 10)", () => {
      const result = calculateCompletion({
        ...COMPLETE_INPUT,
        full_name: null,
        phone: null,
      });
      expect(result.percentage).toBe(80);
    });

    it("returns 50% when five fields are missing (5 of 10)", () => {
      const result = calculateCompletion({
        full_name: "Jane",
        email: "jane@example.com",
        phone: "555-0100",
        location: "NYC",
        current_title: "Engineer",
        // experience_level, years_experience, skills, work_experience, education missing
      });
      expect(result.percentage).toBe(50);
    });

    it("rounds percentage to nearest integer", () => {
      // 7/10 = 70%
      const result = calculateCompletion({
        full_name: "Jane",
        email: "jane@example.com",
        phone: "555-0100",
        location: "NYC",
        current_title: "Engineer",
        experience_level: "mid",
        years_experience: "3",
        // 3 missing: skills, work_experience, education
      });
      expect(result.percentage).toBe(70);
    });

    it("percentage is always between 0 and 100 inclusive", () => {
      const empty = calculateCompletion({});
      const full = calculateCompletion(COMPLETE_INPUT);
      expect(empty.percentage).toBeGreaterThanOrEqual(0);
      expect(empty.percentage).toBeLessThanOrEqual(100);
      expect(full.percentage).toBeGreaterThanOrEqual(0);
      expect(full.percentage).toBeLessThanOrEqual(100);
    });
  });

  // ------------------------------------------------------------------
  // Return shape
  // ------------------------------------------------------------------
  describe("return shape", () => {
    it("always returns an object with percentage and missingFields", () => {
      const result = calculateCompletion({});
      expect(result).toHaveProperty("percentage");
      expect(result).toHaveProperty("missingFields");
      expect(Array.isArray(result.missingFields)).toBe(true);
    });

    it("missingFields contains no duplicates", () => {
      const result = calculateCompletion({});
      const unique = new Set(result.missingFields);
      expect(unique.size).toBe(result.missingFields.length);
    });
  });

  // ------------------------------------------------------------------
  // Regression: whitespace-only strings treated as empty
  // ------------------------------------------------------------------
  describe("whitespace trimming regression", () => {
    it("treats whitespace-only phone as missing", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, phone: "   " });
      expect(result.missingFields).toContain("PHONE");
    });

    it("treats whitespace-only location as missing", () => {
      const result = calculateCompletion({ ...COMPLETE_INPUT, location: "\t" });
      expect(result.missingFields).toContain("LOCATION");
    });
  });
});