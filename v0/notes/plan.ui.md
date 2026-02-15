## Distilled plan — UI Views

### 0) One spine
- One `ProjectState`, one selection model, one undo/redo history.
- Views are **projections**; they don’t change the data model.

---

## 1) Universal View
**Goal:** “do everything” with **one** depth/order control.

- Show: 3D prism + **Depth Rail** (vertical).
- Depth Rail responsibilities (single authority):
  - drag thumb = scrub focus layer
  - drag layer chip = reorder
- Hide: Photoshop-inspired layer list.
- Opacity / hide / solo appear only as **context HUD** on selection.

---

## 2) Layers View (Photoshop-Inspired)
**Goal:** familiar panel workflow + batch ops.

- Show: 3D viewport + **Layers Panel** (eye/solo/lock, opacity, drag reorder, multi-select).
- Hide: Depth Rail / vertical slider.
- Optional: keyboard step up/down stack (`[` `]`) instead of a scrubber.

---

## 3) Minimalist View (XR-ready)
**Goal:** tiny/no UI + direct manipulation.

- Show: prism only + tiny mode glyph; ephemeral radial menu on long-press.
- Hide: Layers Panel + Depth Rail.
- Default tool: **drag planes** (grab/move) instead of select-first.
- Gestures map to XR later (grab/pinch/two-hand adjust).

---

## Switching
- `1` Universal, `2` Layers, `3` Minimalist
- Optional “hold to peek” overlays:
  - hold `Tab` = temporary Layers Panel
  - hold `Shift` = temporary Depth Rail

---

## Implementation steps (MVP)
1. Add `viewMode` enum + top toggle.
2. Conditional render:
   - current list → Layers view
   - current slider → Universal view (evolve into Depth Rail chips)
   - Minimalist → hide both; enable plane-drag tool
3. Keep commits/undo identical across views.

---

## Implementation status

### Files
| File | Role |
|---|---|
| `ViewMode.ts` | `"universal" \| "layers" \| "minimalist"` enum |
| `ViewModeSwitcher.tsx` | Header toggle ◈/☰/◯ |
| `SpaceViewport.tsx` | Central hub — 3D canvas + all HUD overlays |
| `LayerScrubber.tsx` | Depth Rail with draggable ticks (Universal) |
| `LayerControlsHUD.tsx` | Context HUD — eye/solo/opacity (Universal) |
| `LayersPanel.tsx` | Photoshop-inspired panel (Layers view) |
| `RadialMenu.tsx` | Pie menu on long-press (Minimalist) |
| `CameraRig.tsx` | Intro/reset animation + orbit presets |

### Universal view — done
- [x] Depth Rail: coloured ticks per layer, click rail to select
- [x] Tick drag-reorder: continuous visual offset (`dragOffsetPx`) with snap-back animation
- [x] Context HUD (bottom-centre): eye / solo / opacity slider
- [x] `LayerReorderHUD` removed — rail handles reorder directly

### Layers view — done
- [x] Photoshop panel: eye / solo / % opacity, drag-handle reorder
- [x] Inline opacity slider on click

### Minimalist view — done
- [x] Two-phase long-press: 300 ms → selection badge; pointer-up without drag → radial menu
- [x] Radial: Prev / Next / Hide / Solo (no "Desel")
- [x] Drag-reorder: continuous 3D layer following via `DragOverride`
- [x] Camera locks during drag (`OrbitControls.enabled`)
- [x] `suppressClicks` prevents accidental selection during drag

### Cross-view
- [x] Peek overlays: hold `Tab` → Layers Panel, hold `Shift` → Depth Rail
- [x] Keyboard: `1`/`2`/`3` switch, `[`/`]` step layers
- [x] Hidden layers slide fully outside brick at full size (`PRISM_W + 0.5`)

---

## Bug-fix log

### Pointer-capture on wrong element (Universal + Layers drag)
**Symptom:** tick/row drags started but never swapped — move/up events lost.
**Root cause:** `setPointerCapture` was called on the child tick/handle element,
but `onPointerMove`/`onPointerUp` lived on the parent container. Captured events
go to the capture target, so the parent never saw them.
**Fix:** capture on the container ref (`railRef` / `containerRef`) instead.

### Ghost duplicates during Minimalist drag
**Symptom:** dragged layer appeared twice (one in slot, one following cursor).
**Root cause:** `onPreviewOrder` updated `layerOrder` in the parent, causing
a full re-render. The new order placed the layer at a new slot while
`dragOverride` also positioned it at a continuous Y → two visual instances.
**Fix:** removed `onPreviewOrder` calls during drag. SpacePrism now computes
adjusted slot positions locally from `dragOverride`, so non-dragged layers
make room without a parent re-render.

### Screen-to-brick sensitivity (Minimalist drag)
**Symptom:** layer barely moved in 3D even with large cursor drags.
**Root cause:** `screenToBrick = PRISM_H / viewportHeight` assumed the brick
fills the viewport. With an ISO camera the brick is ~25 % of the view.
**Fix:** added `screenToBrickY()` which projects brick top/bottom through the
actual Three.js camera to get the real pixel span. Exposed camera via `CameraRef`
helper component inside the Canvas.

are the views conflicting? fix. views are just UI interface projection space and the project state should not be modified when we switch views

### Final
- [x] Run `pnpm typecheck` — only pre-existing `applyPatch.test.ts` errors
- [x] Run `pnpm test` — 42/42 pass
- [x] Run `pnpm lint` — no new errors in UI files
