# plan.aihistory.md — Per-slice AI History DAG (Seed Paths)

## Status
**Implemented** — schema, helpers, UI, and wiring all live in the codebase.

- Schema: `src/core/history/aiHistorySchema.ts`
- Pure helpers: `src/core/history/historyGraph.ts`
- Tests: `src/core/history/historyGraph.test.ts` (27 tests)
- Selectors: `findAIHistory()`, `findSliceIds()` in `src/core/selectors.ts`
- Universal History panel: `src/ui/AIHistoryPanel.tsx`
- Layers panel integration: `src/ui/LayersPanel.tsx` (N badge + history panel)
- Wired into all AI ops in `src/App.tsx`:
  - `handleAiEdit` (img2img)
  - `handleInvertMask` (maskInvert)
  - `handleImportImage` (import)
  - `handleGenerate3D` (imageTo3D)
  - `handleCombineMasks` (maskCombine — creates new slice with root)
- Cursor handlers: `handleSetDisplayCursor`, `handleSetOperationCursor`
- Keyframe preview: composited top-down from visible layers, updated on cursor change
- Hidden slide direction: fixed to slide left

## Goal
Per-slice reversible AI edits with branching/time travel. History is a **rooted arborescence** (tree of states, no merges in v1). "Paths" are **seed paths** from Slice Root; N counts only seed paths.

## Two "originals"
- **Document Source Image** (project-level): imported image used to generate slices. Stored as `SpaceAIHistory.documentSourceImageId`.
- **Slice Root** (per slice): `rootStateId` in that slice's DAG; anchor for history UI. Labelled **"Slice Root"** in UI — never "Original".

## Invariants
1) Layer stack + Keyframe always reflect `displayStateId` (current displayed state per slice).
2) Slice Root is history-only anchor (not a layer-stack mode).
3) Two cursors exist and can diverge:
   - 👁 `displayStateId`
   - ⚙ `operationStateId`
4) Assets are `PayloadId` references into the existing `state.payloads` store — no parallel asset type.
5) History is a rooted arborescence (each `StateNode` has exactly one `parentStateId`). **No merge support in v1.**
6) Op provenance lives in `OperatorRun` — `OpEdge` carries `operatorRunId` + lightweight `summary`.

## Stable slice identity
- Histories keyed by stable `sliceId` (not integer index).
- Index-to-id mapping resolved via `ui.layers.sliceIds` annotation.
- Optional `sliceIndex` on `StateNode`/`OpEdge` is a creation-time snapshot only.

## Seed paths (definition of N)
- A seed path is created only when an op runs with `inputStateId == rootStateId`.
- `pathId = firstChildStateIdAfterRoot` (stateId of the direct root child).
- `N = count(children(rootStateId))`.
- Further ops within a path do NOT increment N; path head updates.
- **Multi-output rule**: if `inputStateId === rootStateId` and op produces K outputs, `seedPathIds` grows by K. For non-root multi-output, all outputs stay in the same seed family. **v1 head = `outputStateIds[0]`**.
- `StateNode.seedPathId` is a required derived-but-stored cache for O(1) path lookup (null for root).

## Persistence
- Single Annotation per Space:
  - `schema`: `"ui.space.aiHistory"` (constant: `SPACE_AI_HISTORY_SCHEMA`)
  - `data.json`: stringified `SpaceAIHistory`
- `SpaceAIHistory.version: 1` for migration safety.

## Data model
Canonical TypeScript types in `src/core/history/aiHistorySchema.ts`:
- `OpType` — extensible union of operation kinds
- `StateNode` — point-in-time visual state of a slice (references `PayloadId`s)
- `OpEdge` — directed edge linking input state to output states (references `OperatorRunId`)
- `SliceHistoryGraph` — per-slice arborescence + cursors + caches
- `SpaceAIHistory` — space-level container (versioned, keyed by `sliceId`)

## Migration
- No history: wrap current displayed payload into `rootStateId`, set display=operation=root.
- No `ui.layers.sliceIds`: assign `makeId("slice")` to each index, persist.
- Missing/corrupt cursors: set to latest path head, else root. **Latest path head** = `pathHeadStateIds[pathId]` if present, else deepest descendant of the `seedPathId`.
- `ui.layers.glb`: migrate into `assetRefs.glb` on StateNodes (step 8).
- Rendering must fallback safely if history annotation is missing.

## Integration with existing core
- Core types, Zod schemas, undo/redo, layer props/order/selection — **unchanged**.
- Render pipeline still reads `ui.layers.render` annotation.
- `handleAiEdit` gains steps 4a-4d after creating OperatorRun:
  - 4a) Create `StateNode` (`assetRefs.image = outputPayloadId`)
  - 4b) Create `OpEdge` (`operatorRunId = oprunId`)
  - 4c) Update cursors (`displayStateId = operationStateId = newStateId`)
  - 4d) Update render annotation (derived from `displayStateId`)
- Keyframe preview updates when any slice's 👁 cursor changes (debounced).

## Implementation order
0) ~~Schema definition~~ DONE `src/core/history/aiHistorySchema.ts`
1) ~~Stable slice IDs~~ DONE — `ui.layers.sliceIds` annotation + `getOrCreateSliceIds()` in App.tsx
2) ~~`historyGraph.ts`~~ DONE — `src/core/history/historyGraph.ts` with 27 passing tests
3) ~~Graph updates on op completion~~ DONE — wired into `handleAiEdit`, `handleInvertMask`, `handleImportImage`, `handleGenerate3D`, `handleCombineMasks`
4) ~~Render binding from `displayStateId`~~ DONE — `handleSetDisplayCursor` updates both history cursor AND `ui.layers.render` annotation
5) ~~Keyframe preview~~ DONE — composited in App.tsx, rendered in SpaceViewport top-right corner
6) ~~Universal history UI~~ DONE — `src/ui/AIHistoryPanel.tsx` with left anchor (Root+Current) + seed path lanes
7) ~~Layers badge + panel~~ DONE — N badge in `LayersPanel`, inline history panel with seed path heads + ancestry chain
8) **GLB migration** — move `ui.layers.glb` data into `assetRefs.glb` on StateNodes. When new GLBs are created, also create a StateNode with `assetRefs.glb` and update display cursor like image ops.
