import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ASSISTANT_STORAGE_KEY,
  buildAssistantContext,
  classifyAssistantError,
  clearAssistantThread,
  loadAssistantThread,
  saveAssistantThread,
  sendAssistantMessage,
  type AssistantContextInput,
} from "./assistant";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function contextInput(overrides: Partial<AssistantContextInput> = {}): AssistantContextInput {
  return {
    question: "Find healthcare data",
    interpretedIntent: "healthcare intent",
    location: "Washington, DC",
    recommendations: [
      {
        AssignedID: "101",
        title: "Crash Data",
        description: "Crash records",
        source_portal: "Open Data DC",
        access_url: "https://example.com/crashes",
        relevance_score: 92,
        relevance_reason: "Direct crash records",
        proposed_role: "primary crash layer",
      },
    ],
    selectedIds: ["101"],
    activeFilterDescriptions: [],
    recipeSummary: null,
    ...overrides,
  };
}

const chatResult = {
  reply: "Dataset 101 covers crash records.",
  referenced_assigned_ids: ["101"],
  grounded_assigned_ids: ["101"],
  filter_action: { action: "none", filters: [], description: "" },
  needs_catalog_search: false,
  catalog_query: null,
  catalog_search: null,
  warnings: [],
};

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("buildAssistantContext", () => {
  it("builds a compact context with capped candidates", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      AssignedID: String(i),
      title: `Dataset ${i}`,
      description: "desc",
      source_portal: "portal",
      access_url: null,
      relevance_score: 80,
      relevance_reason: "reason",
      proposed_role: "role",
    }));
    const context = buildAssistantContext(contextInput({ recommendations: many }));
    expect(context.candidate_datasets).toHaveLength(20);
    expect(context.selected_assigned_ids).toEqual(["101"]);
    expect(context.location).toBe("Washington, DC");
  });

  it("carries exact total/visible counts for count questions", () => {
    const context = buildAssistantContext(
      contextInput({ totalCount: 304, visibleCount: 298 }),
    );
    expect(context.total_candidates).toBe(304);
    expect(context.visible_candidates).toBe(298);
  });

  it("defaults counts when the caller omits them", () => {
    const context = buildAssistantContext(contextInput());
    expect(context.total_candidates).toBe(1);
    expect(context.visible_candidates).toBe(1);
  });

  it("truncates long text fields", () => {
    const context = buildAssistantContext(
      contextInput({
        recommendations: [
          {
            AssignedID: "1",
            title: "t".repeat(500),
            description: "d".repeat(900),
            source_portal: "p",
            access_url: null,
            relevance_score: 80,
            relevance_reason: "r",
            proposed_role: "role",
          },
        ],
      }),
    );
    expect(context.candidate_datasets[0].title!.length).toBeLessThanOrEqual(300);
    expect(context.candidate_datasets[0].description!.length).toBeLessThanOrEqual(500);
  });
});

