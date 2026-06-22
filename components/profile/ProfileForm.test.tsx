import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Mock server actions and utilities
vi.mock("@/actions/profile", () => ({
  saveProfile: vi.fn().mockResolvedValue({ success: true }),
  uploadResume: vi.fn().mockResolvedValue({ success: true, filename: "resume.pdf" }),
  getResumeSignedUrl: vi.fn().mockResolvedValue({ url: "https://example.com/resume.pdf" }),
}));

vi.mock("@/lib/profile-utils", () => ({
  calculateCompletion: vi.fn().mockReturnValue({
    percentage: 50,
    missingFields: [],
  }),
}));

// lucide-react icons - mock to avoid SVG rendering issues
vi.mock("lucide-react", () => ({
  AlertCircle: () => null,
  CheckCircle: () => null,
  Upload: () => null,
  Plus: () => null,
  X: () => null,
}));

import { ProfileForm } from "./ProfileForm";

const SAMPLE_EXTRACTION = {
  full_name: "Jane Smith",
  phone: "(555) 999-8888",
  location: "New York, US",
  current_title: "Senior Developer",
  experience_level: "senior" as const,
  years_experience: 8,
  linkedin_url: "https://linkedin.com/in/janesmith",
  portfolio_url: "https://github.com/janesmith",
  work_authorization: "citizen" as const,
  remote_preference: "remote" as const,
  salary_expectation: "$150k+",
  skills: ["React", "TypeScript", "Node.js"],
  industries: ["FinTech", "Healthcare"],
  job_titles_seeking: ["Senior Engineer", "Tech Lead"],
  work_experience: [
    {
      company: "TechCorp",
      title: "Senior Developer",
      startDate: "2020-01",
      endDate: null,
      current: true,
      responsibilities: "Led frontend architecture",
    },
  ],
  education: {
    degree: "Bachelor's",
    fieldOfStudy: "Computer Science",
    institution: "State University",
    graduationYear: "2015",
  },
};

const PROFILE_WITH_RESUME = {
  id: "user-123",
  full_name: "Old Name",
  email: "test@example.com",
  phone: "555-000-0000",
  location: "Chicago, US",
  current_title: "Developer",
  experience_level: "mid" as const,
  years_experience: 3,
  skills: ["JavaScript"],
  industries: [],
  work_experience: [],
  education: null,
  job_titles_seeking: [],
  remote_preference: null,
  preferred_locations: [],
  salary_expectation: null,
  cover_letter_tone: null,
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  resume_pdf_url: "https://example.com/resume.pdf",
  resume_pdf_key: "resumes/user-123/resume.pdf",
  resume_pdf_filename: "my-resume.pdf",
  linkedin_connected: false,
  is_tailored: false,
  is_complete: false,
  created_at: "2024-01-01",
  updated_at: "2024-01-01",
};

describe("ProfileForm — Extract from Resume feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe("Extract button visibility", () => {
    it("does not render the Extract button when no resume is uploaded", () => {
      const profileWithoutResume = {
        ...PROFILE_WITH_RESUME,
        resume_pdf_key: null,
        resume_pdf_filename: null,
      };

      render(<ProfileForm profile={profileWithoutResume} email="test@example.com" />);

      expect(screen.queryByText("Extract from Resume")).toBeNull();
    });

    it("renders the Extract button when a resume filename is present", () => {
      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      expect(screen.getByRole("button", { name: "Extract from Resume" })).toBeDefined();
    });

    it("renders the Extract button when resume_pdf_key exists but no filename", () => {
      const profileWithKey = {
        ...PROFILE_WITH_RESUME,
        resume_pdf_filename: null,
        resume_pdf_key: "resumes/user-123/resume.pdf",
      };

      render(<ProfileForm profile={profileWithKey} email="test@example.com" />);

      expect(screen.getByRole("button", { name: "Extract from Resume" })).toBeDefined();
    });

    it("does not show extraction feedback before any extraction has been attempted", () => {
      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      expect(
        screen.queryByText(/Profile filled in from your resume/)
      ).toBeNull();
    });
  });

  describe("Successful extraction", () => {
    it("calls /api/profile/extract with POST method on button click", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: () => Promise.resolve({ success: true, data: SAMPLE_EXTRACTION }),
      });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
      await act(async () => {
        fireEvent.click(extractButton);
      });

      expect(global.fetch).toHaveBeenCalledWith("/api/profile/extract", {
        method: "POST",
      });
    });

    it("shows success message after successful extraction", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: () => Promise.resolve({ success: true, data: SAMPLE_EXTRACTION }),
      });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(
          screen.getByText(/Profile filled in from your resume/)
        ).toBeDefined();
      });
    });

    it("does not show error message after successful extraction", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: () => Promise.resolve({ success: true, data: SAMPLE_EXTRACTION }),
      });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(screen.queryByText(/error/i)).toBeNull();
      });
    });
  });

  describe("Failed extraction", () => {
    it("shows the error message returned by the API on failure", async () => {
      const errorMessage = "Could not extract text from this PDF. Please try a different file.";
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: () => Promise.resolve({ success: false, error: errorMessage }),
      });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeDefined();
      });
    });

    it("does not show success message on extraction failure", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        json: () =>
          Promise.resolve({ success: false, error: "Extraction failed" }),
      });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(
          screen.queryByText(/Profile filled in from your resume/)
        ).toBeNull();
      });
    });
  });

  describe("extractResult state reset on new extraction", () => {
    it("clears previous result before starting a new extraction", async () => {
      // First call fails, second succeeds
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ success: false, error: "First error" }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ success: true, data: SAMPLE_EXTRACTION }),
        });

      render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

      const extractButton = screen.getByRole("button", { name: "Extract from Resume" });

      // First extraction - fails
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(screen.getByText("First error")).toBeDefined();
      });

      // Second extraction - succeeds
      await act(async () => {
        fireEvent.click(extractButton);
      });

      await waitFor(() => {
        expect(screen.queryByText("First error")).toBeNull();
        expect(screen.getByText(/Profile filled in from your resume/)).toBeDefined();
      });
    });
  });
});

