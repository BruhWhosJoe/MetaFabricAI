import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  readWorkspace,
  writeWorkspace,
  WORKSPACE_STORAGE_KEY,
} from "./services/workspaceStorage";
import type { DiscoveryResponse } from "./services/api";

const Q1 = "Find healthcare related data";
const Q2 = "Find pedestrian safety data in Washington DC";
const INTENT_A = "Interpreted intent A for healthcare";
const INTENT_B = "Interpreted intent B for pedestrian safety";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function rec(id: string, title: string) {
  return {
    AssignedID: id,
    title,
    description: `${title} description`,
    source_portal: "Open Data DC",
    access_url: `https://example.com/${id}`,
    relevance_score: 90,
    relevance_reason: `Reason ${id}`,
    proposed_role: "input dataset",
    limitations: [],
  };
}

function discoveryFixture(
  question: string,
  intent: string,
  recommendations: ReturnType<typeof rec>[] = [
    rec("101", "DC Crash Data"),
    rec("102", "DC Road Network"),
  ],
): DiscoveryResponse {
  return {
    request_id: "req-1",
    question,
    interpreted_intent: intent,
    recommendations,
    catalog_total: 1660,
    catalog_examined: 120,
    completeness: "partial",
    warnings: [],
  };
}

const recipeFixture = {
  recipe_id: "recipe-1",
  question: Q1,
  analytical_objective: "Identify pedestrian crash patterns",
  status: "proposed_not_executed",
  analysis_performed: false,
  selected_datasets: [
    {
      AssignedID: "101",
      title: "DC Crash Data",
      description: "Crash records",
      summary: null,
      source_portal: "Open Data DC",
      access_url: "https://example.com/101",
      tags: null,
      topic_categories: null,
      extent: null,
      role: "primary crash layer",
      role_explanation: "Crash events",
      relevance_reason: "Reason 101",
      limitations: ["Reporting lag"],
      metadata: {},
    },
  ],
  relationships: [],
  workflow_steps: [
    {
      step_id: "s1",
      order: 1,
      operation: "spatial_join",
      title: "Join crashes to roads",
      explanation: "Attach crashes to road segments",
      input_dataset_ids: ["101"],
      input_step_ids: [],
      proposed_output: "Crash-by-segment table",
    },
  ],
  expected_outputs: ["Crash-by-segment table"],
  data_gaps: [],
  assumptions: [],
  limitations: [],
  uncertainties: [],
  warnings: [],
};

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function runSearch(question: string) {
  fireEvent.change(screen.getByLabelText("Explore Government Data"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

async function seedWorkspace(overrides: Record<string, unknown> = {}) {
  await writeWorkspace({
    query: Q1,
    location: "",
    missionId: "flood-risks",
    sourceLevels: ["Federal", "State", "Local"],
    discovery: discoveryFixture(Q1, INTENT_A),
    selectedIds: ["101"],
    recipe: null,
    recipeAttempted: false,
    activeTab: "dashboard",
    activeNav: "dashboard",
    hasSearched: true,
    visibleCount: 10,
    searchMeta: {
      resultCount: 2,
      catalogExamined: 120,
      catalogTotal: 1660,
      completeness: "partial",
    },
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Workspace persistence (Step 11.2)", () => {
  it("restores a saved live session on reload without refetching", async () => {
    await seedWorkspace();
    const fetchMock = stubFetch(async () => {
      throw new Error("must not refetch on reload");
    });
    render(<App />);

    // Saved results, interpretation, and selections are back immediately.
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    expect(screen.getByText(INTENT_A)).toBeTruthy();
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Select DC Crash Data for the data recipe") as HTMLInputElement)
        .checked,
    ).toBe(true);
    // Restored data is labeled as restored, not as a new live search.
    expect(screen.getByText(/Restored results from a previous search/)).toBeTruthy();
    expect(screen.queryByText("National Flood Hazard Layer (NFHL)")).toBeNull();
    // No automatic MCP/AI search ran, and the saved session was not clobbered.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readWorkspace().state?.discovery?.question).toBe(Q1);
  });

  it("survives a React remount without losing live results or selections", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, discoveryFixture(Q1, INTENT_A)));
    const { unmount } = render(<App />);
    runSearch(Q1);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
    const callsAfterSearch = fetchMock.mock.calls.length;
    expect(callsAfterSearch).toBe(1);

    unmount();
    fetchMock.mockImplementation(async () => {
      throw new Error("must not refetch on remount");
    });
    render(<App />);

    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    expect(screen.getByText(/Restored results from a previous search/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Select DC Crash Data for the data recipe") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterSearch);
  });

  it("does not re-search when the browser tab is hidden and shown again", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, discoveryFixture(Q1, INTENT_A)));
    render(<App />);
    runSearch(Q1);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    const callsAfterSearch = fetchMock.mock.calls.length;

    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterSearch);
    expect(screen.getByText("DC Crash Data")).toBeTruthy();
  });

  it("preserves dataset selections when switching between Dashboard and Data Recipe", async () => {
    stubFetch(async (url) =>
      url.includes("/api/recipe/generate")
        ? jsonResponse(200, recipeFixture)
        : jsonResponse(200, discoveryFixture(Q1, INTENT_A)),
    );
    render(<App />);
    runSearch(Q1);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Data Recipe/ }));
    expect(screen.getByText("DC Crash Data")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Back to Research Workspace/ }));
    expect(
      (screen.getByLabelText("Select DC Crash Data for the data recipe") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
  });

  it("persists a generated Data Recipe across an application restart", async () => {
    const fetchMock = stubFetch(async (url) =>
      url.includes("/api/recipe/generate")
        ? jsonResponse(200, recipeFixture)
        : jsonResponse(200, discoveryFixture(Q1, INTENT_A)),
    );
    const { unmount } = render(<App />);
    runSearch(Q1);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
    fireEvent.click(screen.getByRole("button", { name: /Generate Data Recipe/ }));
    expect(await screen.findByText("Identify pedestrian crash patterns")).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    const callsBeforeRestart = fetchMock.mock.calls.length;
    unmount();
    fetchMock.mockImplementation(async () => {
      throw new Error("must not regenerate on restart");
    });
    render(<App />);

    // The recipe workspace (not the demo recipe) is restored with no refetch.
    expect(await screen.findByText("Identify pedestrian crash patterns")).toBeTruthy();
    expect(screen.getByText(/Proposed — not executed/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeRestart);
  });

  it("falls back to demo mode on corrupted stored state", () => {
    const fetchMock = stubFetch(async () => {
      throw new Error("must not fetch for a corrupt session");
    });
    localStorage.setItem(WORKSPACE_STORAGE_KEY, "not-json{{{");
    render(<App />);

    expect(screen.getByText("National Flood Hazard Layer (NFHL)")).toBeTruthy();
    expect(screen.getByText(/Demo data:/)).toBeTruthy();
    expect(screen.queryByText("DC Crash Data")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to demo mode on an outdated schema version", () => {
    const fetchMock = stubFetch(async () => {
      throw new Error("must not fetch for an outdated session");
    });
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 0, savedAt: "2020-01-01", query: Q1 }),
    );
    render(<App />);

    expect(screen.getByText("National Flood Hazard Layer (NFHL)")).toBeTruthy();
    expect(screen.queryByText("DC Crash Data")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the session working when storage quota is exceeded", async () => {
    const quotaFailure = () => {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      return error;
    };
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaFailure();
    });
    try {
      stubFetch(async () => jsonResponse(200, discoveryFixture(Q1, INTENT_A)));
      render(<App />);
      runSearch(Q1);

      // The live search still works and the quota problem is surfaced gently.
      expect(await screen.findByText("DC Crash Data")).toBeTruthy();
      expect(await screen.findByText(/may not survive a reload/)).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
      expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("Reset Workspace asks for confirmation and clears the saved session", async () => {
    await seedWorkspace();
    const fetchMock = stubFetch(async () => {
      throw new Error("must not fetch around reset");
    });
    const { unmount } = render(<App />);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();

    const originalConfirm = window.confirm;
    const confirmMock = vi.fn(() => false);
    window.confirm = confirmMock;
    try {
      fireEvent.click(screen.getByRole("button", { name: "Reset Workspace" }));
      expect(confirmMock).toHaveBeenCalledTimes(1);
      // Cancelled: the saved session is untouched.
      expect(screen.getByText("DC Crash Data")).toBeTruthy();
      expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).not.toBeNull();

      confirmMock.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Reset Workspace" }));
      expect(await screen.findByText("National Flood Hazard Layer (NFHL)")).toBeTruthy();
      expect(screen.queryByText("DC Crash Data")).toBeNull();
      // The persisted session is cleared; a restart shows the initial state.
      expect(readWorkspace().state?.discovery ?? null).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      unmount();
      render(<App />);
      expect(screen.getByText("National Flood Hazard Layer (NFHL)")).toBeTruthy();
      expect(screen.queryByText("DC Crash Data")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  it("labels restored data differently from fresh live results", async () => {
    await seedWorkspace();
    const fetchMock = stubFetch(async () => jsonResponse(200, discoveryFixture(Q2, INTENT_B)));
    render(<App />);

    expect(await screen.findByText(/Restored results from a previous search/)).toBeTruthy();
    expect(screen.queryByText(/Live results:/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // A fresh search replaces the restored banner with the live banner.
    runSearch(Q2);
    expect(await screen.findByText(INTENT_B)).toBeTruthy();
    expect(screen.getByText(/Live results:/)).toBeTruthy();
    expect(screen.queryByText(/Restored results from a previous search/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps previous results when a new search fails", async () => {
    let failDiscovery = false;
    const fetchMock = stubFetch(async () =>
      failDiscovery
        ? jsonResponse(503, { detail: "Metadata catalog unavailable", error: "mcp_unavailable" })
        : jsonResponse(200, discoveryFixture(Q1, INTENT_A)),
    );
    render(<App />);
    runSearch(Q1);
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    failDiscovery = true;
    runSearch(Q2);

    // The failed new search is reported, but the previous results survive.
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Previous results kept below/)).toBeTruthy();
    expect(screen.getByText(/Previous results:/)).toBeTruthy();
    expect(screen.getByText("DC Crash Data")).toBeTruthy();
    expect(screen.getByText(INTENT_A)).toBeTruthy();
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
