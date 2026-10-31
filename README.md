# MetaFabric AI

AI-powered government open-data discovery website.

**Tagline:** Government Open Data Intelligence

> Phase 1B — dashboard built with clearly labeled mock datasets for
> frontend testing. No Azure MCP or Meta Model API is connected yet, and
> no GIS analysis is performed.

## Dashboard preview

After `npm run dev`, open [http://localhost:5173](http://localhost:5173):

- **Left (15%)** — Dashboard / Datasets / Saved Recipes navigation and
  Federal / State / Local source filters.
- **Middle (62%)** — Explore Government Data search, example missions
  (Flood Risks, Public Health, Infrastructure), mission interpretation,
  AI Data Fabric summary, grouped Recommended Datasets with `AccessURL`
  links, Data Gaps, Excluded on Purpose, and Suggested Analysis Path.
- **Right (23%)** — collapsible AI Assistant with labeled demo responses.
- **Data Recipe tab** — selected datasets, proposed workflow, gaps,
  limitations, and potential outputs. Tick dataset checkboxes, then use
  **Generate Data Recipe**.

## Tech stack (frontend)

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4 (via the `@tailwindcss/vite` plugin)
- Lucide React icons
- Inter font (Google Fonts)

Design colors:

| Token      | Value     |
| ---------- | --------- |
| Navy       | `#10365B` |
| Teal       | `#0D8389` |
| Background | `#F7FAFC` |
| White      | `#FFFFFF` |
| Slate      | `#64748B` |

## Prerequisites

- Node.js 20+ (developed on Node.js 26.13.0)
- npm 11+

## Run the frontend

```powershell
cd C:\Projects\MetaFabricAI\frontend
npm install
npm run dev
```

Then open the URL printed by Vite in your browser — by default
[http://localhost:5173](http://localhost:5173).

## Other commands

Run these from `C:\Projects\MetaFabricAI\frontend`:

```powershell
npm run build    # type-check (tsc -b) + production build to dist/
npm run preview  # preview the production build
npm run lint     # oxlint
```

## Project structure

```text
MetaFabricAI/
├── frontend/            # React + TypeScript + Vite app
│   ├── public/
│   └── src/
│       ├── components/  # Header, Sidebar, DatasetCard, AIAssistant
│       ├── pages/       # DashboardPage, DataRecipePage
│       ├── data/        # mock missions + datasets (demo, not live MCP)
│       ├── services/    # API placeholder + URL validation helper
│       ├── types/       # shared TypeScript types
│       ├── App.tsx
│       ├── main.tsx
│       └── index.css    # Tailwind v4 theme: colors + Inter
├── doc/                 # project documents
└── README.md
```

## Notes

- The independent MCP project at
  `C:\Projects\MetadataProject\MetadataMCPServer` is untouched by this
  phase and is not connected to the frontend yet.
- Copy `.env.example` conventions later when an API is added; real `.env`
  files and secrets are git-ignored.
