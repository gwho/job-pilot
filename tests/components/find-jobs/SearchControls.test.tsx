import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchControls } from "@/components/find-jobs/SearchControls";

describe("SearchControls", () => {
  describe("initial render", () => {
    it("renders the Job Title label", () => {
      render(<SearchControls />);
      expect(screen.getByText("Job Title")).toBeInTheDocument();
    });

    it("renders the Location label", () => {
      render(<SearchControls />);
      expect(screen.getByText("Location")).toBeInTheDocument();
    });

    it("renders the Job Title input with correct placeholder", () => {
      render(<SearchControls />);
      expect(
        screen.getByPlaceholderText("Frontend Engineer"),
      ).toBeInTheDocument();
    });

    it("renders the Location input with correct placeholder", () => {
      render(<SearchControls />);
      expect(
        screen.getByPlaceholderText("Remote, New York..."),
      ).toBeInTheDocument();
    });

    it("renders the Find Jobs button", () => {
      render(<SearchControls />);
      expect(
        screen.getByRole("button", { name: /find jobs/i }),
      ).toBeInTheDocument();
    });

    it("does not show the success banner initially", () => {
      render(<SearchControls />);
      expect(screen.queryByText(/found \d+ jobs/i)).not.toBeInTheDocument();
    });
  });

  describe("input interaction", () => {
    it("updates the Job Title input value when typed into", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      const input = screen.getByPlaceholderText("Frontend Engineer");
      await user.type(input, "React Developer");
      expect(input).toHaveValue("React Developer");
    });

    it("updates the Location input value when typed into", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      const input = screen.getByPlaceholderText("Remote, New York...");
      await user.type(input, "San Francisco");
      expect(input).toHaveValue("San Francisco");
    });

    it("clears the Job Title input when cleared", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      const input = screen.getByPlaceholderText("Frontend Engineer");
      await user.type(input, "Engineer");
      await user.clear(input);
      expect(input).toHaveValue("");
    });
  });

  describe("Find Jobs button", () => {
    it("shows the success banner after clicking Find Jobs", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      await user.click(screen.getByRole("button", { name: /find jobs/i }));
      expect(
        screen.getByText(/found 8 jobs and saved 4 strong matches/i),
      ).toBeInTheDocument();
    });

    it("success banner shows correct jobsFound count (8)", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      await user.click(screen.getByRole("button", { name: /find jobs/i }));
      expect(screen.getByText(/found 8 jobs/i)).toBeInTheDocument();
    });

    it("success banner shows correct strongMatches count (4)", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      await user.click(screen.getByRole("button", { name: /find jobs/i }));
      expect(screen.getByText(/saved 4 strong matches/i)).toBeInTheDocument();
    });

    it("success banner is not shown before clicking Find Jobs", () => {
      render(<SearchControls />);
      expect(screen.queryByText(/strong matches/i)).not.toBeInTheDocument();
    });

    it("success banner remains visible after a second click", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      const button = screen.getByRole("button", { name: /find jobs/i });
      await user.click(button);
      await user.click(button);
      expect(
        screen.getByText(/found 8 jobs and saved 4 strong matches/i),
      ).toBeInTheDocument();
    });

    it("button is still enabled after search (can search again)", async () => {
      const user = userEvent.setup();
      render(<SearchControls />);
      const button = screen.getByRole("button", { name: /find jobs/i });
      await user.click(button);
      expect(button).not.toBeDisabled();
    });
  });
});