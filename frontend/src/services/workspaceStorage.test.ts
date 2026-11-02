import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSearchMeta,
  clearWorkspaceSnapshot,
  isValidWorkspaceSnapshot,
  loadWorkspaceOverflow,
  readWorkspace,
  writeWorkspace,
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STATE_VERSION,
  __resetOverflowFlagForTests,
  type OverflowBackend,
  type PersistedWorkspaceState,
  type StorageLike,
  type WorkspaceSnapshotInput,
} from "./workspaceStorage";
import type { DiscoveryResponse } from "./api";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function quotaError(): Error {
  const error = new Error("QuotaExceededError");
  error.name = "QuotaExceededError";
  return error;
}

function createMemoryOverflow(failOnSave = false): OverflowBackend & {
  saved: PersistedWorkspaceState[];
} {
  let stored: PersistedWorkspaceState | null = null;
  const saved: PersistedWorkspaceState[] = [];
  return {
    saved,
    save: async (snapshot: PersistedWorkspaceState) => {
      if (failOnSave) throw new Error("IndexedDB unavailable");
      stored = snapshot;
      saved.push(snapshot);
    },
    load: async () => stored,
    clear: async () => {
      stored = null;
    },
  };
}

const discovery: DiscoveryResponse = {
  request_id: "req-1",
  question: "Find healthcare related data",
  interpreted_intent: "Health data intent",
  recommendations: [
    {
      AssignedID: "101",
      title: "Community Health Survey",
      description: "Health survey records",
      source_portal: "healthdata.gov",
      access_url: "https://example.com/health",
      relevance_score: 90,
      relevance_reason: "Direct health match",
      proposed_role: "primary health layer",
      limitations: [],
    },
  ],
  catalog_total: 1660,
  catalog_examined: 120,
  completeness: "partial",
  warnings: [],
};

function snapshotInput(): WorkspaceSnapshotInput {
  return {
    query: discovery.question,
    location: "",
    missionId: "flood-risks",
    sourceLevels: ["Federal", "State", "Local"],
    discovery,
    selectedIds: ["101"],
    recipe: null,
    recipeAttempted: false,
    activeTab: "dashboard",
    activeNav: "dashboard",
    hasSearched: true,
    visibleCount: 10,
    searchMeta: {
      resultCount: 1,
      catalogExamined: 120,
      catalogTotal: 1660,
      completeness: "partial",
    },
  };
}

beforeEach(() => {
  __resetOverflowFlagForTests();
});

