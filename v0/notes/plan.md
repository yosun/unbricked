# Plan — Slice Selection via Annotation (v2)

**Do not implement until approved.** Human says **"implement it all"** to proceed.

## Goal

Click a prism slice to select it. The selected slice is visually emphasized. Selection is persisted as an **Annotation** with schema `"ui.selection.layerIndex"` targeting the Space, round-tripped through the **GraphPatch** pipeline.

This slice should prove:
- **3D-first spatial selection** (no panel-first UX)
- **audit spine** wiring (UI → GraphPatch → applyPatch → state)

## Non-goals

- Hover preview / highlight (can add later).
- Multi-select (single layer selection only).
- Deselect by clicking the background.
- Changing `Annotation.data` from `Record<string, string>` to a richer type.
- Adding zustand or any new dependency.
- Color theming system (we avoid hard-coded colors for MVP; rely on opacity/scale only).

## Approach

### State management: `useState` in App, prop-drilled

- `App.tsx` holds `ProjectState` in `useState`.
- `SpaceViewport` is a pure view: it receives `selectedLayerIndex` and emits `onSelectLayer(index)`.

### Annotation convention (persist selection)

We store selection as exactly one annotation per Space:

```ts
// schema
"ui.selection.layerIndex"

// target
{ kind: "Space", id: spaceId }

// data (string values, per Record<string, string>)
{ layerIndex: "3" } // 0-based
```

**Stable ID strategy (answers “3) ?”):**
- On each selection change, **reuse the same Annotation ID** if a selection annotation already exists for that Space (same `target.id` + `schema`).
- If none exists, create a new `annotation_*` id once, then keep overwriting it on subsequent selections.
- For clearing selection (Escape), delete that one annotation if present.

This avoids accumulation and survives reloads because we can re-discover the selection annotation by schema+target.

### Visual emphasis (no hard-coded colors)

Selected slice gets:
- Higher opacity (e.g. **0.30** vs **0.10** unselected)
- Slight scale bump (1.0 → **1.02**) for a subtle “lift”

No hard-coded color. (If we add theming later, do it via swappable tokens in a single theme module / CSS variables + a bridge—not inlined literals.)

### Helper: selection lookup + bounds checks

