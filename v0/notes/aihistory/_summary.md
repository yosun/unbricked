# AI History UX — Current State Summary

## Shared Infrastructure

### Data Model (`aiHistorySchema.ts`)

- **`SliceHistoryGraph`**: per-slice DAG — `states` (StateNode map), `ops` (OpEdge map), `rootStateId`, `displayStateId` (👁 cursor), `operationStateId` (⚙ cursor).
- **`StateNode`**: vertex — `stateId`, `parentOpId`, `seedPathId`, `assetRefs` (`{ image?, thumb?, mask? }`), `meta` (`{ label, opType?, model? }`).
- **`OpEdge`**: directed edge — `opId`, `sourceStateId`, `resultStateId`, `opType`, `summary`.
- **`SpaceAIHistory`**: wrapper persisted as a `"ui.space.aiHistory"` annotation per space.

### Pure Functions (`historyGraph.ts`)

`getSeedPathIds`, `getPathHeadStateId`, `getAncestryPath`, `getChildStates`, `addOpResultToGraph`, `setDisplayCursor`, `setOperationCursor`, `serializeAIHistory`, `deserializeAIHistory`.

### State Management (`App.tsx`)

- All AI history state lives in App and is plumbed to both views via props.
- Callbacks: `onSetDisplayCursor`, `onSetOperationCursor` — both take `(layerIndex, stateId)`.
- `getSliceHistory(layerIndex) → SliceHistoryGraph | null` — retrieves the graph for a given slice.
- **Initialization**: AI history (with `documentSourceImageId`) is created at ingest time (both main and retry commit paths), so the graph exists immediately after segmentation — no lazy creation needed for the panel to appear.

---

## Universal View (3D Viewport)

**Component**: `AIHistoryPanel.tsx` (standalone, overlaid on `SpaceViewport`)

### Layout — Subway-Map Style

```
┌─────────────────────────────────────────────────────┐
│ AI History — Layer N          2 ops · 1 path      ✕ │
├───────────┬─────────────────────────────────────────┤
│           │  Path 1 (3 ops) ● active          ▶     │
│ [Source]  │  [Station][Station][Station]  compact    │
│ [Root  ]  │                                         │
│           │  Path 2 (1 op)                    ▶     │
│           │  [Station]                              │
└───────────┴─────────────────────────────────────────┘
```

- **Left anchor column** (border-right divider):
  - **Source Image** — document-level source image thumbnail (visually inert, no click handlers).
  - **Slice Root** — the root state; clickable to set 👁 display cursor; hover-reveals ⚙ gear button to set operation cursor.
- **Right area** — one lane per seed path:
  - **Compact mode** (default): horizontal row of `ThumbBox` station thumbnails (36px). Each station shows its label derived from the parent op edge: `[opType · model]`. Clickable for 👁, hover-⚙ for operation cursor.
  - **Expanded mode** (▶/▼ toggle): vertical list — larger (32px) thumbnails with text labels and branch counts.
- **Header**: title with layer index, op/path counts, close button.
- **Cursor badges**: 👁 (top-right) and ⚙ (bottom-right) emoji badges rendered on the station that matches the current display/operation state.

### Toggle & Visibility (`SpaceViewport.tsx`)

- `historyPanelLayer` state (number | null) — tracks which layer's history is open.
- Toggle button rendered if `graph != null` (relaxed — shows even with only the root state, pre-AI-ops).
- Panel floats absolute over the 3D canvas: `bottom: 12px`, `left/right: 12px`, `maxHeight: 240px`, `backdrop-filter: blur(12px)`.

### Unique Features (vs Layers View)

- Document source image anchor (separate from slice root).
- Seed-path-centric organization (paths as subway lines).
- Compact ↔ expanded toggle per path.
- `stationLabel()` derives labels from parent OpEdge (`opType · model`).
- Hover-reveal ⚙ gear button (CSS class `.ai-history-gear` with hover rule).
- `getChildStates` branch count shown in expanded mode.

---

## Layers View (2D Panel)

**Component**: inline JSX within `LayersPanel.tsx` (not using `AIHistoryPanel`)

### Entry Point

Each layer row shows a **badge pill** when `getSliceHistory(layerIdx)` returns a graph with `ops.length > 0`:
- Shows op count (e.g. "2 AI ops").
- Click toggles the history sub-panel for that layer.
- Badge color flips when active.

### Layout — Header + Seed Heads + Ancestry Chain

```
┌────────────────────────────────────────────────┐
│  [Root 36px] → [Current 36px]               ✕ │
├────────────────────────────────────────────────┤
│  SEED PATHS (2) · 3 ops                       │
│  [Head][Head]  ← 40px thumbnails, wrapping     │
├────────────────────────────────────────────────┤
│  PATH HISTORY (2 ops)                          │
│  [28px] Label / opType   [⚙ Use]              │
│  [28px] Label / opType   [⚙ Use]              │
└────────────────────────────────────────────────┘
```

- **Header row**: Root thumbnail (36px) → Current (display) thumbnail (36px), close button. Both show 👁/⚙ badges. Root is clickable for display cursor.
- **Seed Paths section**: grid of seed path _head_ thumbnails (40px). Click selects path + jumps display cursor. Shows head's `opType` label overlay. Highlights path containing display/operation cursor.
- **Ancestry chain** (for selected/first path): vertical list of 28px thumbnails with text labels (`meta.label`, `meta.opType`). Each row clickable for 👁. Non-root, non-current rows show an explicit `⚙ Use` button for operation cursor.
- `selectedPathId` local state — defaults to first seed path.
- `maxHeight: 300px`, scrollable.

### Unique Features (vs Universal View)

- Root → Current header (immediate visual context).
- Seed path _heads_ (shows latest result per path, not full chain).
- Explicit `⚙ Use` text button instead of hover-reveal gear icon.
- Ancestry chain is the detailed vertical list (one path at a time).
- No document source image anchor.
- No compact/expanded toggle (always shows ancestry chain).

---

## Key Differences

| Aspect | Universal (AIHistoryPanel) | Layers (LayersPanel inline) |
|---|---|---|
| Component | Standalone `AIHistoryPanel.tsx` | Inline JSX in `LayersPanel.tsx` |
| Document Source Image | ✅ shown as left anchor | ❌ not shown |
| Organization | Seed paths as lanes (subway lines) | Seed heads grid + single ancestry chain |
| Compact/Expanded | ✅ per-path toggle | ❌ always shows ancestry |
| ⚙ Operation cursor | Hover-reveal gear overlay | Explicit "⚙ Use" button |
| Station labels | Derived from parent OpEdge | Uses `meta.label` + `meta.opType` |
| Position | Floating overlay on 3D canvas | Docked inside layers sidebar |

---

## Initialization Flow

1. User imports image → `handleIngestCommit` in `App.tsx`.
2. Ingest commit creates the `SpaceAIHistory` annotation with `documentSourceImageId` set to the imported payload.
3. After segmentation, each slice's `SliceHistoryGraph` has a root state but no ops.
4. The Universal view toggle button appears immediately (gate: `graph != null`).
5. The Layers view badge only appears once `ops.length > 0` (after first AI edit).
6. AI edit operations add `OpEdge` + result `StateNode` to the graph; cursors update.