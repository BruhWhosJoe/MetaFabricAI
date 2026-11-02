/**
 * Typed API layer for the MetaFabricAI FastAPI backend (Step 11).
 *
 * Uses relative `/api/...` paths so the Vite dev proxy (and any production
 * reverse proxy) forwards requests to FastAPI at http://127.0.0.1:8000.
 * No credentials are held in browser code.
 */
import type { Dataset } from "../types";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/* --- Discovery (backend/app/models/discovery.py) --- */
export interface DiscoveryRequestPayload {
  question: string;
  location?: string | null;
  max_recommendations?: number;
}
export interface DatasetRecommendation {
  AssignedID: string;
  title: string | null;
  description: string | null;
  source_portal: string | null;
  access_url: string | null;
  relevance_score: number;
  relevance_reason: string;
  proposed_role: string;
  limitations: string[];
}
export interface DiscoveryResponse {
  request_id: string;
  question: string;
  interpreted_intent: string;
  recommendations: DatasetRecommendation[];
  catalog_total: number | null;
  catalog_examined: number;
  completeness: "complete" | "partial" | "unknown";
  warnings: string[];
  /** Step 11.2 diagnostics: prefilter candidate count and per-stage timings. */
  candidate_count?: number;
  timings_ms?: Record<string, number> | null;
}

/* --- Recipe (backend/app/models/recipe.py) --- */
export interface DiscoveryDatasetContext {
  AssignedID: string;
  relevance_reason: string;
  proposed_role: string;
}
export interface DiscoveryContext {
  interpreted_intent: string;
  location: string | null;
  dataset_context: DiscoveryDatasetContext[];
}
export interface RecipeRequestPayload {
  question: string;
  selected_assigned_ids: string[];
  location?: string | null;
  discovery_context?: DiscoveryContext | null;
}
export interface RecipeDataset {
  AssignedID: string;
  title: string | null;
  description: string | null;
  summary: string | null;
  source_portal: string | null;
  access_url: string | null;
  tags: string | null;
  topic_categories: string | null;
  extent: string | null;
  role: string;
  role_explanation: string;
  relevance_reason: string;
  limitations: string[];
  metadata: Record<string, unknown>;
}
export interface DatasetRelationship {
  relationship_id: string;
  source_dataset_id: string;
  target_dataset_id: string;
  relationship_type: string;
  description: string;
  basis: "metadata_supported" | "proposed_requires_verification";
  verification_needed: string[];
}
export interface WorkflowStep {
  step_id: string;
  order: number;
  operation: string;
  title: string;
  explanation: string;
  input_dataset_ids: string[];
  input_step_ids: string[];
  proposed_output: string;
}
export interface DataRecipeResponse {
  recipe_id: string;
  question: string;
  analytical_objective: string;
  status: "proposed_not_executed";
  analysis_performed: false;
  selected_datasets: RecipeDataset[];
  relationships: DatasetRelationship[];
  workflow_steps: WorkflowStep[];
  expected_outputs: string[];
  data_gaps: string[];
  assumptions: string[];
  limitations: string[];
  uncertainties: string[];
  warnings: string[];
}

function extractDetail(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string" && d.detail) return d.detail;
    if (Array.isArray(d.detail)) {
      const msgs = d.detail
        .map((e) =>
          e && typeof e === "object" && "msg" in e
            ? String((e as Record<string, unknown>).msg)
            : String(e),
        )
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    }
    if (typeof d.error === "string" && d.error) return d.error;
  }
  return fallback;
}

function statusFallback(status: number): string {
  if (status === 422) return "Invalid request (422). Please check your question and dataset selection.";
  if (status === 404) return "Requested dataset not found (404). It may have been removed from the catalog.";
  if (status === 503) return "Metadata catalog or AI model service unavailable (503). Please try again later.";
  if (status === 502) return "Upstream AI model failure (502). Please try again.";
  return `Request failed (${status}).`;
}

async function postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "Backend unavailable. Check that FastAPI is running and try again.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const code =
      data && typeof data === "object" && typeof (data as Record<string, unknown>).error === "string"
        ? String((data as Record<string, unknown>).error)
        : undefined;
    throw new ApiError(response.status, extractDetail(data, statusFallback(response.status)), code);
  }
  return data as T;
}

