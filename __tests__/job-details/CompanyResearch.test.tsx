/**
 * Component tests for components/job-details/CompanyResearch.tsx.
 *
 * Covers the four UI states (empty, loading, error, success), the fetch
 * integration with POST /api/agent/research, and the guarded rendering of
 * each dossier section.
 *
 * Run: npm run test:run -- __tests__/job-details/CompanyResearch.test.tsx
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import { CompanyResearch } from "@/components/job-details/CompanyResearch";
import type { CompanyResearchDossier } from "@/types/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_DOSSIER: CompanyResearchDossier = {
  companyOverview: "Stripe builds payment infrastructure for the internet.",
  techStack: ["Ruby", "Go"],
  culture: ["Fast-paced", "Written culture"],
  whyThisRole: "Expanding the Asia-Pacific engineering team.",
  yourEdge: ["TypeScript experience maps to their API tooling"],
  gapsToAddress: ["No direct Go experience"],
  smartQuestions: ["What does success look like in 90 days?"],
  interviewPrep: ["Study Stripe's API design philosophy"],
  sources: ["https://stripe.com", "internal notes"],
  researchedAt: "2026-07-02T10:00:00.000Z",
};

const MINIMAL_DOSSIER: CompanyResearchDossier = {
  companyOverview: "",
  techStack: [],
  culture: [],
  whyThisRole: "",
  yourEdge: [],
  gapsToAddress: [],
  smartQuestions: [],
  interviewPrep: [],
  sources: [],
  researchedAt: "",
};

function mockFetchSuccess(dossier: CompanyResearchDossier) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    json: () => Promise.resolve({ success: true, data: { companyResearch: dossier } }),
  });
}

function mockFetchApiError(message: string) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    json: () => Promise.resolve({ success: false, error: message }),
  });
}

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("CompanyResearch — empty state", () => {
  it("shows the empty state with the company name when there is no research yet", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    expect(screen.getByText("No research yet")).toBeInTheDocument();
    expect(screen.getByText(/Stripe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /research company/i })).toBeInTheDocument();
  });

  it("falls back to generic copy when company is null", () => {
    render(<CompanyResearch jobId="job-1" company={null} initialResearch={null} />);

    expect(screen.getByText(/the company/i)).toBeInTheDocument();
  });

  it("does not render dossier sections when there is no research", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    expect(screen.queryByText("Tech Stack")).not.toBeInTheDocument();
    expect(screen.queryByText("About the Company")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Triggering research — loading + success
// ---------------------------------------------------------------------------

describe("CompanyResearch — triggering research", () => {
  it("shows the loading state and disables the button while the request is in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    global.fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);
    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByText(/Researching…/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText(/Researching Stripe…/)).toBeInTheDocument();

    resolveFetch({ json: () => Promise.resolve({ success: true, data: { companyResearch: FULL_DOSSIER } }) });

    await waitFor(() => {
      expect(screen.getByText("About the Company")).toBeInTheDocument();
    });
  });

  it("posts jobId to /api/agent/research when the button is clicked", async () => {
    mockFetchSuccess(FULL_DOSSIER);
    render(<CompanyResearch jobId="job-123" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/agent/research",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: "job-123" }),
        }),
      );
    });
  });

  it("renders the dossier and switches the button to 'Re-research' after a successful fetch", async () => {
    mockFetchSuccess(FULL_DOSSIER);
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByText(FULL_DOSSIER.companyOverview)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /re-research/i })).toBeInTheDocument();
    expect(screen.queryByText("No research yet")).not.toBeInTheDocument();
  });

  it("re-enables the button after the fetch resolves", async () => {
    mockFetchSuccess(FULL_DOSSIER);
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-research/i })).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("CompanyResearch — error handling", () => {
  it("shows the API's error message when the response indicates failure", async () => {
    mockFetchApiError("Failed to research company");
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to research company")).toBeInTheDocument();
    });
    // Still shows the empty state — no dossier to render
    expect(screen.getByText("No research yet")).toBeInTheDocument();
  });

  it("shows a fallback message when the API returns success:false without an error string", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({ success: false }),
    });
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it("shows a network error message when fetch rejects", async () => {
    mockFetchNetworkError();
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("clears a previous error once a retry succeeds", async () => {
    mockFetchApiError("Failed to research company");
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={null} />);

    fireEvent.click(screen.getByRole("button", { name: /research company/i }));
    await waitFor(() => {
      expect(screen.getByText("Failed to research company")).toBeInTheDocument();
    });

    mockFetchSuccess(FULL_DOSSIER);
    fireEvent.click(screen.getByRole("button", { name: /research company/i }));

    await waitFor(() => {
      expect(screen.queryByText("Failed to research company")).not.toBeInTheDocument();
      expect(screen.getByText("About the Company")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Dossier rendering — initialResearch supplied by the server
// ---------------------------------------------------------------------------

describe("CompanyResearch — rendering a pre-loaded dossier", () => {
  it("renders all populated sections from initialResearch without fetching", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={FULL_DOSSIER} />);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText("About the Company")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.companyOverview)).toBeInTheDocument();

    expect(screen.getByText("Tech Stack")).toBeInTheDocument();
    expect(screen.getByText("Ruby")).toBeInTheDocument();
    expect(screen.getByText("Go")).toBeInTheDocument();

    expect(screen.getByText("Culture & Values")).toBeInTheDocument();
    expect(screen.getByText("Fast-paced")).toBeInTheDocument();

    expect(screen.getByText("Why This Role Exists")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.whyThisRole)).toBeInTheDocument();

    expect(screen.getByText("Your Edge")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.yourEdge[0])).toBeInTheDocument();

    expect(screen.getByText("Gaps to Address")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.gapsToAddress[0])).toBeInTheDocument();

    expect(screen.getByText("Smart Questions to Ask")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.smartQuestions[0])).toBeInTheDocument();

    expect(screen.getByText("Interview Prep")).toBeInTheDocument();
    expect(screen.getByText(FULL_DOSSIER.interviewPrep[0])).toBeInTheDocument();

    expect(screen.getByText("Sources")).toBeInTheDocument();
  });

  it("renders the 'Re-research' button when initialResearch is already present", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={FULL_DOSSIER} />);

    expect(screen.getByRole("button", { name: /re-research/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^research company$/i })).not.toBeInTheDocument();
  });

  it("renders http(s) sources as clickable external links", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={FULL_DOSSIER} />);

    const link = screen.getByRole("link", { name: "https://stripe.com" });
    expect(link).toHaveAttribute("href", "https://stripe.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders non-URL sources as plain text, not links", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={FULL_DOSSIER} />);

    expect(screen.getByText("internal notes")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "internal notes" })).not.toBeInTheDocument();
  });

  it("renders the researchedAt timestamp", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={FULL_DOSSIER} />);

    expect(screen.getByText(/Researched/)).toBeInTheDocument();
  });

  it("omits sections whose arrays are empty and text fields that are blank", () => {
    render(<CompanyResearch jobId="job-1" company="Stripe" initialResearch={MINIMAL_DOSSIER} />);

    expect(screen.queryByText("About the Company")).not.toBeInTheDocument();
    expect(screen.queryByText("Tech Stack")).not.toBeInTheDocument();
    expect(screen.queryByText("Culture & Values")).not.toBeInTheDocument();
    expect(screen.queryByText("Why This Role Exists")).not.toBeInTheDocument();
    expect(screen.queryByText("Your Edge")).not.toBeInTheDocument();
    expect(screen.queryByText("Gaps to Address")).not.toBeInTheDocument();
    expect(screen.queryByText("Smart Questions to Ask")).not.toBeInTheDocument();
    expect(screen.queryByText("Interview Prep")).not.toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
    // The dossier is non-null so the empty state must not render either.
    expect(screen.queryByText("No research yet")).not.toBeInTheDocument();
  });
});