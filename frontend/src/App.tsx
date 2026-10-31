import { useMemo, useState } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import AIAssistant from "./components/AIAssistant";
import DashboardPage from "./pages/DashboardPage";
import DataRecipePage from "./pages/DataRecipePage";
import { defaultMission, missions } from "./data/missions";
import { getDatasetById, mockDatasets } from "./data/datasets";
import type { AppTab, Dataset, Mission, SidebarNav, SourceLevel } from "./types";

const ALL_LEVELS: SourceLevel[] = ["Federal", "State", "Local"];

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [activeNav, setActiveNav] = useState<SidebarNav>("dashboard");
  const [mission, setMission] = useState<Mission>(defaultMission);
  const [query, setQuery] = useState(defaultMission.query);
  const [sourceLevels, setSourceLevels] = useState<Set<SourceLevel>>(
    () => new Set(ALL_LEVELS),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(defaultMission.defaultSelectedIds),
  );
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);

  const countsByLevel = useMemo(() => {
    const counts: Record<SourceLevel, number> = { Federal: 0, State: 0, Local: 0 };
    for (const dataset of mockDatasets) counts[dataset.sourceLevel] += 1;
    return counts;
  }, []);

  const selectedDatasets = useMemo(
    () =>
      [...selectedIds]
        .map(getDatasetById)
        .filter((d): d is Dataset => d !== undefined),
    [selectedIds],
  );

  function handleSelectMission(next: Mission) {
    setMission(next);
    setQuery(next.query);
    setSelectedIds(new Set(next.defaultSelectedIds));
    setActiveTab("dashboard");
    setActiveNav("dashboard");
  }

  function handleToggleDataset(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        />

        {activeTab === "dashboard" ? (
          <DashboardPage
            missions={missions}
            mission={mission}
            onSelectMission={handleSelectMission}
            query={query}
            onQueryChange={setQuery}
            sourceLevels={sourceLevels}
            selectedIds={selectedIds}
            onToggleDataset={handleToggleDataset}
            onGenerateRecipe={() => handleTabChange("recipe")}
          />
        ) : (
          <DataRecipePage
            mission={mission}
            selectedDatasets={selectedDatasets}
            onRemoveDataset={handleToggleDataset}
            onBackToWorkspace={() => handleTabChange("dashboard")}
          />
        )}

        <div className="grid-assistant min-w-0">
          <AIAssistant
            collapsed={assistantCollapsed}
            onToggleCollapsed={() => setAssistantCollapsed((v) => !v)}
            mission={mission}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
