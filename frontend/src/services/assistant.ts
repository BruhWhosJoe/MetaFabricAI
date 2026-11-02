/**
 * AI Assistant chat client and conversation persistence (Step 11.3).
 *
 * The panel sends the user's message plus a compact workspace context to
 * POST /api/assistant/chat and receives a structured reply (grounded text,
 * referenced AssignedIDs, an optional filter action, and an optional
 * broader-catalog suggestion). No credentials exist in browser code; the
 * request carries catalog metadata only.
 *
 * Conversation history survives tab changes (React state in App.tsx) and
 * browser reloads (localStorage thread below, capped to recent turns).
 */

import { ApiError, postApiJson, type DiscoveryResponse } from "./api";
import type { FilterAction } from "./assistantFilters";

export { ApiError };

export interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  referencedIds?: string[];
  filterAction?: FilterAction | null;
  filterNotice?: string | null;
  needsCatalogSearch?: boolean;
  catalogQuery?: string | null;
  catalogResultCount?: number | null;
}

export interface AssistantCandidateSnippet {
  AssignedID: string;
  title: string | null;
  description: string | null;
  source_portal: string | null;
  access_url: string | null;
  relevance_score: number | null;
  relevance_reason: string | null;
  proposed_role: string | null;
}

export interface AssistantContextPayload {
  question: string;
  interpreted_intent: string;
  location: string | null;
  candidate_datasets: AssistantCandidateSnippet[];
  selected_assigned_ids: string[];
  active_filter_descriptions: string[];
  recipe_summary: string | null;
  /** Full recommendation count (candidate_datasets is capped for the prompt). */
  total_candidates: number;
  /** Currently visible count after conversational filters. */
  visible_candidates: number;
}

export interface AssistantChatPayload {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  context: AssistantContextPayload;
  allow_catalog_search: boolean;
  max_context_datasets?: number;
}

export interface AssistantChatResult {
  reply: string;
  referenced_assigned_ids: string[];
  grounded_assigned_ids: string[];
  filter_action: FilterAction;
  needs_catalog_search: boolean;
  catalog_query: string | null;
  catalog_search: DiscoveryResponse | null;
  warnings: string[];
}

export interface AssistantContextInput {
  question: string;
  interpretedIntent: string;
  location: string | null;
  recommendations: {
    AssignedID: string;
    title: string | null;
    description: string | null;
    source_portal: string | null;
    access_url: string | null;
    relevance_score: number;
    relevance_reason: string;
    proposed_role: string;
  }[];
  selectedIds: string[];
  activeFilterDescriptions: string[];
  recipeSummary: string | null;
  maxDatasets?: number;
  /** Full recommendation count; defaults to recommendations.length. */
  totalCount?: number;
  /** Visible count after filters; defaults to the capped candidate length. */
  visibleCount?: number;
}

function truncate(value: string | null, limit: number): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

/** Build the compact context shipped with every chat message. */
export function buildAssistantContext(input: AssistantContextInput): AssistantContextPayload {
  const max = input.maxDatasets ?? 20;
  const candidates = input.recommendations.slice(0, max);
  return {
    question: input.question,
    interpreted_intent: input.interpretedIntent,
    location: input.location,
    total_candidates: input.totalCount ?? input.recommendations.length,
    visible_candidates: input.visibleCount ?? candidates.length,
    candidate_datasets: candidates.map((r) => ({
      AssignedID: r.AssignedID,
      title: truncate(r.title, 300),
      description: truncate(r.description, 500),
      source_portal: truncate(r.source_portal, 200),
      access_url: truncate(r.access_url, 500),
      relevance_score: r.relevance_score,
      relevance_reason: truncate(r.relevance_reason, 300),
      proposed_role: truncate(r.proposed_role, 200),
    })),
    selected_assigned_ids: [...input.selectedIds],
    active_filter_descriptions: [...input.activeFilterDescriptions],
    recipe_summary: input.recipeSummary,
  };
}

/** POST one chat message; throws ApiError (or AbortError on cancellation). */
export function sendAssistantMessage(
  payload: AssistantChatPayload,
  signal?: AbortSignal,
): Promise<AssistantChatResult> {
  const history = payload.history.slice(-10).map((m) => ({
    role: m.role,
    content: m.content.trim().slice(0, 4000),
  }));
  return postApiJson<AssistantChatResult>(
    "/api/assistant/chat",
    {
      message: payload.message.trim(),
      history,
      context: payload.context,
      allow_catalog_search: payload.allow_catalog_search,
      max_context_datasets: payload.max_context_datasets ?? 20,
    },
    signal,
  );
}

