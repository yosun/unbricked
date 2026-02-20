## Universal View (3D view overlay) — AI History Subway Map

When a slice (layer) **Q** is selected in the 3D/Universal view and AI history mode is enabled, render a HUD-attached **subway-map style** history panel for that slice.

### Left anchor (must be explicit)
Show **two distinct anchors** side-by-side to avoid “two originals” confusion:

1) **Document Source Image** (project-level): the imported image used to generate BrickUI slices  
   - Label: “Source Image”
   - Visually inert: no `onClick`, `cursor: default`, no hover highlight. Do not pass `onClick` to `ThumbBox`.
   - Source: `documentSourceImageId` from the space AI history annotation (if present) → resolve URI via the same `payloads` prop / payload→URI resolver used for layer thumbnails elsewhere (do not invent a new loader).
   - Plumbed as a separate `documentSourceImageId?: PayloadId` prop (avoids changing `getSliceHistory` signature).
2) **Slice Root** (per-slice): `rootStateId` for slice Q  
   - Label: "Slice Root"
   - This is the true root of the slice's history arborescence.
   - Click → set 👁 (`onSetDisplayCursor`)
   - ⚙ gear overlay → set ⚙ (`onSetOperationCursor`); setting ⚙ to root triggers a new seed path on the next AI op.

No "Current" or "⚙ Input" boxes — those concepts are conveyed by 👁/⚙ badges on stations within the subway lanes.

### Seed-path lanes (subway lines)
- Render **N seed paths** as parallel “lines” diverging from **Slice Root**.
- **N**: prefer `graph.seedPathIds.length` if the cache exists, else compute by scanning states where `parentStateId === rootStateId`.
- Each seed path lane is identified by `pathId = firstChildStateIdAfterRoot`.

### Nodes (stations)
- Each AI operation result state is a **node/station**.
- Each station shows:
  - thumbnail (state thumb if present else image)
  - op badge derived from the parent edge: `graph.ops[node.parentOpId]`
    ```ts
    const op = node.parentOpId ? graph.ops[node.parentOpId] : undefined;
    const opType = op?.opType ?? node.meta.opType;
    const model = op?.summary?.model;
    const stationLabel = [opType, model].filter(Boolean).join(" · ");
    ```
  - Root node (`parentOpId === null`): label is always fixed **"Slice Root"** (shown only in anchor box, not as a subway station).

### Cursors (must be visible on stations)
- 👁 badge on the station whose stateId == `displayStateId`
- ⚙ badge on the station whose stateId == `operationStateId`
- If both, show both badges.

### Interactions
- Click a station → set 👁 immediately (updates slice render + keyframe preview)
- ⚙ gear overlay on every station (compact + expanded views) → set ⚙
  - `ThumbBox` gains optional `onSetOperationCursor?: () => void` prop
  - Renders a small hover-visible ⚙ button in the bottom-left corner
  - Gear click must call `stopPropagation` so it does not also trigger 👁 selection
  - Available on **all** stations including Slice Root anchor
- Running an AI op uses ⚙ input:
  - if ⚙ == Slice Root → creates a new seed path (N++)
  - else → extends within the existing seed path and updates that path's head

### Scope
- This subway map is shown **only for the selected slice Q** (to avoid clutter).
- The layer stack remains authoritative for current displayed state (👁).

---

### Implementation — prop chain

```
App.tsx
  documentSourceImageId from the space AI history annotation (if present)
  └─ SpaceViewport  (+ documentSourceImageId?: PayloadId)
       └─ AIHistoryPanel  (+ documentSourceImageId?: PayloadId)
```

### Files touched

1. `src/ui/AIHistoryPanel.tsx` — all UI changes (anchor layout, station labels, ⚙ affordance)
2. `src/ui/SpaceViewport.tsx` — new `documentSourceImageId` prop in interface + pass-through
3. `src/App.tsx` — pass `documentSourceImageId={aiHistory?.history.documentSourceImageId}`

### What stays unchanged

- `SliceHistoryGraph` / `SpaceAIHistory` types
- `getSliceHistory` callback signature (`(layerIndex) => SliceHistoryGraph | null`)
- `historyGraph.ts` pure functions
- Test files (no core logic change)