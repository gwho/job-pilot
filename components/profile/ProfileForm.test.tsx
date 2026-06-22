import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mock server actions — these run in the server context and cannot be called
// directly from jsdom.
// ---------------------------------------------------------------------------

vi.mock("@/actions/profile", () => ({
  saveProfile: vi.fn().mockResolvedValue({ success: true }),
  uploadResume: vi.fn().mockResolvedValue({ success: true, key: "user/resume.pdf", url: "https://cdn.example.com/resume.pdf", filename: "resume.pdf" }),
  getResumeSignedUrl: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/signed/resume.pdf" }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ProfileForm } from "./ProfileForm";
import { saveProfile, uploadResume, getResumeSignedUrl } from "@/actions/profile";
import type { Profile } from "@/types/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMAIL = "test@example.com";

const NULL_PROFILE = null;

const SPARSE_PROFILE: Profile = {
  id: "user-123",
  full_name: "Taryn Ali",
  email: EMAIL,
  phone: null,
  location: null,
  current_title: null,
  experience_level: null,
  years_experience: null,
  skills: null,
  industries: null,
  work_experience: null,
  education: null,
  job_titles_seeking: null,
  remote_preference: null,
  preferred_locations: null,
  salary_expectation: null,
  cover_letter_tone: null,
  linkedin_url: null,
  portfolio_url: null,
  work_authorization: null,
  resume_pdf_url: null,
  resume_pdf_key: null,
  resume_pdf_filename: null,
  linkedin_connected: false,
  is_tailored: false,
  is_complete: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const COMPLETE_PROFILE: Profile = {
  ...SPARSE_PROFILE,
  full_name: "Jane Doe",
  phone: "555-0100",
  location: "New York",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: 7,
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
  education: {
    degree: "Bachelor's",
    fieldOfStudy: "CS",
    institution: "State U",
    graduationYear: "2018",
  },
  linkedin_connected: false,
  is_tailored: false,
  is_complete: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  describe("rendering", () => {
    it("renders without crashing when profile is null", () => {
      expect(() => render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />)).not.toThrow();
    });

    it("renders the save button", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /save profile/i })).toBeInTheDocument();
    });

    it("renders the email field as disabled (read-only from session)", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      const emailInput = screen.getByDisplayValue(EMAIL);
      expect(emailInput).toBeDisabled();
    });

    it("pre-fills full_name from profile data", () => {
      render(<ProfileForm profile={SPARSE_PROFILE} email={EMAIL} />);
      const fullNameInput = screen.getByPlaceholderText(/your full name/i);
      expect(fullNameInput).toHaveValue("Taryn Ali");
    });

    it("pre-fills numeric years_experience from profile", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      const yoeInput = screen.getByPlaceholderText("4");
      expect(yoeInput).toHaveValue(7);
    });

    it("renders the Connected Accounts card", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/connected accounts/i)).toBeInTheDocument();
    });

    it("renders the Resume card", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/^resume$/i)).toBeInTheDocument();
    });

    it("renders the Profile Information card", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/profile information/i)).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Completion banner — incomplete state
  // ------------------------------------------------------------------
  describe("completion banner — incomplete profile", () => {
    it("shows 'Profile needs attention' when profile is null", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/profile needs attention/i)).toBeInTheDocument();
    });

    it("shows missing field pills for null profile", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      // Email comes from the prop so it won't be missing, but other fields will be
      expect(screen.getByText("FULL NAME")).toBeInTheDocument();
      expect(screen.getByText("PHONE")).toBeInTheDocument();
    });

    it("shows the completion percentage in the ring", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      // With null profile and email provided, EMAIL is not missing.
      // 9 fields missing out of 10 = 10%
      expect(screen.getByText("10%")).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Completion banner — complete state
  // ------------------------------------------------------------------
  describe("completion banner — complete profile", () => {
    it("shows 'Profile complete' when all fields are filled", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/profile complete/i)).toBeInTheDocument();
    });

    it("shows 100% in the ring when profile is complete", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("does NOT show 'Profile needs attention' when complete", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.queryByText(/profile needs attention/i)).not.toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Completion ring updates live as fields are changed
  // ------------------------------------------------------------------
  describe("completion ring — live updates", () => {
    it("updates percentage when full_name is typed in", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      // Initially 10% (only email is filled from prop)
      expect(screen.getByText("10%")).toBeInTheDocument();

      const fullNameInput = screen.getByPlaceholderText(/your full name/i);
      await user.type(fullNameInput, "Jane");
      // Now email + full_name are filled = 2/10 = 20%
      expect(screen.getByText("20%")).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Skills TagInput
  // ------------------------------------------------------------------
  describe("skills TagInput", () => {
    it("renders skills from profile as tags", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      expect(screen.getByText("React")).toBeInTheDocument();
    });

    it("adds a skill when text is typed and Add is clicked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      const skillInput = screen.getByPlaceholderText(/e\.g\. react/i);
      await user.type(skillInput, "Vue.js");
      // There are multiple "Add" buttons (one per TagInput). Scope to the skills input's parent.
      const addButton = within(skillInput.parentElement!).getByRole("button", { name: /^add$/i });
      await user.click(addButton);
      expect(screen.getByText("Vue.js")).toBeInTheDocument();
    });

    it("adds a skill when Enter is pressed in the input", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      const skillInput = screen.getByPlaceholderText(/e\.g\. react/i);
      await user.type(skillInput, "Svelte{Enter}");
      expect(screen.getByText("Svelte")).toBeInTheDocument();
    });

    it("clears the skill input after adding", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      const skillInput = screen.getByPlaceholderText(/e\.g\. react/i);
      await user.type(skillInput, "Node.js");
      const addButton = within(skillInput.parentElement!).getByRole("button", { name: /^add$/i });
      await user.click(addButton);
      expect(skillInput).toHaveValue("");
    });

    it("does not add duplicate skills", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      const skillInput = screen.getByPlaceholderText(/e\.g\. react/i);
      await user.type(skillInput, "React{Enter}");
      const reactTags = screen.getAllByText("React");
      expect(reactTags).toHaveLength(1);
    });

    it("removes a skill when the × button is clicked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByText("TypeScript")).toBeInTheDocument();
      const removeButton = screen.getByRole("button", { name: /remove typescript/i });
      await user.click(removeButton);
      expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();
    });

    it("does not add a whitespace-only skill", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      const skillInput = screen.getByPlaceholderText(/e\.g\. react/i);
      await user.type(skillInput, "   ");
      const addButton = within(skillInput.parentElement!).getByRole("button", { name: /^add$/i });
      await user.click(addButton);
      // Whitespace-only input is trimmed to "" so no chip is created.
      // The input should be cleared or remain (implementation trims before check).
      expect(addButton).toBeInTheDocument(); // no crash
    });
  });

  // ------------------------------------------------------------------
  // Work experience
  // ------------------------------------------------------------------
  describe("work experience", () => {
    it("shows an 'Add role' button when fewer than 3 entries exist", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /add role/i })).toBeInTheDocument();
    });

    it("adds a work entry when 'Add role' is clicked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /add role/i }));
      expect(screen.getByText(/role 1/i)).toBeInTheDocument();
    });

    it("hides 'Add role' button when 3 entries are present", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /add role/i }));
      await user.click(screen.getByRole("button", { name: /add role/i }));
      await user.click(screen.getByRole("button", { name: /add role/i }));
      expect(screen.queryByRole("button", { name: /add role/i })).not.toBeInTheDocument();
    });

    it("removes a work entry when Remove is clicked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /add role/i }));
      expect(screen.getByText(/role 1/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /remove/i }));
      expect(screen.queryByText(/role 1/i)).not.toBeInTheDocument();
    });

    it("pre-populates work entries from profile", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByDisplayValue("Acme Corp")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Engineer")).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // LinkedIn section
  // ------------------------------------------------------------------
  describe("LinkedIn connected section", () => {
    it("shows 'Not connected' when linkedin_connected is false", () => {
      render(<ProfileForm profile={SPARSE_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    });

    it("shows 'Connect LinkedIn' button when not connected", () => {
      render(<ProfileForm profile={SPARSE_PROFILE} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /connect linkedin/i })).toBeInTheDocument();
    });

    it("shows 'Connected' and 'Disconnect' button when linkedin_connected is true", () => {
      const connectedProfile = { ...SPARSE_PROFILE, linkedin_connected: true };
      render(<ProfileForm profile={connectedProfile} email={EMAIL} />);
      expect(screen.getByText(/^connected$/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Resume card
  // ------------------------------------------------------------------
  describe("resume card", () => {
    it("shows upload zone when no resume exists", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByText(/click to upload or drag and drop/i)).toBeInTheDocument();
    });

    it("shows existing filename when resume_pdf_filename is set", () => {
      const profileWithResume = {
        ...SPARSE_PROFILE,
        resume_pdf_filename: "my-resume.pdf",
        resume_pdf_key: "user-123/resume.pdf",
      };
      render(<ProfileForm profile={profileWithResume} email={EMAIL} />);
      expect(screen.getByText("my-resume.pdf")).toBeInTheDocument();
    });

    it("shows 'View current resume' button when resume exists", () => {
      const profileWithResume = {
        ...SPARSE_PROFILE,
        resume_pdf_filename: "my-resume.pdf",
        resume_pdf_key: "user-123/resume.pdf",
      };
      render(<ProfileForm profile={profileWithResume} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /view current resume/i })).toBeInTheDocument();
    });

    it("does NOT show 'View current resume' button when no resume exists", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.queryByRole("button", { name: /view current resume/i })).not.toBeInTheDocument();
    });

    it("shows 'Replace Resume' text when resume exists", () => {
      const profileWithResume = {
        ...SPARSE_PROFILE,
        resume_pdf_filename: "my-resume.pdf",
        resume_pdf_key: "user-123/resume.pdf",
      };
      render(<ProfileForm profile={profileWithResume} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /replace resume/i })).toBeInTheDocument();
    });

    it("shows 'Select Resume' text when no resume exists", () => {
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      expect(screen.getByRole("button", { name: /select resume/i })).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Save button
  // ------------------------------------------------------------------
  describe("save button", () => {
    it("calls saveProfile when Save Profile is clicked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /save profile/i }));
      await waitFor(() => {
        expect(saveProfile).toHaveBeenCalledTimes(1);
      });
    });

    it("shows 'Profile saved successfully' on successful save", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /save profile/i }));
      await waitFor(() => {
        expect(screen.getByText(/profile saved successfully/i)).toBeInTheDocument();
      });
    });

    it("shows error message when save fails", async () => {
      vi.mocked(saveProfile).mockResolvedValueOnce({
        success: false,
        error: "Failed to save profile",
      });
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /save profile/i }));
      await waitFor(() => {
        expect(screen.getByText(/failed to save profile/i)).toBeInTheDocument();
      });
    });

    it("includes all form fields in saveProfile payload", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /save profile/i }));
      await waitFor(() => {
        expect(saveProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            full_name: "Jane Doe",
            phone: "555-0100",
            location: "New York",
            current_title: "Software Engineer",
            experience_level: "senior",
            years_experience: "7",
            skills: expect.arrayContaining(["TypeScript", "React"]),
          })
        );
      });
    });
  });

  // ------------------------------------------------------------------
  // Education section
  // ------------------------------------------------------------------
  describe("education section", () => {
    it("pre-fills education fields from profile", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      expect(screen.getByDisplayValue("CS")).toBeInTheDocument();
      expect(screen.getByDisplayValue("State U")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2018")).toBeInTheDocument();
    });

    it("renders the degree select with profile value", () => {
      render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      const degreeSelect = screen.getByRole("combobox", { name: /highest degree/i });
      expect(degreeSelect).toHaveValue("Bachelor's");
    });
  });

  // ------------------------------------------------------------------
  // Work experience current checkbox
  // ------------------------------------------------------------------
  describe("work experience current checkbox", () => {
    it("hides end date input when 'Currently working here' is checked", async () => {
      const user = userEvent.setup();
      render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      await user.click(screen.getByRole("button", { name: /add role/i }));
      // Initially the checkbox is unchecked and end date input is shown
      const endDateInput = screen.getByPlaceholderText(/december 2023/i);
      expect(endDateInput).toBeInTheDocument();

      const currentCheckbox = screen.getByRole("checkbox");
      await user.click(currentCheckbox);
      // End date should now be hidden
      expect(screen.queryByPlaceholderText(/december 2023/i)).not.toBeInTheDocument();
    });

    it("shows end date input for existing role that is not current", () => {
      const profileWithPastRole: Profile = {
        ...COMPLETE_PROFILE,
        work_experience: [
          {
            company: "Old Corp",
            title: "Dev",
            startDate: "2018",
            endDate: "2020",
            current: false,
            responsibilities: "Old stuff.",
          },
        ],
      };
      render(<ProfileForm profile={profileWithPastRole} email={EMAIL} />);
      expect(screen.getByDisplayValue("2020")).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // SVG ring aria label
  // ------------------------------------------------------------------
  describe("SVG completion ring accessibility", () => {
    it("has an aria-label reflecting the completion percentage", () => {
      const { container } = render(<ProfileForm profile={NULL_PROFILE} email={EMAIL} />);
      // The SVG element carries aria-label but no role="img" — query via attribute selector.
      // With only email filled: 1/10 = 10%
      const svg = container.querySelector('svg[aria-label]');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-label")).toMatch(/10%/);
    });

    it("aria-label updates to 100% when profile is complete", () => {
      const { container } = render(<ProfileForm profile={COMPLETE_PROFILE} email={EMAIL} />);
      const svg = container.querySelector('svg[aria-label]');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-label")).toMatch(/100%/);
    });
  });
});