/* --- Assistant error taxonomy (Step 11.3 Task 3) ---
 *
 * A bare FastAPI 404 body is exactly {"detail": "Not Found"}: it means the
 * running backend has no POST /api/assistant/chat route (stale server that
 * predates Step 11.3), not a missing dataset or a model failure. Surfacing
 * it verbatim ("Assistant error: Not Found") hides that cause, so each
 * failure maps to the layer that produced it.
 */

export interface ClassifiedAssistantError {
  message: string;
  /** True when the backend/service is down (banner + input disabled). */
  unavailable: boolean;
}

const ASSISTANT_ROUTE = "POST /api/assistant/chat";

/** Map any sendAssistantMessage failure to a layer-specific message. */
export function classifyAssistantError(error: unknown): ClassifiedAssistantError {
  if (error instanceof ApiError) {
    // No HTTP response at all: FastAPI unreachable (down, wrong port, or
    // the Vite proxy target is not serving).
    if (error.status === 0) {
      return {
        message: "Backend unavailable. Check that FastAPI is running and try again.",
        unavailable: true,
      };
    }
    // FastAPI default for an unregistered route. Discovery still works
    // because /api/discovery/search exists in older backends too.
    if (error.status === 404) {
      return {
        message:
          `The running backend does not serve ${ASSISTANT_ROUTE} (404). ` +
          "Restart FastAPI with the latest Step 11.3 code so the assistant route is registered, then Retry.",
        unavailable: false,
      };
    }
    if (error.status === 503 && error.code === "mcp_unavailable") {
      return { message: `Metadata catalog unavailable (503). ${error.message}`, unavailable: true };
    }
    if (error.status === 503 && error.code === "model_not_configured") {
      return {
        message: "The AI model API key is not configured on the backend (503). Set it and Retry.",
        unavailable: true,
      };
    }
    if (error.status === 503) {
      return { message: error.message, unavailable: true };
    }
    // Model provider failure or an assistant draft that failed validation.
    if (error.status === 502) {
      return {
        message: `Upstream AI model failure (502). ${error.message}`,
        unavailable: false,
      };
    }
    if (error.status === 422) {
      return {
        message: `Invalid assistant request (422). ${error.message}`,
        unavailable: false,
      };
    }
    return { message: error.message, unavailable: false };
  }
  if (error instanceof Error && error.message) return { message: error.message, unavailable: false };
  return { message: "Assistant message failed. Please try again.", unavailable: false };
}

/* --- Conversation persistence (localStorage, metadata only) --- */

export const ASSISTANT_STORAGE_KEY = "metafabricai.assistant.v1";
const ASSISTANT_STORAGE_VERSION = 1;
const MAX_STORED_MESSAGES = 50;

interface StoredAssistantThread {
  version: number;
  savedAt: string;
  messages: AssistantMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStoredMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (typeof value.text !== "string" || typeof value.id !== "number") return false;
  return true;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

/** Load the saved thread; null when absent, corrupt, or version-mismatched. */
export function loadAssistantThread(storage?: Storage | null): AssistantMessage[] | null {
  const target = storage === undefined ? getStorage() : storage;
  if (!target) return null;
  let raw: string | null;
  try {
    raw = target.getItem(ASSISTANT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== ASSISTANT_STORAGE_VERSION) return null;
  if (!Array.isArray(parsed.messages)) return null;
  const messages = parsed.messages.filter(isValidStoredMessage);
  if (messages.length === 0) return null;
  return messages.slice(-MAX_STORED_MESSAGES);
}

export function saveAssistantThread(
  messages: AssistantMessage[],
  storage?: Storage | null,
): void {
  const target = storage === undefined ? getStorage() : storage;
  if (!target) return;
  const thread: StoredAssistantThread = {
    version: ASSISTANT_STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  };
  try {
    target.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(thread));
  } catch {
    // Persistence is best-effort; the live conversation stays in memory.
  }
}

export function clearAssistantThread(storage?: Storage | null): void {
  const target = storage === undefined ? getStorage() : storage;
  if (!target) return;
  try {
    target.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    // Best-effort only.
  }
}