describe("applyExtraction — null-safe form population", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("populates scalar fields from extraction data", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: SAMPLE_EXTRACTION }),
    });

    render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

    // Verify initial state
    const fullNameInput = screen.getByPlaceholderText("Your full name") as HTMLInputElement;
    expect(fullNameInput.value).toBe("Old Name");

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    // After extraction, full_name should be updated from "Old Name" to "Jane Smith"
    await waitFor(() => {
      expect(fullNameInput.value).toBe("Jane Smith");
    });
  });

  it("does not overwrite fields when extraction returns null for them", async () => {
    const extractionWithNulls = {
      ...SAMPLE_EXTRACTION,
      phone: null,
      location: null,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: extractionWithNulls }),
    });

    render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

    const phoneInput = screen.getByPlaceholderText("(555) 000-0000") as HTMLInputElement;
    expect(phoneInput.value).toBe("555-000-0000"); // initial value from profile

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    await waitFor(() => {
      // Phone should remain unchanged because extraction returned null
      expect(phoneInput.value).toBe("555-000-0000");
    });
  });

  it("converts years_experience number to string in form state", async () => {
    const extractionWithYears = {
      ...SAMPLE_EXTRACTION,
      years_experience: 8,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: extractionWithYears }),
    });

    render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

    const yearsInput = screen.getByPlaceholderText("4") as HTMLInputElement;

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    await waitFor(() => {
      expect(yearsInput.value).toBe("8");
    });
  });

  it("does not update skills when extraction returns empty array", async () => {
    const extractionWithNoSkills = {
      ...SAMPLE_EXTRACTION,
      skills: [],
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: extractionWithNoSkills }),
    });

    render(
      <ProfileForm
        profile={{ ...PROFILE_WITH_RESUME, skills: ["JavaScript"] }}
        email="test@example.com"
      />
    );

    // Initial skills tag should exist
    expect(screen.getByText("JavaScript")).toBeDefined();

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    // Skills should NOT be replaced with empty array
    await waitFor(() => {
      expect(screen.getByText("JavaScript")).toBeDefined();
    });
  });

  it("updates skills when extraction returns a non-empty array", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: { ...SAMPLE_EXTRACTION, skills: ["React", "TypeScript", "Node.js"] },
        }),
    });

    render(
      <ProfileForm
        profile={{ ...PROFILE_WITH_RESUME, skills: ["JavaScript"] }}
        email="test@example.com"
      />
    );

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    await waitFor(() => {
      expect(screen.getByText("React")).toBeDefined();
      expect(screen.getByText("TypeScript")).toBeDefined();
      expect(screen.getByText("Node.js")).toBeDefined();
    });
  });

  it("does not update education when extraction returns education with null degree", async () => {
    const extractionWithNullDegree = {
      ...SAMPLE_EXTRACTION,
      education: {
        degree: null,
        fieldOfStudy: "Computer Science",
        institution: "MIT",
        graduationYear: "2015",
      },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: extractionWithNullDegree }),
    });

    render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    // Education should not be updated because degree is null
    await waitFor(() => {
      // MIT should not appear (education was not applied)
      const institutionInput = screen.getByPlaceholderText("e.g. State University") as HTMLInputElement;
      expect(institutionInput.value).toBe("");
    });
  });

  it("updates education when extraction returns a non-null degree", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            ...SAMPLE_EXTRACTION,
            education: {
              degree: "Master's",
              fieldOfStudy: "Computer Science",
              institution: "MIT",
              graduationYear: "2015",
            },
          },
        }),
    });

    render(<ProfileForm profile={PROFILE_WITH_RESUME} email="test@example.com" />);

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    await waitFor(() => {
      const institutionInput = screen.getByPlaceholderText("e.g. State University") as HTMLInputElement;
      expect(institutionInput.value).toBe("MIT");
    });
  });

  it("preserves existing profile fields that extraction does not return", async () => {
    // cover_letter_tone is not a ProfileExtraction field, should be untouched
    const profileWithTone = {
      ...PROFILE_WITH_RESUME,
      cover_letter_tone: "formal" as const,
    };

    const extractionWithoutAllFields = {
      full_name: "Jane Smith",
      skills: ["React"],
      // missing many other fields
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () =>
        Promise.resolve({ success: true, data: extractionWithoutAllFields }),
    });

    render(<ProfileForm profile={profileWithTone} email="test@example.com" />);

    const extractButton = screen.getByRole("button", { name: "Extract from Resume" });
    await act(async () => {
      fireEvent.click(extractButton);
    });

    await waitFor(() => {
      // full_name should update
      const fullNameInput = screen.getByPlaceholderText("Your full name") as HTMLInputElement;
      expect(fullNameInput.value).toBe("Jane Smith");
    });

    // Phone and location (not in extraction) should remain from original profile
    const phoneInput = screen.getByPlaceholderText("(555) 000-0000") as HTMLInputElement;
    expect(phoneInput.value).toBe("555-000-0000");
  });
});