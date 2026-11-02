import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import AIAssistant from "./components/AIAssistant";
import DashboardPage from "./pages/DashboardPage";
import DataRecipePage from "./pages/DataRecipePage";
import { defaultMission, missions } from "./data/missions";
import { getDatasetById } from "./data/datasets";
import { mockDatasets } from "./data/datasets";
import type { AppTab, Dataset, Mission, SidebarNav, SourceLevel } from "./types";
import {
  ApiError,
  buildDiscoveryContext,
  generateRecipe,
  isAbortError,
  recipeDatasetToDataset,
  recommendationToDataset,
  searchDiscovery,
  type DataRecipeResponse,
  type DiscoveryResponse,
} from "./services/api";
import {
  buildSearchMeta,
  clearWorkspaceOverflow,
  clearWorkspaceSnapshot,
  loadWorkspaceOverflow,
  readWorkspace,
  writeWorkspace,
  WORKSPACE_STORAGE_WARNING,
} from "./services/workspaceStorage";
import {
  applyDatasetFilters,
  describeConditions,
  mergeConditions,
  normalizeFilterCondition,
  type FilterCondition,
} from "./services/assistantFilters";
import {
  buildAssistantContext,
  classifyAssistantError,
  clearAssistantThread,
  loadAssistantThread,
  saveAssistantThread,
  sendAssistantMessage,
  type AssistantMessage,
} from "./services/assistant";

