# Research (v2)

## Repo overview

**Stack**: React 18 + R3F (react-three-fiber) 8 + drei 9 + Vite 5 + TypeScript strict + Zod 3 + vitest (jsdom env). No tests exist yet.

**Structure**:
- `src/core/` — canonical data model (types, Zod schemas, ID generation, GraphPatch creation, patch application).
- `src/ui/SpaceViewport.tsx` — sole UI component: R3F `<Canvas>` rendering a `SpacePrism` (wireframe box + translucent layer planes) with `OrbitControls`.
- `src/App.tsx` — shell: header bar + SpaceViewport.
- `notes/` — research.md (this file), plan.md (implementation plan).
- `docs/` — vision, data-model, ui-philosophy, trace-flow, copilot-setup.
- `.github/instructions/` — scoped copilot instructions for core, ui, docs.

## Data model notes

### Current canonical types (src/core/types.ts)

| Type | Key fields | Notes |
|------|-----------|-------|
| `Space` | `id`, `name`, `layerCount` | MVP uses `layerCount` to render slices. |
| `Edge` | `edgeKind`, `from`, `to` | Not used yet in UI. |
| `Payload` | `mediaType`, `uri`, `sha256` | Not used yet. |
| `Annotation` | `target`, `schema`, `data` | `data` is `Record<string, string>` (we can store `layerIndex` as string). |
| `OperatorRun` | `operator`, `inputs`, `outputs`, `params` | Not used yet. |
| `GraphPatch` | `baseRevision`, `ops[]` | `ops` are `put`/`del`. `put.value` is `JsonValue`. |
| `ProjectState` | `manifest`, maps, `revision` | In-memory store; revision increments per patch. |

### Patch application (src/core/applyPatch.ts)

- Uses Zod to validate a patch and each `put` object by kind.
- Enforces `baseRevision === state.revision`.
- Copies maps, applies ops, increments `revision`.

**Important typing gap discovered**:
- `applyPatch` currently accepts `patchInput: JsonValue`, but `newPatch()` returns `GraphPatch`.
- `GraphPatch` is JSON-safe, but **not assignable** to `JsonValue` in TS due to index-signature rules.
- This does not surface yet because the UI doesn’t call `applyPatch`. It will surface immediately when we wire selection.

Plan should fix by changing `applyPatch` input type to `GraphPatch`.

## UI notes (src/ui/SpaceViewport.tsx)

- Renders a prism volume + N slice planes based on `layerCount`.
- Uses basic materials and `OrbitControls`.
- Currently has **no pointer interaction** and no selection state.

### Missing for selection feature

1. No selection persisted in ProjectState as Annotation.
2. No click handlers on slice meshes (`onClick`).
3. No visual differentiation for selected vs unselected slices.
4. No GraphPatch is emitted/applied for selection changes.
5. No “clear selection” behavior (Escape).

(We will lift state to `App.tsx` and keep `SpaceViewport` view-only.)

## Invariants to preserve

1. Every persisted change → **GraphPatch** (selection must go through patch pipeline).
2. TS types + Zod schemas must stay in sync.
3. 3D-first: selection is spatial/pick-based, not panel-based.
4. `Annotation.data` is `Record<string, string>` — store `layerIndex` as string.
5. `applyPatch` validates baseRevision and parses per-kind objects with Zod.
6. No `any` / `unknown` in code.

## Exact file touchpoints for feature (aligned with plan)

| File | Action |
|------|--------|
| `src/core/applyPatch.ts` | Change signature to accept `GraphPatch` (typing fix) |
| `src/core/selectors.ts` | Add selection lookup helper (pure, testable) |
| `src/App.tsx` | Hold ProjectState in `useState`, emit patches, wire Escape |
| `src/ui/SpaceViewport.tsx` | Add click handlers + apply visual emphasis (opacity/scale only) |
| `src/core/applyPatch.test.ts` | Add minimal unit tests for selection annotation put/update/del |

## Risks / gaps

1. **Type mismatch will block compile** once UI calls `applyPatch` unless we change the signature to accept `GraphPatch`.
2. **Annotation.data is Record<string, string>**: storing `layerIndex` as string is slightly awkward but consistent. Don’t expand the spine for this slice.
3. **Selection as persisted state**: every click produces a GraphPatch. Spec requires it; also useful for share/replay later.
4. **Index validity drift**: if `layerCount` changes, persisted `layerIndex` may become invalid. We should treat invalid as “no selection” (not clamp).
5. **No tests exist**: add one core unit test file for the patch round-trip to keep the spine honest.

## Recommendation

Proceed with the single thin slice:
- spatial slice click selection
- persisted as Annotation via GraphPatch
- Escape to clear selection

This proves the Unbricked essence (spatial layers + audit spine) without building a layer panel or a graph UI.
