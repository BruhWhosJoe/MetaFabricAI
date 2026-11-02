import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Bot,
  MessageSquarePlus,
  PanelRightClose,
  RotateCcw,
  Search,
  Send,
  User,
} from "lucide-react";
import type { AssistantMessage } from "../services/assistant";

interface CatalogOffer {
  query: string;
  resultCount: number | null;
}

interface AIAssistantProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  messages: AssistantMessage[];
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  unavailableMessage: string | null;
  contextSummary: string;
  catalogOffer: CatalogOffer | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  onNewConversation: () => void;
  onSearchCatalog: (query: string) => void;
  onAdoptCatalogResults: () => void;
}

const QUICK_PROMPTS = [
  "Summarize the top datasets",
  "Which datasets have AccessURLs?",
  "Remove weakly relevant recommendations",
];

export default function AIAssistant({
  collapsed,
  onToggleCollapsed,
  messages,
  loading,
  error,
  unavailable,
  unavailableMessage,
  contextSummary,
  catalogOffer,
  onSend,
  onRetry,
  onNewConversation,
  onSearchCatalog,
  onAdoptCatalogResults,
}: AIAssistantProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || loading || unavailable) return;
    setDraft("");
    onSend(text);
  }

  if (collapsed) {
    return (
      <aside className="flex min-w-0 flex-col items-center rounded-lg border border-slate/20 bg-surface py-3 shadow-sm lg:sticky lg:top-4 lg:self-start">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand AI assistant"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-navy text-white hover:bg-navy/90"
        >
          <Bot className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="mt-2 hidden text-[11px] font-medium text-slate [writing-mode:vertical-rl] lg:block">
          AI Assistant
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex min-w-0 flex-col rounded-lg border border-slate/20 bg-surface shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-6.5rem)] lg:self-start">
      <div className="flex items-center gap-2 border-b border-slate/15 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-navy text-white">
          <Bot className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-sm font-semibold text-navy">AI Assistant</h2>
          <p className="text-xs text-slate">Conversational refinements</p>
        </div>
        {unavailable ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
            Unavailable
          </span>
        ) : (
          <span className="rounded bg-teal/15 px-1.5 py-0.5 text-[11px] font-semibold text-teal">
            Live
          </span>
        )}
        <button
          type="button"
          onClick={onNewConversation}
          aria-label="Start a new conversation"
          title="Start a new conversation"
          className="rounded-md p-1.5 text-slate hover:bg-background hover:text-navy"
        >
          <MessageSquarePlus className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse AI assistant"
          className="rounded-md p-1.5 text-slate hover:bg-background hover:text-navy"
        >
          <PanelRightClose className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </div>

      {contextSummary && (
        <p className="border-b border-slate/15 px-4 py-2 text-xs leading-relaxed text-slate">
          {contextSummary}
        </p>
      )}

      {unavailable && (
        <div className="border-b border-red-300/60 bg-red-50 px-4 py-2.5 text-[13px] text-red-900" role="alert">
          <strong className="font-semibold">Assistant unavailable:</strong>{" "}
          {unavailableMessage ?? "The backend assistant service could not be reached."}{" "}
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      <div ref={logRef} className="min-h-48 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((message) =>
          message.role === "assistant" ? (
            <div key={message.id} className="flex gap-2">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <div className="min-w-0">
                <p className="mt-0.5 text-[13px] leading-relaxed text-navy/90">{message.text}</p>
                {message.referencedIds && message.referencedIds.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] break-all text-slate">
                    {message.referencedIds.map((id) => `AssignedID: ${id}`).join(" · ")}
                  </p>
                )}
                {message.filterNotice && (
                  <p className="mt-1 text-xs leading-relaxed text-teal">{message.filterNotice}</p>
                )}
              </div>
            </div>
          ) : (
            <div key={message.id} className="flex gap-2">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-slate" aria-hidden="true" />
              <p className="min-w-0 text-[13px] leading-relaxed font-medium text-navy">
                {message.text}
              </p>
            </div>
          ),
        )}
        {loading && (
          <div className="flex gap-2" role="status">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
            <p className="text-[13px] text-slate">Thinking…</p>
          </div>
        )}
      </div>

      {error && !unavailable && (
        <div className="border-t border-red-300/60 bg-red-50 px-4 py-2.5 text-[13px] text-red-900" role="alert">
          <strong className="font-semibold">Assistant error:</strong> {error}{" "}
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {catalogOffer && !loading && (
        <div className="border-t border-teal/40 bg-teal/5 px-4 py-2.5 text-[13px] text-navy">
          {catalogOffer.resultCount !== null ? (
            <p>
              <strong className="font-semibold">
                Found {catalogOffer.resultCount} additional dataset
                {catalogOffer.resultCount === 1 ? "" : "s"} in the catalog.
              </strong>{" "}
              <button
                type="button"
                onClick={onAdoptCatalogResults}
                className="font-medium text-teal hover:underline"
              >
                Show in workspace
              </button>
            </p>
          ) : (
            <p>
              This question may need datasets beyond the current results.{" "}
              <button
                type="button"
                onClick={() => onSearchCatalog(catalogOffer.query)}
                className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                Search catalog for &ldquo;{catalogOffer.query}&rdquo;
              </button>
            </p>
          )}
        </div>
      )}

      <div className="border-t border-slate/15 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate uppercase">
          Refine this search
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (!loading && !unavailable) onSend(label);
              }}
              disabled={loading || unavailable}
              className="inline-flex items-center gap-1 rounded-full border border-teal/40 px-2.5 py-1 text-xs font-medium text-teal hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Ask for a refinement
          </label>
          <input
            id="assistant-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about datasets or refine results…"
            disabled={loading || unavailable}
            className="min-w-0 flex-1 rounded-md border border-slate/30 bg-white px-3 py-2 text-sm text-navy placeholder:text-slate/70 focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send refinement"
            disabled={loading || unavailable}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal text-white hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  );
}
