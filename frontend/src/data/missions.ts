import type { Mission } from "../types";

export const missions: Mission[] = [
  {
    id: "flood-risks",
    label: "Flood Risks",
    query: "Which communities face the highest flood risk, and who is most exposed?",
    objective: "Assess community flood risk and population exposure",
    geographicFocus: "United States, with state and county drill-down",
    informationNeeded: [
      "Flood hazard footprint",
      "Population and housing exposure",
      "Observed rainfall and stream history",
      "Existing mitigation projects",
    ],
    fabricSummary:
      "Start from the authoritative FEMA hazard footprint, add USGS drainage pathways to explain how water moves, then overlay Census demographics to see who is exposed. State and local records fill planning and observed-event gaps the national layers cannot cover. Stale or unadopted local data is flagged, never silently merged.",
    groups: [
      {
        purpose: "Hazard & Exposure Footprint",
        purposeNote: "Where flooding can occur and what sits inside those areas.",
        datasetIds: ["fema-nfhl", "usgs-nhd"],
      },
      {
        purpose: "People & Housing at Risk",
        purposeNote: "Who lives in hazard areas and how vulnerable they may be.",
        datasetIds: ["census-acs"],
      },
      {
        purpose: "State & Local Ground Truth",
        purposeNote: "Planning context and observed events from closer to the ground.",
        datasetIds: ["tx-glo-flood", "harris-hcfcd", "fema-deprecated-demo"],
      },
    ],
    defaultSelectedIds: ["fema-nfhl", "usgs-nhd", "census-acs", "harris-hcfcd"],
    gaps: [
      "No parcel-level building footprints in this demo set — exposure is tract-level only.",
      "Future precipitation projections are not included; hazard maps reflect current adopted studies.",
      "Gauge history covers Harris County only, so observed-event validation is geographically narrow.",
    ],
    excluded: [
      {
        title: "Real-time flood forecasting feeds",
        reason: "Forecast models are operational products, not stable open datasets for a reproducible recipe.",
      },
      {
        title: "Insurance claims microdata",
        reason: "Policyholder-level claims are restricted and cannot be redistributed through open data.",
      },
      {
        title: "Social media flood reports",
        reason: "Unverified, non-representative sampling would bias exposure estimates.",
      },
    ],
    analysisPath: [
      "Clip the FEMA hazard footprint to the chosen geography and summarize zones by area.",
      "Join Census tract demographics to hazard areas for an exposure profile (counts, not risk scores).",
      "Trace USGS watersheds upstream of exposed tracts to explain contributing drainage.",
      "Compare mapped hazard against Harris County gauge history where coverage exists.",
      "Document every gap and preliminary-map area before drawing conclusions.",
    ],
    potentialOutputs: [
      "Exposure summary table by tract",
      "Hazard-area map layers (export)",
      "Data quality and gaps memo",
    ],
  },
  {
    id: "public-health",
    label: "Public Health",
    query: "Where are chronic disease burdens highest, and what local factors track with them?",
    objective: "Compare community health burden and contributing local factors",
    geographicFocus: "United States at census-tract level",
    informationNeeded: [
      "Chronic disease prevalence",
      "Environmental exposure indicators",
      "Provider shortage designations",
      "Demographic context",
    ],
    fabricSummary:
      "Anchor on CDC tract-level prevalence, pair it with EPA exposure indicators, then check HRSA shortage designations before interpreting any pattern. The demo state discharge record is withheld from selection until its AccessURL and license are fixed — burden data without lawful, reachable access does not enter a recipe.",
    groups: [
      {
        purpose: "Health Burden",
        purposeNote: "How much disease burden each community carries.",
        datasetIds: ["cdc-places"],
      },
      {
        purpose: "Exposure & Access Context",
        purposeNote: "Environmental burden and care supply that shape interpretation.",
        datasetIds: ["epa-ejscreen", "hrsa-shortage"],
      },
      {
        purpose: "Records Needing Verification",
        purposeNote: "Potentially useful sources blocked by access or license problems.",
        datasetIds: ["state-health-demo"],
      },
    ],
    defaultSelectedIds: ["cdc-places", "epa-ejscreen", "hrsa-shortage"],
    gaps: [
      "PLACES values are model-based estimates — small-area comparisons carry wide uncertainty.",
      "No behavioral or clinical microdata is available in open form for this demo.",
      "Environmental indicators mix vintages, so cross-indicator timing is approximate.",
    ],
    excluded: [
      {
        title: "Patient-level hospital records",
        reason: "Identifiable health data is never part of an open-data recipe.",
      },
      {
        title: "Commercial wellness app data",
        reason: "Opt-in panels are not population-representative.",
      },
    ],
    analysisPath: [
      "Rank tracts by selected prevalence measures with uncertainty noted, not hidden.",
      "Overlay EPA burden indicators to check for co-located environmental stressors.",
      "Flag tracts inside HRSA shortage areas before recommending any intervention reading.",
      "Write up limitations alongside every comparison table.",
    ],
    potentialOutputs: [
      "Tract comparison table with uncertainty notes",
      "Burden and access overlay map (export)",
      "Methods and limitations note",
    ],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    query: "Which bridges, roads, and transit assets most need attention?",
    objective: "Prioritize transportation infrastructure condition review",
    geographicFocus: "United States, national inventory with state drill-down",
    informationNeeded: [
      "Bridge condition and age",
      "Road surface condition",
      "Transit service and fleet profile",
      "Inspection recency",
    ],
    fabricSummary:
      "Build from structure-level federal inventories (bridges first), add state pavement condition for corridor context, and use transit reporting to cover the non-road network. Annual and biennial inspection cycles mean 'current condition' is always a dated claim — the recipe carries those dates forward instead of smoothing them away.",
    groups: [
      {
        purpose: "Asset Condition Inventory",
        purposeNote: "Structure-level condition for the fixed asset base.",
        datasetIds: ["fhwa-bridges", "state-dot-demo"],
      },
      {
        purpose: "Service & Operations Profile",
        purposeNote: "How the network is actually operated and used.",
        datasetIds: ["dot-ntd"],
      },
    ],
    defaultSelectedIds: ["fhwa-bridges", "state-dot-demo", "dot-ntd"],
    gaps: [
      "Bridge inspections run on ~24-month cycles — the newest record may still be dated.",
      "Pavement survey methods changed in 2023 in the demo state record; long trends may break.",
      "Local (city/county) assets below federal reporting thresholds are absent.",
    ],
    excluded: [
      {
        title: "Toll operator transaction data",
        reason: "Commercial operating data is not published as open data.",
      },
      {
        title: "Utility-owned underground assets",
        reason: "Privately held and security-sensitive; excluded from open-data scope on purpose.",
      },
    ],
    analysisPath: [
      "Filter the bridge inventory by condition rating and inspection date.",
      "Join state pavement segments to the same corridors for a combined asset view.",
      "Summarize transit service and fleet age from the latest NTD reporting year.",
      "Rank assets for review with inspection recency shown next to every rank.",
    ],
    potentialOutputs: [
      "Asset review shortlist with inspection dates",
      "Corridor condition summary",
      "Coverage and recency caveats list",
    ],
  },
];

export const defaultMission: Mission = missions[0];
