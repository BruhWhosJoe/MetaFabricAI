export type SourceLevel = "Federal" | "State" | "Local";

export type AppTab = "dashboard" | "recipe";

export type SidebarNav = "dashboard" | "datasets" | "saved";

export interface DatasetMetadata {
  issued: string;
  modified: string;
  temporalCoverage: string;
  spatialCoverage: string;
  format: string;
  license: string;
}

export interface Dataset {
  id: string;
  title: string;
  source: string;
  sourceLevel: SourceLevel;
  description: string;
  whyRecommended: string;
  /** Exact metadata field name shown in the UI. May be missing or invalid in mock data. */
  AccessURL?: string;
  metadata: DatasetMetadata;
  qualityWarnings: string[];
  /** Live-backend fields (Step 11); absent for demo/mock datasets. */
  relevanceScore?: number;
  proposedRole?: string;
  assignedId?: string;
  isLive?: boolean;
}

export interface DatasetGroup {
  purpose: string;
  purposeNote: string;
  datasetIds: string[];
}

export interface ExcludedItem {
  title: string;
  reason: string;
}

export interface Mission {
  id: string;
  label: string;
  query: string;
  objective: string;
  geographicFocus: string;
  informationNeeded: string[];
  fabricSummary: string;
  groups: DatasetGroup[];
  defaultSelectedIds: string[];
  gaps: string[];
  excluded: ExcludedItem[];
  analysisPath: string[];
  potentialOutputs: string[];
}
