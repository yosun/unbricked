# Unbricked

**The unexamined brick is not worth editing.**

Unbricked is a spatial media editor where every artifact is an **enterable Space**, not a dead file. 3D is primary; 2D is a projection. Layers are spatial slices in a translucent prism — like Photoshop layers in 3D.

## Core concepts

| Concept | Description |
|---------|-------------|
| **Space** | The fundamental container — a world, layerspace, objectspace, or partspace you can enter |
| **Prism** | A Space is visualized as a rectangular prism; layers are translucent horizontal slices |
| **3D-first** | The default viewport is isometric 3D; 2D views are projections, never the source of truth |
| **Graph power, no graph UX** | A validated graph spine (Space → Edge → Payload) underpins everything, but users interact spatially, not through nodes and wires |

### Two canonical paths from 2D → 3D

1. **Segmentation-first** — image → SAM2 auto-segment → layers/slices → AI edit / 3D generation
2. **Holistic** — image → 3D without segmentation

Both are first-class; the user explicitly chooses which fork to take.

## Data model

All persisted structures are TypeScript-strict and Zod-validated:

- **Space** — enterable container with a dynamic layer count
- **Edge** — typed relationship (containment, projection, derivation, portal)
- **Payload** — blob reference (image, mask, mesh, GLB) with content hash + crop metadata
- **Annotation** — structured metadata on any object (selection, layer props, render mapping, order, GLB models)
- **OperatorRun** — provenance of a transformation (inputs → outputs → params)
- **GraphPatch** — validated mutation with base-revision checking
- **Manifest** — package integrity (version + object index + hashes)

Every meaningful change is a `GraphPatch`. Every transformation records an `OperatorRun`.

## Current state

The app is a functional spatial editor with the following capabilities:

### Image ingest & segmentation
- **Tabula Rasa** onboarding — blank-slate overlay prompts image import or text-to-image generation
- **Image import** from file picker or **AI text-to-image** generation (fal.ai Flux)
- **SAM2 auto-segmentation** — imported images are automatically sliced into per-object layers with tight-crop bounding boxes
- **Mask picker** — review, select, and combine SAM2 mask candidates into custom layers

### 3D viewport & layer interaction
- **R3F isometric viewport** rendering a Space as a prism with translucent textured layer slices
- **Camera rig** with intro animation, top-down ↔ iso toggle, reset, and space-transition animations
- **Click-to-select** slices; selection persisted as Annotation via GraphPatch
- **Depth scrubber** (R3F plane) — drag to preview, release to commit selection
- **Layer reorder** via drag in the HUD overlay
- **Per-layer controls**: visibility toggle, solo, opacity slider, mask toggle, mask invert
- **Segment display modes**: masked original or colored silhouettes
- **Reveal animation** when new slices are produced after segmentation
- Keyboard shortcuts: `[`/`]` step layers, `1`/`2`/`3` switch view modes, `Tab` peek layers, `Shift` peek rail

### AI editing
- **AI img2img** on selected layers via fal.ai proxy (Flux dev, Nano Banana models)
- **Automatic mask regeneration** — after AI edit, BiRefNet re-segments the output to maintain clean boundaries
- **Crop-aware editing** — AI receives tightly-cropped segment content; results are re-fitted to original coordinates

### 3D generation
- **Image-to-3D** per layer via fal.ai SAM-3 — produces textured GLB models rendered inline
- **Source image toggle** — hide/show the 2D texture when a 3D model is active
- GLB models persisted as Payloads and restored on reload

### AI History
- **Per-slice history graph** — every AI operation is recorded as a directed acyclic graph of state nodes and operation edges
- **3D subway map** (Universal mode) — history rendered as actual R3F meshes attached to the selected slice: a figure-8 hub (original + current image) with branching operation thumbnails
- **SVG subway map** (Layers mode) — bottom-drawer panel with the same graph rendered as interactive SVG
- **Display cursor** — click any history node to preview that state; all nodes remain visible (no destructive navigation)
- **Branch-aware** — divergent AI edits fan out as separate lanes; active ancestry is highlighted

### Editor infrastructure
- **Undo / Redo** (snapshot-based, up to 100 levels) with `Cmd+Z` / `Cmd+Shift+Z`
- **LocalStorage persistence** — project state survives page reload
- **Portal navigation** — enter child Spaces via portal edges, with browser-history-backed address bar
- **View modes**: Universal, Layers, Minimalist — with "Way of Code" style templates
- **Settings panel** for default AI model and operation preferences
- **Radial menu** context actions on selected layers

## Tech stack

- **React 18** + **TypeScript** (strict, no `any`)
- **React Three Fiber** (R3F) + **drei** — 3D viewport
- **Three.js** — rendering engine
- **Zustand** — UI style state management
- **Zod** — runtime schema validation for all data
- **ULID** — branded ID generation
- **Vite** — dev server and build
- **Vitest** — unit testing (jsdom)
- **fal.ai** — AI backend via drop-in proxy (SAM2, Flux, BiRefNet, SAM-3)

