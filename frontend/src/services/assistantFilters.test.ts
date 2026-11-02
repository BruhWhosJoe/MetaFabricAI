import { describe, expect, it } from "vitest";
import type { Dataset } from "../types";
import {
  applyDatasetFilters,
  canonicalFilterField,
  describeCondition,
  matchesCondition,
  mergeConditions,
  normalizeFilterCondition,
  normalizeIds,
  normalizeTerms,
  type FilterCondition,
} from "./assistantFilters";

function ds(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "101",
    title: "DC Crash Data",
    source: "Open Data DC",
    sourceLevel: "Federal",
    description: "Crash records near hospitals",
    whyRecommended: "Direct crash records",
    AccessURL: "https://example.com/crashes",
    metadata: {
      issued: "2022-01-01",
      modified: "2024-03-01",
      temporalCoverage: "2020-2024",
      spatialCoverage: "Washington, DC",
      format: "CSV",
      license: "CC0",
    },
    qualityWarnings: [],
    relevanceScore: 92,
    proposedRole: "primary crash layer",
    assignedId: "101",
    isLive: true,
    ...overrides,
  };
}

describe("normalizeTerms", () => {
  it("lowercases and drops blanks from strings and arrays", () => {
    expect(normalizeTerms(" Hospital ")).toEqual(["hospital"]);
    expect(normalizeTerms(["Clinic", "  ", "HOSPITAL"])).toEqual(["clinic", "hospital"]);
    expect(normalizeTerms(null)).toEqual([]);
  });
});

describe("matchesCondition", () => {
  it("matches keywords across title, description, and role", () => {
    expect(matchesCondition(ds(), { field: "keyword", op: "contains", value: "hospital" })).toBe(true);
    expect(matchesCondition(ds(), { field: "keyword", op: "contains", value: ["zebra", "clinic"] })).toBe(false);
    expect(matchesCondition(ds(), { field: "keyword", op: "not_contains", value: "zebra" })).toBe(true);
    expect(matchesCondition(ds(), { field: "keyword", op: "not_contains", value: "crash" })).toBe(false);
  });

  it("compares field text case-insensitively", () => {
    expect(matchesCondition(ds(), { field: "title", op: "contains", value: "CRASH" })).toBe(true);
    expect(matchesCondition(ds(), { field: "title", op: "equals", value: "dc crash data" })).toBe(true);
    expect(matchesCondition(ds(), { field: "source", op: "not_contains", value: "federal" })).toBe(true);
  });

  it("checks AccessURL validity rather than mere presence", () => {
    const base = ds();
    expect(matchesCondition(base, { field: "has_access_url", op: "equals", value: true })).toBe(true);
    expect(
      matchesCondition(
        ds({ AccessURL: undefined }),
        { field: "has_access_url", op: "equals", value: true },
      ),
    ).toBe(false);
    expect(
      matchesCondition(
        ds({ AccessURL: "not a url" }),
        { field: "has_access_url", op: "equals", value: true },
      ),
    ).toBe(false);
    expect(
      matchesCondition(
        ds({ AccessURL: undefined }),
        { field: "has_access_url", op: "equals", value: false },
      ),
    ).toBe(true);
  });

  it("never treats a missing relevance score as a match", () => {
    const noScore = ds({ relevanceScore: undefined });
    expect(matchesCondition(ds(), { field: "relevance_score", op: "gte", value: 60 })).toBe(true);
    expect(matchesCondition(ds(), { field: "relevance_score", op: "lte", value: 60 })).toBe(false);
    expect(matchesCondition(noScore, { field: "relevance_score", op: "gte", value: 0 })).toBe(false);
    expect(matchesCondition(noScore, { field: "relevance_score", op: "lte", value: 100 })).toBe(false);
  });

  it("compares update years and skips dateless datasets", () => {
    expect(matchesCondition(ds(), { field: "updated_after", op: "gte", value: 2023 })).toBe(true);
    expect(matchesCondition(ds(), { field: "updated_after", op: "gte", value: 2025 })).toBe(false);
    const dateless = ds({
      metadata: { ...ds().metadata, issued: "Not provided", modified: "Not provided" },
    });
    expect(matchesCondition(dateless, { field: "updated_after", op: "gte", value: 2000 })).toBe(false);
  });

  it("matches explicit ID lists", () => {
    expect(matchesCondition(ds(), { field: "assigned_id", op: "any_of", value: ["101", "102"] })).toBe(true);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "any_of", value: ["102"] })).toBe(false);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "none_of", value: ["102"] })).toBe(true);
  });

  it("matches numeric and mixed ID forms without mismatches", () => {
    expect(matchesCondition(ds(), { field: "assigned_id", op: "none_of", value: [102] })).toBe(true);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "none_of", value: [101] })).toBe(false);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "any_of", value: [101] })).toBe(true);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "one_of", value: ["101"] })).toBe(true);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "one_of", value: ["102"] })).toBe(false);
    expect(matchesCondition(ds(), { field: "assigned_id", op: "none_of", value: [" 101 "] })).toBe(false);
  });
});

