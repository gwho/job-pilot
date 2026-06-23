import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Profile } from "@/types/index";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so mock functions are available in factory callbacks
// ---------------------------------------------------------------------------

const {
  mockGetCurrentUser,
  mockFrom,
  mockStorageFrom,
  mockGenerateResumePdf,
} = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockFrom: vi.fn(),
  mockStorageFrom: vi.fn(),
  mockGenerateResumePdf: vi.fn(),
}));

// Mock next/server — NextResponse.json is used by the route handler
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
      json: async () => body,
      status: init?.status ?? 200,
    })),
  },
}));

// Mock createInsforgeServer
vi.mock("@/lib/insforge-server", () => ({
  createInsforgeServer: vi.fn(async () => ({
    auth: {
      getCurrentUser: mockGetCurrentUser,
    },
    database: {
      from: mockFrom,
    },
    storage: {
      from: mockStorageFrom,
    },
  })),
}));

// Mock generateResumePdf
vi.mock("@/agent/pdf-generator", () => ({
  generateResumePdf: mockGenerateResumePdf,
}));

// ---------------------------------------------------------------------------
// Import route AFTER mocks are set up
// ---------------------------------------------------------------------------
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-abc",
    full_name: "Test User",
    email: "test@example.com",
    phone: "555-1234",
    location: "Austin, TX",
    current_title: "Engineer",
    experience_level: "mid",
    years_experience: 3,
    skills: ["JavaScript"],
    industries: null,
    work_experience: [],
    education: { degree: "B.S.", fieldOfStudy: "CS", institution: "UT", graduationYear: "2020" },
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
    is_complete: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Creates a fluent DB SELECT query chain. */
function makeSelectChain(returnValue: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(returnValue),
  };
}

/** Creates a DB upsert chain. */
function makeUpsertChain(error: unknown = null) {
  return {
    upsert: vi.fn().mockResolvedValue({ error }),
  };
}

