/**
 * Versioned persistence for the MetaFabricAI research workspace (Step 11.2).
 *
 * The workspace keeps everything in React state, so a full page reload
 * (manual refresh, browser tab discard/suspension, dev-server restart, or a
 * fresh React remount) re-initialized the app to the Step 7 mock datasets and
 * dropped the user's live search. This module snapshots the stable workspace
 * to localStorage and restores it on startup.
 *
 * Design:
 * - One versioned JSON snapshot under WORKSPACE_STORAGE_KEY in localStorage.
 * - Only stable data is persisted: submitted question, location, live
 *   recommendations + interpretation, selected AssignedIDs, generated recipe,
 *   active tab/nav, and search metadata. Loading flags, pending searches, and
 *   transient errors are never written.
 * - Never stores secrets: the snapshot holds catalog metadata only. No API
 *   keys, credentials, or tokens exist in browser code (see services/api.ts).
 * - Large result sets: if the snapshot exceeds the localStorage quota, a slim
 *   snapshot stays in localStorage and the full recommendations overflow to
 *   IndexedDB. Restore merges the overflow back asynchronously.
 */

import type { AppTab, SidebarNav, SourceLevel } from "../types";
import type { DataRecipeResponse, DiscoveryResponse } from "./api";
import type { FilterCondition } from "./assistantFilters";

/** Current schema version. Bump when the snapshot shape changes. */
export const WORKSPACE_STATE_VERSION = 1;

/** localStorage key for the workspace snapshot. */
export const WORKSPACE_STORAGE_KEY = "metafabricai.workspace.v1";

const IDB_DB_NAME = "metafabricai";
const IDB_STORE_NAME = "workspace";
const IDB_OVERFLOW_KEY = "discovery-overflow-v1";

const SOURCE_LEVELS: readonly SourceLevel[] = ["Federal", "State", "Local"];
const APP_TABS: readonly AppTab[] = ["dashboard", "recipe"];
const SIDEBAR_NAVS: readonly SidebarNav[] = ["dashboard", "datasets", "saved"];
const COMPLETENESS: readonly string[] = ["complete", "partial", "unknown"];

/** Small search metadata derived from a discovery response. */
export interface WorkspaceSearchMeta {
  resultCount: number;
  catalogExamined: number;
  catalogTotal: number | null;
  completeness: "complete" | "partial" | "unknown";
}

/** Fields the app hands to the persistence layer (version/savedAt added). */
export interface WorkspaceSnapshotInput {
  query: string;
  location: string;
  missionId: string;
  sourceLevels: SourceLevel[];
  discovery: DiscoveryResponse | null;
  selectedIds: string[];
  recipe: DataRecipeResponse | null;
  recipeAttempted: boolean;
  activeTab: AppTab;
  activeNav: SidebarNav;
  hasSearched: boolean;
  visibleCount: number;
  searchMeta: WorkspaceSearchMeta | null;
  /**
   * Step 11.3: active conversational filter conditions. Optional so
   * Step 11.2 snapshots (without this key) still validate; absent means
   * no filters. The original discovery results are always preserved in
   * `discovery`, so filtering stays reversible after a reload.
   */
  assistantFilters?: FilterCondition[];
}

/** Versioned snapshot as stored. */
export interface PersistedWorkspaceState extends WorkspaceSnapshotInput {
  version: typeof WORKSPACE_STATE_VERSION;
  savedAt: string;
  /**
   * True when the recommendations list lives in the IndexedDB overflow
   * because the full snapshot exceeded the localStorage quota. The stored
   * discovery then carries an empty recommendations array plus searchMeta.
   */
  recommendationsOverflow: boolean;
}

export type WorkspaceLoadStatus = "empty" | "ok" | "corrupt" | "version-mismatch";

export interface WorkspaceLoadResult {
  status: WorkspaceLoadStatus;
  /** Present only when status is "ok". */
  state?: PersistedWorkspaceState;
}

export type WorkspaceWriteResult =
  | { ok: true; overflow: boolean }
  | { ok: false; reason: "unavailable" | "quota" | "serialize" };

