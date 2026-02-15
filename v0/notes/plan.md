# Plan — BrickUI Slice 1 + Slice 2 + Intro Camera (v3)

**Do not implement until approved.** Implementation begins only when the human says **"implement it all"**.

This plan intentionally prioritizes **meaning first** (selection + persistence + patches) and only then adds BrickUI affordances (scrubber) and onboarding lens (camera animation).

---

## Core essence (constraints)

- **Everything is a Space you can enter.**
- **3D is primary.** 2D is a projection.
- Layers are **spatial slices in a translucent prism** (not panel-first).
- **Graph power without graph UX.**
- Canonical spine remains coherent + Zod-validated:
  **Space, Edge, Payload, Annotation, OperatorRun, GraphPatch, Manifest**
- **No hard-coded colors** in TS. If styling is needed, use **CSS variables** / swappable stylesheet tokens.

---

## Shared conventions

### Selection persistence (single source of truth)

We represent “currently selected slice” as exactly one annotation per Space:

- `schema`: `"ui.selection.layerIndex"`
- `target`: `{ kind: "Space", id: spaceId }`
- `data`: `{ layerIndex: "<0-based integer as string>" }`

### Stable Annotation ID strategy

- If a selection annotation already exists for the Space (`schema` + `target` match), **reuse its ID** and overwrite its `data`.
- If none exists, create a new `annotation_*` id once.
- Clearing selection deletes that one annotation if present.

### Robust parsing + bounds checks

- Missing/NaN/out-of-range `layerIndex` → treat as **no selection** (return `null`).
- Do **not** silently clamp; invalid persisted state should be ignored.

---

## Slice 0 — Scene hygiene (fast, only if needed)

**Goal:** Make the prism always visible and the orbit pivot stable so BrickUI iteration is not painful.

- Ensure canvas fills viewport.
- Ensure background is non-white via CSS variables (swappable).
- OrbitControls: set `target={[0,0,0]}`, clamp polar angles to prevent pole-flip, enable damping.

This is not “animation polish”—just baseline usability.

---

## Slice 1 — Spatial click selection → persisted Annotation via GraphPatch

### Goal

Click a prism slice to select it. The selected slice is visually emphasized (opacity/scale only). Selection is persisted via `GraphPatch` and stored as an `Annotation`.

### UI behavior

- Click slice `i`:
  - emit patch that `put`-writes the selection annotation with `{ layerIndex: String(i) }`
  - visually emphasize slice `i` (opacity + slight scale)
- Press **Escape**:
  - if selection annotation exists, emit patch with `del` op for that annotation id
  - UI returns to no selection

### Critical typing fix (must do)

`applyPatch` must accept `GraphPatch` as input type (not `JsonValue`), otherwise the UI cannot call it without TS errors.

---

## Slice 2 — Depth scrubber (slider) for layer selection

### Goal

Add a minimal “depth scrubber” that selects the same layer index as clicking, but via a vertical rail/slider overlay. It updates selection **without** introducing a heavy panel.

### UX decisions

- The scrubber is a thin overlay rail on the right edge of the viewport.
- **Snap** to integer indices.
- **Preview vs commit** to avoid patch spam:
  - While dragging: update local `previewLayerIndex` (fast feedback; no GraphPatch).
  - On pointer up: emit **one** GraphPatch to persist the final index.
- Click on the rail commits immediately (one patch).

### State behavior

- App keeps `previewLayerIndex: number | null`.
- Effective selection shown in prism:
  - `effectiveSelected = previewLayerIndex ?? persistedSelected`
- `previewLayerIndex` clears on commit/cancel.

### Accessibility / fallback

- Optional: support mouse wheel over the scrubber to increment/decrement by 1 (can defer).

---

## Slice 2b — Intro camera animation (top-down → iso) + reset reverse

### Goal

On load (or on “Reset view”), animate from a top-down 2D-ish view into the isometric view to reveal the slice prism. Reverse the animation on reset.

### Non-negotiables

- **Skippable:** any manual user interaction (pointer down / wheel) cancels the animation immediately and gives full control to OrbitControls.
- Avoid “gimbal” feel: do not lerp Euler rotations. Interpolate **spherical coordinates** (radius, polar, azimuth) or position vectors and `lookAt`.

### Implementation approach

- Add `CameraRig` component that:
  - owns an `animPhase` state (`"idle" | "intro" | "reset"`)
  - on mount, starts `"intro"`
  - on reset action, starts `"reset"`
  - uses `useFrame()` to ease camera position toward the target preset
  - while animating, optionally disables OrbitControls (`enabled={false}`) OR leaves enabled but cancels animation on interaction

