import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function discoveryBody(question: string, interpretedIntent: string, extra = {}) {
  return {
    request_id: "req-1",
    question,
    interpreted_intent: interpretedIntent,
    recommendations: [],
    catalog_total: 10,
    catalog_examined: 10,
    completeness: "complete",
    warnings: [],
    candidate_count: 0,
    timings_ms: { total_ms: 12.3 },
    ...extra,
  };
}

const Q1 = "Find healthcare related data";
const Q2 = "Find pedestrian safety data in Washington DC";
const INTENT_A = "Interpreted intent A for healthcare";
const INTENT_B = "Interpreted intent B for pedestrian safety";

function deferred() {
  let resolve!: (v: Response) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function searchWith(question: string, location = "") {
  fireEvent.change(screen.getByLabelText("Explore Government Data"), {
    target: { value: question },
  });
  if (location) {
    fireEvent.change(screen.getByLabelText("Location (optional)"), {
      target: { value: location },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Mission Interpretation updates (Step 11.2)", () => {
  it("shows the submitted query immediately, then the returned intent", async () => {
    const gate = deferred();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => gate.promise),
    );
    render(<App />);

    searchWith(Q1, "Washington, DC");

    // Preliminary state reflects the newly submitted query/location.
    expect(await screen.findByText(/Interpreting/)).toBeTruthy();
    expect(screen.getByText(new RegExp(Q1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    expect(screen.getByText(/for Washington, DC/)).toBeTruthy();

    gate.resolve(jsonResponse(200, discoveryBody(Q1, INTENT_A)));
    expect(await screen.findByText(INTENT_A)).toBeTruthy();
    expect(screen.queryByText(/Interpreting/)).toBeNull();
  });

  it("ignores a stale response that resolves after a newer search", async () => {
    const gateA = deferred();
    const gateB = deferred();
    const fetchMock = vi.fn(async () => gateA.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    searchWith(Q1);
    expect(await screen.findByText(/Interpreting/)).toBeTruthy();

    // Cancel the first search, then run a newer one.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/No live interpretation for the current search yet/)).toBeTruthy();

    fetchMock.mockImplementation(async () => gateB.promise);
    searchWith(Q2);
    expect(await screen.findByText(/Interpreting/)).toBeTruthy();

    gateB.resolve(jsonResponse(200, discoveryBody(Q2, INTENT_B)));
    expect(await screen.findByText(INTENT_B)).toBeTruthy();

    // The stale first response must not overwrite the newer search.
    gateA.resolve(jsonResponse(200, discoveryBody(Q1, INTENT_A)));
    await gateA.promise;
    await gateB.promise;
    expect(screen.queryByText(INTENT_A)).toBeNull();
    expect(screen.getByText(INTENT_B)).toBeTruthy();
  });

  it("shows a failure state without a stale interpretation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          jsonResponse(503, {
            detail: "Metadata catalog unavailable: down",
            error: "mcp_unavailable",
          }),
      ),
    );
    render(<App />);

    searchWith(Q1);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText(/no interpretation available/i),
    ).toBeTruthy();
    // The demo mission chips are not presented as the current interpretation.
    expect(screen.queryByText(/Demo interpretation for/)).toBeNull();
  });

  it("shows the interpreted intent even when no datasets match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, discoveryBody(Q1, INTENT_A))),
    );
    render(<App />);

    searchWith(Q1);
    expect(await screen.findByText(INTENT_A)).toBeTruthy();
    expect(
      screen.getByText(/No datasets found for this question/),
    ).toBeTruthy();
  });

  it("renders a clear missing-URL state without fabricating a link", async () => {
    const body = discoveryBody(Q1, INTENT_A, {
      recommendations: [
        {
          AssignedID: "101",
          title: "Community Health Survey",
          description: "Health survey records",
          source_portal: "healthdata.gov",
          access_url: null,
          relevance_score: 90,
          relevance_reason: "Direct health match",
          proposed_role: "primary health layer",
          limitations: ["No access URL in metadata."],
        },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, body)));
    render(<App />);

    searchWith(Q1);
    expect(await screen.findByText("Community Health Survey")).toBeTruthy();
    expect(screen.getByText(/Missing URL/)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /Open Dataset/ }),
    ).toBeNull();
  });
});
