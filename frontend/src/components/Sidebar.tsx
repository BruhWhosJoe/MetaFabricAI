import { Bookmark, Database, LayoutDashboard } from "lucide-react";
import type { SidebarNav, SourceLevel } from "../types";

interface SidebarProps {
  activeNav: SidebarNav;
  onNavigate: (nav: SidebarNav) => void;
  sourceLevels: Set<SourceLevel>;
  onToggleSourceLevel: (level: SourceLevel) => void;
  countsByLevel: Record<SourceLevel, number>;
  selectedCount: number;
}

const NAV_ITEMS: { id: SidebarNav; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "datasets", label: "Datasets", icon: Database },
  { id: "saved", label: "Saved Recipes", icon: Bookmark },
];

const LEVELS: SourceLevel[] = ["Federal", "State", "Local"];

export default function Sidebar({
  activeNav,
  onNavigate,
  sourceLevels,
  onToggleSourceLevel,
  countsByLevel,
  selectedCount,
}: SidebarProps) {
  return (
    <aside className="min-w-0 rounded-lg border border-slate/20 bg-surface p-4 shadow-sm lg:sticky lg:top-4 lg:self-start">
      <nav aria-label="Workspace" className="space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={activeNav === id ? "page" : undefined}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeNav === id
                ? "bg-navy text-white"
                : "text-navy hover:bg-background"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
            {id === "saved" && selectedCount > 0 && (
              <span
                className={`ml-auto rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  activeNav === id ? "bg-white/20" : "bg-teal/15 text-teal"
                }`}
              >
                {selectedCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="mt-6 border-t border-slate/15 pt-4">
        <h2 className="px-1 text-xs font-semibold tracking-wide text-slate uppercase">
          Data sources
        </h2>
        <div className="mt-2 space-y-1">
          {LEVELS.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-navy hover:bg-background"
            >
              <input
                type="checkbox"
                checked={sourceLevels.has(level)}
                onChange={() => onToggleSourceLevel(level)}
                className="h-4 w-4 shrink-0 accent-teal"
              />
              <span className="flex-1">{level}</span>
              <span className="text-xs text-slate">{countsByLevel[level]}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 px-1 text-xs leading-relaxed text-slate">
          Filters apply to the recommended datasets in the workspace.
        </p>
      </div>
    </aside>
  );
}
