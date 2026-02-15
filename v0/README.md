# Unbricked

**The unexamined brick is not worth editing.**

Unbricked is an editor for examined media. Every artifact is an **enterable Space**, not a dead file. 3D is primary; 2D is a projection. Layers are spatial slices in a translucent prism.

## Core concepts

| Concept | Description |
|---------|-------------|
| **Space** | The fundamental container — a world, layerspace, objectspace, or partspace you can enter |
| **Prism** | A Space is visualized as a rectangular prism; layers are translucent horizontal slices |
| **3D-first** | The default viewport is isometric 3D; 2D views are projections, never the source of truth |
| **Graph power, no graph UX** | A validated graph spine (Space → Edge → Payload) underpins everything, but users interact spatially, not through nodes and wires |

### Two canonical paths from 2D → 3D

1. **Segmentation-first** — image → segments/layers → 3D composition
2. **Holistic** — image → 3D without segmentation

Both are first-class; the user explicitly chooses which fork to take.

## Data model

All persisted structures are TypeScript-strict and Zod-validated:

- **Space** — enterable container with a layer count
- **Edge** — typed relationship (containment, projection, derivation, portal)
- **Payload** — blob reference (image, mask, mesh, video) with content hash
- **Annotation** — structured metadata on any object (schema + data)
- **OperatorRun** — provenance of a transformation (inputs → outputs)
- **GraphPatch** — validated mutation with base-revision checking
- **Manifest** — package integrity (version + object index + hashes)

Every meaningful change is a `GraphPatch`. Every transformation records an `OperatorRun`.

## Current state (MVP)

- 3D isometric viewport rendering a Space as a prism with translucent layer slices
- Click a slice to select it; selection persists as an `Annotation` (`ui.selection.layerIndex`) through the GraphPatch pipeline
- Press Escape to clear selection
- Full round-trip: click → Annotation → GraphPatch → `applyPatch` → re-render

## Project structure

```
src/
  core/           # Data model, schemas, patch application, selectors
    types.ts      # TS types (Space, Edge, Payload, Annotation, etc.)
    schema.ts     # Zod validators for all types
    ids.ts        # Branded ID generation (ULID-based)
    graphPatch.ts # Patch creation helpers (newPatch, putOp, delOp)
    applyPatch.ts # Deterministic patch application with validation
    selectors.ts  # Pure query functions (findLayerSelection)
    sampleProject.ts
  ui/
    SpaceViewport.tsx  # R3F canvas with prism + interactive slices
  App.tsx              # State holder, patch plumbing, keyboard shortcuts
  main.tsx
docs/             # Vision, data model, UI philosophy, trace flow
notes/            # Research findings + implementation plans
```

## Development

```bash
pnpm i
pnpm dev          # Vite dev server
```

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