### Presets

- `TopDown` (2D-ish): camera above origin, slight offset to avoid singularity.
- `Iso`: camera at `[6, 5, 6]`, target `[0,0,0]`.

Keep these as named constants in `CameraRig.tsx` (not “magic numbers” scattered).

---

## Files to change / add

| File | Action | Notes |
|------|--------|------|
| `src/core/applyPatch.ts` | **Modify** | Change patch input type to `GraphPatch`. Keep Zod parse. |
| `src/core/selectors.ts` | **Create** | `findLayerSelection(state, spaceId)` → `{annotationId,index} | null` (robust bounds). |
| `src/core/index.ts` | **Modify** | Export selectors. |
| `src/core/applyPatch.test.ts` | **Create** | Test selection annotation create/update/clear via patches. |
| `src/App.tsx` | **Modify** | Hold `ProjectState` in state, derive persisted selection, manage preview selection, wire Escape + reset. |
| `src/ui/SpaceViewport.tsx` | **Modify** | Accept `selectedLayerIndex`, `onSelectLayer`, and render overlays + CameraRig + stable OrbitControls. |
| `src/ui/LayerScrubber.tsx` | **Create** | Overlay rail/slider: pointer drag, snapping, preview + commit. |
| `src/ui/CameraRig.tsx` | **Create** | Camera intro/reset animation + cancel-on-interaction. |
| `src/styles.css` | **Modify (optional)** | Add CSS variables for background/borders to avoid “white on white”. |

---

## Tests

Core-only (vitest):

- applyPatch:
  - create selection annotation (put)
  - update selection annotation (put same id overwrites)
  - clear selection annotation (del)
- selectors:
  - missing annotation → null
  - invalid values (`"NaN"`, `"-1"`, out-of-range) → null
  - valid in-range value → returns index + annotationId

(UI tests deferred for MVP.)

---

## TODO checklist

### Slice 0 (optional hygiene)
- [ ] Ensure `SpaceViewport` canvas fills container (width/height 100%).
- [ ] Add CSS vars for background/border in `styles.css` (swappable).
- [ ] OrbitControls: explicit `target={[0,0,0]}`, damping, polar clamp to prevent flip.

### Slice 1 (selection spine)
- [ ] Change `applyPatch(state, patchInput)` input type to `GraphPatch`.
- [ ] Create `src/core/selectors.ts` with `findLayerSelection(...)` (robust parsing + bounds).
- [ ] Export selectors in `src/core/index.ts`.
- [ ] In `App.tsx`:
  - [ ] Hold `ProjectState` in `useState`.
  - [ ] Derive persisted selection via `findLayerSelection`.
  - [ ] Implement `handleSelectLayer(index)` that reuses selection annotation id when present and emits a patch.
  - [ ] Implement `handleClearSelection()` on Escape (del op).
- [ ] In `SpaceViewport.tsx`:
  - [ ] Add `onClick` on slice meshes → calls `onSelectLayer(i)`, with `stopPropagation()`.
  - [ ] Emphasize selected slice via opacity + slight scale only.
- [ ] Add `applyPatch.test.ts` tests for create/update/clear.

### Slice 2 (depth scrubber)
- [ ] Add `previewLayerIndex: number | null` in `App.tsx`.
- [ ] Pass `effectiveSelectedIndex = preview ?? persisted` to `SpaceViewport`.
- [ ] Add `src/ui/LayerScrubber.tsx`:
  - [ ] render rail + thumb
  - [ ] pointer drag: `onPreview(snappedIndex)`
  - [ ] pointer up: `onCommit(snappedIndex)`; clear preview
  - [ ] click rail: commit immediately
- [ ] Render `LayerScrubber` overlay inside `SpaceViewport` container.
- [ ] Ensure no patch spam: only commit emits GraphPatch.

### Slice 2b (intro camera animation)
- [ ] Add `src/ui/CameraRig.tsx` with presets + easing via `useFrame`.
- [ ] Start intro animation on mount; provide a `resetView()` trigger from App/UI.
- [ ] Cancel animation on any user input (pointer down / wheel) and hand control to OrbitControls.
- [ ] Add a simple “Reset view” button in header (text-only) that triggers reverse animation (optional).

### Final
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm test`
- [ ] Run `pnpm lint`
- [ ] Fix failures immediately.
