import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

// insforge mock helpers — redefined per test where needed
let mockGetCurrentUser: ReturnType<typeof vi.fn>;
let mockDbSelect: ReturnType<typeof vi.fn>;
let mockDbUpsert: ReturnType<typeof vi.fn>;
let mockStorageRemove: ReturnType<typeof vi.fn>;
let mockStorageUpload: ReturnType<typeof vi.fn>;
let mockStorageCreateSignedUrl: ReturnType<typeof vi.fn>;

vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(() => ({
    auth: {
      getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
    },
    database: {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: (...args: unknown[]) => mockDbSelect(...args),
          }),
        }),
        upsert: (...args: unknown[]) => mockDbUpsert(...args),
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        remove: (...args: unknown[]) => mockStorageRemove(...args),
        upload: (...args: unknown[]) => mockStorageUpload(...args),
        createSignedUrl: (...args: unknown[]) => mockStorageCreateSignedUrl(...args),
      }),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { saveProfile, uploadResume, getResumeSignedUrl } from "./profile";
import type { ProfileSavePayload } from "./profile";
import { revalidatePath } from "next/cache";
import { captureServerEvent } from "@/lib/posthog-server";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_USER = { id: "user-123", email: "test@example.com" };

const MINIMAL_PAYLOAD: ProfileSavePayload = {
  full_name: "",
  phone: "",
  location: "",
  current_title: "",
  experience_level: "",
  years_experience: "",
  linkedin_url: "",
  portfolio_url: "",
  work_authorization: "",
  remote_preference: "",
  salary_expectation: "",
  cover_letter_tone: "",
  skills: [],
  industries: [],
  job_titles_seeking: [],
  preferred_locations: [],
  work_experience: [],
  education: { degree: null, fieldOfStudy: null, institution: null, graduationYear: null },
  linkedin_connected: false,
  is_tailored: false,
};

