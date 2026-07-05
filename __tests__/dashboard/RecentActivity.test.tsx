/**
 * Tests for RecentActivity (Feature 16 — Recent Activity Real Data).
 *
 * Covers the changes introduced in this PR:
 *   - `ActivityItem` gained a required `id` field, used as the React key
 *     instead of the array index.
 *   - An empty state ("No activity yet. Run a search to get started.")
 *     renders when `items.length === 0`, with a link to `/find-jobs`.
 *   - The populated list still renders each item's label/timeAgo and the
 *     correct dot styling per `type`.
 *
 * Run: npm run test:run -- __tests__/dashboard/RecentActivity.test.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/RecentActivity";

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "search-1",
    type: "search",
    label: "Found 8 jobs for Frontend Engineer",
    timeAgo: "10 mins ago",
    ...overrides,
  };
}

describe("RecentActivity", () => {
  describe("empty state", () => {
    it("renders the empty-state message when items is an empty array", () => {
      render(<RecentActivity items={[]} />);
      expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    });

    it("renders a link to /find-jobs with the text 'Run a search'", () => {
      render(<RecentActivity items={[]} />);
      const link = screen.getByRole("link", { name: /run a search/i });
      expect(link).toHaveAttribute("href", "/find-jobs");
    });

    it("does not render the divider list container when empty", () => {
      const { container } = render(<RecentActivity items={[]} />);
      expect(container.querySelector(".divide-y")).not.toBeInTheDocument();
    });

    it("still renders the 'Recent Activity' heading when empty", () => {
      render(<RecentActivity items={[]} />);
      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    });
  });

  describe("populated state", () => {
    it("renders one row per item", () => {
      const items = [
        makeItem({ id: "search-1", label: "Found 8 jobs for Frontend Engineer" }),
        makeItem({ id: "research-1", type: "research", label: "Researched Stripe" }),
      ];
      render(<RecentActivity items={items} />);
      expect(screen.getByText("Found 8 jobs for Frontend Engineer")).toBeInTheDocument();
      expect(screen.getByText("Researched Stripe")).toBeInTheDocument();
    });

    it("does not render the empty-state message when items are present", () => {
      render(<RecentActivity items={[makeItem()]} />);
      expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument();
    });

    it("renders the timeAgo text alongside each label", () => {
      render(
        <RecentActivity
          items={[makeItem({ label: "Researched Vercel", timeAgo: "Yesterday" })]}
        />,
      );
      expect(screen.getByText("Researched Vercel")).toBeInTheDocument();
      expect(screen.getByText("Yesterday")).toBeInTheDocument();
    });

    it("preserves the given item order in the DOM", () => {
      const items = [
        makeItem({ id: "a", label: "First event" }),
        makeItem({ id: "b", label: "Second event" }),
        makeItem({ id: "c", label: "Third event" }),
      ];
      render(<RecentActivity items={items} />);
      const labels = screen.getAllByText(/event$/).map((el) => el.textContent);
      expect(labels).toEqual(["First event", "Second event", "Third event"]);
    });

    it("applies the success dot classes for a 'search' type item", () => {
      const { container } = render(
        <RecentActivity items={[makeItem({ type: "search" })]} />,
      );
      expect(container.querySelector(".bg-success-light")).toBeInTheDocument();
      expect(container.querySelector(".bg-success-alt")).toBeInTheDocument();
    });

    it("applies the info dot classes for a 'research' type item", () => {
      const { container } = render(
        <RecentActivity items={[makeItem({ type: "research" })]} />,
      );
      expect(container.querySelector(".bg-info-light")).toBeInTheDocument();
      expect(container.querySelector(".bg-info")).toBeInTheDocument();
    });

    it("renders duplicate labels from distinct items without collapsing them", () => {
      // Two distinct DB rows can produce the same label text; distinct `id`s
      // must still result in two rendered rows (regression for switching
      // away from index-based keys).
      const items = [
        makeItem({ id: "search-1", label: "Found 5 jobs for Engineer" }),
        makeItem({ id: "search-2", label: "Found 5 jobs for Engineer" }),
      ];
      render(<RecentActivity items={items} />);
      expect(screen.getAllByText("Found 5 jobs for Engineer")).toHaveLength(2);
    });
  });
});