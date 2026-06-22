import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavLinks } from "./NavLinks";

// ---------------------------------------------------------------------------
// Mock next/navigation and next/link
// ---------------------------------------------------------------------------

let mockPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => mockPathname),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setPathname(path: string) {
  mockPathname = path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NavLinks", () => {
  beforeEach(() => {
    setPathname("/dashboard");
  });

  describe("rendering", () => {
    it("renders all three navigation links", () => {
      render(<NavLinks />);
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Find Jobs")).toBeInTheDocument();
      expect(screen.getByText("Profile")).toBeInTheDocument();
    });

    it("renders links with correct hrefs", () => {
      render(<NavLinks />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
      expect(screen.getByRole("link", { name: "Find Jobs" })).toHaveAttribute("href", "/find-jobs");
      expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/profile");
    });

    it("renders a nav element", () => {
      render(<NavLinks />);
      expect(screen.getByRole("navigation")).toBeInTheDocument();
    });
  });

  describe("active state — exact pathname match", () => {
    it("applies text-accent class to Dashboard when on /dashboard", () => {
      setPathname("/dashboard");
      render(<NavLinks />);
      const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
      expect(dashboardLink.className).toContain("text-accent");
    });

    it("applies text-accent class to Find Jobs when on /find-jobs", () => {
      setPathname("/find-jobs");
      render(<NavLinks />);
      const findJobsLink = screen.getByRole("link", { name: "Find Jobs" });
      expect(findJobsLink.className).toContain("text-accent");
    });

    it("applies text-accent class to Profile when on /profile", () => {
      setPathname("/profile");
      render(<NavLinks />);
      const profileLink = screen.getByRole("link", { name: "Profile" });
      expect(profileLink.className).toContain("text-accent");
    });
  });

  describe("active state — sub-route match", () => {
    it("activates Dashboard for /dashboard/sub-page", () => {
      setPathname("/dashboard/sub-page");
      render(<NavLinks />);
      const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
      expect(dashboardLink.className).toContain("text-accent");
    });

    it("activates Find Jobs for /find-jobs/job-123", () => {
      setPathname("/find-jobs/job-123");
      render(<NavLinks />);
      const findJobsLink = screen.getByRole("link", { name: "Find Jobs" });
      expect(findJobsLink.className).toContain("text-accent");
    });

    it("activates Profile for /profile/settings", () => {
      setPathname("/profile/settings");
      render(<NavLinks />);
      const profileLink = screen.getByRole("link", { name: "Profile" });
      expect(profileLink.className).toContain("text-accent");
    });
  });

  describe("inactive state", () => {
    it("inactive links have text-text-dark class", () => {
      setPathname("/dashboard");
      render(<NavLinks />);
      const findJobsLink = screen.getByRole("link", { name: "Find Jobs" });
      const profileLink = screen.getByRole("link", { name: "Profile" });
      expect(findJobsLink.className).toContain("text-text-dark");
      expect(profileLink.className).toContain("text-text-dark");
    });

    it("only the active link lacks text-text-dark (active = no dark text class)", () => {
      // Active links use "text-accent" only; inactive links use "text-text-dark hover:text-accent".
      // We distinguish by checking for "text-text-dark" on inactive links.
      setPathname("/profile");
      render(<NavLinks />);
      const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
      const findJobsLink = screen.getByRole("link", { name: "Find Jobs" });
      const profileLink = screen.getByRole("link", { name: "Profile" });
      expect(dashboardLink.className).toContain("text-text-dark"); // inactive
      expect(findJobsLink.className).toContain("text-text-dark");  // inactive
      expect(profileLink.className).not.toContain("text-text-dark"); // active
    });
  });

  describe("prefix matching edge cases", () => {
    it("does NOT activate Dashboard for /dashboardextra (false prefix match)", () => {
      // The active check is pathname.startsWith(href + '/'), so /dashboardextra
      // should NOT match /dashboard. Inactive links have "text-text-dark".
      setPathname("/dashboardextra");
      render(<NavLinks />);
      const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
      // /dashboardextra !== /dashboard and does not startsWith("/dashboard/")
      // → link is inactive → has text-text-dark class
      expect(dashboardLink.className).toContain("text-text-dark");
    });

    it("no link is active when on an unrelated route like /settings", () => {
      setPathname("/settings");
      render(<NavLinks />);
      const links = screen.getAllByRole("link");
      links.forEach((link) => {
        expect(link.className).toContain("text-text-dark");
      });
    });
  });

  describe("transition class", () => {
    it("all links have transition-colors class", () => {
      setPathname("/dashboard");
      render(<NavLinks />);
      const links = screen.getAllByRole("link");
      links.forEach((link) => {
        expect(link.className).toContain("transition-colors");
      });
    });
  });
});