/** Creates a storage bucket mock. */
function makeStorageBucket(
  uploadReturn: { data: unknown; error: unknown } = {
    data: { key: "user-abc/resume.pdf", url: "user-abc/resume.pdf" },
    error: null,
  },
) {
  return {
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    upload: vi.fn().mockResolvedValue(uploadReturn),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/resume/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 401 — unauthenticated
  // -------------------------------------------------------------------------

  it("returns 401 when there is no authenticated user", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await POST();

    expect(response._status).toBe(401);
    expect(response._body).toEqual({ success: false, error: "Unauthorized" });
  });

  // -------------------------------------------------------------------------
  // 404 — profile not found
  // -------------------------------------------------------------------------

  it("returns 404 when the profile query returns an error", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(makeSelectChain({ data: null, error: { message: "not found" } }));

    const response = await POST();

    expect(response._status).toBe(404);
    expect(response._body).toEqual({ success: false, error: "Profile not found" });
  });

  it("returns 404 when the profile query returns null data with no error", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(makeSelectChain({ data: null, error: null }));

    const response = await POST();

    expect(response._status).toBe(404);
    expect(response._body).toEqual({ success: false, error: "Profile not found" });
  });

  // -------------------------------------------------------------------------
  // 400 — profile incomplete
  // -------------------------------------------------------------------------

  it("returns 400 when profile.is_complete is false", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(
      makeSelectChain({ data: makeProfile({ is_complete: false }), error: null }),
    );

    const response = await POST();

    expect(response._status).toBe(400);
    expect(response._body).toEqual({
      success: false,
      error: "Complete your profile before generating a resume",
    });
  });

  // -------------------------------------------------------------------------
  // 500 — PDF generation failure
  // -------------------------------------------------------------------------

  it("returns 500 when generateResumePdf fails", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(makeSelectChain({ data: makeProfile(), error: null }));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: false,
      error: "Failed to generate resume PDF",
    });

    const response = await POST();

    expect(response._status).toBe(500);
    expect(response._body).toEqual({
      success: false,
      error: "Failed to generate resume PDF",
    });
  });

  // -------------------------------------------------------------------------
  // 500 — storage upload failure
  // -------------------------------------------------------------------------

  it("returns 500 when storage upload returns an error", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(makeSelectChain({ data: makeProfile(), error: null }));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(
      makeStorageBucket({ data: null, error: { message: "upload failed" } }),
    );

    const response = await POST();

    expect(response._status).toBe(500);
    expect(response._body).toEqual({
      success: false,
      error: "Failed to save generated resume",
    });
  });

  it("returns 500 when storage upload returns null data with no error", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(makeSelectChain({ data: makeProfile(), error: null }));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(makeStorageBucket({ data: null, error: null }));

    const response = await POST();

    expect(response._status).toBe(500);
    expect(response._body).toEqual({
      success: false,
      error: "Failed to save generated resume",
    });
  });

  // -------------------------------------------------------------------------
  // 500 — DB upsert failure
  // -------------------------------------------------------------------------

  it("returns 500 when the DB upsert after upload returns an error", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile(), error: null }))
      .mockReturnValueOnce(makeUpsertChain({ message: "db error" }));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(makeStorageBucket());

    const response = await POST();

    expect(response._status).toBe(500);
    expect(response._body).toEqual({
      success: false,
      error: "Failed to save resume reference",
    });
  });

  // -------------------------------------------------------------------------
  // 200 — success
  // -------------------------------------------------------------------------

  it("returns 200 with success=true on complete successful flow", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile(), error: null }))
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(makeStorageBucket());

    const response = await POST();

    expect(response._status).toBe(200);
    expect(response._body).toEqual({ success: true });
  });

  // -------------------------------------------------------------------------
  // Storage remove — conditional on existing key
  // -------------------------------------------------------------------------

  it("calls storage remove when profile has an existing resume_pdf_key", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom
      .mockReturnValueOnce(
        makeSelectChain({ data: makeProfile({ resume_pdf_key: "user-abc/resume.pdf" }), error: null }),
      )
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    const storageBucket = makeStorageBucket();
    mockStorageFrom.mockReturnValue(storageBucket);

    await POST();

    expect(storageBucket.remove).toHaveBeenCalledWith("user-abc/resume.pdf");
  });

  it("does NOT call storage remove when profile has no existing resume_pdf_key", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile({ resume_pdf_key: null }), error: null }))
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    const storageBucket = makeStorageBucket();
    mockStorageFrom.mockReturnValue(storageBucket);

    await POST();

    expect(storageBucket.remove).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Storage path and Blob type
  // -------------------------------------------------------------------------

  it("uploads to the correct storage path: {userId}/resume.pdf", async () => {
    const userId = "user-xyz";
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile({ id: userId }), error: null }))
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    const storageBucket = makeStorageBucket({
      data: { key: `${userId}/resume.pdf`, url: `${userId}/resume.pdf` },
      error: null,
    });
    mockStorageFrom.mockReturnValue(storageBucket);

    await POST();

    expect(storageBucket.upload).toHaveBeenCalledWith(
      `${userId}/resume.pdf`,
      expect.any(Blob),
    );
  });

  it("passes a Blob with application/pdf type to storage upload", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile(), error: null }))
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    const storageBucket = makeStorageBucket();
    mockStorageFrom.mockReturnValue(storageBucket);

    await POST();

    const uploadedBlob = storageBucket.upload.mock.calls[0][1] as Blob;
    expect(uploadedBlob).toBeInstanceOf(Blob);
    expect(uploadedBlob.type).toBe("application/pdf");
  });

  // -------------------------------------------------------------------------
  // DB upsert values
  // -------------------------------------------------------------------------

  it("saves 'AI Generated Resume.pdf' as resume_pdf_filename in the DB upsert", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    const upsertChain = makeUpsertChain(null);
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile(), error: null }))
      .mockReturnValueOnce(upsertChain);
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(makeStorageBucket());

    await POST();

    const upsertRows = upsertChain.upsert.mock.calls[0][0] as Array<{
      resume_pdf_filename: string;
    }>;
    expect(upsertRows[0].resume_pdf_filename).toBe("AI Generated Resume.pdf");
  });

  it("saves the upload key and url to the DB", async () => {
    const userId = "user-abc";
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    const upsertChain = makeUpsertChain(null);
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: makeProfile(), error: null }))
      .mockReturnValueOnce(upsertChain);
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1, 2, 3]),
    });
    mockStorageFrom.mockReturnValue(
      makeStorageBucket({
        data: { key: `${userId}/resume.pdf`, url: `${userId}/resume.pdf` },
        error: null,
      }),
    );

    await POST();

    const upsertRows = upsertChain.upsert.mock.calls[0][0] as Array<{
      resume_pdf_key: string;
      resume_pdf_url: string;
    }>;
    expect(upsertRows[0].resume_pdf_key).toBe(`${userId}/resume.pdf`);
    expect(upsertRows[0].resume_pdf_url).toBe(`${userId}/resume.pdf`);
  });

  // -------------------------------------------------------------------------
  // generateResumePdf receives correct profile
  // -------------------------------------------------------------------------

  it("passes the DB profile directly to generateResumePdf", async () => {
    const userId = "user-abc";
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    const profile = makeProfile({ full_name: "DB Profile User" });
    mockFrom
      .mockReturnValueOnce(makeSelectChain({ data: profile, error: null }))
      .mockReturnValueOnce(makeUpsertChain(null));
    mockGenerateResumePdf.mockResolvedValueOnce({
      success: true,
      buffer: Buffer.from([1]),
    });
    mockStorageFrom.mockReturnValue(makeStorageBucket());

    await POST();

    expect(mockGenerateResumePdf).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: "DB Profile User", id: userId }),
    );
  });

  // -------------------------------------------------------------------------
  // Unhandled exception → 500
  // -------------------------------------------------------------------------

  it("returns 500 when an unexpected exception is thrown", async () => {
    mockGetCurrentUser.mockRejectedValueOnce(new Error("unexpected crash"));

    const response = await POST();

    expect(response._status).toBe(500);
    expect(response._body).toEqual({
      success: false,
      error: "Internal server error",
    });
  });

  // -------------------------------------------------------------------------
  // Server-side is_complete check (defense in depth)
  // -------------------------------------------------------------------------

  it("never calls generateResumePdf when is_complete is false (server-side guard)", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ data: { user: { id: "user-abc" } } });
    mockFrom.mockReturnValue(
      makeSelectChain({ data: makeProfile({ is_complete: false }), error: null }),
    );

    await POST();

    expect(mockGenerateResumePdf).not.toHaveBeenCalled();
  });
});