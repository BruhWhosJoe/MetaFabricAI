import { Database } from "lucide-react";
import type { AppTab } from "../types";

interface HeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  selectedCount: number;
}

export default function Header({ activeTab, onTabChange, selectedCount }: HeaderProps) {
  const tabClass = (tab: AppTab) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      activeTab === tab
        ? "bg-teal text-white"
        : "text-white/75 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <header className="bg-navy text-white">
      <div className="flex min-h-16 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal">
            <Database className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-base font-semibold tracking-tight">MetaFabric AI</p>
            <p className="text-xs text-white/65">Government Open Data Intelligence</p>
          </div>
        </div>

        <nav aria-label="Primary" className="ml-auto flex items-center gap-2">
          <button type="button" className={tabClass("dashboard")} onClick={() => onTabChange("dashboard")}>
            Research Workspace
          </button>
          <button type="button" className={tabClass("recipe")} onClick={() => onTabChange("recipe")}>
            Data Recipe
            {selectedCount > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-semibold">
                {selectedCount}
              </span>
            )}
          </button>
          <span className="ml-1 hidden rounded border border-amber-300/50 bg-amber-400/15 px-2 py-1 text-xs font-medium text-amber-200 md:inline-block">
            Demo data
          </span>
        </nav>
      </div>
    </header>
  );
}