const ALL_LEVELS: SourceLevel[] = ["Federal", "State", "Local"];
export const MAX_SELECTED = 20;
/** Number of live recommendations revealed per Load More page. */
export const DISCOVERY_PAGE_SIZE = 10;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function App() {
  // Step 11.2: restore the previous workspace synchronously on first render,
  // before any default state can overwrite the saved session. A missing,
  // corrupted, or outdated snapshot falls back to the Step 7 demo defaults.
  const [initialWorkspace] = useState(() => readWorkspace());
  const restored = initialWorkspace.state ?? null;

  const [activeTab, setActiveTab] = useState<AppTab>(restored?.activeTab ?? "dashboard");
  const [activeNav, setActiveNav] = useState<SidebarNav>(
    restored?.activeNav ?? (restored?.activeTab === "recipe" ? "saved" : "dashboard"),
  );
  const [mission, setMission] = useState<Mission>(
    () => missions.find((m) => m.id === restored?.missionId) ?? defaultMission,
  );
  const [query, setQuery] = useState(restored?.query ?? defaultMission.query);
  const [location, setLocation] = useState(restored?.location ?? "");
  const [sourceLevels, setSourceLevels] = useState<Set<SourceLevel>>(
    () => new Set(restored?.sourceLevels ?? ALL_LEVELS),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(restored?.selectedIds ?? defaultMission.defaultSelectedIds),
  );
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);

  // Step 11.3: conversational filters. The original discovery results stay
  // untouched in `discovery`; these conditions derive the visible subset so
  // filtering is always reversible. History enables Undo Last Filter.
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>(
    () => (restored?.assistantFilters as FilterCondition[] | undefined) ?? [],
  );
  const [filterHistory, setFilterHistory] = useState<FilterCondition[][]>([]);

  // Step 11.3: assistant conversation (shared with the central workspace).
  // Survives tab changes in state and browser reloads via assistantStorage.
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>(() => {
    const saved = loadAssistantThread();
    if (saved) return saved;
    return [
      {
        id: 1,
        role: "assistant",
        text: "I can answer questions about your datasets, metadata, and mission, and refine the visible results in plain language. Run a search to load live results, then ask me anything.",
      },
    ];
  });
  const assistantId = useRef(
    loadAssistantThread()?.reduce((n, m) => Math.max(n, m.id), 1) ?? 1,
  );
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantUnavailable, setAssistantUnavailable] = useState(false);
  const [assistantUnavailableMessage, setAssistantUnavailableMessage] = useState<string | null>(null);
  const assistantAbort = useRef<AbortController | null>(null);
  const assistantSeq = useRef(0);
  // Broader-catalog results fetched by the assistant, awaiting user confirm.
  const [adoptableCatalog, setAdoptableCatalog] = useState<DiscoveryResponse | null>(null);

  // Live integration state (Step 11). discovery === null means demo mode
  // until a live search succeeds; hasSearched hides demo results after a
  // failed/new search so old/demo data is never shown as new results.
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(
    restored?.discovery ?? null,
  );
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(restored?.hasSearched ?? false);
  const [visibleCount, setVisibleCount] = useState(
    restored && restored.visibleCount >= 1 ? restored.visibleCount : DISCOVERY_PAGE_SIZE,
  );
  const discoveryAbort = useRef<AbortController | null>(null);
  // True while the shown live results came from a saved session rather than
  // a fresh search. Cleared by any new search, mission change, or reset.
  const [isRestored, setIsRestored] = useState(
    () =>
      restored !== null &&
      (restored.discovery !== null || restored.recipe !== null || restored.hasSearched),
  );
  // Non-blocking notice when the session cannot be saved (e.g. quota).
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  // Last good live state, kept so a failed new search can restore the
  // previous results instead of leaving the workspace empty.
  const lastGood = useRef<{
    discovery: DiscoveryResponse | null;
    recipe: DataRecipeResponse | null;
    recipeAttempted: boolean;
  } | null>(null);
  // Step 11.2: the query/location of the latest submitted search. Set
  // immediately on Search so the Mission Interpretation panel reflects the
  // new query while the Discovery API is still working. A monotonic
  // sequence guards against stale responses overwriting a newer search.
  const [pendingSearch, setPendingSearch] = useState<{
    question: string;
    location: string | null;
  } | null>(null);
  const searchSeq = useRef(0);

  const [recipe, setRecipe] = useState<DataRecipeResponse | null>(
    restored?.recipe ?? null,
  );
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeAttempted, setRecipeAttempted] = useState(
    restored?.recipeAttempted ?? false,
  );
  const recipeAbort = useRef<AbortController | null>(null);

  // Step 11.2: persist every stable workspace change. Loading flags and
  // transient errors are intentionally excluded so a reload never restores a
  // half-finished search, and writes are skipped while a request is in flight
  // so the in-flight clearing of results cannot wipe the saved session.
  useEffect(() => {
    if (discoveryLoading || recipeLoading) return;
    let cancelled = false;
    void writeWorkspace({
      query,
      location,
      missionId: mission.id,
      sourceLevels: [...sourceLevels],
      discovery,
      selectedIds: [...selectedIds],
      recipe,
      recipeAttempted,
      activeTab,
      activeNav,
      hasSearched,
      visibleCount,
      searchMeta: buildSearchMeta(discovery),
      assistantFilters: activeFilters,
    }).then((result) => {
      if (cancelled) return;
      setStorageWarning(result.ok ? null : WORKSPACE_STORAGE_WARNING);
    });
    return () => {
      cancelled = true;
    };
  }, [
    query,
    location,
    mission.id,
    sourceLevels,
    discovery,
    discoveryLoading,
    selectedIds,
    recipe,
    recipeLoading,
    recipeAttempted,
    activeTab,
    activeNav,
    hasSearched,
    visibleCount,
    activeFilters,
  ]);

  // Step 11.3: persist the conversation thread separately so the workspace
  // snapshot stays small. Metadata only -- never credentials.
  useEffect(() => {
    saveAssistantThread(assistantMessages);
  }, [assistantMessages]);

  // Merge the IndexedDB overflow back when the local snapshot is slim.
  useEffect(() => {
    if (!restored?.recommendationsOverflow) return;
    let cancelled = false;
    void loadWorkspaceOverflow().then((snapshot) => {
      if (cancelled || !snapshot?.discovery) return;
      setDiscovery(snapshot.discovery);
    });
    return () => {
      cancelled = true;
    };
    // Only the mount-time restore reads the overflow; later snapshots flow
    // through the persistence effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countsByLevel = useMemo(() => {
    const counts: Record<SourceLevel, number> = { Federal: 0, State: 0, Local: 0 };
    for (const dataset of mockDatasets) counts[dataset.sourceLevel] += 1;
    return counts;
  }, []);

  const liveDatasets = useMemo<Dataset[]>(
    () => (discovery ? discovery.recommendations.map(recommendationToDataset) : []),
    [discovery],
  );

  // Step 11.3: the visible subset after conversational filters. The
  // original `discovery` response is preserved so Clear/Undo can restore it.
  const filteredDatasets = useMemo(
    () => applyDatasetFilters(liveDatasets, activeFilters),
    [liveDatasets, activeFilters],
  );
  const filterDescriptions = useMemo(
    () => describeConditions(activeFilters),
    [activeFilters],
  );

  // Step 11.3: context line shown above the assistant thread.
  const assistantContextSummary = discovery
    ? `Mission: ${discovery.question} · ${filteredDatasets.length} of ${liveDatasets.length} datasets shown · ${selectedIds.size} selected`
    : "Demo workspace — run a search to load live results for the assistant.";

  // Latest broader-catalog offer from the assistant, if any.
  const catalogOffer = useMemo(() => {
    for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
      const message = assistantMessages[i];
      if (message.role === "assistant" && message.needsCatalogSearch && message.catalogQuery) {
        return { query: message.catalogQuery, resultCount: message.catalogResultCount ?? null };
      }
    }
    return null;
  }, [assistantMessages]);

  // Step 11.3: warn before submitting unusually large selections without
  // discarding anything; the recipe endpoint still validates the max.
  const largeSelectionWarning =
    selectedIds.size > MAX_SELECTED
      ? `You selected ${selectedIds.size} datasets, but recipe generation supports at most ${MAX_SELECTED}. Reduce the selection before generating — nothing was discarded.`
      : selectedIds.size > 10
        ? `${selectedIds.size} datasets selected — an unusually large selection. Recipe generation supports at most ${MAX_SELECTED} and may be slow.`
        : null;

  const selectedDatasets = useMemo(() => {
    if (recipe && recipeAttempted) {
      // Recipe page list is driven by current selection where possible.
    }
    const fromLive = [...selectedIds]
      .map((id) => liveDatasets.find((d) => d.id === id))
      .filter((d): d is Dataset => d !== undefined);
    if (fromLive.length > 0 || discovery) {
      // Also include recipe datasets the user still has selected.
      const extra = recipe
        ? recipe.selected_datasets
            .filter((ds) => selectedIds.has(ds.AssignedID))
            .map(recipeDatasetToDataset)
            .filter((d) => !fromLive.some((x) => x.id === d.id))
        : [];
      return [...fromLive, ...extra];
    }
    return [...selectedIds]
      .map(getDatasetById)
      .filter((d): d is Dataset => d !== undefined);
  }, [selectedIds, liveDatasets, discovery, recipe, recipeAttempted]);

  function nextAssistantId(): number {
    assistantId.current += 1;
    return assistantId.current;
  }

  function appendAssistantMessage(message: Omit<AssistantMessage, "id">): void {
    const id = nextAssistantId();
    setAssistantMessages((prev) => [...prev, { ...message, id }]);
  }

  function handleSelectMission(next: Mission) {
    discoveryAbort.current?.abort();
    searchSeq.current += 1; // invalidate any in-flight search
    setPendingSearch(null);
    lastGood.current = null;
    setMission(next);
    setQuery(next.query);
    setSelectedIds(new Set(next.defaultSelectedIds));
    setDiscovery(null);
    setDiscoveryError(null);
    setHasSearched(false);
    setDiscoveryLoading(false);
    setVisibleCount(DISCOVERY_PAGE_SIZE);
    setActiveFilters([]);
    setFilterHistory([]);
    setAdoptableCatalog(null);
    setRecipe(null);
    setRecipeError(null);
    setRecipeAttempted(false);
    setActiveTab("dashboard");
    setActiveNav("dashboard");
    setIsRestored(false);
  }

  async function handleSearch() {
    const question = query.trim();
    if (question.length < 3 || discoveryLoading) return;
    await executeSearch(question, location.trim() || null);
  }

  async function executeSearch(question: string, submittedLocation: string | null) {
    if (discoveryLoading) return;
    discoveryAbort.current?.abort();
    const controller = new AbortController();
    discoveryAbort.current = controller;
    const seq = (searchSeq.current += 1);
    // Stash the last good state so a failed new search can keep showing the
    // previous results instead of leaving the workspace empty.
    lastGood.current = { discovery, recipe, recipeAttempted };
    // Immediately reflect the newly submitted query/location; the panel
    // shows this preliminary state until the API response arrives.
    setPendingSearch({ question, location: submittedLocation });
    setHasSearched(true);
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    setDiscovery(null); // never show old results as belonging to this search
    setRecipe(null);
    setRecipeAttempted(false);
    setRecipeError(null);
    setIsRestored(false);
    try {
      const result = await searchDiscovery(
        { question, location: submittedLocation },
        controller.signal,
      );
      // Stale guard: ignore responses from superseded searches even if
      // their abort did not land before the response resolved.
      if (controller.signal.aborted || seq !== searchSeq.current) return;
      lastGood.current = null;
      setDiscovery(result);
      setPendingSearch(null);
      setVisibleCount(DISCOVERY_PAGE_SIZE);
      setSelectedIds(new Set()); // clear previous selections for new results
      // Step 11.3: a new search replaces the result set, so conversational
      // filters restart; the conversation is kept and the new context noted.
      setActiveFilters([]);
      setFilterHistory([]);
      setAdoptableCatalog(null);
      appendAssistantMessage({
        role: "assistant",
        text: `New search: "${question}" — ${result.recommendations.length} recommendation${result.recommendations.length === 1 ? "" : "s"}. Previous conversation kept for context.`,
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      if (seq !== searchSeq.current) return; // a newer search owns the panel
      const previous = lastGood.current;
      setPendingSearch(null);
      if (previous?.discovery) {
        // Keep the previous live results and distinguish them from the new
        // search that just failed.
        setDiscovery(previous.discovery);
        setRecipe(previous.recipe);
        setRecipeAttempted(previous.recipeAttempted);
        setIsRestored(true);
        setDiscoveryError(
          `${errorMessage(error, "Discovery search failed. Please try again.")} Previous results kept below.`,
        );
      } else {
        setDiscovery(null);
        setDiscoveryError(errorMessage(error, "Discovery search failed. Please try again."));
      }
    } finally {
      if (!controller.signal.aborted && seq === searchSeq.current) {
        setDiscoveryLoading(false);
      }
    }
  }

  function handleCancelSearch() {
    discoveryAbort.current?.abort();
    searchSeq.current += 1; // invalidate the cancelled search
    setPendingSearch(null);
    setDiscoveryLoading(false);
  }

  function handleResetWorkspace() {
    if (
      !window.confirm(
        "Reset workspace? This clears your saved search, selections, and data recipe.",
      )
    ) {
      return;
    }
    discoveryAbort.current?.abort();
    recipeAbort.current?.abort();
    assistantAbort.current?.abort();
    searchSeq.current += 1; // invalidate any in-flight request
    assistantSeq.current += 1;
    lastGood.current = null;
    clearWorkspaceSnapshot();
    void clearWorkspaceOverflow();
    clearAssistantThread();
    setMission(defaultMission);
    setQuery(defaultMission.query);
    setLocation("");
    setSourceLevels(new Set(ALL_LEVELS));
    setSelectedIds(new Set(defaultMission.defaultSelectedIds));
    setDiscovery(null);
    setDiscoveryError(null);
    setHasSearched(false);
    setDiscoveryLoading(false);
    setPendingSearch(null);
    setVisibleCount(DISCOVERY_PAGE_SIZE);
    setActiveFilters([]);
    setFilterHistory([]);
    setAdoptableCatalog(null);
    setRecipe(null);
    setRecipeError(null);
    setRecipeAttempted(false);
    setRecipeLoading(false);
    setActiveTab("dashboard");
    setActiveNav("dashboard");
    setIsRestored(false);
    setStorageWarning(null);
    setAssistantLoading(false);
    setAssistantError(null);
    setAssistantMessages([
      {
        id: nextAssistantId(),
        role: "assistant",
        text: "Workspace reset. Run a search to load live results, then ask me anything about your datasets.",
      },
    ]);
  }

  function handleToggleDataset(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }

  function handleLoadMore() {
    // Reveal the next page of already-fetched recommendations.
    // Selections in selectedIds are untouched, so cross-page picks persist.
    setVisibleCount((prev) => prev + DISCOVERY_PAGE_SIZE);
  }

  function handleBulkSelect(ids: string[], select: boolean) {
    // Bulk operations touch only the loaded filtered cards. Filtered-out
    // datasets keep their selection, and bulk adds never silently discard:
    // exceeding MAX_SELECTED is allowed and surfaced via the large-selection
    // warning instead of being truncated.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const raw of ids) {
          const id = raw.trim();
          if (id) next.add(id);
        }
      } else {
        for (const raw of ids) next.delete(raw);
      }
      return next;
    });
  }

  function handleClearFilters() {
    if (activeFilters.length === 0) return;
    setFilterHistory((prev) => [...prev, activeFilters]);
    setActiveFilters([]);
    setVisibleCount(DISCOVERY_PAGE_SIZE);
  }

  function handleUndoFilter() {
    if (filterHistory.length === 0) return;
    setActiveFilters(filterHistory[filterHistory.length - 1]);
    setFilterHistory(filterHistory.slice(0, -1));
    setVisibleCount(DISCOVERY_PAGE_SIZE);
  }

  /**
   * Apply a backend filter action to the central workspace (Step 11.3 fix).
   *
   * Execution order: validate every proposed condition against the same
   * engine that renders the cards, then apply to the full recommendation
   * set, then report the actual result count. Validation or execution
   * failure leaves the active filters untouched and returns an
   * explanation instead of a success claim.
   */
  function applyAssistantFilterAction(
    action: { action: string; filters: FilterCondition[]; description: string; unsupported_reason?: string | null },
  ): string | null {
    if (!discovery) {
      if (action.action === "apply" || action.action === "clear" || action.action === "undo") {
        return "No live results to filter yet — run a search first.";
      }
      return null;
    }
    const total = liveDatasets.length;
    if (action.action === "apply") {
      // The frontend engine is the authority on what executes: normalize
      // aliases and numeric IDs, reject anything it cannot run.
      const normalized: FilterCondition[] = [];
      const problems: string[] = [];
      action.filters.forEach((raw, index) => {
        const condition = normalizeFilterCondition(
          raw as unknown as { field: unknown; op: unknown; value: unknown },
        );
        if (condition) {
          normalized.push(condition);
        } else {
          const field = (raw as unknown as { field?: unknown })?.field;
          const op = (raw as unknown as { op?: unknown })?.op;
          problems.push(`filter #${index + 1}: unsupported field/op combination (${String(field)} ${String(op)})`);
        }
      });
      if (problems.length > 0 || normalized.length === 0) {
        const detail = problems.length > 0 ? problems.join("; ") : "the filter carries no usable conditions";
        return `That filter isn't supported yet (${detail}), so results were left unchanged.`;
      }
      const next = mergeConditions(activeFilters, normalized);
      const visible = applyDatasetFilters(liveDatasets, next).length;
      setFilterHistory((prev) => [...prev, activeFilters]);
      setActiveFilters(next);
      setVisibleCount(DISCOVERY_PAGE_SIZE);
      return `${action.description || "Filters applied."} Showing ${visible} of ${total} datasets.`;
    }
    if (action.action === "clear") {
      setFilterHistory((prev) => [...prev, activeFilters]);
      setActiveFilters([]);
      setVisibleCount(DISCOVERY_PAGE_SIZE);
      return `${action.description || "Filters cleared."} Showing ${total} of ${total} datasets.`;
    }
    if (action.action === "undo") {
      if (filterHistory.length === 0) {
        return "Nothing to undo — no recent filter changes.";
      }
      const restored = filterHistory[filterHistory.length - 1];
      const visible = applyDatasetFilters(liveDatasets, restored).length;
      setActiveFilters(restored);
      setFilterHistory(filterHistory.slice(0, -1));
      setVisibleCount(DISCOVERY_PAGE_SIZE);
      return `${action.description || "Undid the last filter change."} Showing ${visible} of ${total} datasets.`;
    }
    if (action.action === "unsupported") {
      return action.unsupported_reason || "That filter needs metadata that is not available, so results were left unchanged.";
    }
    return null;
  }

  /** Remove one active filter by position; history keeps the change undoable. */
  function handleRemoveFilter(index: number) {
    if (index < 0 || index >= activeFilters.length) return;
    setFilterHistory((prev) => [...prev, activeFilters]);
    setActiveFilters((prev) => prev.filter((_, i) => i !== index));
    setVisibleCount(DISCOVERY_PAGE_SIZE);
  }

  function assistantContextNow() {
    return buildAssistantContext({
      question: (discovery?.question ?? query).trim(),
      interpretedIntent: discovery?.interpreted_intent ?? "",
      location: location.trim() || null,
      recommendations: (discovery?.recommendations ?? []).map((r) => ({
        AssignedID: r.AssignedID,
        title: r.title,
        description: r.description,
        source_portal: r.source_portal,
        access_url: r.access_url,
        relevance_score: r.relevance_score,
        relevance_reason: r.relevance_reason,
        proposed_role: r.proposed_role,
      })),
      selectedIds: [...selectedIds],
      activeFilterDescriptions: filterDescriptions,
      recipeSummary: recipe
        ? `${recipe.analytical_objective} (${recipe.selected_datasets.length} datasets)`
        : null,
      // Exact workspace counts: recommendations are capped in the prompt,
      // so "How many datasets remain?" is answered from these figures.
      totalCount: discovery?.recommendations.length ?? 0,
      visibleCount: filteredDatasets.length,
    });
  }

  async function sendAssistantChat(
    message: string,
    allowCatalogSearch: boolean,
    opts?: { resend?: boolean },
  ) {
    const text = message.trim();
    if (!text || assistantLoading) return;
    assistantAbort.current?.abort();
    const controller = new AbortController();
    assistantAbort.current = controller;
    const seq = (assistantSeq.current += 1);
    // Retry repeats the failed operation exactly: the user message is
    // already the trailing thread entry, so neither append a duplicate nor
    // repeat it inside history. A failed send never reached filter
    // application, and mergeConditions dedupes, so Retry cannot double-apply.
    const baseHistory = assistantMessages.map((m) => ({ role: m.role, content: m.text }));
    const history =
      opts?.resend &&
      baseHistory.length > 0 &&
      baseHistory[baseHistory.length - 1].role === "user" &&
      baseHistory[baseHistory.length - 1].content === text
        ? baseHistory.slice(0, -1)
        : baseHistory;
    if (!opts?.resend) {
      const userMessage: AssistantMessage = { id: nextAssistantId(), role: "user", text };
      setAssistantMessages((prev) => [...prev, userMessage]);
    }
    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const result = await sendAssistantMessage(
        {
          message: text,
          history,
          context: assistantContextNow(),
          allow_catalog_search: allowCatalogSearch,
        },
        controller.signal,
      );
      // Stale guard: a newer message owns the thread.
      if (controller.signal.aborted || seq !== assistantSeq.current) return;
      setAssistantUnavailable(false);
      setAssistantUnavailableMessage(null);
      if (result.catalog_search) setAdoptableCatalog(result.catalog_search);
      const filterNotice = applyAssistantFilterAction(result.filter_action);
      appendAssistantMessage({
        role: "assistant",
        text: result.reply,
        referencedIds: result.grounded_assigned_ids,
        filterAction: result.filter_action,
        filterNotice,
        needsCatalogSearch: result.needs_catalog_search,
        catalogQuery: result.catalog_query,
        catalogResultCount: result.catalog_search ? result.catalog_search.recommendations.length : null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isAbortError(error) || controller.signal.aborted) return;
      if (seq !== assistantSeq.current) return; // a newer message owns the thread
      const classified = classifyAssistantError(error);
      if (classified.unavailable) {
        setAssistantUnavailable(true);
        setAssistantUnavailableMessage(classified.message);
        setAssistantError(null);
      } else {
        setAssistantError(classified.message);
      }
    } finally {
      if (!controller.signal.aborted && seq === assistantSeq.current) {
        setAssistantLoading(false);
      }
    }
  }

  function handleSendAssistant(text: string) {
    void sendAssistantChat(text, false);
  }

  function handleRetryAssistant() {
    // Retry re-sends the latest user message as an exact resend: no
    // duplicate chat bubble, no duplicated history tail, no double filter.
    for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
      if (assistantMessages[i].role === "user") {
        setAssistantError(null);
        void sendAssistantChat(assistantMessages[i].text, false, { resend: true });
        return;
      }
    }
  }

  function handleNewConversation() {
    assistantAbort.current?.abort();
    assistantSeq.current += 1; // invalidate any in-flight message
    setAssistantLoading(false);
    setAssistantError(null);
    clearAssistantThread();
    setAdoptableCatalog(null);
    setAssistantMessages([
      {
        id: nextAssistantId(),
        role: "assistant",
        text: "New conversation started. Ask me about your datasets, metadata, or mission — or refine the visible results in plain language.",
      },
    ]);
  }

  function handleSearchCatalogOffer(catalogQuery: string) {
    const q = catalogQuery.trim() || "Find related government datasets";
    setQuery(q);
    void executeSearch(q, location.trim() || null);
  }

  function handleAdoptCatalogResults() {
    if (!adoptableCatalog) return;
    const adopted = adoptableCatalog;
    setAdoptableCatalog(null);
    lastGood.current = null;
    setDiscovery(adopted);
    setQuery(adopted.question);
    setPendingSearch(null);
    setHasSearched(true);
    setDiscoveryError(null);
    setIsRestored(false);
    setVisibleCount(DISCOVERY_PAGE_SIZE);
    setSelectedIds(new Set());
    setActiveFilters([]);
    setFilterHistory([]);
    setRecipe(null);
    setRecipeAttempted(false);
    setRecipeError(null);
    appendAssistantMessage({
      role: "assistant",
      text: `Loaded ${adopted.recommendations.length} broader-catalog dataset${adopted.recommendations.length === 1 ? "" : "s"} into the workspace for "${adopted.question}".`,
    });
  }

  async function handleGenerateRecipe() {
    setActiveTab("recipe");
    setActiveNav("saved");
    const question = (discovery?.question ?? query).trim();
    const ids = [...new Set([...selectedIds].map((i) => i.trim()).filter(Boolean))];
    setRecipeAttempted(true);
    if (ids.length === 0) {
      setRecipe(null);
      setRecipeError("Select at least one dataset before generating a data recipe.");
      return;
    }
    if (ids.length > MAX_SELECTED) {
      setRecipe(null);
      setRecipeError(`Select at most ${MAX_SELECTED} datasets for recipe generation.`);
      return;
    }
    if (question.length < 3) {
      setRecipe(null);
      setRecipeError("Enter a research question (at least 3 characters) before generating a data recipe.");
      return;
    }
    if (recipeLoading) return;
    recipeAbort.current?.abort();
    const controller = new AbortController();
    recipeAbort.current = controller;
    setRecipeLoading(true);
    setRecipeError(null);
    setRecipe(null);
    try {
      const result = await generateRecipe(
        {
          question,
          selected_assigned_ids: ids,
          location: location.trim() || null,
          discovery_context: buildDiscoveryContext(discovery, ids, location),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setRecipe(result);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      setRecipe(null);
      setRecipeError(errorMessage(error, "Data recipe generation failed. Please try again."));
    } finally {
      if (!controller.signal.aborted) setRecipeLoading(false);
    }
  }

  function handleToggleSourceLevel(level: SourceLevel) {
    setSourceLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size > 1) next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  function handleNavigate(nav: SidebarNav) {
    setActiveNav(nav);
    if (nav === "saved") {
      setActiveTab("recipe");
    } else {
      setActiveTab("dashboard");
      if (nav === "datasets") {
        requestAnimationFrame(() => {
          document
            .getElementById("recommended-datasets")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }

  function handleTabChange(tab: AppTab) {
    setActiveTab(tab);
    setActiveNav(tab === "recipe" ? "saved" : "dashboard");
  }

  return (
    <div className="min-h-svh bg-background font-sans">
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        selectedCount={selectedIds.size}
        isLive={discovery !== null}
      />
      <div
        className={`dashboard-grid mx-auto w-full max-w-[1600px] ${
          assistantCollapsed ? "dashboard-grid--assistant-collapsed" : ""
        }`}
      >
        <Sidebar
          activeNav={activeNav}
          onNavigate={handleNavigate}
          sourceLevels={sourceLevels}
          onToggleSourceLevel={handleToggleSourceLevel}
          countsByLevel={countsByLevel}
          selectedCount={selectedIds.size}
          onResetWorkspace={handleResetWorkspace}
        />

        {activeTab === "dashboard" ? (
          <DashboardPage
            missions={missions}
            mission={mission}
            onSelectMission={handleSelectMission}
            query={query}
            onQueryChange={setQuery}
            location={location}
            onLocationChange={setLocation}
            sourceLevels={sourceLevels}
            selectedIds={selectedIds}
            onToggleDataset={handleToggleDataset}
            onGenerateRecipe={handleGenerateRecipe}
            discovery={discovery}
            discoveryLoading={discoveryLoading}
            discoveryError={discoveryError}
            hasSearched={hasSearched}
            pendingQuery={pendingSearch?.question ?? null}
            pendingLocation={pendingSearch?.location ?? null}
            onSearch={handleSearch}
            onCancelSearch={handleCancelSearch}
            recipeLoading={recipeLoading}
            visibleCount={visibleCount}
            onLoadMore={handleLoadMore}
            isRestored={isRestored}
            storageWarning={storageWarning}
            filteredDatasets={filteredDatasets}
            totalOriginal={liveDatasets.length}
            activeFilters={activeFilters}
            filterDescriptions={filterDescriptions}
            canUndoFilter={filterHistory.length > 0}
            onClearFilters={handleClearFilters}
            onUndoFilter={handleUndoFilter}
            onRemoveFilter={handleRemoveFilter}
            onBulkSelect={handleBulkSelect}
            largeSelectionWarning={largeSelectionWarning}
          />
        ) : (
          <DataRecipePage
            mission={mission}
            selectedDatasets={selectedDatasets}
            onRemoveDataset={handleToggleDataset}
            onBackToWorkspace={() => handleTabChange("dashboard")}
            recipe={recipe}
            recipeLoading={recipeLoading}
            recipeError={recipeError}
            recipeAttempted={recipeAttempted}
            onGenerateRecipe={handleGenerateRecipe}
          />
        )}

        <div className="grid-assistant min-w-0">
          <AIAssistant
            collapsed={assistantCollapsed}
            onToggleCollapsed={() => setAssistantCollapsed((v) => !v)}
            messages={assistantMessages}
            loading={assistantLoading}
            error={assistantError}
            unavailable={assistantUnavailable}
            unavailableMessage={assistantUnavailableMessage}
            contextSummary={assistantContextSummary}
            catalogOffer={catalogOffer}
            onSend={handleSendAssistant}
            onRetry={handleRetryAssistant}
            onNewConversation={handleNewConversation}
            onSearchCatalog={handleSearchCatalogOffer}
            onAdoptCatalogResults={handleAdoptCatalogResults}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
