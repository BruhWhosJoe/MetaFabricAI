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
import type { DataRecipeResponse } from "../services/api";

interface DataRecipePageProps {
  mission: Mission;
  selectedDatasets: Dataset[];
  onRemoveDataset: (id: string) => void;
  onBackToWorkspace: () => void;
  recipe?: DataRecipeResponse | null;
  recipeLoading?: boolean;
  recipeError?: string | null;
  recipeAttempted?: boolean;
  onGenerateRecipe?: () => void;
}

function ListSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-[15px] font-semibold text-navy">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate">{empty}</p>
      ) : (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-navy/90">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DataRecipePage({
  mission,
  selectedDatasets,
  onRemoveDataset,
  onBackToWorkspace,
  recipe = null,
  recipeLoading = false,
  recipeError = null,
  recipeAttempted = false,
  onGenerateRecipe,
}: DataRecipePageProps) {
  const limitations = Array.from(
    new Set(selectedDatasets.flatMap((d) => d.qualityWarnings)),
  );

  if (recipeLoading || recipeError || recipe) {
    const sortedSteps = recipe
      ? [...recipe.workflow_steps].sort((a, b) => a.order - b.order)
      : [];
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
          <h1 className="mt-2 text-xl font-bold tracking-tight text-navy sm:text-2xl">Data Recipe</h1>
          {recipe && (
            <>
              <p className="mt-1 text-sm text-slate">{recipe.question}</p>
              <p className="mt-2">
                <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                  Proposed — not executed (status: {recipe.status})
                </span>{" "}
                <span className="text-xs text-slate">
                  analysis_performed: {String(recipe.analysis_performed)} · Recipe {recipe.recipe_id}
                </span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate">
                This is a proposed workflow only. No geospatial or statistical analysis has been performed.
              </p>
            </>
          )}
        </div>

        {recipeLoading && (
          <p className="rounded-lg border border-slate/20 bg-surface px-4 py-6 text-sm text-slate shadow-sm" role="status">
            Generating data recipe…
          </p>
        )}
        {recipeError && (
          <div className="rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
            <strong className="font-semibold">Recipe generation failed:</strong> {recipeError}
          </div>
        )}

        {recipe && (
          <>
            <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
              <h2 className="text-[15px] font-semibold text-navy">Analytical Objective</h2>
              <p className="mt-2 text-sm leading-relaxed text-navy/90">{recipe.analytical_objective}</p>
            </section>

            <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
              <h2 className="text-[15px] font-semibold text-navy">
                Selected Datasets ({recipe.selected_datasets.length})
              </h2>
              <ul className="mt-3 divide-y divide-slate/12">
                {recipe.selected_datasets.map((ds) => {
                  const hasValidUrl = isValidHttpUrl(ds.access_url ?? undefined);
                  return (
                    <li key={ds.AssignedID} className="flex items-start gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-navy">{ds.title ?? ds.AssignedID}</p>
                        <p className="mt-0.5 font-mono text-xs break-all text-slate">AssignedID: {ds.AssignedID}</p>
                        <p className="mt-0.5 text-[13px] text-slate">{ds.source_portal ?? "Unknown source portal"}</p>
                        {ds.role && (
                          <p className="mt-1 text-[13px] text-navy/85">
                            <span className="font-medium">Role: </span>
                            {ds.role}
                            {ds.role_explanation ? ` — ${ds.role_explanation}` : ""}
                          </p>
                        )}
                        {(ds.description ?? ds.summary) && (
                          <p className="mt-1 text-[13px] leading-relaxed text-slate">{ds.description ?? ds.summary}</p>
                        )}
                        {ds.limitations.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                            {ds.limitations.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 font-mono text-xs break-all text-slate">
                          AccessURL: {ds.access_url ?? "Not provided"}
                        </p>
                      </div>
                      {hasValidUrl ? (
                        <a
                          href={ds.access_url ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal/50 px-2.5 py-1.5 text-xs font-medium text-teal hover:bg-teal/5"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          Open
                        </a>
                      ) : (
                        <span className="shrink-0 rounded-md bg-slate/15 px-2.5 py-1.5 text-xs font-medium text-slate">No valid URL</span>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveDataset(ds.AssignedID)}
                        aria-label={`Remove ${ds.title ?? ds.AssignedID} from the recipe`}
                        className="shrink-0 rounded-md p-1.5 text-slate hover:bg-background hover:text-navy"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate">
                Currently selected: {selectedDatasets.length}. Adjust selections in the workspace, then regenerate.
              </p>
            </section>

            <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
              <h2 className="text-[15px] font-semibold text-navy">Dataset Relationships</h2>
              {recipe.relationships.length === 0 ? (
                <p className="mt-3 text-sm text-slate">No relationships proposed.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recipe.relationships.map((rel) => (
                    <li key={rel.relationship_id} className="text-sm leading-relaxed text-navy/90">
                      <span className="font-mono text-xs">{rel.source_dataset_id}</span>
                      {" → "}
                      <span className="font-mono text-xs">{rel.target_dataset_id}</span>
                      {` (${rel.relationship_type}, ${rel.basis})`}
                      {rel.description ? `: ${rel.description}` : ""}
                      {rel.verification_needed.length > 0 && (
                        <span className="block text-xs text-slate">
                          Verification needed: {rel.verification_needed.join("; ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-slate/20 bg-surface p-4 shadow-sm sm:p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy">
                <ListOrdered className="h-4.5 w-4.5 text-teal" aria-hidden="true" />
                Proposed Workflow
              </h2>
              <ol className="mt-3 space-y-2">
                {sortedSteps.map((step) => (
                  <li key={step.step_id} className="flex gap-3 text-sm leading-relaxed text-navy/90">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal/12 text-xs font-bold text-teal">
                      {step.order}
                    </span>
                    <span className="pt-0.5">
                      <span className="font-medium">{step.title || step.operation}</span>
                      {step.operation && step.title !== step.operation ? ` (${step.operation})` : ""}
                      {step.explanation ? ` — ${step.explanation}` : ""}
                      {step.input_dataset_ids.length > 0 && (
                        <span className="block text-xs text-slate">Datasets: {step.input_dataset_ids.join(", ")}</span>
                      )}
                      {step.input_step_ids.length > 0 && (
                        <span className="block text-xs text-slate">After steps: {step.input_step_ids.join(", ")}</span>
                      )}
                      {step.proposed_output && (
                        <span className="block text-xs text-slate">Proposed output: {step.proposed_output}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <ListSection title="Expected Outputs" items={recipe.expected_outputs} empty="No expected outputs proposed." />
              <ListSection title="Data Gaps" items={recipe.data_gaps} empty="No data gaps reported." />
              <ListSection title="Assumptions" items={recipe.assumptions} empty="No assumptions reported." />
              <ListSection title="Limitations" items={recipe.limitations} empty="No limitations reported." />
              <ListSection title="Uncertainties" items={recipe.uncertainties} empty="No uncertainties reported." />
              <ListSection title="Warnings" items={recipe.warnings} empty="No warnings reported." />
            </div>
          </>
        )}

        {onGenerateRecipe && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-navy px-4 py-4 sm:px-5">
            <p className="min-w-0 flex-1 text-sm text-white">
              {selectedDatasets.length} dataset{selectedDatasets.length === 1 ? "" : "s"} currently selected.
            </p>
            <button
              type="button"
              onClick={onGenerateRecipe}
              disabled={recipeLoading || selectedDatasets.length === 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
            >
              {recipeLoading ? "Generating…" : recipe ? "Regenerate Data Recipe" : "Generate Data Recipe"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Demo / pre-generation view (preserved from Step 7). Only shown when no
  // live generation has been attempted.
  void recipeAttempted;

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

      {onGenerateRecipe && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-navy px-4 py-4 sm:px-5">
          <p className="min-w-0 flex-1 text-sm text-white">
            Generate a live proposed recipe from the {selectedDatasets.length} selected dataset
            {selectedDatasets.length === 1 ? "" : "s"}.
          </p>
          <button
            type="button"
            onClick={onGenerateRecipe}
            disabled={selectedDatasets.length === 0}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
          >
            Generate Data Recipe
          </button>
        </div>
      )}
    </div>
  );
}
