import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const QUESTION =
  "Find datasets useful for analyzing pedestrian safety and traffic crashes in Washington, DC.";

const discoveryBody = {
  request_id: "req-1",
  question: QUESTION,
  interpreted_intent: "Analyze pedestrian safety and traffic crashes in Washington, DC",
  recommendations: [
    {
      AssignedID: "101",
      title: "DC Crash Data",
      description: "Crash records",
      source_portal: "Open Data DC",
      access_url: "https://example.com/crashes",
      relevance_score: 92,
      relevance_reason: "Direct crash records",
      proposed_role: "primary crash layer",
      limitations: ["Reporting lag"],
    },
    {
      AssignedID: "102",
      title: "DC Road Network",
      description: "Roads",
      source_portal: "Open Data DC",
      access_url: "https://example.com/roads",
      relevance_score: 70,
      relevance_reason: "Road context",
      proposed_role: "network context",
      limitations: [],
    },
  ],
  catalog_total: 1660,
  catalog_examined: 120,
  completeness: "partial",
  warnings: ["Only part of the catalog was examined"],
};

const recipeBody = {
  recipe_id: "recipe-1",
  question: QUESTION,
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
      access_url: "https://example.com/crashes",
      tags: null,
      topic_categories: null,
      extent: null,
      role: "primary crash layer",
      role_explanation: "Crash events",
      relevance_reason: "Direct crash records",
      limitations: ["Reporting lag"],
      metadata: {},
    },
  ],
  relationships: [
    {
      relationship_id: "rel-1",
      source_dataset_id: "101",
      target_dataset_id: "102",
      relationship_type: "spatial_join",
      description: "Join crashes to roads",
      basis: "proposed_requires_verification",
      verification_needed: ["Check road identifiers"],
    },
  ],
  workflow_steps: [
    {
      step_id: "s1",
      order: 1,
      operation: "spatial_join",
      title: "Join crashes to roads",
      explanation: "Attach crashes to road segments",
      input_dataset_ids: ["101", "102"],
      input_step_ids: [],
      proposed_output: "Crash-by-segment table",
    },
  ],
  expected_outputs: ["Crash-by-segment table"],
  data_gaps: ["No pedestrian exposure counts"],
  assumptions: ["Crash locations are accurate"],
  limitations: ["Reporting lag"],
  uncertainties: ["Geocoding quality varies"],
  warnings: ["Verify road join keys"],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function runSearch(expectedTitle = "DC Crash Data") {
  const input = screen.getByLabelText("Explore Government Data");
  fireEvent.change(input, { target: { value: QUESTION } });
  fireEvent.change(screen.getByLabelText("Location (optional)"), {
    target: { value: "Washington, DC" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(expectedTitle);
}

describe("Step 11 integration", () => {
  it("preserves the existing demo dashboard on first load", () => {
    stubFetch(async () => jsonResponse(200, discoveryBody));
    render(<App />);
    expect(screen.getByRole("heading", { name: "Explore Government Data" })).toBeTruthy();
    expect(screen.getByText("National Flood Hazard Layer (NFHL)")).toBeTruthy();
    expect(screen.getByText("Research Workspace")).toBeTruthy();
    expect(screen.getByText("AI Assistant")).toBeTruthy();
  });

  it("submits discovery, displays live recommendations and warnings", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, discoveryBody));
    render(<App />);
    await runSearch();
    expect(screen.getByText("AssignedID: 101")).toBeTruthy();
    expect(screen.getByText(/Relevance 92/)).toBeTruthy();
    expect(screen.getByText(/Only part of the catalog was examined/)).toBeTruthy();
    expect(screen.getByText(/completeness: partial/)).toBeTruthy();
    expect(screen.getByText("Analyze pedestrian safety and traffic crashes in Washington, DC")).toBeTruthy();
    const link = screen.getAllByRole("link", { name: /Open Dataset/ })[0];
    expect(link.getAttribute("href")).toBe("https://example.com/crashes");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/discovery/search");
    expect(JSON.parse(String(init.body))).toEqual({
      question: QUESTION,
      location: "Washington, DC",
    });
    // New search cleared previous (demo) selections.
    expect(screen.getByText(/0 selected for the recipe/)).toBeTruthy();
  });

  it("shows loading and prevents duplicate discovery submissions", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    const fetchMock = stubFetch(
      () => new Promise<Response>((r) => (resolveFetch = r)),
    );
    render(<App />);
    const input = screen.getByLabelText("Explore Government Data");
    fireEvent.change(input, { target: { value: QUESTION } });
    const button = screen.getByRole("button", { name: /Search/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText("Searching the metadata catalog…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Searching/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse(200, { ...discoveryBody, recommendations: [] }));
    expect(await screen.findByText("No datasets found for this question. Try broader terms or a different location.")).toBeTruthy();
  });

  it("shows backend errors and does not present demo data as results", async () => {
    stubFetch(async () =>
      jsonResponse(503, { detail: "Metadata catalog unavailable: down", error: "mcp_unavailable" }),
    );
    render(<App />);
    const input = screen.getByLabelText("Explore Government Data");
    fireEvent.change(input, { target: { value: QUESTION } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Metadata catalog unavailable/)).toBeTruthy();
    expect(screen.queryByText("National Flood Hazard Layer (NFHL)")).toBeNull();
    expect(screen.queryByText("DC Crash Data")).toBeNull();
  });

  it("selects by AssignedID, dedupes via toggling, and generates a proposed recipe", async () => {
    const fetchMock = stubFetch(async (url) =>
      url.includes("/api/recipe/generate")
        ? jsonResponse(200, recipeBody)
        : jsonResponse(200, discoveryBody),
    );
    render(<App />);
    await runSearch();

    const checkbox = screen.getByLabelText("Select DC Crash Data for the data recipe");
    fireEvent.click(checkbox);
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();
    fireEvent.click(checkbox); // deselect
    expect(screen.getByText(/0 selected for the recipe/)).toBeTruthy();
    fireEvent.click(checkbox); // select again (Set prevents duplicates)
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Generate Data Recipe/ }));
    expect(await screen.findByText("Identify pedestrian crash patterns")).toBeTruthy();
    expect(screen.getByText(/Proposed — not executed/)).toBeTruthy();
    expect(screen.getByText(/proposed_not_executed/)).toBeTruthy();
    expect(screen.getByText(/analysis_performed: false/)).toBeTruthy();
    expect(screen.getAllByText(/Join crashes to roads/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No pedestrian exposure counts/)).toBeTruthy();
    expect(screen.getByText(/Verify road join keys/)).toBeTruthy();
    expect(screen.getByText(/Geocoding quality varies/)).toBeTruthy();

    const recipeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/recipe/generate"),
    ) as unknown as [string, RequestInit];
    const payload = JSON.parse(String(recipeCall[1].body));
    expect(payload.selected_assigned_ids).toEqual(["101"]);
    expect(payload.question).toBe(QUESTION);
    expect(payload.discovery_context).toEqual({
      interpreted_intent: discoveryBody.interpreted_intent,
      location: "Washington, DC",
      dataset_context: [
        { AssignedID: "101", relevance_reason: "Direct crash records", proposed_role: "primary crash layer" },
      ],
    });

    // Regenerate control is present after generation.
    expect(screen.getByRole("button", { name: /Regenerate Data Recipe/ })).toBeTruthy();
  });

  it("shows a recipe error (404) without a fabricated recipe", async () => {
    stubFetch(async (url) =>
      url.includes("/api/recipe/generate")
        ? jsonResponse(404, { detail: "AssignedID 101 not found", error: "dataset_not_found" })
        : jsonResponse(200, discoveryBody),
    );
    render(<App />);
    await runSearch();
    fireEvent.click(screen.getByLabelText("Select DC Crash Data for the data recipe"));
    fireEvent.click(screen.getByRole("button", { name: /Generate Data Recipe/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/AssignedID 101 not found/)).toBeTruthy();
    expect(screen.queryByText(/Proposed — not executed/)).toBeNull();
  });

  it("displays more than five results with a total relevant count", async () => {
    const many = {
      ...discoveryBody,
      recommendations: Array.from({ length: 8 }, (_, i) => ({
        AssignedID: String(201 + i),
        title: `Flood Dataset ${201 + i}`,
        description: `Description ${201 + i}`,
        source_portal: "Open Data DC",
        access_url: `https://example.com/${201 + i}`,
        relevance_score: 95 - i * 3,
        relevance_reason: `Reason ${201 + i}`,
        proposed_role: "input dataset",
        limitations: [],
      })),
      catalog_total: 8,
      catalog_examined: 8,
      completeness: "complete",
      warnings: [],
    };
    stubFetch(async () => jsonResponse(200, many));
    render(<App />);
    await runSearch("Flood Dataset 201");
    // Total is shown; with 8 results and a page size of 10 all are visible.
    expect(screen.getByText("Flood Dataset 201")).toBeTruthy();
    expect(screen.getByText("Flood Dataset 208")).toBeTruthy();
    expect(screen.getByText(/8 relevant datasets/)).toBeTruthy();
    expect(screen.getByText(/showing 8 of 8/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load More/ })).toBeNull();
  });

  it("paginates with Load More and preserves cross-page selections", async () => {
    const many = {
      ...discoveryBody,
      recommendations: Array.from({ length: 12 }, (_, i) => ({
        AssignedID: String(301 + i),
        title: `Paginated Dataset ${301 + i}`,
        description: `Description ${301 + i}`,
        source_portal: "Open Data DC",
        access_url: `https://example.com/${301 + i}`,
        relevance_score: 95 - i,
        relevance_reason: `Reason ${301 + i}`,
        proposed_role: "input dataset",
        limitations: [],
      })),
      catalog_total: 12,
      catalog_examined: 12,
      completeness: "complete",
      warnings: [],
    };
    const fetchMock = stubFetch(async (url) =>
      url.includes("/api/recipe/generate")
        ? jsonResponse(200, recipeBody)
        : jsonResponse(200, many),
    );
    render(<App />);
    await runSearch("Paginated Dataset 301");
    expect(screen.getByText("Paginated Dataset 301")).toBeTruthy();
    // First page shows 10 of 12 with a Load More button.
    expect(screen.getByText(/12 relevant datasets · showing 10 of 12/)).toBeTruthy();
    expect(screen.getByText(/Showing 10 of 12 relevant datasets/)).toBeTruthy();
    const loadMore = screen.getByRole("button", { name: /Load More \(2 remaining\)/ });
    expect(loadMore).toBeTruthy();
    expect(screen.queryByText("Paginated Dataset 312")).toBeNull();

    // Select one dataset on the first page.
    fireEvent.click(screen.getByLabelText("Select Paginated Dataset 301 for the data recipe"));
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    // Load the second page; first-page selection persists.
    fireEvent.click(loadMore);
    expect(await screen.findByText("Paginated Dataset 312")).toBeTruthy();
    expect(screen.getByText(/showing 12 of 12/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load More/ })).toBeNull();
    expect(screen.getByText(/1 selected for the recipe/)).toBeTruthy();

    // Select one dataset on the second page; both persist for the recipe.
    fireEvent.click(screen.getByLabelText("Select Paginated Dataset 312 for the data recipe"));
    expect(screen.getByText(/2 selected for the recipe/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Generate Data Recipe/ }));
    await waitFor(() => expect(screen.getByText(/Proposed — not executed/)).toBeTruthy());
    const recipeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/recipe/generate"),
    ) as unknown as [string, RequestInit];
    const payload = JSON.parse(String(recipeCall[1].body));
    expect(payload.selected_assigned_ids).toEqual(
      expect.arrayContaining(["301", "312"]),
    );
    expect(payload.selected_assigned_ids).toHaveLength(2);
  });

  it("reports complete catalog coverage when the full catalog was examined", async () => {
    const full = {
      ...discoveryBody,
      catalog_total: 2,
      catalog_examined: 2,
      completeness: "complete",
      warnings: [],
    };
    stubFetch(async () => jsonResponse(200, full));
    render(<App />);
    await runSearch();
    expect(await screen.findByText("DC Crash Data")).toBeTruthy();
    expect(screen.getByText(/examined 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/completeness: complete/)).toBeTruthy();
  });
});