const COMPLETE_PAYLOAD: ProfileSavePayload = {
  full_name: "Jane Doe",
  phone: "555-0100",
  location: "New York",
  current_title: "Software Engineer",
  experience_level: "senior",
  years_experience: "7",
  linkedin_url: "https://linkedin.com/in/jane",
  portfolio_url: "",
  work_authorization: "citizen",
  remote_preference: "remote",
  salary_expectation: "$150k",
  cover_letter_tone: "formal",
  skills: ["TypeScript", "React"],
  industries: ["FinTech"],
  job_titles_seeking: ["Senior Engineer"],
  preferred_locations: ["New York"],
  work_experience: [
    {
      company: "Acme",
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
};

// ---------------------------------------------------------------------------
// Helper: authenticated state returning existing profile data
// ---------------------------------------------------------------------------
function makeDbSelectReturn(data: unknown, error: unknown = null) {
  mockDbSelect = vi.fn().mockResolvedValue({ data, error });
}

function makeAuthOk(user = MOCK_USER) {
  mockGetCurrentUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
}

function makeAuthFail() {
  mockGetCurrentUser = vi.fn().mockResolvedValue({
    data: { user: null },
    error: new Error("not authenticated"),
  });
}

// ---------------------------------------------------------------------------
// saveProfile
// ---------------------------------------------------------------------------

describe("saveProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeAuthOk();
    makeDbSelectReturn({ is_complete: false }); // existing profile not complete
    mockDbUpsert = vi.fn().mockResolvedValue({ error: null });
    mockStorageRemove = vi.fn().mockResolvedValue({ error: null });
    mockStorageUpload = vi.fn();
    mockStorageCreateSignedUrl = vi.fn();
  });

  describe("authentication", () => {
    it("returns { success: false, error: 'Not authenticated' } when auth fails", async () => {
      makeAuthFail();
      const result = await saveProfile(MINIMAL_PAYLOAD);
      expect(result).toEqual({ success: false, error: "Not authenticated" });
    });

    it("returns { success: false, error: 'Not authenticated' } when user is null", async () => {
      mockGetCurrentUser = vi.fn().mockResolvedValue({
        data: { user: null },
        error: null,
      });
      const result = await saveProfile(MINIMAL_PAYLOAD);
      expect(result).toEqual({ success: false, error: "Not authenticated" });
    });
  });

  describe("successful save", () => {
    it("returns { success: true } on a valid save", async () => {
      const result = await saveProfile(COMPLETE_PAYLOAD);
      expect(result).toEqual({ success: true });
    });

    it("calls revalidatePath('/profile') on success", async () => {
      await saveProfile(COMPLETE_PAYLOAD);
      expect(revalidatePath).toHaveBeenCalledWith("/profile");
    });

    it("does not call revalidatePath on auth failure", async () => {
      makeAuthFail();
      await saveProfile(COMPLETE_PAYLOAD);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("upsert error handling", () => {
    it("returns { success: false, error: 'Failed to save profile' } when upsert fails", async () => {
      mockDbUpsert = vi.fn().mockResolvedValue({ error: new Error("db error") });
      const result = await saveProfile(COMPLETE_PAYLOAD);
      expect(result).toEqual({ success: false, error: "Failed to save profile" });
    });

    it("does not call revalidatePath when upsert fails", async () => {
      mockDbUpsert = vi.fn().mockResolvedValue({ error: new Error("db error") });
      await saveProfile(COMPLETE_PAYLOAD);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("is_complete calculation", () => {
    it("upserts with is_complete=false when payload is missing required fields", async () => {
      await saveProfile(MINIMAL_PAYLOAD);
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.is_complete).toBe(false);
    });

    it("upserts with is_complete=true when all required fields are present", async () => {
      await saveProfile(COMPLETE_PAYLOAD);
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.is_complete).toBe(true);
    });
  });

  describe("profile_completed PostHog event", () => {
    it("fires profile_completed when transitioning from incomplete to complete", async () => {
      makeDbSelectReturn({ is_complete: false }); // was not complete
      await saveProfile(COMPLETE_PAYLOAD);
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "profile_completed",
          distinctId: MOCK_USER.id,
        })
      );
    });

    it("does NOT fire profile_completed when profile was already complete", async () => {
      makeDbSelectReturn({ is_complete: true }); // was already complete
      await saveProfile(COMPLETE_PAYLOAD);
      expect(captureServerEvent).not.toHaveBeenCalled();
    });

    it("does NOT fire profile_completed when payload is incomplete", async () => {
      makeDbSelectReturn({ is_complete: false });
      await saveProfile(MINIMAL_PAYLOAD); // will still be incomplete
      expect(captureServerEvent).not.toHaveBeenCalled();
    });

    it("does not block save if captureServerEvent throws", async () => {
      (captureServerEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("analytics down")
      );
      makeDbSelectReturn({ is_complete: false });
      const result = await saveProfile(COMPLETE_PAYLOAD);
      expect(result).toEqual({ success: true });
    });
  });

  describe("field coercion", () => {
    it("converts empty string experience_level to null in upsert payload", async () => {
      await saveProfile({ ...COMPLETE_PAYLOAD, experience_level: "" });
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.experience_level).toBeNull();
    });

    it("converts non-empty years_experience string to number in upsert payload", async () => {
      await saveProfile(COMPLETE_PAYLOAD); // years_experience: "7"
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.years_experience).toBe(7);
    });

    it("converts empty years_experience to null in upsert payload", async () => {
      await saveProfile({ ...COMPLETE_PAYLOAD, years_experience: "" });
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.years_experience).toBeNull();
    });

    it("stores email from auth session, not from payload", async () => {
      await saveProfile(COMPLETE_PAYLOAD);
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.email).toBe(MOCK_USER.email);
    });

    it("stores user id from auth session", async () => {
      await saveProfile(COMPLETE_PAYLOAD);
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.id).toBe(MOCK_USER.id);
    });

    it("converts empty string full_name to null in upsert payload", async () => {
      await saveProfile({ ...COMPLETE_PAYLOAD, full_name: "" });
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.full_name).toBeNull();
    });
  });

  describe("unexpected error handling", () => {
    it("returns { success: false, error: 'An unexpected error occurred' } on thrown error", async () => {
      (vi.mocked(mockGetCurrentUser) as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network error")
      );
      const result = await saveProfile(MINIMAL_PAYLOAD);
      expect(result).toEqual({ success: false, error: "An unexpected error occurred" });
    });
  });
});

