import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { DiscoveryResponse } from "./services/api";

/**
 * Step 11.3 fix: cumulative AI Assistant filtering over a full result set.
 *
 * Reproduces the reported live scenario at mock scale: 304
 * recommendations, a relevance filter, then an explicit AssignedID
 * exclusion of 14 pre-2025 Crime Incidents datasets. Covers AND
 * combination, full-collection filtering with pagination, exact success
 * counts, undo/remove-one/clear, duplicate suppression, selection
 * survival, and workspace persistence across reloads.
 */

const EXCLUDED_IDS = [
  "390", "391", "762", "763", "761", "563", "392",
  "764", "765", "766", "760", "564", "513", "767",
];

const QUESTION = "Find crime related data for Washington, DC";

function rec(
  id: string,
  title: string,
  description: string,
  accessUrl: string | null,
  score: number,
) {
  return {
    AssignedID: id,
    title,
    description,
    source_portal: "Open Data DC",
    access_url: accessUrl,
    relevance_score: score,
    relevance_reason: `Reason ${id}`,
    proposed_role: "input dataset",
    limitations: [],
  };
}

function discoveryBody(): DiscoveryResponse {
  const recommendations = [
    // The 14 explicitly excluded pre-2025 Crime Incidents datasets.
    ...EXCLUDED_IDS.map((id) =>
      rec(id, `Crime Incidents 2023 Archive ${id}`, "Crime incident records before 2025", `https://example.com/${id}`, 75),
    ),
    // Newer Crime Incidents datasets the exclusion must NOT remove.
    rec("900", "Crime Incidents 2025 Update 900", "Recent crime incident records", "https://example.com/900", 88),
    rec("901", "Crime Incidents 2025 Update 901", "Recent crime incident records", "https://example.com/901", 88),
    rec("902", "Crime Incidents 2026 Update 902", "Recent crime incident records", "https://example.com/902", 88),
    rec("903", "Crime Incidents 2026 Update 903", "Recent crime incident records", "https://example.com/903", 88),
    // Weakly relevant filler removed by the relevance filter.
    ...Array.from({ length: 40 }, (_, i) =>
      rec(`w${i + 1}`, `Zebra Migration Path w${i + 1}`, "Wildlife tracking", `https://example.com/w${i + 1}`, 45),
    ),
    // Relevant datasets without an AccessURL, removed by filter 3 only.
    ...Array.from({ length: 6 }, (_, i) =>
      rec(`n${i + 1}`, `Traffic Safety Dataset NoURL n${i + 1}`, "Traffic safety records", null, 80),
    ),
    // Remaining relevant datasets (240) to reach 304 total.
    ...Array.from({ length: 240 }, (_, i) =>
      rec(`f${i + 1}`, `Traffic Safety Dataset f${i + 1}`, "Traffic safety records", `https://example.com/f${i + 1}`, 80),
    ),
  ];
  expect(recommendations).toHaveLength(304);
  return {
    request_id: "req-crime",
    question: QUESTION,
    interpreted_intent: "Analyze crime patterns in Washington, DC",
    recommendations,
    catalog_total: 1660,
    catalog_examined: 120,
    completeness: "partial",
    warnings: [],
  };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function chatOk(overrides: Record<string, unknown> = {}) {
  return {
    reply: "ok",
    referenced_assigned_ids: [],
    grounded_assigned_ids: [],
    filter_action: { action: "none", filters: [], description: "" },
    needs_catalog_search: false,
    catalog_query: null,
    catalog_search: null,
    warnings: [],
    ...overrides,
  };
}

function applyAction(filters: unknown[], description = "Filters applied.") {
  return { action: "apply", filters, description };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

interface Router {
  chatHandler: (body: Record<string, unknown>) => Promise<Response>;
  discoveryHandler: (body: Record<string, unknown>) => Promise<Response>;
  calls: { url: string; body: Record<string, unknown> }[];
}

function newRouter(): Router {
  return {
    chatHandler: async () => jsonResponse(200, chatOk()),
    discoveryHandler: async () => jsonResponse(200, discoveryBody()),
    calls: [],
  };
}

function stubRouter(router: Router) {
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    router.calls.push({ url: String(url), body });
    if (String(url).includes("/api/assistant/chat")) return router.chatHandler(body);
    if (String(url).includes("/api/discovery/search")) return router.discoveryHandler(body);
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal("fetch", mock);
}

function routeChatByMessage(router: Router) {
  router.chatHandler = async (body) => {
    const message = String((body as { message?: unknown }).message ?? "");
    if (message.includes("weakly")) {
      return jsonResponse(
        200,
        chatOk({
          reply: "Removed weakly relevant recommendations.",
          filter_action: applyAction(
            [{ field: "relevance_score", op: "gte", value: 60 }],
            "Keep recommendations with relevance 60 or higher.",
          ),
        }),
      );
    }
    if (message.includes("before 2025")) {
      return jsonResponse(
        200,
        chatOk({
          reply: "Excluded the 14 pre-2025 Crime Incidents datasets you named.",
          // Numeric IDs exercise the string/number normalization path.
          filter_action: applyAction(
            [{ field: "assigned_id", op: "none_of", value: EXCLUDED_IDS.map(Number) }],
            "Exclude the named pre-2025 datasets.",
          ),
        }),
      );
    }
    if (message.includes("AccessURL")) {
      return jsonResponse(
        200,
        chatOk({
          reply: "Kept datasets with AccessURLs.",
          filter_action: applyAction(
            [{ field: "has_access_url", op: "equals", value: true }],
            "Keep datasets with an AccessURL.",
          ),
        }),
      );
    }
    return jsonResponse(200, chatOk());
  };
}

async function runSearch() {
  fireEvent.change(screen.getByLabelText("Explore Government Data"), {
    target: { value: QUESTION },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Crime Incidents 2023 Archive 390");
}

function sendAssistant(text: string) {
  fireEvent.change(screen.getByLabelText("Ask for a refinement"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send refinement" }));
}

function loadAllPages() {
  for (let i = 0; i < 40; i++) {
    const more = screen.queryByRole("button", { name: /Load More/ });
    if (!more) return;
    fireEvent.click(more);
  }
  throw new Error("Load More did not exhaust after 40 pages");
}

describe("Step 11.3 fix: cumulative assigned_id filtering", () => {
  // Rendering 250 cards across 25 pages exceeds the default 5s timeout.
  it("applies consecutive filters with exact counts across all pages", async () => {
    const router = newRouter();
    routeChatByMessage(router);
    stubRouter(router);
    render(<App />);
    await runSearch();

    // A selection made before filtering must survive being hidden.
    fireEvent.click(
      screen.getByLabelText("Select Crime Incidents 2023 Archive 390 for the data recipe"),
    );
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    // Filter 1: remove weakly relevant recommendations (40 weak -> 264).
    sendAssistant("Remove weakly relevant recommendations");
    expect(await screen.findByText(/Showing 264 of 304 datasets/)).toBeTruthy();
    expect(screen.getByText(/264 of 304 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(1\)/)).toBeTruthy();

    // Filter 2: exclude the 14 named pre-2025 datasets (264 -> 250).
    sendAssistant(
      "Please remove Crime Incidents datasets before 2025: AssignedIDs 390, 391, 762, 763, 761, 563, 392, 764, 765, 766, 760, 564, 513, 767.",
    );
    expect(await screen.findByText(/Showing 250 of 304 datasets/)).toBeTruthy();
    expect(screen.getByText(/250 of 304 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(2\)/)).toBeTruthy();
    // Narrowing the search leaves the mission interpretation untouched.
    expect(screen.getByText("Analyze crime patterns in Washington, DC")).toBeTruthy();
    // The assistant mission context reflects the filtered counts.
    expect(screen.getByText(/250 of 304 datasets shown/)).toBeTruthy();
    // The hidden selection is preserved.
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    // Filters apply to the full collection, then paginate: load everything.
    loadAllPages();
    expect(screen.queryByRole("button", { name: /Load More/ })).toBeNull();
    expect(screen.getByText(/250 of 304 relevant datasets · showing 250 of 250/)).toBeTruthy();

    // Every excluded ID is absent from every page.
    for (const id of EXCLUDED_IDS) {
      expect(screen.queryByText(`Crime Incidents 2023 Archive ${id}`)).toBeNull();
    }
    // All remaining datasets satisfy filter 1: no weak dataset survives.
    expect(screen.queryAllByText(/Zebra Migration Path/)).toHaveLength(0);
    // 2025/2026 Crime Incidents datasets are not excluded by filter 2.
    expect(screen.getByText("Crime Incidents 2025 Update 900")).toBeTruthy();
    expect(screen.getByText("Crime Incidents 2026 Update 903")).toBeTruthy();
  }, 60000);

  it("undoes, removes one, clears, and dedupes cumulative filters", async () => {
    const router = newRouter();
    routeChatByMessage(router);
    stubRouter(router);
    render(<App />);
    await runSearch();

    sendAssistant("Remove weakly relevant recommendations");
    await screen.findByText(/Showing 264 of 304 datasets/);
    sendAssistant("Please remove Crime Incidents datasets before 2025");
    await screen.findByText(/Showing 250 of 304 datasets/);

    // Repeating the same request does not stack a duplicate filter.
    sendAssistant("Please remove Crime Incidents datasets before 2025");
    await waitFor(() => {
      expect(
        screen.getAllByText("Excluded the 14 pre-2025 Crime Incidents datasets you named."),
      ).toHaveLength(2);
    });
    expect(screen.getByText(/Active filters \(2\)/)).toBeTruthy();
    expect(screen.getByText(/250 of 304 relevant datasets/)).toBeTruthy();

    // Filter 3: keep datasets with an AccessURL (250 -> 244).
    sendAssistant("Exclude datasets without AccessURLs");
    expect(await screen.findByText(/Showing 244 of 304 datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(3\)/)).toBeTruthy();

    // Undo restores filters 1 and 2 exactly.
    fireEvent.click(screen.getByRole("button", { name: "Undo Last Filter" }));
    expect(screen.getByText(/250 of 304 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(2\)/)).toBeTruthy();
    expect(screen.getByText("excludes 14 IDs")).toBeTruthy();

    // Removing filter 2 leaves filter 1 (plus filter 3 was undone):
    // re-apply filter 3 first so removal is [f1, f3] -> 258.
    sendAssistant("Exclude datasets without AccessURLs");
    await screen.findByText(/Showing 244 of 304 datasets/);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter 2: excludes 14 IDs" }));
    expect(screen.getByText(/258 of 304 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(2\)/)).toBeTruthy();
    // The excluded dataset returns on the first page; loading the page that
    // would hold weak datasets proves filter 1 still excludes them.
    expect(screen.getByText("Crime Incidents 2023 Archive 390")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Load More/ }));
    expect(screen.queryByText("Zebra Migration Path w1")).toBeNull();

    // Clear restores the original 304 recommendations.
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(screen.getByText(/304 relevant datasets · showing 10 of 304/)).toBeTruthy();
    expect(screen.getByText("Showing 10 of 304 relevant datasets")).toBeTruthy();
    expect(screen.queryByText(/Active filters/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Load More/ }));
    expect(screen.getByText("Zebra Migration Path w1")).toBeTruthy();
  }, 60000);

  it("preserves selections and filters across browser reloads", async () => {
    const router = newRouter();
    routeChatByMessage(router);
    stubRouter(router);
    render(<App />);
    await runSearch();

    fireEvent.click(
      screen.getByLabelText("Select Crime Incidents 2023 Archive 390 for the data recipe"),
    );
    sendAssistant("Remove weakly relevant recommendations");
    await screen.findByText(/Showing 264 of 304 datasets/);
    sendAssistant("Please remove Crime Incidents datasets before 2025");
    await screen.findByText(/Showing 250 of 304 datasets/);

    // Wait for the workspace snapshot (filters + selection) to persist.
    await waitFor(() => {
      const raw = localStorage.getItem("metafabricai.workspace.v1");
      expect(raw).not.toBeNull();
      expect(String(raw)).toContain("assigned_id");
    });

    // Reload: any network call is a regression, everything restores.
    cleanup();
    const reloaded: Router = {
      chatHandler: async () => {
        throw new Error("must not refetch on reload");
      },
      discoveryHandler: async () => {
        throw new Error("must not refetch on reload");
      },
      calls: [],
    };
    stubRouter(reloaded);
    render(<App />);

    expect(await screen.findByText(/250 of 304 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/Active filters \(2\)/)).toBeTruthy();
    expect(screen.getByText("excludes 14 IDs")).toBeTruthy();
    expect(screen.queryByText("Crime Incidents 2023 Archive 390")).toBeNull();
    expect(screen.getByText("Crime Incidents 2025 Update 900")).toBeTruthy();
    // The hidden selection survived the reload: clearing restores it checked.
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(
      (screen.getByLabelText("Select Crime Incidents 2023 Archive 390 for the data recipe") as HTMLInputElement).checked,
    ).toBe(true);
    expect(reloaded.calls).toHaveLength(0);
  }, 60000);
});