describe("applyDatasetFilters", () => {
  it("returns everything when no conditions are active", () => {
    expect(applyDatasetFilters([ds()], [])).toHaveLength(1);
  });

  it("combines conditions with AND", () => {
    const datasets = [ds(), ds({ id: "102", assignedId: "102", title: "Zebra Counts" })];
    const result = applyDatasetFilters(datasets, [
      { field: "keyword", op: "contains", value: ["crash", "zebra"] },
      { field: "keyword", op: "not_contains", value: "zebra" },
    ]);
    expect(result.map((d) => d.id)).toEqual(["101"]);
  });
});

describe("describeCondition and mergeConditions", () => {
  it("describes chips in human terms", () => {
    expect(describeCondition({ field: "has_access_url", op: "equals", value: true })).toBe("has AccessURL");
    expect(describeCondition({ field: "relevance_score", op: "gte", value: 60 })).toBe("relevance ≥ 60");
    expect(describeCondition({ field: "updated_after", op: "gte", value: 2023 })).toBe("updated after 2023");
  });

  it("dedupes identical conditions while preserving order", () => {
    const a = { field: "keyword", op: "contains", value: "clinic" } as const;
    const b = { field: "keyword", op: "contains", value: "hospital" } as const;
    expect(mergeConditions([a], [a, b])).toEqual([a, b]);
  });
});

describe("assigned_id normalization (Step 11.3 fix)", () => {
  it("canonicalizes AssignedID/assignedId/assigned_id aliases", () => {
    expect(canonicalFilterField("AssignedID")).toBe("assigned_id");
    expect(canonicalFilterField("assignedId")).toBe("assigned_id");
    expect(canonicalFilterField("assigned_id")).toBe("assigned_id");
    expect(canonicalFilterField("nonsense")).toBeNull();
    expect(canonicalFilterField("title")).toBe("title");
  });

  it("coerces numeric, padded, and mixed ID values to clean strings", () => {
    expect(normalizeIds([390, " 391 ", 392.0])).toEqual(["390", "391", "392"]);
    expect(normalizeIds(390)).toEqual(["390"]);
    expect(normalizeIds(["a", "a", " A "])).toEqual(["a"]);
  });

  it("drops malformed IDs instead of matching them", () => {
    expect(normalizeIds([true, "", "   ", null, 390.5, NaN])).toEqual([]);
    expect(normalizeIds([])).toEqual([]);
  });

  it("validates backend conditions and normalizes executable ones", () => {
    expect(
      normalizeFilterCondition({ field: "AssignedID", op: "none_of", value: [390, "391"] }),
    ).toEqual({ field: "assigned_id", op: "none_of", value: ["390", "391"] });
    expect(
      normalizeFilterCondition({ field: "assigned_id", op: "one_of", value: ["1"] }),
    ).toEqual({ field: "assigned_id", op: "any_of", value: ["1"] });
    expect(normalizeFilterCondition({ field: "assigned_id", op: "contains", value: ["1"] })).toBeNull();
    expect(normalizeFilterCondition({ field: "assigned_id", op: "none_of", value: [] })).toBeNull();
    expect(normalizeFilterCondition({ field: "nonsense", op: "contains", value: "x" })).toBeNull();
    expect(normalizeFilterCondition({ field: "has_access_url", op: "equals", value: "yes" })).toBeNull();
  });

  it("dedupes reordered or renumbered ID lists from repeated requests", () => {
    const first: FilterCondition = { field: "assigned_id", op: "none_of", value: ["390", "391"] };
    expect(
      mergeConditions([first], [{ field: "assigned_id", op: "none_of", value: ["391", "390"] }]),
    ).toEqual([first]);
    expect(
      mergeConditions([first], [{ field: "assigned_id", op: "none_of", value: [390, 391] }]),
    ).toEqual([first]);
    expect(
      mergeConditions(
        [first],
        // Backend-shaped payload: alias field with the keep-only alias op.
        [{ field: "AssignedID", op: "one_of", value: ["1"] } as unknown as FilterCondition],
      ),
    ).toEqual([first, { field: "assigned_id", op: "any_of", value: ["1"] }]);
  });

  it("describes ID filters with their actual counts", () => {
    expect(describeCondition({ field: "assigned_id", op: "none_of", value: [390, "391"] })).toBe("excludes 2 IDs");
    expect(describeCondition({ field: "assigned_id", op: "any_of", value: ["1"] })).toBe("keeps only 1 IDs");
  });
});