// ---------------------------------------------------------------------------
// uploadResume
// ---------------------------------------------------------------------------

describe("uploadResume", () => {
  const makeFormData = (file: File | null, fieldName = "resume") => {
    const fd = new FormData();
    if (file) fd.append(fieldName, file);
    return fd;
  };

  const makeValidPdf = (name = "resume.pdf", size = 1024) => {
    return new File([new Uint8Array(size)], name, { type: "application/pdf" });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    makeAuthOk();
    makeDbSelectReturn({ resume_pdf_key: null }); // no existing resume
    mockDbUpsert = vi.fn().mockResolvedValue({ error: null });
    mockStorageRemove = vi.fn().mockResolvedValue({ data: null, error: null });
    mockStorageUpload = vi
      .fn()
      .mockResolvedValue({ data: { key: "user-123/resume.pdf", url: "https://cdn.example.com/resume.pdf" }, error: null });
    mockStorageCreateSignedUrl = vi.fn();
  });

  describe("authentication", () => {
    it("returns { success: false, error: 'Not authenticated' } when auth fails", async () => {
      makeAuthFail();
      const fd = makeFormData(makeValidPdf());
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "Not authenticated" });
    });
  });

  describe("file validation", () => {
    it("returns error when no file is provided in FormData", async () => {
      const fd = new FormData(); // no "resume" field
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "No file provided" });
    });

    it("returns error when file has size 0", async () => {
      const emptyFile = new File([], "empty.pdf", { type: "application/pdf" });
      const fd = makeFormData(emptyFile);
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "No file provided" });
    });

    it("returns error when file is not a PDF", async () => {
      const textFile = new File(["content"], "resume.txt", { type: "text/plain" });
      const fd = makeFormData(textFile);
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "Only PDF files are accepted" });
    });

    it("rejects image files even with .pdf extension", async () => {
      const imageFile = new File([new Uint8Array(100)], "resume.pdf", { type: "image/png" });
      const fd = makeFormData(imageFile);
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "Only PDF files are accepted" });
    });
  });

  describe("remove-before-upload pattern", () => {
    it("removes existing resume when resume_pdf_key exists", async () => {
      makeDbSelectReturn({ resume_pdf_key: "user-123/old-resume.pdf" });
      const fd = makeFormData(makeValidPdf());
      await uploadResume(fd);
      expect(mockStorageRemove).toHaveBeenCalledWith("user-123/old-resume.pdf");
    });

    it("does NOT call remove when no existing resume", async () => {
      makeDbSelectReturn({ resume_pdf_key: null });
      const fd = makeFormData(makeValidPdf());
      await uploadResume(fd);
      expect(mockStorageRemove).not.toHaveBeenCalled();
    });
  });

  describe("successful upload", () => {
    it("returns success with key, url, and filename", async () => {
      const fd = makeFormData(makeValidPdf("my-resume.pdf"));
      const result = await uploadResume(fd);
      expect(result).toEqual({
        success: true,
        key: "user-123/resume.pdf",
        url: "https://cdn.example.com/resume.pdf",
        filename: "my-resume.pdf",
      });
    });

    it("calls revalidatePath('/profile') on successful upload", async () => {
      const fd = makeFormData(makeValidPdf());
      await uploadResume(fd);
      expect(revalidatePath).toHaveBeenCalledWith("/profile");
    });

    it("upserts resume_pdf_key, resume_pdf_url, and resume_pdf_filename to db", async () => {
      const fd = makeFormData(makeValidPdf("cv.pdf"));
      await uploadResume(fd);
      const upsertArg = mockDbUpsert.mock.calls[0][0][0];
      expect(upsertArg.resume_pdf_key).toBe("user-123/resume.pdf");
      expect(upsertArg.resume_pdf_url).toBe("https://cdn.example.com/resume.pdf");
      expect(upsertArg.resume_pdf_filename).toBe("cv.pdf");
    });
  });

  describe("storage error handling", () => {
    it("returns error when storage upload fails", async () => {
      mockStorageUpload = vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error("storage error") });
      const fd = makeFormData(makeValidPdf());
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "Failed to upload resume" });
    });

    it("returns error when db upsert after upload fails", async () => {
      mockDbUpsert = vi.fn().mockResolvedValue({ error: new Error("db error") });
      const fd = makeFormData(makeValidPdf());
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "Failed to save resume reference" });
    });
  });

  describe("unexpected error handling", () => {
    it("returns { success: false, error: 'An unexpected error occurred' } on thrown error", async () => {
      mockGetCurrentUser = vi.fn().mockRejectedValueOnce(new Error("network error"));
      const fd = makeFormData(makeValidPdf());
      const result = await uploadResume(fd);
      expect(result).toEqual({ success: false, error: "An unexpected error occurred" });
    });
  });
});