/** Shared typed POST helper for sibling API modules (assistant, future). */
export function postApiJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  return postJson<T>(path, payload, signal);
}

export function searchDiscovery(
  payload: DiscoveryRequestPayload,
  signal?: AbortSignal,
): Promise<DiscoveryResponse> {
  // No default total cap: omit max_recommendations so the backend returns
  // every dataset meeting the relevance criteria, ordered by relevance.
  // Callers may still pass an explicit max_recommendations as a page size.
  const body: DiscoveryRequestPayload = {
    question: payload.question.trim(),
    location: payload.location?.trim() ? payload.location.trim() : null,
  };
  if (payload.max_recommendations != null) {
    body.max_recommendations = payload.max_recommendations;
  }
  return postJson<DiscoveryResponse>("/api/discovery/search", body, signal);
}

export function generateRecipe(
  payload: RecipeRequestPayload,
  signal?: AbortSignal,
): Promise<DataRecipeResponse> {
  // Dedupe while preserving order; backend also rejects duplicates with 422.
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of payload.selected_assigned_ids) {
    const v = String(id).trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      ids.push(v);
    }
  }
  return postJson<DataRecipeResponse>(
    "/api/recipe/generate",
    { ...payload, question: payload.question.trim(), selected_assigned_ids: ids },
    signal,
  );
}

/* --- Adapters into existing UI types (no visual redesign) --- */

/** Map a live recommendation onto the existing Dataset card model. */
export function recommendationToDataset(rec: DatasetRecommendation): Dataset {
  return {
    id: rec.AssignedID,
    title: rec.title ?? rec.AssignedID,
    source: rec.source_portal ?? "Unknown source portal",
    sourceLevel: "Federal",
    description: rec.description ?? "",
    whyRecommended: rec.relevance_reason || rec.proposed_role || "",
    AccessURL: rec.access_url ?? undefined,
    metadata: {
      issued: "Not provided",
      modified: "Not provided",
      temporalCoverage: "Not provided",
      spatialCoverage: "Not provided",
      format: "Not provided",
      license: "Not provided",
    },
    qualityWarnings: rec.limitations ?? [],
    relevanceScore: rec.relevance_score,
    proposedRole: rec.proposed_role,
    assignedId: rec.AssignedID,
    isLive: true,
  };
}

export function recipeDatasetToDataset(ds: RecipeDataset): Dataset {
  return {
    id: ds.AssignedID,
    title: ds.title ?? ds.AssignedID,
    source: ds.source_portal ?? "Unknown source portal",
    sourceLevel: "Federal",
    description: ds.description ?? ds.summary ?? "",
    whyRecommended: ds.relevance_reason || ds.role_explanation || ds.role || "",
    AccessURL: ds.access_url ?? undefined,
    metadata: {
      issued: "Not provided",
      modified: "Not provided",
      temporalCoverage: "Not provided",
      spatialCoverage: ds.extent ?? "Not provided",
      format: ds.tags ?? "Not provided",
      license: "Not provided",
    },
    qualityWarnings: ds.limitations ?? [],
    proposedRole: ds.role,
    assignedId: ds.AssignedID,
    isLive: true,
  };
}

export function buildDiscoveryContext(
  discovery: DiscoveryResponse | null,
  selectedIds: string[],
  location?: string | null,
): DiscoveryContext | null {
  if (!discovery) return null;
  const selected = new Set(selectedIds);
  return {
    interpreted_intent: discovery.interpreted_intent,
    location: location?.trim() ? location.trim() : null,
    dataset_context: discovery.recommendations
      .filter((r) => selected.has(r.AssignedID))
      .map((r) => ({
        AssignedID: r.AssignedID,
        relevance_reason: r.relevance_reason,
        proposed_role: r.proposed_role,
      })),
  };
}

/** Small adapter: backend workflow steps -> ordered display lines for the existing workflow list. */
export function workflowStepsToLines(recipe: DataRecipeResponse): string[] {
  return [...recipe.workflow_steps]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const title = s.title || s.operation;
      const detail = s.explanation || s.proposed_output;
      return detail ? `${title} — ${detail}` : title;
    });
}

export function dedupeIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((i) => String(i).trim()).filter(Boolean))];
}
