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

## Slice 3 — Layer props controls (visibility / opacity / solo)

### Goal

Make BrickUI feel like “Photoshop layers in 3D” by adding minimal per-layer controls for the **selected** slice:

* **Visibility** (hide/show)
* **Opacity** (per-layer multiplier)
* **Solo** (isolate one layer)

All state must be:

* persisted as an **Annotation**
* mutated via **GraphPatch**
* undo/redo-ready later (no ad-hoc persisted state)

### Non-goals

* Layer panel UI (optional later; not primary UX)
* Reorder
* Multi-solo or grouping
* Fancy shaders; keep visuals simple (opacity-driven)
* Hard-coded colors in TS (CSS variables only)

---

### Data representation (single source of truth)

We represent “layer props” as exactly one annotation per Space:

* `schema`: `"ui.layers.props"`
* `target`: `{ kind: "Space", id: spaceId }`
* `data`: `Record<string, string>`

Keys:

Visibility:

* `hidden.<i> = "true"` (omit means visible)

Opacity:

* `opacity.<i> = "<float 0..1>"` (omit means 1.0 multiplier)

Solo:

* `solo = "<i>"` (omit means no solo)

### Stable Annotation ID strategy (same pattern as selection)

* If a props annotation already exists for the Space (`schema` + `target` match), **reuse its ID** and overwrite its `data`.
* If none exists, create a new `annotation_*` id once.
* (Optional cleanup) If `data` becomes empty (no hidden/opacity/solo keys), delete the props annotation.

### Robust parsing + bounds checks

* `hidden.<i>`: only treat `"true"` as hidden.
* `opacity.<i>`: parse float; ignore NaN; clamp to [0,1] **for rendering only**.
* `solo`: parse int; ignore if invalid/out-of-range.
* Do **not** silently clamp indices; invalid persisted state should be ignored.

---

### Render rules (authoritative)

For each slice i:

1. If `solo` exists:

   * if `i !== solo`: treat as hidden (**do not render**)
2. Else if `hidden.i === true`: do not render
3. Else:

   * `baseOpacity = (selected ? 0.30 : 0.10)`
   * `finalOpacity = baseOpacity * opacityMultiplier(i)` where default multiplier = 1.0
   * If opacity is being dragged in UI: `opacityMultiplier(i)` uses `previewOpacity(i)` for selected layer

---

### UX decisions

* Controls appear as a small overlay HUD only when a slice is selected (not a panel-first UI).
* Controls apply to **selected slice only**:

  * 👁 toggle visibility
  * Solo toggle
  * Opacity slider

### Patch spam policy (same pattern as Slice 2)

* Visibility: 1 GraphPatch per click (commit immediately)
* Solo: 1 GraphPatch per click (commit immediately)
* Opacity slider:

  * while dragging: update local `previewOpacity` (no patches)
  * on pointer up: emit **one** GraphPatch to persist final opacity

### State behavior

* App keeps `previewOpacity: number | null` (for selected slice only).
* Effective opacity multiplier:

  * `effectiveOpacity = previewOpacity ?? persistedOpacity ?? 1.0`
* Preview clears on commit/cancel.

### Clearing keys

* Toggling visible back on removes `hidden.<i>` key (preferred over setting `"false"`).
* Setting opacity back to `1.0` removes `opacity.<i>` key.
* Solo toggle:

  * if `solo === selectedIndex`, clear `solo`
  * else set `solo = selectedIndex`

---

## Files to change / add