/** Non-blocking notice shown when the workspace cannot be saved for later. */
export const WORKSPACE_STORAGE_WARNING =
  "Workspace storage is full — your work stays in this tab but may not survive a reload.";

/** Minimal storage surface so tests can inject fakes. localStorage satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Async overflow backend (IndexedDB in production, in-memory fakes in tests). */
export interface OverflowBackend {
  save(snapshot: PersistedWorkspaceState): Promise<void>;
  load(): Promise<PersistedWorkspaceState | null>;
  clear(): Promise<void>;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isValidDiscovery(value: unknown): value is DiscoveryResponse {
  if (!isRecord(value)) return false;
  if (typeof value.question !== "string") return false;
  if (typeof value.interpreted_intent !== "string") return false;
  if (typeof value.request_id !== "string") return false;
  if (!Array.isArray(value.recommendations)) return false;
  if (typeof value.catalog_examined !== "number") return false;
  if (value.catalog_total !== null && typeof value.catalog_total !== "number") return false;
  if (typeof value.completeness !== "string" || !COMPLETENESS.includes(value.completeness)) return false;
  if (!Array.isArray(value.warnings)) return false;
  return value.recommendations.every((rec) => {
    if (!isRecord(rec)) return false;
    return (
      typeof rec.AssignedID === "string" &&
      typeof rec.relevance_score === "number" &&
      typeof rec.relevance_reason === "string" &&
      typeof rec.proposed_role === "string" &&
      Array.isArray(rec.limitations)
    );
  });
}

function isValidRecipe(value: unknown): value is DataRecipeResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.recipe_id === "string" &&
    typeof value.question === "string" &&
    typeof value.analytical_objective === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.selected_datasets) &&
    Array.isArray(value.relationships) &&
    Array.isArray(value.workflow_steps) &&
    Array.isArray(value.expected_outputs) &&
    Array.isArray(value.data_gaps) &&
    Array.isArray(value.assumptions) &&
    Array.isArray(value.limitations) &&
    Array.isArray(value.uncertainties) &&
    Array.isArray(value.warnings)
  );
}

function isValidSearchMeta(value: unknown): value is WorkspaceSearchMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.resultCount === "number" &&
    typeof value.catalogExamined === "number" &&
    (value.catalogTotal === null || typeof value.catalogTotal === "number") &&
    typeof value.completeness === "string" &&
    COMPLETENESS.includes(value.completeness)
  );
}

function isValidFilterCondition(value: unknown): value is FilterCondition {
  if (!isRecord(value)) return false;
  if (typeof value.field !== "string" || typeof value.op !== "string") return false;
  const v = value.value;
  if (v !== null && v !== undefined && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
    // AssignedID lists may mix numeric and string forms (backend
    // normalization); the filter engine coerces both to clean strings.
    if (!Array.isArray(v) || !v.every((item) => typeof item === "string" || typeof item === "number")) return false;
  }
  return true;
}

/** Strict shape check: unknown/garbage snapshots are rejected, never applied. */
export function isValidWorkspaceSnapshot(value: unknown): value is PersistedWorkspaceState {
  if (!isRecord(value)) return false;
  if (value.version !== WORKSPACE_STATE_VERSION) return false;
  if (typeof value.savedAt !== "string") return false;
  if (typeof value.query !== "string") return false;
  if (typeof value.location !== "string") return false;
  if (typeof value.missionId !== "string") return false;
  if (
    !Array.isArray(value.sourceLevels) ||
    !value.sourceLevels.every((l) => typeof l === "string" && (SOURCE_LEVELS as readonly string[]).includes(l))
  ) {
    return false;
  }
  if (value.discovery !== null && !isValidDiscovery(value.discovery)) return false;
  if (!isStringArray(value.selectedIds)) return false;
  if (value.recipe !== null && !isValidRecipe(value.recipe)) return false;
  if (typeof value.recipeAttempted !== "boolean") return false;
  if (typeof value.activeTab !== "string" || !(APP_TABS as readonly string[]).includes(value.activeTab)) {
    return false;
  }
  if (typeof value.activeNav !== "string" || !(SIDEBAR_NAVS as readonly string[]).includes(value.activeNav)) {
    return false;
  }
  if (typeof value.hasSearched !== "boolean") return false;
  if (typeof value.visibleCount !== "number" || !Number.isInteger(value.visibleCount) || value.visibleCount < 1) {
    return false;
  }
  if (value.searchMeta !== null && !isValidSearchMeta(value.searchMeta)) return false;
  if (typeof value.recommendationsOverflow !== "boolean") return false;
  if (
    value.assistantFilters !== undefined &&
    (!Array.isArray(value.assistantFilters) ||
      !value.assistantFilters.every(isValidFilterCondition))
  ) {
    return false;
  }
  return true;
}