We need **robust parsing** (fix #1): missing/NaN/out-of-range values should produce `null`. Also clamp is acceptable, but for selection it’s usually better to **reject** invalid persisted state rather than silently clamping.

Create a helper in core (pure, testable):

```ts
// src/core/selectors.ts
export function findLayerSelection(
  state: ProjectState,
  spaceId: SpaceId,
): { annotationId: AnnotationId; index: number } | null {
  const ann = Object.values(state.annotations).find(
    (a) => a.target.kind === "Space" && a.target.id === spaceId && a.schema === "ui.selection.layerIndex",
  );
  if (!ann) return null;

  const raw = ann.data.layerIndex;
  if (raw === undefined) return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const idx = Math.trunc(n);
  if (idx < 0) return null;

  const space = state.spaces[spaceId];
  if (!space) return null;

  if (idx >= space.layerCount) return null;

  return { annotationId: ann.id, index: idx };
}
```

(We intentionally require the Space to exist and the index to be within `layerCount`.)

### Patch plumbing type fix (important)

Currently `applyPatch` accepts `JsonValue`, but `newPatch()` returns a `GraphPatch` type that is **not assignable** to `JsonValue` due to TypeScript index-signature rules. This will block the feature at compile-time.

**Fix:** change `applyPatch` signature to accept `GraphPatch`:

- `src/core/applyPatch.ts`: `applyPatch(state: ProjectState, patchInput: GraphPatch): ProjectState`

Zod validation still happens inside `applyPatch` via `GraphPatchSchema.parse(...)`.

## Files to change / add

| File | Action | Details |
|------|--------|---------|
| `src/core/applyPatch.ts` | **Modify** | Change `patchInput` type to `GraphPatch` (import from `types.ts`). |
| `src/core/selectors.ts` | **Create** | `findLayerSelection(...)` helper (pure, tested). Export from `src/core/index.ts`. |
| `src/App.tsx` | **Modify** | Hold `ProjectState` in `useState`. Use `findLayerSelection`. Implement `handleSelectLayer` + `handleClearSelection`. Wire Escape key. Pass props to `SpaceViewport`. |
| `src/ui/SpaceViewport.tsx` | **Modify** | Accept `selectedLayerIndex: number \| null` + `onSelectLayer: (index: number) => void`. Add `onClick` to each slice. Apply emphasis via opacity/scale only. |
| `src/core/applyPatch.test.ts` | **Create** | Unit tests: put selection annotation (create), update selection annotation (overwrite), clear selection (del). |

## API / Types / Schemas

- No schema shape changes are required: `AnnotationSchema` already supports this use case.
- We **do** change one function signature:
  - `applyPatch(state, patchInput)` input type becomes `GraphPatch` (still JSON-safe; still validated by Zod).
- No changes to `Annotation.data` type.

## UI behavior

1. **Initial state**: No slice selected (no selection annotation). All slices render at default opacity (e.g. 0.10).
2. **User clicks slice #3**:
   - `onSelectLayer(3)` fires.
   - App determines current selection annotation id:
     - if exists: reuse its `annotationId`
     - else: create new `annotation_*` id
   - App creates a `GraphPatch` with a single `put` op for the Annotation value.
   - App calls `applyPatch` and updates `ProjectState`.
   - SpaceViewport re-renders: slice 3 gets opacity bump + slight scale.
3. **User clicks slice #5**:
   - Same flow; the annotation is overwritten with `{ layerIndex: "5" }` (same annotation id).
4. **User presses Escape** (fix #4):
   - If selection annotation exists: App emits `GraphPatch` with a single `del` op for that annotation id.
   - UI returns to “no selection”.
5. **OrbitControls**:
   - Click selection should not fight with drag. (R3F `onClick` only fires if pointer didn’t move significantly; fine for MVP.)

## Tradeoffs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| State management | `useState` in App | zustand store | Simplest; no deps; good for MVP. |
| Selection persistence | Annotation + GraphPatch | ephemeral UI state | Spec requires persistence; also aligns with audit spine. |
| Annotation ID reuse | reuse existing | new id per click | Prevents annotation accumulation; survives reloads via lookup by schema+target. |
| Visual emphasis | opacity + scale only | color/glow/shaders | Avoids hard-coded colors; no shaders/deps; minimal. |
| Invalid persisted index | treat as null | clamp | Safer: don’t hide bad state; keeps invariants crisp. |

## TODO

- [x] 1. **core/applyPatch.ts**: change signature to accept `GraphPatch` (import type). Also fixed pre-existing branded-ID type mismatches and `exactOptionalPropertyTypes` issues.
- [x] 2. **core/selectors.ts**: implement `findLayerSelection` helper.
- [x] 3. **core/index.ts**: export selectors.
- [x] 4. **App.tsx**: lift `ProjectState` into `useState`, initialized from `sampleProject.state`.
- [x] 5. **App.tsx**: use `findLayerSelection` to derive `{ selectedLayerIndex, selectionAnnotationId }`.
- [x] 6. **App.tsx**: implement `handleSelectLayer(index)` with bounds-check, annotation ID reuse, GraphPatch round-trip.
- [x] 7. **App.tsx**: implement `handleClearSelection()` (del op if selection exists).
- [x] 8. **App.tsx**: add `keydown` listener; Escape calls `handleClearSelection`.
- [x] 9. **SpaceViewport.tsx**: update props; add `onClick={() => onSelectLayer(i)}` on each slice with `e.stopPropagation()`.
- [x] 10. **SpaceViewport.tsx**: apply emphasis (opacity 0.3 vs 0.1, scale 1.02 vs 1) based on `selectedLayerIndex`.
- [x] 11. **applyPatch.test.ts**: 5 tests — create, overwrite, clear, out-of-range rejection, negative rejection.
- [x] 12. `pnpm typecheck` ✓, `pnpm test` ✓ (5/5), `pnpm lint` ✓ (0 new errors; 11 pre-existing).
