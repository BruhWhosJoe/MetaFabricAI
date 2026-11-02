/**
 * Deterministic conversational-filter evaluation (Step 11.3).
 *
 * The AI Assistant translates natural-language refinement requests into
 * FilterCondition entries; this module applies them to dataset cards in
 * plain application code -- no per-dataset LLM calls, no extra MCP
 * queries. One model call already happened in the chat endpoint to produce
 * the conditions (including synonym expansion for `keyword` filters); here
 * every condition is a pure predicate and all conditions combine with AND.
 *
 * Missing-value rule: a condition that requires a field never matches a
 * dataset missing that field (e.g. a relevance filter skips cards without
 * a relevance score instead of keeping them).
 */

import type { Dataset } from "../types";
import { isValidHttpUrl } from "./url";

export type FilterField =
  | "keyword"
  | "title"
  | "description"
  | "source"
  | "proposed_role"
  | "location"
  | "has_access_url"
  | "has_geo"
  | "relevance_score"
  | "updated_after"
  | "assigned_id";

export type FilterOp =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "gte"
  | "lte"
  | "any_of"
  | "one_of"
  | "none_of";

export interface FilterCondition {
  field: FilterField;
  op: FilterOp;
  value: string | number | boolean | Array<string | number> | null;
}

export type FilterActionType = "apply" | "clear" | "undo" | "none" | "unsupported";

export interface FilterAction {
  action: FilterActionType;
  filters: FilterCondition[];
  description: string;
  unsupported_reason?: string | null;
}

/** Placeholder metadata text the live adapter emits when a field is unknown. */
const UNKNOWN_MARKERS = new Set(["not provided", "— not provided in source metadata —", ""]);

function cleanText(value: string | undefined): string {
  return (value ?? "").trim();
}

function isKnown(value: string | undefined): boolean {
  return !UNKNOWN_MARKERS.has(cleanText(value).toLowerCase());
}

/** Lowercase search terms from a string or string-array value. */
export function normalizeTerms(value: FilterCondition["value"]): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Coerce an assigned_id value to a clean, deduped ID list (Step 11.3 fix).
 *
 * Accepts a single ID or an array mixing numeric and string forms
 * (`390`, `" 390 "` both mean `"390"`). Booleans, blanks,
 * non-integral floats, and other malformed entries are dropped rather
 * than matched, so a numeric backend payload can never silently wipe or
 * pass every card. An empty result means the value carries no usable ID.
 */
export function normalizeIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const v of raw) {
    let text: string | null = null;
    if (typeof v === "number") {
      if (!Number.isFinite(v) || !Number.isInteger(v)) continue;
      text = String(v);
    } else if (typeof v === "string") {
      text = v.trim();
    } else {
      continue;
    }
    if (!text) continue;
    const key = text.toLowerCase();
    if (!out.some((e) => e.toLowerCase() === key)) out.push(text);
  }
  return out;
}

/** Map AssignedID/assignedId/assigned_id variants to one canonical field. */
export function canonicalFilterField(raw: unknown): FilterField | null {
  if (typeof raw !== "string") return null;
  if (raw.replace(/[\s_]+/g, "").toLowerCase() === "assignedid") {
    return "assigned_id";
  }
  switch (raw) {
    case "keyword":
    case "title":
    case "description":
    case "source":
    case "proposed_role":
    case "location":
    case "has_access_url":
    case "has_geo":
    case "relevance_score":
    case "updated_after":
    case "assigned_id":
      return raw;
    default:
      return null;
  }
}

/** Ops the deterministic frontend engine actually implements, per field. */
const SUPPORTED_OPS: Record<FilterField, readonly FilterOp[]> = {
  keyword: ["contains", "not_contains"],
  title: ["contains", "not_contains", "equals", "not_equals"],
  description: ["contains", "not_contains", "equals", "not_equals"],
  source: ["contains", "not_contains", "equals", "not_equals"],
  proposed_role: ["contains", "not_contains", "equals", "not_equals"],
  location: ["contains", "not_contains", "equals", "not_equals"],
  has_access_url: ["equals"],
  has_geo: ["equals"],
  relevance_score: ["gte", "lte"],
  updated_after: ["gte"],
  // one_of is the task vocabulary for "keep only these IDs"; it executes
  // exactly like any_of and is canonicalized there during validation.
  assigned_id: ["any_of", "one_of", "none_of"],
};

function isSupportedOp(field: FilterField, op: unknown): op is FilterOp {
  return typeof op === "string" && (SUPPORTED_OPS[field] as readonly string[]).includes(op);
}

