import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
} from "lucide-react";
import type { Dataset } from "../types";
import { isValidHttpUrl } from "../services/url";

interface DatasetCardProps {
  dataset: Dataset;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}

export default function DatasetCard({ dataset, selected, onToggleSelected }: DatasetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasValidUrl = isValidHttpUrl(dataset.AccessURL);

  async function handleCopy() {
    if (!dataset.AccessURL || !hasValidUrl) return;
    try {
      await navigator.clipboard.writeText(dataset.AccessURL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article
      className={`rounded-lg border bg-surface p-4 shadow-sm transition-colors ${
        selected ? "border-teal/60" : "border-slate/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(dataset.id)}
          aria-label={`Select ${dataset.title} for the data recipe`}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-teal"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-navy">{dataset.title}</h3>
            {!dataset.isLive && (
              <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[11px] font-semibold text-navy">
                {dataset.sourceLevel}
              </span>
            )}
            {dataset.isLive ? (
              <>
                <span className="rounded bg-teal/15 px-1.5 py-0.5 text-[11px] font-semibold text-teal">
                  Live
                </span>
                {typeof dataset.relevanceScore === "number" && (
                  <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[11px] font-semibold text-navy">
                    Relevance {Math.round(dataset.relevanceScore)}
                  </span>
                )}
              </>
            ) : (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                Mock
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-slate">{dataset.source}</p>
          {dataset.isLive && dataset.assignedId && (
            <p className="mt-0.5 font-mono text-xs break-all text-slate">
              AssignedID: {dataset.assignedId}
            </p>
          )}
          {dataset.isLive && dataset.proposedRole && (
            <p className="mt-1 text-[13px] text-navy/85">
              <span className="font-medium text-navy">Proposed role: </span>
              {dataset.proposedRole}
            </p>
          )}

          <p className="mt-2.5 text-sm leading-relaxed text-navy/85">
            <span className="font-medium text-navy">Why this dataset: </span>
            {dataset.whyRecommended}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              Issued {dataset.metadata.issued}
            </span>
            <span>Modified {dataset.metadata.modified}</span>
            <span>{dataset.metadata.format}</span>
          </div>

          {dataset.qualityWarnings.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {dataset.qualityWarnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-800"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-teal hover:underline"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
            {expanded ? "Hide metadata" : "Show metadata"}
          </button>

          {expanded && (
            <dl className="mt-3 space-y-1.5 rounded-md bg-background p-3 text-[13px]">
              <div>
                <dt className="font-medium text-navy">Description</dt>
                <dd className="mt-0.5 leading-relaxed text-slate">{dataset.description}</dd>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-navy">Temporal coverage</dt>
                  <dd className="text-slate">{dataset.metadata.temporalCoverage}</dd>
                </div>
                <div>
                  <dt className="font-medium text-navy">Spatial coverage</dt>
                  <dd className="text-slate">{dataset.metadata.spatialCoverage}</dd>
                </div>
                <div>
                  <dt className="font-medium text-navy">License</dt>
                  <dd className="text-slate">{dataset.metadata.license}</dd>
                </div>
                <div>
                  <dt className="font-medium text-navy">Format</dt>
                  <dd className="text-slate">{dataset.metadata.format}</dd>
                </div>
              </div>
              <div>
                <dt className="font-medium text-navy">AccessURL</dt>
                <dd className="mt-0.5 font-mono text-xs break-all text-slate">
                  {dataset.AccessURL ?? "— not provided in source metadata —"}
                </dd>
              </div>
            </dl>
          )}

          <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-slate/15 pt-3">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-[11px] font-semibold tracking-wide text-slate uppercase">
                AccessURL
              </p>
              <p className="mt-0.5 font-mono text-xs break-all text-navy/80">
                {dataset.AccessURL ?? "Not provided"}
              </p>
              {!hasValidUrl && (
                <p className="mt-1 text-xs text-amber-800">
                  {dataset.AccessURL
                    ? "Invalid URL — links disabled."
                    : "Missing URL — links disabled."}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {hasValidUrl ? (
                <a
                  href={dataset.AccessURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-teal px-3 py-2 text-[13px] font-medium text-white hover:bg-teal/90"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open Dataset
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md bg-slate/25 px-3 py-2 text-[13px] font-medium text-slate"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open Dataset
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                disabled={!hasValidUrl}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate/30 px-3 py-2 text-[13px] font-medium text-navy enabled:hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-teal" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy URL"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