/** Derive small search metadata from a discovery response. */
export function buildSearchMeta(discovery: DiscoveryResponse | null): WorkspaceSearchMeta | null {
  if (!discovery) return null;
  const completeness = COMPLETENESS.includes(discovery.completeness)
    ? discovery.completeness
    : "unknown";
  return {
    resultCount: discovery.recommendations.length,
    catalogExamined: discovery.catalog_examined,
    catalogTotal: discovery.catalog_total,
    completeness,
  };
}

export interface ReadWorkspaceOptions {
  storage?: StorageLike | null;
}

/** Synchronously read the snapshot. Never throws: problems are reported by status. */
export function readWorkspace(options: ReadWorkspaceOptions = {}): WorkspaceLoadResult {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  if (!storage) return { status: "empty" };
  let raw: string | null;
  try {
    raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Storage inaccessible (e.g. blocked cookies): start fresh, don't crash.
    return { status: "empty" };
  }
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt" };
  }
  if (isRecord(parsed) && parsed.version !== WORKSPACE_STATE_VERSION) {
    return { status: "version-mismatch" };
  }
  if (!isValidWorkspaceSnapshot(parsed)) return { status: "corrupt" };
  return { status: "ok", state: parsed };
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  if (e.code === 22 || e.code === 1014) return true;
  return typeof e.message === "string" && /quota exceeded/i.test(e.message);
}

/** Slim snapshot kept in localStorage when the full one exceeds quota. */
function toSlimSnapshot(snapshot: PersistedWorkspaceState): PersistedWorkspaceState {
  return {
    ...snapshot,
    discovery: snapshot.discovery
      ? { ...snapshot.discovery, recommendations: [] }
      : null,
    recommendationsOverflow: true,
  };
}

/** Tracks whether a previous write overflowed, so full writes can clean up. */
let overflowInUse = false;

export function __resetOverflowFlagForTests(): void {
  overflowInUse = false;
}

export interface WriteWorkspaceOptions {
  storage?: StorageLike | null;
  overflow?: OverflowBackend | null;
}

/**
 * Persist the workspace. Never throws (failures are reported in the result).
 * On localStorage quota failure the slim snapshot is kept in localStorage
 * and the full snapshot goes to the overflow backend (IndexedDB), so large
 * result sets still survive a reload.
 *
 * Async because the IndexedDB overflow path is async. The localStorage write
 * itself happens synchronously before any await, so rapid successive writes
 * keep their order on the common path.
 */