/**
 * Validate and normalize a raw backend filter condition.
 *
 * Returns the canonical condition the engine can execute, or null when
 * the field/op is unsupported or the value carries no usable content.
 * The caller must treat null as a rejected filter (leave results
 * untouched and explain), never as a no-op success.
 */
export function normalizeFilterCondition(raw: {
  field: unknown;
  op: unknown;
  value: unknown;
}): FilterCondition | null {
  const field = canonicalFilterField(raw.field);
  if (field === null || !isSupportedOp(field, raw.op)) return null;
  const op = raw.op;
  const value = raw.value as FilterCondition["value"];
  if (field === "assigned_id") {
    const ids = normalizeIds(value);
    if (ids.length === 0) return null;
    // Canonicalize the keep-only alias so dedupe and chips see one form.
    return { field, op: op === "one_of" ? "any_of" : op, value: ids };
  }
  if (
    field === "keyword" ||
    field === "title" ||
    field === "description" ||
    field === "source" ||
    field === "proposed_role" ||
    field === "location"
  ) {
    if (normalizeTerms(value).length === 0) return null;
    return { field, op, value: value as FilterCondition["value"] };
  }
  if (field === "has_access_url" || field === "has_geo") {
    if (op !== "equals" || typeof value !== "boolean") return null;
    return { field, op, value };
  }
  if (field === "relevance_score") {
    if ((op !== "gte" && op !== "lte") || typeof value === "boolean") return null;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) return null;
    return { field, op, value: value as FilterCondition["value"] };
  }
  // updated_after: a four-digit year the dataset was updated after.
  if (op !== "gte") return null;
  const year = Number.parseInt(String(value), 10);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  return { field, op, value: value as FilterCondition["value"] };
}