describe("sendAssistantMessage", () => {
  it("posts the chat payload and trims the message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, chatResult));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendAssistantMessage({
      message: "  What is dataset 101?  ",
      history: [{ role: "user", content: "hi" }],
      context: buildAssistantContext(contextInput()),
      allow_catalog_search: false,
    });
    expect(result.reply).toContain("crash records");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/assistant/chat");
    const body = JSON.parse(String(init.body));
    expect(body.message).toBe("What is dataset 101?");
    expect(body.history).toEqual([{ role: "user", content: "hi" }]);
    expect(body.allow_catalog_search).toBe(false);
    expect(body.context.selected_assigned_ids).toEqual(["101"]);
  });

  it("caps history at the most recent ten turns", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, chatResult));
    vi.stubGlobal("fetch", fetchMock);
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn ${i}`,
    }));
    await sendAssistantMessage({
      message: "latest",
      history,
      context: buildAssistantContext(contextInput()),
      allow_catalog_search: false,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).history).toHaveLength(10);
  });

  it("maps backend errors with their code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(503, { detail: "MODEL_API_KEY is not configured.", error: "model_not_configured" }),
      ),
    );
    await expect(
      sendAssistantMessage({
        message: "hi",
        history: [],
        context: buildAssistantContext(contextInput()),
        allow_catalog_search: false,
      }),
    ).rejects.toMatchObject({ name: "ApiError", status: 503, code: "model_not_configured" });
  });

  it("maps network failures to backend-unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = await sendAssistantMessage({
      message: "hi",
      history: [],
      context: buildAssistantContext(contextInput()),
      allow_catalog_search: false,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it("passes AbortSignal through", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendAssistantMessage(
        {
          message: "hi",
          history: [],
          context: buildAssistantContext(contextInput()),
          allow_catalog_search: false,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("classifyAssistantError", () => {
  it("names the missing route for a 404 with a restart instruction", () => {
    const classified = classifyAssistantError(new ApiError(404, "Not Found"));
    expect(classified.unavailable).toBe(false);
    expect(classified.message).toContain("POST /api/assistant/chat");
    expect(classified.message).toContain("Restart FastAPI");
  });

  it("treats network failure as backend unavailable", () => {
    const classified = classifyAssistantError(new ApiError(0, "fetch failed"));
    expect(classified.unavailable).toBe(true);
    expect(classified.message).toContain("Backend unavailable");
  });

  it("distinguishes MCP outages from missing model configuration", () => {
    const mcp = classifyAssistantError(
      new ApiError(503, "Metadata catalog unavailable: down", "mcp_unavailable"),
    );
    expect(mcp.unavailable).toBe(true);
    expect(mcp.message).toContain("Metadata catalog unavailable");
    const key = classifyAssistantError(
      new ApiError(503, "MODEL_API_KEY is not configured.", "model_not_configured"),
    );
    expect(key.unavailable).toBe(true);
    expect(key.message).toContain("API key");
  });

  it("labels model provider failures as upstream 502 errors", () => {
    const classified = classifyAssistantError(
      new ApiError(502, "Meta Model API request timed out", "model_error"),
    );
    expect(classified.unavailable).toBe(false);
    expect(classified.message).toContain("Upstream AI model failure (502)");
  });

  it("labels invalid requests without the unavailable banner", () => {
    const classified = classifyAssistantError(new ApiError(422, "message must not be blank"));
    expect(classified.unavailable).toBe(false);
    expect(classified.message).toContain("Invalid assistant request (422)");
  });
});

describe("assistant thread persistence", () => {
  it("round-trips messages and clears them", () => {
    const storage = memoryStorage();
    expect(loadAssistantThread(storage)).toBeNull();
    saveAssistantThread(
      [
        { id: 1, role: "user", text: "hello" },
        { id: 2, role: "assistant", text: "hi there", referencedIds: ["101"] },
      ],
      storage,
    );
    expect(storage.getItem(ASSISTANT_STORAGE_KEY)).toContain("hi there");
    // No credentials are ever written to the stored thread.
    expect(storage.getItem(ASSISTANT_STORAGE_KEY)).not.toContain("API_KEY");
    expect(loadAssistantThread(storage)).toHaveLength(2);
    clearAssistantThread(storage);
    expect(loadAssistantThread(storage)).toBeNull();
  });

  it("rejects corrupt and version-mismatched threads", () => {
    const storage = memoryStorage();
    storage.setItem(ASSISTANT_STORAGE_KEY, "not-json{{{");
    expect(loadAssistantThread(storage)).toBeNull();
    storage.setItem(
      ASSISTANT_STORAGE_KEY,
      JSON.stringify({ version: 0, savedAt: "2020-01-01", messages: [] }),
    );
    expect(loadAssistantThread(storage)).toBeNull();
  });

  it("caps stored threads at recent messages", () => {
    const storage = memoryStorage();
    saveAssistantThread(
      Array.from({ length: 80 }, (_, i) => ({ id: i + 1, role: "user" as const, text: `m${i}` })),
      storage,
    );
    expect(loadAssistantThread(storage)).toHaveLength(50);
  });
});
