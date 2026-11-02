import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  buildDiscoveryContext,
  dedupeIds,
  generateRecipe,
  recommendationToDataset,
  searchDiscovery,
  workflowStepsToLines,
  type DataRecipeResponse,
  type DiscoveryResponse,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const discovery: DiscoveryResponse = {
  request_id: "req-1",
  question: "pedestrian safety in Washington, DC",
  interpreted_intent: "Analyze pedestrian safety and traffic crashes",
  recommendations: [
    {
      AssignedID: "101",
      title: "Crash Data",
      description: "Crashes",
      source_portal: "Open Data DC",
      access_url: "https://example.com/crashes",
      relevance_score: 92,
      relevance_reason: "Direct crash records",
      proposed_role: "primary crash layer",
      limitations: ["Reporting lag"],
    },
    {
      AssignedID: "102",
      title: "Road Network",
      description: null,
      source_portal: null,
      access_url: null,
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

afterEach(() => vi.unstubAllGlobals());

describe("searchDiscovery", () => {
  it("posts the correct payload to the relative discovery path", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, discovery));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchDiscovery({
      question: "  pedestrian safety  ",
      location: " Washington, DC ",
    });
    expect(result.request_id).toBe("req-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/discovery/search");
    // No default cap: max_recommendations is omitted unless explicitly requested.
    expect(JSON.parse(String(init.body))).toEqual({
      question: "pedestrian safety",
      location: "Washington, DC",
    });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("forwards an explicit max_recommendations page size when provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, discovery));
    vi.stubGlobal("fetch", fetchMock);
    await searchDiscovery({ question: "flood risk", max_recommendations: 25 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      question: "flood risk",
      location: null,
      max_recommendations: 25,
    });
  });

  it("returns more than five recommendations without truncation", async () => {
    const many = {
      ...discovery,
      recommendations: Array.from({ length: 8 }, (_, i) => ({
        ...discovery.recommendations[0],
        AssignedID: String(101 + i),
        title: `Dataset ${101 + i}`,
        relevance_score: 90 - i,
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, many)),
    );
    const result = await searchDiscovery({ question: "flood risk" });
    expect(result.recommendations).toHaveLength(8);
    const scores = result.recommendations.map((r) => r.relevance_score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("maps 503 backend errors with their message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(503, { detail: "Metadata catalog unavailable: down", error: "mcp_unavailable" }),
      ),
    );
    await expect(searchDiscovery({ question: "flood risk" })).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "mcp_unavailable",
    });
  });

  it("maps 422 validation detail arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { detail: [{ msg: "question too short" }] })),
    );
    const err = await searchDiscovery({ question: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("question too short");
  });

  it("maps network failures to a backend-unavailable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(searchDiscovery({ question: "flood risk" })).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("Backend unavailable"),
    });
  });

  it("passes AbortSignal through and preserves abort errors", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      searchDiscovery({ question: "flood risk" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
      controller.signal,
    );
  });
});

describe("generateRecipe", () => {
  it("dedupes AssignedIDs and posts exact selected ids", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        recipe_id: "r1",
        question: "q",
        analytical_objective: "obj",
        status: "proposed_not_executed",
        analysis_performed: false,
        selected_datasets: [],
        relationships: [],
        workflow_steps: [],
        expected_outputs: [],
        data_gaps: [],
        assumptions: [],
        limitations: [],
        uncertainties: [],
        warnings: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateRecipe({
      question: " pedestrian safety ",
      selected_assigned_ids: ["101", "101", "102"],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/recipe/generate");
    expect(JSON.parse(String(init.body)).selected_assigned_ids).toEqual(["101", "102"]);
  });

  it("maps 404 dataset-not-found errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(404, { detail: "AssignedID 999 not found", error: "dataset_not_found" })),
    );
    await expect(
      generateRecipe({ question: "safety", selected_assigned_ids: ["999"] }),
    ).rejects.toMatchObject({ status: 404, code: "dataset_not_found" });
  });
});

describe("adapters", () => {
  it("maps recommendations onto the existing dataset card model", () => {
    const ds = recommendationToDataset(discovery.recommendations[0]);
    expect(ds.id).toBe("101");
    expect(ds.assignedId).toBe("101");
    expect(ds.AccessURL).toBe("https://example.com/crashes");
    expect(ds.relevanceScore).toBe(92);
    expect(ds.proposedRole).toBe("primary crash layer");
    expect(ds.qualityWarnings).toEqual(["Reporting lag"]);
    expect(ds.isLive).toBe(true);
  });

  it("builds nested discovery_context only for selected datasets", () => {
    expect(buildDiscoveryContext(discovery, ["102"], "Washington, DC")).toEqual({
      interpreted_intent: "Analyze pedestrian safety and traffic crashes",
      location: "Washington, DC",
      dataset_context: [
        { AssignedID: "102", relevance_reason: "Road context", proposed_role: "network context" },
      ],
    });
    expect(buildDiscoveryContext(null, ["102"])).toBeNull();
  });

  it("orders workflow steps by order in the adapter", () => {
    const recipe = {
      workflow_steps: [
        { step_id: "s2", order: 2, operation: "join", title: "Join", explanation: "b", input_dataset_ids: [], input_step_ids: [], proposed_output: "" },
        { step_id: "s1", order: 1, operation: "load", title: "Load", explanation: "a", input_dataset_ids: [], input_step_ids: [], proposed_output: "" },
      ],
    } as unknown as DataRecipeResponse;
    expect(workflowStepsToLines(recipe)).toEqual(["Load — a", "Join — b"]);
  });

  it("dedupes ids while preserving order", () => {
    expect(dedupeIds(["1", "1", " 2 ", "", "1"])).toEqual(["1", "2"]);
  });
});