export async function writeWorkspace(
  input: WorkspaceSnapshotInput,
  options: WriteWorkspaceOptions = {},
): Promise<WorkspaceWriteResult> {
  const storage = options.storage === undefined ? getDefaultStorage() : options.storage;
  const overflow = options.overflow === undefined ? getOverflowBackend() : options.overflow;
  if (!storage) return { ok: false, reason: "unavailable" };

  const full: PersistedWorkspaceState = {
    ...input,
    version: WORKSPACE_STATE_VERSION,
    savedAt: new Date().toISOString(),
    recommendationsOverflow: false,
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(full);
  } catch {
    return { ok: false, reason: "serialize" };
  }

  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, serialized);
  } catch (error) {
    if (!isQuotaError(error) || !overflow) return { ok: false, reason: "quota" };
    // Quota path: keep the slim snapshot locally, overflow the full one.
    const slim: PersistedWorkspaceState = {
      ...toSlimSnapshot(full),
      savedAt: full.savedAt,
    };
    try {
      storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(slim));
    } catch {
      return { ok: false, reason: "quota" };
    }
    try {
      await overflow.save(full);
    } catch {
      return { ok: false, reason: "quota" };
    }
    overflowInUse = true;
    return { ok: true, overflow: true };
  }

  if (overflowInUse && overflow) {
    overflowInUse = false;
    try {
      await overflow.clear();
    } catch {
      // Best-effort cleanup only.
    }
  }
  return { ok: true, overflow: false };
}

/** Remove the persisted snapshot. Never throws. */
export function clearWorkspaceSnapshot(storage?: StorageLike | null): void {
  const target = storage === undefined ? getDefaultStorage() : storage;
  if (!target) return;
  try {
    target.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Clearing is best-effort; the app state is already reset in memory.
  }
}

/* --- IndexedDB overflow backend (raw, dependency-free) --- */

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(IDB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    } catch (error) {
      reject(error);
    }
  });
}

function runIdbStore<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openWorkspaceDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false;
        const done = (fn: () => void) => {
          if (!settled) {
            settled = true;
            try {
              db.close();
            } catch {
              // Ignore close errors.
            }
            fn();
          }
        };
        try {
          const tx = db.transaction(IDB_STORE_NAME, mode);
          tx.oncomplete = () => done(() => {});
          tx.onerror = () => done(() => reject(tx.error ?? new Error("IndexedDB transaction failed")));
          tx.onabort = () => done(() => reject(tx.error ?? new Error("IndexedDB transaction aborted")));
          const request = task(tx.objectStore(IDB_STORE_NAME));
          request.onsuccess = () => {
            const value = request.result;
            done(() => resolve(value));
          };
          request.onerror = () => done(() => reject(request.error ?? new Error("IndexedDB request failed")));
        } catch (error) {
          done(() => reject(error));
        }
      }),
  );
}

function createIndexedDbOverflow(): OverflowBackend | null {
  try {
    if (typeof indexedDB === "undefined") return null;
  } catch {
    return null;
  }
  return {
    save(snapshot: PersistedWorkspaceState): Promise<void> {
      return runIdbStore("readwrite", (store) => store.put(snapshot, IDB_OVERFLOW_KEY)).then(() => {});
    },
    load(): Promise<PersistedWorkspaceState | null> {
      return runIdbStore("readonly", (store) => store.get(IDB_OVERFLOW_KEY)).then((value) => {
        if (isValidWorkspaceSnapshot(value)) return value;
        return null;
      });
    },
    clear(): Promise<void> {
      return runIdbStore("readwrite", (store) => store.delete(IDB_OVERFLOW_KEY)).then(() => {});
    },
  };
}

let overflowSingleton: OverflowBackend | null | undefined;

function getOverflowBackend(): OverflowBackend | null {
  if (overflowSingleton === undefined) overflowSingleton = createIndexedDbOverflow();
  return overflowSingleton;
}

/** Load the overflowed full snapshot (IndexedDB). Resolves null when absent/invalid. */
export function loadWorkspaceOverflow(
  overflow?: OverflowBackend | null,
): Promise<PersistedWorkspaceState | null> {
  const backend = overflow === undefined ? getOverflowBackend() : overflow;
  if (!backend) return Promise.resolve(null);
  return backend.load().catch(() => null);
}

/** Best-effort overflow cleanup (used by Reset Workspace). Never throws. */
export function clearWorkspaceOverflow(overflow?: OverflowBackend | null): Promise<void> {
  const backend = overflow === undefined ? getOverflowBackend() : overflow;
  if (!backend) return Promise.resolve();
  overflowInUse = false;
  return backend.clear().catch(() => {});
}
