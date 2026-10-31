import type { Dataset } from "../types";

/**
 * Mock datasets for frontend testing only.
 * These are clearly labeled demo records — NOT live MCP results.
 */
export const mockDatasets: Dataset[] = [
  {
    id: "fema-nfhl",
    title: "National Flood Hazard Layer (NFHL)",
    source: "FEMA — Federal Emergency Management Agency",
    sourceLevel: "Federal",
    description:
      "Official flood hazard data including flood insurance rate map zones, base flood elevations, and floodway boundaries.",
    whyRecommended:
      "Authoritative national flood-hazard footprint. Use it as the hazard layer every other dataset is compared against.",
    AccessURL: "https://www.fema.gov/flood-maps",
    metadata: {
      issued: "2015-06-01",
      modified: "2026-08-14",
      temporalCoverage: "1974 / present (rolling updates)",
      spatialCoverage: "United States (participating NFIP communities)",
      format: "Geodatabase, WMS, Shapefile",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: [
      "Some counties still reference preliminary (unadopted) maps",
      "Coverage gaps exist in non-participating communities",
    ],
  },
  {
    id: "usgs-nhd",
    title: "National Hydrography Dataset (NHD)",
    source: "USGS — U.S. Geological Survey",
    sourceLevel: "Federal",
    description:
      "Surface-water features — rivers, streams, lakes, and watersheds — used to trace how water moves across terrain.",
    whyRecommended:
      "Shows drainage pathways and upstream watersheds so flood extent can be interpreted, not just mapped.",
    AccessURL: "https://www.usgs.gov/national-hydrography",
    metadata: {
      issued: "2000-01-01",
      modified: "2026-07-30",
      temporalCoverage: "2000 / present",
      spatialCoverage: "United States",
      format: "Geodatabase, WFS",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: ["Flowline density varies by state vintage"],
  },
  {
    id: "census-acs",
    title: "American Community Survey (ACS) 5-Year Estimates",
    source: "U.S. Census Bureau",
    sourceLevel: "Federal",
    description:
      "Demographic and socioeconomic estimates at tract and block-group level, including income, age, and housing tenure.",
    whyRecommended:
      "Identifies who lives inside hazard areas. Tract-level income and age fields support a basic exposure profile.",
    AccessURL: "https://www.census.gov/programs-surveys/acs",
    metadata: {
      issued: "2024-12-12",
      modified: "2025-12-11",
      temporalCoverage: "2020 / 2024 (5-year pooled)",
      spatialCoverage: "United States, Puerto Rico",
      format: "CSV, API, Shapefile (TIGER/Line)",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: [
      "5-year pooled estimates lag recent development",
      "Margins of error are large for small block groups",
    ],
  },
  {
    id: "tx-glo-flood",
    title: "Texas State Flood Plan — Regional Flood Data",
    source: "Texas General Land Office / TWDB",
    sourceLevel: "State",
    description:
      "State-compiled regional flood planning data, including flood mitigation project inventories for Texas regions.",
    whyRecommended:
      "Adds state planning context the federal layers miss, including funded mitigation projects by region.",
    AccessURL: "https://www.glo.texas.gov",
    metadata: {
      issued: "2023-09-01",
      modified: "2026-05-20",
      temporalCoverage: "2023 / 2028 (planning cycle)",
      spatialCoverage: "Texas (15 flood planning regions)",
      format: "GeoJSON, CSV, PDF reports",
      license: "Texas Public Information Act",
    },
    qualityWarnings: ["Regional submissions use inconsistent schemas"],
  },
  {
    id: "harris-hcfcd",
    title: "Harris County Flood Warning System — Rainfall & Stream Gauges",
    source: "Harris County Flood Control District",
    sourceLevel: "Local",
    description:
      "Near-real-time rainfall and stream-level gauge observations across Harris County bayous and watersheds.",
    whyRecommended:
      "Local gauge history grounds the federal hazard maps in observed events for the Houston metro area.",
    AccessURL: "https://www.hcfcd.org",
    metadata: {
      issued: "2019-03-15",
      modified: "2026-10-29",
      temporalCoverage: "2019 / present (15-minute intervals)",
      spatialCoverage: "Harris County, Texas",
      format: "API, CSV",
      license: "Public (attribution requested)",
    },
    qualityWarnings: [
      "Gauge outages occur during severe storms",
      "No coverage outside Harris County",
    ],
  },
  {
    id: "fema-deprecated-demo",
    title: "Legacy County Floodplain Parcels (Demo Record)",
    source: "County Open Data Portal (mock)",
    sourceLevel: "Local",
    description:
      "Demo record included to show how MetaFabric AI handles a missing AccessURL. This is not a real dataset listing.",
    whyRecommended:
      "Demonstrates the disabled-link state when source metadata has no usable AccessURL.",
    metadata: {
      issued: "2018-01-01",
      modified: "2021-04-02",
      temporalCoverage: "2018 / 2021",
      spatialCoverage: "Single county (unspecified)",
      format: "Shapefile",
      license: "Unknown — verify before use",
    },
    qualityWarnings: [
      "AccessURL missing from source metadata",
      "Not updated since 2021 — treat as stale",
    ],
  },
  {
    id: "cdc-places",
    title: "PLACES: Local Data for Better Health",
    source: "CDC — Centers for Disease Control and Prevention",
    sourceLevel: "Federal",
    description:
      "Census-tract health measures including chronic disease prevalence, preventive services, and health behaviors.",
    whyRecommended:
      "Core population-health layer. Tract-level prevalence supports place-based comparison without patient-level data.",
    AccessURL: "https://www.cdc.gov/places",
    metadata: {
      issued: "2020-12-08",
      modified: "2026-06-18",
      temporalCoverage: "2022 / 2024 (model-based estimates)",
      spatialCoverage: "United States (census tracts)",
      format: "CSV, API, GIS files",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: [
      "Model-based small-area estimates, not direct counts",
      "Suppressed where population is very small",
    ],
  },
  {
    id: "epa-ejscreen",
    title: "EJScreen — Environmental Justice Screening",
    source: "EPA — Environmental Protection Agency",
    sourceLevel: "Federal",
    description:
      "Environmental and demographic indicators combining pollution burden with population characteristics by block group.",
    whyRecommended:
      "Pairs exposure indicators with demographics so health findings can be checked for unequal burden.",
    AccessURL: "https://www.epa.gov/ejscreen",
    metadata: {
      issued: "2015-06-01",
      modified: "2026-04-22",
      temporalCoverage: "2018 / 2024 (indicator dependent)",
      spatialCoverage: "United States",
      format: "CSV, Geodatabase, Web service",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: ["Indicator vintages differ within one release"],
  },
  {
    id: "hrsa-shortage",
    title: "Health Professional Shortage Areas (HPSA)",
    source: "HRSA — Health Resources & Services Administration",
    sourceLevel: "Federal",
    description:
      "Designated shortage areas for primary care, dental, and mental health by geography and population group.",
    whyRecommended:
      "Shows where provider supply is already thin, which changes how prevalence data should be interpreted.",
    AccessURL: "https://www.hrsa.gov",
    metadata: {
      issued: "2016-10-01",
      modified: "2026-09-30",
      temporalCoverage: "2016 / present (designation cycle)",
      spatialCoverage: "United States and territories",
      format: "CSV, API",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: ["Designations update on application cycles, not continuously"],
  },
  {
    id: "state-health-demo",
    title: "State Hospital Discharge Summary (Demo Record)",
    source: "State Department of Health (mock)",
    sourceLevel: "State",
    description:
      "Demo record with a malformed AccessURL to show validation behavior. This is not a real dataset listing.",
    whyRecommended:
      "Demonstrates that mistyped or non-HTTP links are blocked instead of opened.",
    AccessURL: "not-a-valid-url",
    metadata: {
      issued: "2022-01-01",
      modified: "2024-01-01",
      temporalCoverage: "2022 / 2024",
      spatialCoverage: "Statewide (unspecified state)",
      format: "CSV",
      license: "Restricted — data use agreement required",
    },
    qualityWarnings: [
      "AccessURL failed validation (not an HTTP/HTTPS URL)",
      "Restricted license — requires a data use agreement",
    ],
  },
  {
    id: "dot-ntd",
    title: "National Transit Database (NTD)",
    source: "U.S. Department of Transportation — FTA",
    sourceLevel: "Federal",
    description:
      "Transit agency service, ridership, fleet, and financial data reported annually by U.S. transit providers.",
    whyRecommended:
      "Baseline for transit supply. Agency-level service hours and fleet age anchor the infrastructure picture.",
    AccessURL: "https://www.transportation.gov",
    metadata: {
      issued: "2010-01-01",
      modified: "2026-08-01",
      temporalCoverage: "2010 / 2025 (annual reporting)",
      spatialCoverage: "United States (reporting agencies)",
      format: "CSV, Excel, API",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: ["Annual reporting lags 12–18 months"],
  },
  {
    id: "fhwa-bridges",
    title: "National Bridge Inventory (NBI)",
    source: "FHWA — Federal Highway Administration",
    sourceLevel: "Federal",
    description:
      "Condition and inventory records for bridges on public roads, including inspection ratings and sufficiency scores.",
    whyRecommended:
      "Structure-level condition ratings identify aging assets. This is the inventory other infrastructure data joins to.",
    AccessURL: "https://www.fhwa.dot.gov/bridge/nbi.cfm",
    metadata: {
      issued: "1992-01-01",
      modified: "2026-03-31",
      temporalCoverage: "1992 / present (inspection cycle)",
      spatialCoverage: "United States (public-road bridges)",
      format: "ASCII / CSV, GIS",
      license: "Public domain (U.S. Government)",
    },
    qualityWarnings: [
      "Inspection cycles are typically 24 months",
      "Some fields are state-reported with varying QA",
    ],
  },
  {
    id: "state-dot-demo",
    title: "State DOT Pavement Condition Survey",
    source: "State Department of Transportation (mock)",
    sourceLevel: "State",
    description:
      "Demo state-level pavement condition record used to exercise State source filtering. Mock data for frontend testing.",
    whyRecommended:
      "Road-surface condition complements bridge data for a corridor-level view of asset health.",
    AccessURL: "https://www.transportation.gov",
    metadata: {
      issued: "2021-05-01",
      modified: "2025-11-15",
      temporalCoverage: "2021 / 2025 (annual survey)",
      spatialCoverage: "Statewide (unspecified state)",
      format: "CSV, GeoJSON",
      license: "Public (state open data terms)",
    },
    qualityWarnings: ["Survey method changed in 2023 — trend breaks possible"],
  },
];

export function getDatasetById(id: string): Dataset | undefined {
  return mockDatasets.find((d) => d.id === id);
}
