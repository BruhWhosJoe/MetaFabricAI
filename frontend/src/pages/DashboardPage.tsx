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

interface DashboardPageProps {
  missions: Mission[];
  mission: Mission;
  onSelectMission: (mission: Mission) => void;
  query: string;
  onQueryChange: (value: string) => void;
  sourceLevels: Set<SourceLevel>;
  selectedIds: Set<string>;
  onToggleDataset: (id: string) => void;
  onGenerateRecipe: () => void;
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
  sourceLevels,
  selectedIds,
  onToggleDataset,
  onGenerateRecipe,
}: DashboardPageProps) {
  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const match = missions.find(
      (m) => m.label.toLowerCase() === query.trim().toLowerCase(),
    );
    if (match) onSelectMission(match);
  }

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

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
        <strong className="font-semibold">Demo data:</strong> mock datasets for
        frontend testing. These are not live MCP results, and no Azure MCP or
        Meta Model API is connected.
      </div>

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
          <button
            type="submit"
            className="shrink-0 rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white hover:bg-navy/90"
          >
            Search
          </button>
        </form>

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
      </Section>

      <Section icon={Sparkles} title="AI Data Fabric Summary">
        <p className="text-sm leading-relaxed text-navy/90">{mission.fabricSummary}</p>
      </Section>

      <div id="recommended-datasets" className="scroll-mt-4 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-navy">
            <Layers className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
            Recommended Datasets
          </h2>
          <span className="text-[13px] text-slate">
            {totalVisible} shown · {selectedIds.size} selected for the recipe
          </span>
        </div>

        {visibleGroups.length === 0 && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm">
            No mock datasets match the current source filters and search text.
            Re-enable a source level or clear the search to see more.
          </p>
        )}

        {visibleGroups.map((group) => (
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
          disabled={selectedIds.size === 0}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
        >
          <WandSparkles className="h-4.5 w-4.5" aria-hidden="true" />
          Generate Data Recipe
        </button>
      </div>
    </div>
  );
}
