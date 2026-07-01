import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CompanyResearch } from "@/components/job-details/CompanyResearch";

describe("CompanyResearch", () => {
  it("renders the Company Research header", () => {
    render(<CompanyResearch company="Acme Corp" />);
    expect(screen.getByText("Company Research")).toBeInTheDocument();
  });

  it("always shows the empty state in Feature 12 (no research data flow yet)", () => {
    render(<CompanyResearch company="Acme Corp" />);
    expect(screen.getByText("No research yet")).toBeInTheDocument();
  });

  it("renders a disabled 'Research Company' button", () => {
    render(<CompanyResearch company="Acme Corp" />);
    const button = screen.getByRole("button", { name: /Research Company/i });
    expect(button).toBeDisabled();
  });

  it("includes the company name in the empty-state message", () => {
    render(<CompanyResearch company="Acme Corp" />);
    // The custom matcher's first argument is the element's own direct
    // text-node content (testing-library's getNodeText), not the full deep
    // textContent — so this only matches the specific <p> containing the
    // message, not any ancestor container.
    expect(
      screen.getByText((content) => /browse Acme Corp's public pages/.test(content)),
    ).toBeInTheDocument();
  });

  it("falls back to 'the company' when company is null", () => {
    render(<CompanyResearch company={null} />);
    expect(
      screen.getByText((content) => /browse the company's public pages/.test(content)),
    ).toBeInTheDocument();
  });
});