function keywordHaystack(dataset: Dataset): string {
  return [
    dataset.title,
    dataset.description,
    dataset.source,
    dataset.whyRecommended,
    dataset.proposedRole,
    dataset.assignedId,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
}

function fieldText(dataset: Dataset, field: FilterCondition["field"]): string | null {
  switch (field) {
    case "title":
      return dataset.title.toLowerCase();
    case "description":
      return `${dataset.description} ${dataset.whyRecommended}`.toLowerCase();
    case "source":
      return dataset.source.toLowerCase();
    case "proposed_role":
      return (dataset.proposedRole ?? "").toLowerCase();
    case "location":
      // Textual coverage match over the fields recommendations carry.
      // Coordinate-level coverage is resolved server-side into ID lists.
      return [
        dataset.metadata.spatialCoverage,
        dataset.description,
        dataset.source,
        dataset.title,
      ]
        .filter((v): v is string => typeof v === "string")
        .join(" ")
        .toLowerCase();
    default:
      return null;
  }
}

function matchText(text: string, op: FilterOp, terms: string[]): boolean {
  switch (op) {
    case "contains":
      return terms.some((t) => text.includes(t));
    case "not_contains":
      return terms.every((t) => !text.includes(t));
    case "equals":
      return terms.some((t) => text.trim() === t);
    case "not_equals":
      return terms.every((t) => text.trim() !== t);
    default:
      return true;
  }
}

function datasetYear(dataset: Dataset): number | null {
  for (const raw of [dataset.metadata.modified, dataset.metadata.issued]) {
    if (!isKnown(raw)) continue;
    const match = String(raw).match(/\b(19|20)\d{2}\b/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return null;
}

function datasetId(dataset: Dataset): string {
  return (dataset.assignedId ?? dataset.id).trim();
}

/** Evaluate one condition against one dataset card. */
export function matchesCondition(dataset: Dataset, condition: FilterCondition): boolean {
  const { field, op, value } = condition;
  switch (field) {
    case "keyword": {
      return matchText(keywordHaystack(dataset), op, normalizeTerms(value));
    }
    case "title":
    case "description":
    case "source":
    case "proposed_role":
    case "location": {
      const text = fieldText(dataset, field);
      if (text === null) return true;
      return matchText(text, op, normalizeTerms(value));
    }
    case "has_access_url": {
      if (op !== "equals" || typeof value !== "boolean") return true;
      return isValidHttpUrl(dataset.AccessURL) === value;
    }
    case "has_geo": {
      if (op !== "equals" || typeof value !== "boolean") return true;
      const spatial = dataset.metadata.spatialCoverage;
      const hasGeo = isKnown(spatial);
      return hasGeo === value;
    }
    case "relevance_score": {
      if (typeof dataset.relevanceScore !== "number") return false;
      if (typeof value !== "number") return true;
      if (op === "gte") return dataset.relevanceScore >= value;
      if (op === "lte") return dataset.relevanceScore <= value;
      return true;
    }
    case "updated_after": {
      const year = datasetYear(dataset);
      if (year === null) return false;
      const minYear = typeof value === "number" ? value : Number.parseInt(String(value), 10);
      if (!Number.isFinite(minYear)) return true;
      return year >= minYear;
    }
    case "assigned_id": {
      const ids = normalizeIds(value).map((v) => v.toLowerCase());
      const id = datasetId(dataset).toLowerCase();
      if (op === "any_of" || op === "one_of") return ids.includes(id);
      if (op === "none_of") return !ids.includes(id);
      return true;
    }
    default:
      // Unknown future fields are no-ops rather than result-wiping.
      return true;
  }
}

/** Apply every condition (AND) and return the matching datasets. */
export function applyDatasetFilters(datasets: Dataset[], conditions: FilterCondition[]): Dataset[] {
  if (conditions.length === 0) return datasets;
  return datasets.filter((d) => conditions.every((c) => matchesCondition(d, c)));
}

function formatTerms(value: FilterCondition["value"]): string {
  const terms = normalizeTerms(value);
  if (terms.length === 0) return String(value ?? "");
  return terms.map((t) => `"${t}"`).join(", ");
}

/** One-line human description of a condition for filter chips. */
export function describeCondition(condition: FilterCondition): string {
  const { field, op, value } = condition;
  switch (field) {
    case "keyword":
      return op === "not_contains"
        ? `excludes ${formatTerms(value)}`
        : `matches ${formatTerms(value)}`;
    case "location":
      return op === "not_contains"
        ? `outside ${formatTerms(value)}`
        : `covers ${formatTerms(value)}`;
    case "has_access_url":
      return value === false ? "missing AccessURL" : "has AccessURL";
    case "has_geo":
      return value === false ? "no coordinates" : "has coordinates";
    case "relevance_score":
      return op === "lte" ? `relevance ≤ ${String(value)}` : `relevance ≥ ${String(value)}`;
    case "updated_after":
      return `updated after ${String(value)}`;
    case "assigned_id": {
      const count = normalizeIds(value).length;
      return op === "none_of" ? `excludes ${count} IDs` : `keeps only ${count} IDs`;
    }
    default:
      return `${field} ${op} ${formatTerms(value)}`;
  }
}

export function describeConditions(conditions: FilterCondition[]): string[] {
  return conditions.map(describeCondition);
}

/**
 * Order- and alias-insensitive dedupe key: identical requests repeated
 * with reordered ID lists or numeric-vs-string IDs map to one entry, so
 * retries and restated requests never stack duplicate filters.
 */
function conditionKey(condition: FilterCondition): string {
  const normalized = normalizeFilterCondition(condition);
  const source = normalized ?? {
    field: canonicalFilterField(condition.field) ?? condition.field,
    op: condition.op,
    value: condition.value,
  };
  let keyValue: unknown = source.value;
  if (source.field === "assigned_id") {
    keyValue = normalizeIds(source.value).map((v) => v.toLowerCase()).sort();
  } else if (Array.isArray(source.value)) {
    keyValue = (source.value as Array<string | number>)
      .map((v) => String(v).trim().toLowerCase())
      .sort();
  } else if (typeof source.value === "string") {
    keyValue = source.value.trim().toLowerCase();
  }
  return JSON.stringify([source.field, source.op, keyValue]);
}

/** Canonicalize field aliases, the one_of alias, and ID values. */
function canonicalValue(condition: FilterCondition): FilterCondition {
  const field = canonicalFilterField(condition.field) ?? condition.field;
  const op = field === "assigned_id" && condition.op === "one_of" ? "any_of" : condition.op;
  if (field !== "assigned_id") {
    return field === condition.field && op === condition.op
      ? condition
      : { ...condition, field, op };
  }
  const ids = normalizeIds(condition.value);
  return ids.length > 0 ? { ...condition, field, op, value: ids } : { ...condition, field, op };
}

/** Append conditions without duplicating identical entries. */
export function mergeConditions(
  current: FilterCondition[],
  added: FilterCondition[],
): FilterCondition[] {
  const seen = new Set(current.map(conditionKey));
  const next = [...current];
  for (const condition of added) {
    const key = conditionKey(condition);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(canonicalValue(condition));
    }
  }
  return next;
}
