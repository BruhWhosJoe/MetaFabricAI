import {
  ArrowLeft,
  ExternalLink,
  FileOutput,
  Info,
  ListOrdered,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Dataset, Mission } from "../types";
import { isValidHttpUrl } from "../services/url";

interface DataRecipePageProps {
  mission: Mission;
  selectedDatasets: Dataset[];
  onRemoveDataset: (id: string) => void;
  onBackToWorkspace: () => void;
}

export default function DataRecipePage({
  mission,
  selectedDatasets,
  onRemoveDataset,
  onBackToWorkspace,
}: DataRecipePageProps) {
  const limitations = Array.from(
    new Set(selectedDatasets.flatMap((d) => d.qualityWarnings)),
  );

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-teal hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Research Workspace
        </button>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-navy sm:text-2xl">
          Data Recipe
        </h1>
        <p className="mt-1 text-sm text-slate">
          Mission: {mission.objective} · {mission.geographicFocus}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-slate">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Demo recipe built from mock datasets. No GIS analysis is performed.
        </p>
      </div>

      <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="text-[15px] font-semibold text-navy">
          Selected Datasets ({selectedDatasets.length})
        </h2>
        {selectedDatasets.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-slate">
            Nothing selected yet. Return to the workspace and tick the
            checkbox on any recommended dataset to add it here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate/12">
            {selectedDatasets.map((dataset) => {
              const hasValidUrl = isValidHttpUrl(dataset.AccessURL);
              return (
                <li key={dataset.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">{dataset.title}</p>
                    <p className="mt-0.5 text-[13px] text-slate">
                      {dataset.source} · {dataset.sourceLevel} · Modified{" "}
                      {dataset.metadata.modified}
                    </p>
                    <p className="mt-1 font-mono text-xs break-all text-slate">
                      AccessURL: {dataset.AccessURL ?? "Not provided"}
                    </p>
                  </div>
                  {hasValidUrl ? (
                    <a
                      href={dataset.AccessURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal/50 px-2.5 py-1.5 text-xs font-medium text-teal hover:bg-teal/5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open
                    </a>
                  ) : (
                    <span className="shrink-0 rounded-md bg-slate/15 px-2.5 py-1.5 text-xs font-medium text-slate">
                      No valid URL
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveDataset(dataset.id)}
                    aria-label={`Remove ${dataset.title} from the recipe`}
                    className="shrink-0 rounded-md p-1.5 text-slate hover:bg-background hover:text-navy"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy">
          <ListOrdered className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
          Proposed Workflow
        </h2>
        <ol className="mt-3 space-y-2">
          {mission.analysisPath.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed text-navy/90">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal/12 text-xs font-bold text-teal">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy">
            <TriangleAlert className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
            Data Gaps
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-navy/90">
            {mission.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="text-[15px] font-semibold text-navy">
            Limitations from Selected Datasets
          </h2>
          {limitations.length === 0 ? (
            <p className="mt-3 text-sm text-slate">
              No quality warnings on the currently selected datasets.
            </p>
          ) : (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-navy/90">
              {limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy">
          <FileOutput className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
          Potential Outputs
        </h2>
        <ul className="mt-3 space-y-1.5">
          {mission.potentialOutputs.map((output) => (
            <li key={output} className="flex items-start gap-2 text-sm text-navy/90">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal" aria-hidden="true" />
              {output}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-slate">
          Planned outputs only — nothing is generated or analyzed in this demo.
        </p>
      </section>
    </div>
  );
}