describe("workspaceStorage", () => {
  it("reports empty when nothing was saved", () => {
    expect(readWorkspace({ storage: createMemoryStorage() }).status).toBe("empty");
  });

  it("round-trips a valid snapshot with its schema version", async () => {
    const storage = createMemoryStorage();
    const result = await writeWorkspace(snapshotInput(), {
      storage,
      overflow: createMemoryOverflow(),
    });
    expect(result).toEqual({ ok: true, overflow: false });

    const loaded = readWorkspace({ storage });
    expect(loaded.status).toBe("ok");
    expect(loaded.state?.version).toBe(WORKSPACE_STATE_VERSION);
    expect(loaded.state?.query).toBe(discovery.question);
    expect(loaded.state?.selectedIds).toEqual(["101"]);
    expect(loaded.state?.discovery?.interpreted_intent).toBe("Health data intent");
    expect(loaded.state?.searchMeta?.resultCount).toBe(1);
    expect(isValidWorkspaceSnapshot(loaded.state)).toBe(true);
  });

  it("rejects corrupted JSON instead of applying it", () => {
    const loaded = readWorkspace({
      storage: createMemoryStorage({ [WORKSPACE_STORAGE_KEY]: "not-json{{{ " }),
    });
    expect(loaded.status).toBe("corrupt");
    expect(loaded.state).toBeUndefined();
  });

  it("rejects an outdated schema version", () => {
    const loaded = readWorkspace({
      storage: createMemoryStorage({
        [WORKSPACE_STORAGE_KEY]: JSON.stringify({ version: 0, savedAt: "x" }),
      }),
    });
    expect(loaded.status).toBe("version-mismatch");
  });

  it("rejects a wrong-version snapshot even when the shape looks valid", () => {
    const loaded = readWorkspace({
      storage: createMemoryStorage({
        [WORKSPACE_STORAGE_KEY]: JSON.stringify({ version: 999, query: "x" }),
      }),
    });
    expect(loaded.status).toBe("version-mismatch");
  });

  it("rejects invalid shapes without throwing", () => {
    for (const bad of [
      { version: 1 },
      { version: 1, savedAt: "x", query: 42 },
      {
        version: 1,
        savedAt: "x",
        query: "q",
        location: "",
        missionId: "m",
        sourceLevels: ["Federal"],
        discovery: { question: "q" },
        selectedIds: [],
        recipe: null,
        recipeAttempted: false,
        activeTab: "dashboard",
        activeNav: "dashboard",
        hasSearched: true,
        visibleCount: 10,
        searchMeta: null,
        recommendationsOverflow: false,
      },
      {
        version: 1,
        savedAt: "x",
        query: "q",
        location: "",
        missionId: "m",
        sourceLevels: ["Federal"],
        discovery: null,
        selectedIds: [],
        recipe: null,
        recipeAttempted: false,
        activeTab: "nope",
        activeNav: "dashboard",
        hasSearched: true,
        visibleCount: 10,
        searchMeta: null,
        recommendationsOverflow: false,
      },
    ]) {
      const loaded = readWorkspace({
        storage: createMemoryStorage({ [WORKSPACE_STORAGE_KEY]: JSON.stringify(bad) }),
      });
      expect(loaded.status).toBe("corrupt");
    }
  });

  it("never persists secrets — the snapshot holds catalog metadata only", async () => {
    const storage = createMemoryStorage();
    await writeWorkspace(snapshotInput(), { storage, overflow: null });
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY) ?? "";
    expect(raw).not.toMatch(/api[_-]?key/i);
    expect(raw).not.toMatch(/secret/i);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/credential/i);
    expect(raw).not.toMatch(/bearer/i);
  });

  it("overflows large snapshots to IndexedDB when localStorage quota is hit", async () => {
    let calls = 0;
    const storage = createMemoryStorage();
    const throwing: StorageLike = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        calls += 1;
        if (calls === 1) throw quotaError(); // full snapshot exceeds quota
        storage.setItem(key, value); // slim snapshot fits
      },
      removeItem: (key) => storage.removeItem(key),
    };
    const overflow = createMemoryOverflow();

    const result = await writeWorkspace(snapshotInput(), { storage: throwing, overflow });
    expect(result).toEqual({ ok: true, overflow: true });

    // The slim snapshot stays in localStorage with the overflow flag set.
    const slim = readWorkspace({ storage });
    expect(slim.status).toBe("ok");
    expect(slim.state?.recommendationsOverflow).toBe(true);
    expect(slim.state?.discovery?.recommendations).toEqual([]);
    expect(slim.state?.searchMeta?.resultCount).toBe(1);

    // The full recommendations survived in the overflow backend.
    expect(overflow.saved).toHaveLength(1);
    const savedFull = overflow.saved[0];
    expect(savedFull?.discovery).not.toBeNull();
    expect(savedFull?.discovery?.recommendations).toHaveLength(1);
    expect(savedFull?.discovery?.recommendations[0]?.AssignedID).toBe("101");
  });

  it("reports quota failure when no overflow backend can take the snapshot", async () => {
    const storage = createMemoryStorage();
    const throwing: StorageLike = {
      getItem: (key) => storage.getItem(key),
      setItem: () => {
        throw quotaError();
      },
      removeItem: (key) => storage.removeItem(key),
    };
    const result = await writeWorkspace(snapshotInput(), {
      storage: throwing,
      overflow: null,
    });
    expect(result).toEqual({ ok: false, reason: "quota" });
  });

  it("treats inaccessible storage as empty instead of throwing", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readWorkspace({ storage: broken }).status).toBe("empty");
  });

  it("clears the saved snapshot", async () => {
    const storage = createMemoryStorage();
    await writeWorkspace(snapshotInput(), { storage, overflow: null });
    expect(readWorkspace({ storage }).status).toBe("ok");
    clearWorkspaceSnapshot(storage);
    expect(readWorkspace({ storage }).status).toBe("empty");
  });

  it("derives search metadata and leaves overflow empty on the full-write path", async () => {
    const overflow = createMemoryOverflow();
    await writeWorkspace(snapshotInput(), {
      storage: createMemoryStorage(),
      overflow,
    });
    // Full write path does not use the overflow backend.
    expect(await loadWorkspaceOverflow(overflow)).toBeNull();
    expect(buildSearchMeta(discovery)).toEqual({
      resultCount: 1,
      catalogExamined: 120,
      catalogTotal: 1660,
      completeness: "partial",
    });
    expect(buildSearchMeta(null)).toBeNull();
  });
});