| File                          | Action                | Notes                                                                                                                                         |
| ----------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/selectors.ts`       | **Modify**            | Add `findLayerProps(state, spaceId)` → `{annotationId, props}` plus helpers `getHidden(i)`, `getOpacity(i)`, `getSolo()`.                     |
| `src/core/applyPatch.test.ts` | **Modify**            | Add tests for props annotation create/update/clear via patches.                                                                               |
| `src/App.tsx`                 | **Modify**            | Add handlers: `toggleHidden(i)`, `toggleSolo(i)`, `setOpacityPreview(val)`, `commitOpacity(i,val)`. Emit GraphPatches to `"ui.layers.props"`. |
| `src/ui/SpaceViewport.tsx`    | **Modify**            | Apply hide/solo/opacity render rules. Render HUD overlay when selection exists.                                                               |
| `src/ui/LayerControlsHUD.tsx` | **Create**            | Minimal overlay UI: buttons + slider. No TS hard-coded colors; CSS vars only.                                                                 |
| `src/styles.css`              | **Modify (optional)** | Add CSS vars for HUD surface/border/text (swappable).                                                                                         |

---

## Tests

Core-only (vitest):

* applyPatch:

  * create props annotation (put)
  * update props annotation (put same id overwrites)
  * clear keys by rewriting data without them
  * (optional) delete props annotation when data empty (del)
* selectors:

  * missing props annotation → defaults (no solo, all visible, opacity=1)
  * invalid `solo`/`opacity` values → ignored
  * valid keys parse correctly

(UI tests deferred for MVP.)

---

## TODO checklist

### Slice 3 (layer props spine)

* [ ] In `selectors.ts`:

  * [ ] Add `findLayerProps(state, spaceId)` with robust parsing + bounds checks
  * [ ] Helper accessors: `isHidden(i)`, `opacityMultiplier(i)`, `soloIndex()`
* [ ] In `App.tsx`:

  * [ ] Add `previewOpacity: number | null`
  * [ ] Implement `toggleHidden(selectedIndex)` emitting GraphPatch (add/remove `hidden.<i>`)
  * [ ] Implement `toggleSolo(selectedIndex)` emitting GraphPatch (set/clear `solo`)
  * [ ] Implement `setOpacityPreview(val)` (no patch)
  * [ ] Implement `commitOpacity(selectedIndex, val)` emitting GraphPatch (add/remove `opacity.<i>`)
* [ ] In `SpaceViewport.tsx`:

  * [ ] Apply render rules (solo > hidden > opacity)
  * [ ] Mount `LayerControlsHUD` overlay only when `effectiveSelectedIndex != null`
* [ ] Add `LayerControlsHUD.tsx`:

  * [ ] Eye button (hide/show)
  * [ ] Solo toggle
  * [ ] Opacity slider (preview + commit-on-pointer-up)
* [ ] Tests:

  * [ ] Extend `applyPatch.test.ts` for props annotation create/update/clear
  * [ ] Add selector tests for parse + defaults
 

### **Slice 4 — R3F Scrubber Plane** for Unbricked.

Context:

* App uses canonical `ProjectState`.
* Selection is persisted as Annotation:

  * schema: "ui.selection.layerIndex"
  * target: { kind:"Space", id: spaceId }
  * data: { layerIndex: "<int string>" }
* Selection commits must happen via **GraphPatch → applyPatch**.
* Preview states must remain ephemeral (no patches until commit).
* HUD (DOM overlay) already exists; scrubber must be **inside R3F**, not a DOM <input>.

Task:

1. Create a `ScrubberPlane` R3F component (mesh plane + translucent material) that sits inside the prism stack.
2. Plane position is derived from `effectiveSelectedIndex = previewLayerIndex ?? persistedLayerIndex`.
3. Add drag interaction:

   * onPointerDown: start dragging; capture pointer; temporarily disable OrbitControls if needed.
   * onPointerMove while dragging: compute drag position along stack axis (z), map to a floating index, update `previewLayerIndex` continuously (no GraphPatch).
   * onPointerUp: snap to nearest integer in [0..layerCount-1], emit exactly **one** GraphPatch to persist selection, clear preview.
4. Ensure scrubber remains usable even with solo/hide (scrubber should not be hidden by layer props).
5. No TS hard-coded colors; styling via CSS vars only if needed.

Acceptance:

* Drag updates selection live; release snaps and commits one patch.
* No patch spam during dragging.
* TypeScript strict passes; lint/test pass.

---

## Slice 5 — Undo / Redo (editor-grade spine) (NEXT)

### Goal

Add undo/redo so every committed change (selection commit, props commit, scrubber commit) is reversible.
This makes the “GraphPatch spine” feel like an editor, not a demo.

### Non-goals

- Cross-session history persistence.
- Patch inversion math (we can do that later).
- Time travel UI beyond undo/redo.

### Approach (MVP, robust)

Use immutable **ProjectState snapshots** (not inverse patches) for now.

State model in `App.tsx`:
- `past: ProjectState[]`
- `present: ProjectState`
- `future: ProjectState[]`

On every *committed* patch:
- `past.push(present)`
- `present = applyPatch(present, patch)`
- `future = []`

Undo:
- if `past.length > 0`:
  - `future.unshift(present)`
  - `present = past.pop()`

Redo:
- if `future.length > 0`:
  - `past.push(present)`
  - `present = future.shift()`

This is safe if we treat `ProjectState` as immutable (applyPatch returns new maps/objects).

### UX

- Header buttons: **Undo** / **Redo** (disabled when unavailable).
- Keyboard:
  - `Cmd/Ctrl+Z` → Undo
  - `Cmd/Ctrl+Shift+Z` (and/or `Cmd/Ctrl+Y`) → Redo

### Important: “commit” vs “preview”

Only committed actions affect history:
- Selection click commit ✅
- Scrubber release commit ✅
- Opacity release commit ✅
Preview states (dragging) do **not** push history.

### Files to change / add

| File | Action | Notes |
|------|--------|------|
| `src/App.tsx` | Modify | Introduce `past/present/future`. Route all commit handlers through `commitPatch(patch)`. Add keyboard + buttons. |
| `src/ui/HeaderBar.tsx` (optional) | Create | If header is getting crowded; otherwise keep inline in App. |
| `src/core/history.test.ts` (optional) | Create | Tiny unit test for undo/redo reducer (nice-to-have). |

### Acceptance criteria

- Any committed selection/props/scrub change can be undone/redone.
- Undo/redo restores both visuals and persisted annotations (because present state changes).
- After undo, committing a new patch clears redo stack.
- Typecheck/lint/tests pass.

### TODO

- [ ] Create `commitPatch(patch: GraphPatch)` helper in `App.tsx` that updates `past/present/future`.
- [ ] Refactor existing commit paths to call `commitPatch` (selection commit, scrubber commit, props commit).
- [ ] Add Undo/Redo buttons to header.
- [ ] Add keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y).
- [ ] (Optional) Add a small `history`

---

## Slice 6 — Layer Reorder (order mapping) (NEXT AFTER UNDO/REDO)

### Goal

Enable reordering of layers (slices) in BrickUI:
- The prism should render slices in the current order.
- Selection should follow the same logical layer identity after reorder.
- Reorder must be persisted via **Annotation + GraphPatch**.
- Reorder must be undo/redo-able (via Slice 5 history).

This is the first step toward “Photoshop layers” beyond selection/visibility/opacity/solo.

### Non-goals

- Layer groups.
- Multi-select reorder.
- Dragging multiple slices at once.
- Timeline/keyframes.

### Key decision: Represent order without new core types

We keep the existing `Space.layerCount` as the number of logical layers (indices `0..layerCount-1`).
We introduce a mapping annotation that defines the display/stack order.

### Data representation (single annotation per Space)

- `schema`: `"ui.layers.order"`
- `target`: `{ kind: "Space", id: spaceId }`
- `data`: `Record<string, string>`

Encoding:
- `order = "0,1,2,3,4"` (comma-separated list of unique ints of length `layerCount`)

Parsing rules:
- If missing/invalid: default order is `[0..layerCount-1]`
- Valid order must:
  - parse to ints
  - contain exactly `layerCount` items
  - be a permutation of `0..layerCount-1`
- If invalid → ignore and fallback to default.

### Render rules (authoritative)

Replace “render slice i at position from i” with:
- Determine `order[]`.
- For visual stack position `p` in `0..layerCount-1`:
  - let `layerIndex = order[p]`
  - render that layer at position corresponding to `p` (stack axis position)
  - apply props (hidden/opacity/solo) based on `layerIndex` (logical identity)

This makes reorder purely a *mapping from visual stack positions → logical layer indices*.

### Selection behavior across reorder (important)

Selection is stored as logical index:
- `"ui.selection.layerIndex" = "<layerIndex>"`

After reorder:
- The selected logical layer remains selected (same index).
- It simply appears at a different visual position (wherever `order` places it).

### UX options (pick MVP)

**MVP (recommended):** reorder via a minimal overlay “layer strip” with draggable handles.
- A vertical list of small “ticks” or labels for each layer index.
- Dragging a tick changes the order.
- Commit reorder only on pointer up (preview while dragging).

(We avoid panel-first UI but give a reorder affordance that doesn’t require precision dragging in 3D space.)

**Alternate (later):** reorder by dragging a slice in 3D along stack axis and swapping when it crosses neighbors.

For now, do MVP overlay.

### Patch spam policy

- While dragging: keep `previewOrder: number[] | null` in App state (no patches).
- On pointer up: emit **one** GraphPatch to persist `"ui.layers.order"` with `order="..."`.
- If preview results in default order, optionally delete the order annotation.

### Files to change / add

| File | Action | Notes |
|------|--------|------|
| `src/core/selectors.ts` | Modify | Add `findLayerOrder(state, spaceId)` + `serializeOrder(order)` + validation helpers. |
| `src/App.tsx` | Modify | Add `previewOrder: number[] | null`. Provide `onReorderPreview(order)` + `onReorderCommit(order)`. Persist via GraphPatch. |
| `src/ui/SpaceViewport.tsx` | Modify | Render layers by `effectiveOrder = previewOrder ?? persistedOrder`. Positions use visual index `p`, props use logical `layerIndex`. |
| `src/ui/LayerReorderHUD.tsx` | Create | Minimal overlay reorder UI (ticks/list). Preview + commit. No TS hard-coded colors. |
| `src/core/applyPatch.test.ts` | Modify | Add tests: order annotation create/update/invalid fallback parsing. |

### Acceptance criteria

- You can reorder layers via HUD drag.
- Reorder previews live (visual positions update while dragging).
- On release, exactly one patch is committed.
- Reorder persists across refresh.
- Selection + solo/hidden/opacity continue to apply to the same logical layer index after reorder.
- Undo/redo works (via Slice 5).
- Typecheck/lint/tests pass.

### TODO

- [ ] Add `findLayerOrder` selector with strict validation + default fallback.
- [ ] Add `previewOrder` + commit handler in App.
- [ ] Update SpaceViewport rendering to use `effectiveOrder`.
- [ ] Implement `LayerReorderHUD` overlay:
  - [ ] show layer “ticks” in current order
  - [ ] drag to reorder (preview)
  - [ ] commit on pointer up
- [ ] Extend tests for order annotation parsing + persistence.
- [ ] Run `pnpm typecheck && pnpm test && pnpm lint`.

---

---

## Slice 8 — fal.ai Image-to-Image (via drop-in proxy) (NEXT)

### Goal

Make the selected layer *actually editable* with AI:

- Provide an **Import Image** action for the selected layer (so we have a real input).
- Provide an **AI Edit (img2img)** action that sends the selected layer’s image through the **fal.ai drop-in proxy**.
- On success, commit a single GraphPatch that:
  - creates a new `Payload` for the output image
  - creates an `OperatorRun` capturing operator/provenance (inputs/outputs/params)
  - updates the selected layer to **display** the new payload (non-destructive “projection switch”)

### Non-goals (later)

- image→3D / mesh / splats
- mixing slices into 3D scene
- segmentation operators
- persistence-to-disk / cloud storage

---

## Data model (persistent)

### A) Layer “render payload” mapping (single source of truth)

We represent “which payload is displayed on layer i” as one annotation per Space:

- `schema`: `"ui.layers.render"`
- `target`: `{ kind: "Space", id: spaceId }`
- `data`: `Record<string,string>`
  - `payload.<i> = "<payloadId>"`

Rules:
- If missing, that layer renders “blank” (no texture) until an image is imported/generated.
- Keys must be removed (not set to `"null"`) when clearing.

### B) Operator provenance

Every successful AI edit creates an `OperatorRun`:

- `operator`: `"fal.img2img"` (or more specific if you prefer, e.g. `"fal.<model>.img2img"`)
- `status`: `"succeeded"`
- `inputs`: `[ { kind:"Payload", id: <inputPayloadId> } ]`
- `outputs`: `[ { kind:"Payload", id: <outputPayloadId> } ]`
- `params`: string record of:
  - `prompt`
  - `model` (if applicable)
  - `strength` / `guidance` / `seed` etc (as strings)
  - `proxyRoute` (optional, for debugging: which proxy endpoint was used)

(If the request fails: show error in UI; optionally create a failed OperatorRun later, but MVP can keep failures ephemeral.)

### C) Payload requirements (must be correct)

`PayloadSchema` requires non-empty `sha256` and `bytes`.

For any imported/generated/AI-returned image:
- compute bytes from Blob size
- compute sha256 from Blob bytes using WebCrypto
- store:
  - `mediaType` (e.g. `"image/png"` / `"image/jpeg"`)
  - `uri` (see below)
  - `sha256` (hex)
  - `bytes` (int)

URI strategy (MVP):
- Prefer `data:` URLs for imported/returned images (self-contained, easy display).
- If proxy returns a stable URL, you may store that URL directly as `uri` **only if** it’s accessible from the browser and stable.
- The key is: the plane renderer must be able to `fetch` / `loadTexture` from the `uri`.

---

## Proxy contract (Phase 1 research)

We have a drop-in fal.ai proxy. Do NOT guess endpoints.

Document (in `notes/research.md`):
- base URL (env var)
- route path for img2img
- request format (JSON vs multipart)
- response shape (url vs base64 vs dataUrl)

Implementation must follow that contract exactly and Zod-validate it.

---

## UI / Interaction (MVP)

In the selected-layer HUD:

1) **Import Image**
- Opens file picker.
- Converts selected file → (Blob) → compute sha256/bytes → create Payload.
- Commits one patch that:
  - `put Payload(inputPayload)`
  - `put/overwrite ui.layers.render payload.<i> = inputPayload.id`

2) **AI Edit (img2img)**
- Opens a small prompt + params UI (keep it minimal):
  - prompt (required)
  - strength (optional)
  - seed (optional)
- While running:
  - show “running” state (ephemeral)
  - disable the AI button
- On success:
  - build output Payload + OperatorRun
  - commit **one** GraphPatch that:
    - `put Payload(outputPayload)`
    - `put OperatorRun(oprun)`
    - update `ui.layers.render payload.<i> = outputPayload.id`
- No patch spam while typing or while request is in-flight.

Rendering:
- If a layer has `ui.layers.render payload.<i>`, load that payload URI as a texture and map it onto that slice plane.
- (If solo/hide is active, still obey those rules; render mapping only affects visible slices.)

---

## Patch spam policy

- Import: 1 patch per import.
- AI run: 1 patch per success (and 0 patches while running).
- Any sliders for params:
  - preview in UI only
  - commit only when user presses “Run” (not during drag).

---

## Files to change / add

| File | Action | Notes |
|------|--------|------|
| `src/core/selectors.ts` | Modify | Add `findLayerRenderPayload(state, spaceId, layerIndex) → PayloadId | null` and `findRenderAnnotationId(...)`. |
| `src/core/types.ts` | No change | Keep core stable; store operator params as string record. |
| `src/core/schema.ts` | No change | Zod already supports Payload/OperatorRun. Add separate Zod schema for proxy response (not in core). |
| `src/core/crypto.ts` | Create | `sha256Hex(bytes: ArrayBuffer) → string` using `crypto.subtle.digest`. |
| `src/services/falProxy.ts` | Create | Typed `runImg2Img(...)` calling the drop-in proxy + Zod-validated response. No `any/unknown`. |
| `src/ui/LayerControlsHUD.tsx` | Modify | Add Import + AI Edit UI, prompt input, run button, running/error display. |
| `src/ui/SpaceViewport.tsx` | Modify | When rendering slice plane, if payload exists, load texture from payload.uri (drei/useTexture or manual TextureLoader). |
| `src/core/applyPatch.test.ts` | Modify | Tests: render mapping annotation put/update; payload creation + mapping; operatorRun creation + mapping. |

---

## Tests (vitest)

- Selector defaults:
  - no render annotation → null payload for all layers
- Import flow (core-only):
  - patch adds Payload + updates render mapping
- AI success flow (core-only):
  - patch adds output Payload + OperatorRun + updates render mapping
- Response parsing (service):
  - Zod validates proxy response shape (at least one happy-path sample)

(Mock fetch for service tests.)

---

## Acceptance criteria

- Importing an image onto selected layer shows it on that slice plane.
- AI Edit returns an edited image and swaps that layer’s render payload to the new output.
- An `OperatorRun` is created for each successful AI edit with correct input/output references.
- Payload objects have correct `sha256` and `bytes`.
- No patch spam: only commit on import and on successful run.
- `pnpm typecheck && pnpm test && pnpm lint` pass.

---

## TODO checklist

### Phase 1: research (write into notes/research.md)
- [ ] Document proxy base URL + endpoint path for img2img
- [ ] Document request format + required fields
- [ ] Document response schema (url vs base64/dataUrl)
- [ ] Confirm whether proxy expects multipart upload or accepts data URLs

### Phase 2: implement
- [ ] Add render payload selector + annotation id reuse strategy
- [ ] Add `crypto.ts` sha256 helper
- [ ] Add `falProxy.ts` with strict request/response typing + Zod parse
- [ ] Add Import Image flow (file picker → Payload → render mapping patch)
- [ ] Add AI Edit flow (prompt → proxy call → Payload+OperatorRun+render mapping patch)
- [ ] Texture rendering on planes from payload.uri
- [ ] Add tests for render mapping + operator run objects
- [ ] Run `pnpm typecheck && pnpm test && pnpm lint`

---




### Final
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm test`
- [ ] Run `pnpm lint`
- [ ] Fix failures immediately.
