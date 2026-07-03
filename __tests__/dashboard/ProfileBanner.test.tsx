import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProfileBanner } from "@/components/dashboard/ProfileBanner";

describe("ProfileBanner", () => {
  it("renders nothing when isComplete is true", () => {
    const { container } = render(<ProfileBanner isComplete={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the incomplete-profile warning message when isComplete is false", () => {
    render(<ProfileBanner isComplete={false} />);
    expect(screen.getByText(/your profile is incomplete/i)).toBeInTheDocument();
    expect(
      screen.getByText(/complete your profile to unlock better job matches/i),
    ).toBeInTheDocument();
  });

  it("renders a call-to-action link pointing to /profile", () => {
    render(<ProfileBanner isComplete={false} />);
    const link = screen.getByRole("link", { name: /complete profile/i });
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("renders the AlertCircle icon with warning styling", () => {
    const { container } = render(<ProfileBanner isComplete={false} />);
    const icon = container.querySelector("svg");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass("text-warning");
  });

  it("does not render the call-to-action link when isComplete is true", () => {
    render(<ProfileBanner isComplete={true} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});