// ---------------------------------------------------------------------------
// getResumeSignedUrl
// ---------------------------------------------------------------------------

describe("getResumeSignedUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    makeAuthOk();
    makeDbSelectReturn({ resume_pdf_key: "user-123/resume.pdf" });
    mockStorageRemove = vi.fn();
    mockStorageUpload = vi.fn();
    mockStorageCreateSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://cdn.example.com/signed/resume.pdf" }, error: null });
    mockDbUpsert = vi.fn();
  });

  describe("authentication", () => {
    it("returns { error: 'Not authenticated' } when auth fails", async () => {
      makeAuthFail();
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("returns { error: 'Not authenticated' } when user is null", async () => {
      mockGetCurrentUser = vi.fn().mockResolvedValue({
        data: { user: null },
        error: null,
      });
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "Not authenticated" });
    });
  });

  describe("no resume on file", () => {
    it("returns { error: 'No resume on file' } when resume_pdf_key is null", async () => {
      makeDbSelectReturn({ resume_pdf_key: null });
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "No resume on file" });
    });

    it("returns { error: 'No resume on file' } when profile row doesn't exist", async () => {
      makeDbSelectReturn(null); // maybeSingle returns null data
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "No resume on file" });
    });
  });

  describe("successful signed URL generation", () => {
    it("returns { url } on success", async () => {
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ url: "https://cdn.example.com/signed/resume.pdf" });
    });

    it("requests a 3600-second expiry for the signed URL", async () => {
      await getResumeSignedUrl();
      expect(mockStorageCreateSignedUrl).toHaveBeenCalledWith("user-123/resume.pdf", 3600);
    });
  });

  describe("storage error handling", () => {
    it("returns { error: 'Could not generate preview link' } when createSignedUrl fails", async () => {
      mockStorageCreateSignedUrl = vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error("storage error") });
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "Could not generate preview link" });
    });

    it("returns { error: 'Could not generate preview link' } when signedUrl is missing from response", async () => {
      mockStorageCreateSignedUrl = vi
        .fn()
        .mockResolvedValue({ data: { signedUrl: null }, error: null });
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "Could not generate preview link" });
    });
  });

  describe("unexpected error handling", () => {
    it("returns { error: 'An unexpected error occurred' } on thrown error", async () => {
      mockGetCurrentUser = vi.fn().mockRejectedValueOnce(new Error("network error"));
      const result = await getResumeSignedUrl();
      expect(result).toEqual({ error: "An unexpected error occurred" });
    });
  });
});