## Project structure

```
src/
  core/                       # Data model, schemas, graph engine
    types.ts                  # TS types (Space, Edge, Payload, Annotation, etc.)
    schema.ts                 # Zod validators for all core types
    ids.ts                    # Branded ULID-based ID generation
    graphPatch.ts             # Patch creation helpers (newPatch, putOp, delOp)
    applyPatch.ts             # Deterministic patch application with validation
    selectors.ts              # Pure query functions (selection, props, order, render, GLB, portals)
    operations.ts             # Operation registry (SAM3 segment, image-to-3D, Canny, none)
    persistProjectState.ts    # LocalStorage save/load
    preferences.ts            # User preferences (default AI model, operation)
    crypto.ts                 # WebCrypto sha256 helper
    sampleProject.ts          # Default empty project factory
  core/history/                # AI history graph engine
    aiHistorySchema.ts        # SliceHistoryGraph, StateNode, OpEdge schemas
    historyGraph.ts           # Core helpers (addOpResult, getSeedPath, setDisplayCursor)
    chainVisibility.test.ts   # Chain visibility tests
    historyGraph.test.ts      # History graph unit tests
    integrationRoundtrip.test.ts # End-to-end roundtrip tests
  history/                      # AI history visualization
    historyTypes.ts           # Subway-map data model (HistoryNode, HistoryGraph)
    historyGraph.ts           # DAG traversal (getActiveLineage, buildActiveSet)
    historyLayout.ts          # DAG → subway geometry positions
    adaptSliceHistory.ts      # SliceHistoryGraph → subway HistoryGraph adapter
    HistoryGraph3D.tsx        # R3F 3D subway map (in-scene, attached to slice)
    HistoryMapPanel.tsx       # SVG subway map (Layers-view bottom drawer)
    HistoryHudPanel.tsx       # Screen-space HUD panel (legacy, Layers fallback)
  services/
    falProxy.ts               # fal.ai proxy client (img2img, text2img, SAM2, BiRefNet, SAM-3)
    operationRunner.ts        # Orchestrates operations (segmentation → patches)
  slice8/
    SpaceAddressHUD.tsx        # Breadcrumb-style space address bar
    spaceNav.ts                # Space navigation state machine
    useSpaceNav.ts             # React hook for space navigation + browser history
  ui/
    SpaceViewport.tsx          # R3F canvas: prism, textured slices, scrubber, HUD overlays
    CameraRig.tsx              # Animated camera transitions (intro, iso, top-down, reset)
    LayerControlsHUD.tsx       # Per-layer controls (visibility, solo, opacity, mask, AI edit)
    LayerReorderHUD.tsx        # Drag-to-reorder layer strip
    LayerScrubber.tsx          # Vertical depth scrubber rail
    LayersPanel.tsx            # Layer list panel (view mode dependent)
    RadialMenu.tsx             # Context radial menu on selection
    MaskPickerPanel.tsx        # SAM2 mask candidate picker + combine
    ImageIngestPanel.tsx       # Image import / text-to-image ingest
    OperationProgressHUD.tsx   # Operation progress / result indicator
    PortalOverlay.tsx          # Portal entry overlay
    SlicingOverlay.tsx         # Animated overlay while segmentation runs
    SettingsPanel.tsx          # Preferences panel
    TabulaRasa.tsx             # Blank-slate onboarding overlay
    ViewModeSwitcher.tsx       # View mode selector (Universal / Layers / Minimalist)
    ViewMode.ts                # View mode type definitions
    uiStyleStore.ts            # Zustand store for Way-of-Code style templates
    styleTemplates.ts          # Predefined UI style templates
  App.tsx                      # Root component: state, patch plumbing, all handlers
  main.tsx                     # Entry point
  styles.css                   # CSS variables, global styles
docs/                          # Vision, data model, UI philosophy, trace flow
notes/                         # Research findings + implementation plans
```

## Development

```bash
pnpm i
pnpm dev          # Vite dev server
```

Requires a `.env` file with `VITE_FAL_PROXY_URL` pointing to your fal.ai drop-in proxy endpoint.

## Quality gates

```bash
pnpm typecheck    # TypeScript strict, no any/unknown
pnpm test         # Vitest (jsdom)
pnpm lint         # ESLint
pnpm format       # Prettier
```

## Agent workflow

This repo uses a disciplined Research → Plan → Implement cycle. See `CLAUDE.md` for the full protocol. Key rules:

- All findings go to `notes/research.md`
- Implementation plans go to `notes/plan.md` with a TODO checklist
- No production code changes until the plan is approved
- Implementation only begins on **"implement it all"**
