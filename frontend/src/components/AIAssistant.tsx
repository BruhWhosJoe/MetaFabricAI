import { useState } from "react";
import type { FormEvent } from "react";
import { Bot, ChevronRight, PanelRightClose, Send, User } from "lucide-react";
import type { Mission } from "../types";

interface AIAssistantProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mission: Mission;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

const QUICK_REFINEMENTS = [
  "Narrow to county level",
  "Federal sources only",
  "Exclude preliminary data",
];

let nextId = 3;

export default function AIAssistant({ collapsed, onToggleCollapsed, mission }: AIAssistantProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      text: `I read your question as: "${mission.objective}" for ${mission.geographicFocus}. The workspace shows a demo interpretation and mock datasets — tell me how to narrow it.`,
    },
    {
      id: 2,
      role: "assistant",
      text: "Try a refinement below, or type your own. Replies here are canned demo responses, not a live model.",
    },
  ]);

  function addRefinement(text: string) {
    const userMessage: Message = { id: nextId++, role: "user", text };
    const reply: Message = {
      id: nextId++,
      role: "assistant",
      text: `Noted: "${text}". In the live product this would re-run dataset discovery and update the groups, gaps, and recipe. In this demo the workspace stays unchanged.`,
    };
    setMessages((prev) => [...prev, userMessage, reply]);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    addRefinement(text);
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
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
          Demo
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse AI assistant"
          className="rounded-md p-1.5 text-slate hover:bg-background hover:text-navy"
        >
          <PanelRightClose className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-48 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((message) =>
          message.role === "assistant" ? (
            <div key={message.id} className="flex gap-2">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-teal uppercase">
                  Demo response
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-navy/90">{message.text}</p>
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
      </div>

      <div className="border-t border-slate/15 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wide text-slate uppercase">
          Refine this search
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_REFINEMENTS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => addRefinement(label)}
              className="inline-flex items-center gap-1 rounded-full border border-teal/40 px-2.5 py-1 text-xs font-medium text-teal hover:bg-teal/5"
            >
              {label}
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
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
            placeholder="Ask for a refinement…"
            className="min-w-0 flex-1 rounded-md border border-slate/30 bg-white px-3 py-2 text-sm text-navy placeholder:text-slate/70 focus:border-teal focus:ring-2 focus:ring-teal/30 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send refinement"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal text-white hover:bg-teal/90"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  );
}
