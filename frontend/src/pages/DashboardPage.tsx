import type { FormEvent, ReactNode } from "react";
import {
  Ban,
  ClipboardList,
  Crosshair,
  FileSearch,
  Info,
  Layers,
  ListOrdered,
  MapPin,
  Search,
  Sparkles,
  Target,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import type { Dataset, Mission, SourceLevel } from "../types";
import { getDatasetById } from "../data/datasets";
import DatasetCard from "../components/DatasetCard";
import { recommendationToDataset, type DiscoveryResponse } from "../services/api";
import type { FilterCondition } from "../services/assistantFilters";

interface DashboardPageProps {
  missions: Mission[];
  mission: Mission;
  onSelectMission: (mission: Mission) => void;
  query: string;
  onQueryChange: (value: string) => void;
  location: string;
  onLocationChange: (value: string) => void;
  sourceLevels: Set<SourceLevel>;
  selectedIds: Set<string>;
  onToggleDataset: (id: string) => void;
  onGenerateRecipe: () => void;
  discovery?: DiscoveryResponse | null;
  discoveryLoading?: boolean;
  discoveryError?: string | null;
  hasSearched?: boolean;
  /** Step 11.2: latest submitted query/location shown while loading. */
  pendingQuery?: string | null;
  pendingLocation?: string | null;
  onSearch?: () => void;
  onCancelSearch?: () => void;
  recipeLoading?: boolean;
  visibleCount?: number;
  onLoadMore?: () => void;
  /** Step 11.2: true while the shown results were restored from a saved session. */
  isRestored?: boolean;
  /** Step 11.2: non-blocking notice when the session cannot be saved. */
  storageWarning?: string | null;
  /** Step 11.3: live datasets after conversational filters (App applies them). */
  filteredDatasets?: Dataset[] | null;
  /** Step 11.3: original unfiltered live count for the header. */
  totalOriginal?: number;
  /** Step 11.3: active conversational filter conditions. */
  activeFilters?: FilterCondition[];
  /** Step 11.3: human-readable active filter descriptions (chips). */
  filterDescriptions?: string[];
  /** Step 11.3: whether a filter change can be undone. */
  canUndoFilter?: boolean;
  /** Step 11.3: remove all conversational filters. */
  onClearFilters?: () => void;
  /** Step 11.3: revert the most recent filter change. */
  onUndoFilter?: () => void;
  /** Step 11.3 fix: remove one active filter by its position. */
  onRemoveFilter?: (index: number) => void;
  /** Step 11.3: bulk-select or bulk-deselect loaded dataset IDs. */
  onBulkSelect?: (ids: string[], select: boolean) => void;
  /** Step 11.3: warning shown when the selection is unusually large. */
  largeSelectionWarning?: string | null;
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy">
        <Icon className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function matchesQuery(dataset: Dataset, q: string): boolean {
  if (!q.trim()) return true;
  const haystack =
    `${dataset.title} ${dataset.source} ${dataset.description} ${dataset.whyRecommended}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

export default function DashboardPage({
  missions,
  mission,
  onSelectMission,
  query,
  onQueryChange,
  location = "",
  onLocationChange,
  sourceLevels,
  selectedIds,
  onToggleDataset,
  onGenerateRecipe,
  discovery = null,
  discoveryLoading = false,
  discoveryError = null,
  hasSearched = false,
  pendingQuery = null,
  pendingLocation = null,
  onSearch,
  onCancelSearch,
  recipeLoading = false,
  visibleCount,
  onLoadMore,
  isRestored = false,
  storageWarning = null,
  filteredDatasets = null,
  totalOriginal,
  activeFilters = [],
  filterDescriptions = [],
  canUndoFilter = false,
  onClearFilters,
  onUndoFilter,
  onRemoveFilter,
  onBulkSelect,
  largeSelectionWarning = null,
}: DashboardPageProps) {
  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    if (onSearch) {
      onSearch();
      return;
    }
    const match = missions.find(
      (m) => m.label.toLowerCase() === query.trim().toLowerCase(),
    );
    if (match) onSelectMission(match);
  }
  const isLive = discovery !== null;
  // Step 11.3: App applies conversational filters and passes the filtered
  // list; fall back to the unfiltered mapping when the parent predates it.
  const liveDatasets = filteredDatasets ?? (discovery ? discovery.recommendations.map(recommendationToDataset) : []);
  const totalRelevant = totalOriginal ?? liveDatasets.length;
  const filteredTotal = liveDatasets.length;
  const filtersActive = activeFilters.length > 0;
  // Paginated display: the backend returns every relevant dataset ordered by
  // relevance; the UI reveals them in pages so large result sets stay usable.
  // visibleCount defaults to the full list when the parent does not paginate.
  const effectiveVisibleCount = visibleCount ?? filteredTotal;
  const visibleLiveDatasets = liveDatasets.slice(0, effectiveVisibleCount);
  const hasMoreLive = effectiveVisibleCount < filteredTotal;
  // Bulk selection operates on the currently loaded (rendered) filtered
  // cards only -- never on server-side matches outside this view.
  const loadedIds = visibleLiveDatasets.map((d) => d.id);
  const loadedSelectedCount = visibleLiveDatasets.filter((d) => selectedIds.has(d.id)).length;
  const allLoadedSelected = loadedIds.length > 0 && loadedSelectedCount === loadedIds.length;
  const someLoadedSelected = loadedSelectedCount > 0 && !allLoadedSelected;

  const visibleGroups = mission.groups
    .map((group) => ({
      ...group,
      datasets: group.datasetIds
        .map(getDatasetById)
        .filter((d): d is Dataset => d !== undefined)
        .filter((d) => sourceLevels.has(d.sourceLevel))
        .filter((d) => matchesQuery(d, query === mission.query ? "" : query)),
    }))
    .filter((group) => group.datasets.length > 0);

  const totalVisible = visibleGroups.reduce((n, g) => n + g.datasets.length, 0);

  // Step 11.2: label where the shown live results came from. A live
  // discovery plus an error means the new search failed and the previous
  // results were kept; isRestored means they came from the saved session.
  const showingPreviousResults = isLive && discoveryError != null;
  return (
    <div className="min-w-0 space-y-4">
      {storageWarning && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900" role="status">
          <strong className="font-semibold">Workspace not saved:</strong> {storageWarning}
        </div>
      )}
      {!isLive && !hasSearched && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <strong className="font-semibold">Demo data:</strong> mock datasets for
          frontend testing. Run a search to load live results from the catalog.
        </div>
      )}
      {isLive && discovery && (
        <div className="rounded-lg border border-teal/40 bg-teal/5 px-4 py-2.5 text-[13px] text-navy" role="status">
          <strong className="font-semibold">
            {showingPreviousResults
              ? "Previous results:"
              : isRestored
                ? "Restored results from a previous search:"
                : "Live results:"}
          </strong>{" "}
          {discovery.recommendations.length} recommendation
          {discovery.recommendations.length === 1 ? "" : "s"} · examined{" "}
          {discovery.catalog_examined}
          {discovery.catalog_total != null ? ` of ${discovery.catalog_total}` : ""} catalog
          records · completeness: {discovery.completeness}
          {isRestored && !showingPreviousResults && (
            <span className="mt-1 block text-xs text-slate">
              Restored from your saved workspace — run a new search for fresh results.
            </span>
          )}
        </div>
      )}
      {discoveryError && (
        <div className="rounded-lg border border-red-300/60 bg-red-50 px-4 py-2.5 text-[13px] text-red-900" role="alert">
          <strong className="font-semibold">Search failed:</strong> {discoveryError}
        </div>
      )}
      {isLive && discovery && discovery.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900" role="alert">
          <strong className="font-semibold">Catalog warning:</strong>
          <ul className="mt-1 list-disc pl-5">
            {discovery.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {discovery.completeness !== "complete" && (
            <p className="mt-1">Catalog search may be incomplete — not every record was examined.</p>
          )}
        </div>
      )}

      <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
        <h1 className="text-xl font-bold tracking-tight text-navy sm:text-2xl">
          Explore Government Data
        </h1>
        <p className="mt-1 text-sm text-slate">
          Describe a research question. MetaFabric AI interprets the mission
          and assembles a traceable dataset selection.
        </p>
        <form onSubmit={handleSearchSubmit} className="mt-4 flex gap-2">
          <label htmlFor="explore-search" className="sr-only">
            Explore Government Data
          </label>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4.5 w-4.5 -translate-y-1/2 text-slate"
              aria-hidden="true"
            />
            <input
              id="explore-search"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="e.g. Which communities face the highest flood risk?"
              className="w-full rounded-md border border-slate/30 bg-white py-2.5 pr-3 pl-10 text-sm text-navy placeholder:text-slate/70 focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none"
            />
          </div>
          <input
            aria-label="Location (optional)"
            type="text"
            value={location}
            onChange={(e) => onLocationChange?.(e.target.value)}
            placeholder="Location (optional)"
            className="w-40 shrink-0 rounded-md border border-slate/30 bg-white px-3 py-2.5 text-sm text-navy placeholder:text-slate/70 focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none"
          />
          <button
            type="submit"
            disabled={discoveryLoading}
            className="shrink-0 rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {discoveryLoading ? "Searching…" : "Search"}
          </button>
          {discoveryLoading && onCancelSearch && (
            <button
              type="button"
              onClick={onCancelSearch}
              className="shrink-0 rounded-md border border-slate/30 px-3 py-2.5 text-sm font-medium text-navy hover:bg-background"
            >
              Cancel
            </button>
          )}
        </form>
        {discoveryLoading && (
          <p className="mt-2 text-[13px] text-slate" role="status">
            Searching the metadata catalog…
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate">Try an example:</span>
          {missions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectMission(m)}
              aria-pressed={mission.id === m.id}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                mission.id === m.id
                  ? "border-teal bg-teal text-white"
                  : "border-slate/30 bg-white text-navy hover:border-teal hover:text-teal"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <Section icon={Crosshair} title="Mission Interpretation">
        {isLive && discovery ? (
          <div>
            <p className="text-sm leading-relaxed text-navy/90">
              {discovery.interpreted_intent || discovery.question}
            </p>
            <p className="mt-2 text-xs text-slate">
              {showingPreviousResults
                ? "Previous live interpretation — the new search failed, so the earlier results are kept."
                : isRestored
                  ? "Restored from your previous search — run a new search for a fresh interpretation."
                  : "Interpreted from your question by the live discovery service."}
            </p>
          </div>
        ) : discoveryLoading && pendingQuery ? (
          <div role="status">
            <p className="text-sm leading-relaxed text-navy/90">
              Interpreting &ldquo;{pendingQuery}&rdquo;
              {pendingLocation ? ` for ${pendingLocation}` : ""}&hellip;
            </p>
            <p className="mt-2 text-xs text-slate">
              The full interpretation arrives with the search results.
            </p>
          </div>
        ) : hasSearched && discoveryError ? (
          <div>
            <p className="text-sm leading-relaxed text-navy/90">
              Search failed &mdash; no interpretation available.
            </p>
            <p className="mt-2 text-xs text-slate">
              Fix the error above and search again.
            </p>
          </div>
        ) : hasSearched ? (
          <div>
            <p className="text-sm leading-relaxed text-navy/90">
              No live interpretation for the current search yet.
            </p>
            <p className="mt-2 text-xs text-slate">
              Run a search to interpret your question.
            </p>
          </div>
        ) : (
        <>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex max-w-full items-start gap-1.5 rounded-md bg-navy px-2.5 py-1.5 text-[13px] font-medium text-white">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="text-white/60">Objective: </span>
              {mission.objective}
            </span>
          </span>
          <span className="inline-flex max-w-full items-start gap-1.5 rounded-md bg-background px-2.5 py-1.5 text-[13px] font-medium text-navy ring-1 ring-slate/20">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" aria-hidden="true" />
            <span>
              <span className="text-slate">Geographic focus: </span>
              {mission.geographicFocus}
            </span>
          </span>
          {mission.informationNeeded.map((need) => (
            <span
              key={need}
              className="inline-flex items-center gap-1.5 rounded-md bg-background px-2.5 py-1.5 text-[13px] text-navy ring-1 ring-slate/20"
            >
              <FileSearch className="h-3.5 w-3.5 shrink-0 text-teal" aria-hidden="true" />
              {need}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate">
          Demo interpretation for the “{mission.label}” example. A live model
          would derive these chips from your question.
        </p>
        </>
        )}
      </Section>

      {!isLive && (
        <Section icon={Sparkles} title="AI Data Fabric Summary">
          <p className="text-sm leading-relaxed text-navy/90">{mission.fabricSummary}</p>
        </Section>
      )}

      <div id="recommended-datasets" className="scroll-mt-4 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-navy">
            <Layers className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
            Recommended Datasets
          </h2>
          <span className="text-[13px] text-slate">
            {isLive
              ? filtersActive
                ? `${filteredTotal} of ${totalRelevant} relevant datasets · showing ${visibleLiveDatasets.length} of ${filteredTotal} · ${selectedIds.size} selected for the recipe`
                : `${totalRelevant} relevant dataset${totalRelevant === 1 ? "" : "s"} · showing ${visibleLiveDatasets.length} of ${totalRelevant} · ${selectedIds.size} selected for the recipe`
              : `${totalVisible} shown · ${selectedIds.size} selected for the recipe`}
          </span>
        </div>

        {isLive && filtersActive && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/5 px-3 py-2" role="status">
            <span className="text-xs font-semibold tracking-wide text-teal uppercase">
              Active filters ({activeFilters.length})
            </span>
            {filterDescriptions.map((chip, index) => (
              <span
                key={`${chip}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-teal/40 bg-white py-0.5 pr-1.5 pl-2.5 text-xs font-medium text-navy"
              >
                {chip}
                {onRemoveFilter && (
                  <button
                    type="button"
                    onClick={() => onRemoveFilter(index)}
                    aria-label={`Remove filter ${index + 1}: ${chip}`}
                    title={`Remove filter ${index + 1}`}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-slate hover:bg-background hover:text-navy"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {onUndoFilter && (
              <button
                type="button"
                onClick={onUndoFilter}
                disabled={!canUndoFilter}
                className="rounded-md border border-slate/30 px-2.5 py-1 text-xs font-medium text-navy hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                Undo Last Filter
              </button>
            )}
            {onClearFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-md border border-slate/30 px-2.5 py-1 text-xs font-medium text-navy hover:bg-background"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {isLive && totalRelevant > 0 && onBulkSelect && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate/20 bg-surface px-3 py-2 shadow-sm">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-navy">
              <input
                type="checkbox"
                checked={allLoadedSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someLoadedSelected;
                }}
                onChange={() => onBulkSelect(loadedIds, !allLoadedSelected)}
                aria-label="Select all displayed datasets"
                className="h-4 w-4 shrink-0 cursor-pointer accent-teal"
              />
              Select all displayed ({loadedIds.length})
            </label>
            <button
              type="button"
              onClick={() => onBulkSelect(loadedIds, false)}
              disabled={loadedSelectedCount === 0}
              className="rounded-md border border-slate/30 px-2.5 py-1 text-xs font-medium text-navy hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deselect all displayed
            </button>
            <span className="text-xs text-slate">
              {loadedSelectedCount} of {loadedIds.length} displayed selected · {selectedIds.size} selected overall
            </span>
          </div>
        )}

        {discoveryLoading && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm" role="status">
            Searching…
          </p>
        )}

        {!discoveryLoading && hasSearched && !isLive && !discoveryError && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm">
            No results yet.
          </p>
        )}

        {!discoveryLoading && hasSearched && !isLive && discoveryError && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm">
            No live results to show. Fix the error above and search again.
          </p>
        )}

        {isLive && !discoveryLoading && liveDatasets.length === 0 && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm">
            {filtersActive && totalRelevant > 0
              ? `No datasets match the active filters. Clear filters or undo to restore all ${totalRelevant} original results.`
              : "No datasets found for this question. Try broader terms or a different location."}
          </p>
        )}

        {isLive && visibleLiveDatasets.length > 0 && (
          <div className="space-y-3">
            {visibleLiveDatasets.map((dataset) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                selected={selectedIds.has(dataset.id)}
                onToggleSelected={onToggleDataset}
              />
            ))}
          </div>
        )}

        {isLive && !discoveryLoading && hasMoreLive && (
          <div className="flex flex-wrap items-center gap-3 px-1">
            <button
              type="button"
              onClick={onLoadMore}
              className="rounded-md border border-teal/50 px-4 py-2 text-sm font-medium text-teal hover:bg-teal/5"
            >
              Load More ({filteredTotal - effectiveVisibleCount} remaining)
            </button>
            <span className="text-[13px] text-slate">
              Showing {visibleLiveDatasets.length} of {filteredTotal} relevant datasets
            </span>
          </div>
        )}

        {!isLive && !hasSearched && visibleGroups.length === 0 && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm">
            No mock datasets match the current source filters and search text.
            Re-enable a source level or clear the search to see more.
          </p>
        )}

        {!isLive && !hasSearched && visibleGroups.map((group) => (
          <div key={group.purpose}>
            <h3 className="px-1 text-sm font-semibold text-navy">{group.purpose}</h3>
            <p className="mt-0.5 px-1 text-[13px] text-slate">{group.purposeNote}</p>
            <div className="mt-2 space-y-3">
              {group.datasets.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  selected={selectedIds.has(dataset.id)}
                  onToggleSelected={onToggleDataset}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {!isLive && !hasSearched && (
      <>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section icon={TriangleAlert} title="Data Gaps and Limitations">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-navy/90">
            {mission.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Section>

        <Section icon={Ban} title="Excluded on Purpose">
          <ul className="space-y-2.5">
            {mission.excluded.map((item) => (
              <li key={item.title} className="text-sm">
                <p className="font-medium text-navy">{item.title}</p>
                <p className="mt-0.5 leading-relaxed text-slate">{item.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section icon={ListOrdered} title="Suggested Analysis Path">
        <ol className="space-y-2">
          {mission.analysisPath.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed text-navy/90">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal/12 text-xs font-bold text-teal">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Suggested only. No GIS or statistical analysis runs in this demo.
        </p>
      </Section>
      </>
      )}

      {largeSelectionWarning && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900" role="status">
          <strong className="font-semibold">Large selection:</strong> {largeSelectionWarning}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-navy px-4 py-4 sm:px-5">
        <ClipboardList className="h-5 w-5 shrink-0 text-white/80" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-white">
          {selectedIds.size > 0
            ? `${selectedIds.size} dataset${selectedIds.size === 1 ? "" : "s"} selected. Review the proposed workflow, gaps, and outputs.`
            : "Select at least one dataset above to build a data recipe."}
        </p>
        <button
          type="button"
          onClick={onGenerateRecipe}
          disabled={selectedIds.size === 0 || recipeLoading}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
        >
          <WandSparkles className="h-4.5 w-4.5" aria-hidden="true" />
          {recipeLoading ? "Generating…" : "Generate Data Recipe"}
        </button>
      </div>
    </div>
  );
}
