/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// The raw stylesheet (vitest empties ?raw CSS imports, so read the file).
const cssRoot = process.env.INIT_CWD ?? process.cwd();
const css = readFileSync(join(cssRoot, "src/index.css"), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Assistant hide/show layout (Step 11.3)", () => {
  it("keeps fixed sidebar and assistant tracks in both grid states", () => {
    // Root cause of the old bug: every track used fr units, so collapsing
    // redistributed free space and the sidebar jumped from ~15% to ~94%.
    // Both desktop rules must pin the sidebar to the same fixed track and
    // let only the center minmax(0, 1fr) track absorb the difference.
    expect(css).toContain("grid-template-columns: 15rem minmax(0, 1fr) 22rem;");
    expect(css).toContain("grid-template-columns: 15rem minmax(0, 1fr) 3.25rem;");
    expect(css).not.toContain("15fr");
    expect(css).toContain("overflow-x: clip");
  });

  it("expands only the center panel when the assistant is hidden", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network on layout test");
      }),
    );
    render(<App />);
    const grid = document.querySelector(".dashboard-grid");
    expect(grid).toBeTruthy();
    expect(grid!.classList.contains("dashboard-grid--assistant-collapsed")).toBe(false);

    // Sidebar and workspace are both present before hiding.
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Explore Government Data" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse AI assistant" }));
    expect(grid!.classList.contains("dashboard-grid--assistant-collapsed")).toBe(true);
    // The left navigation sidebar is untouched; only the assistant collapsed.
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Explore Government Data" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand AI assistant" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand AI assistant" }));
    expect(grid!.classList.contains("dashboard-grid--assistant-collapsed")).toBe(false);
    expect(screen.getByText("AI Assistant")).toBeTruthy();
  });
});
