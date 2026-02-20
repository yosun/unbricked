# ux.aihistory.md — AI History UX (Seed Paths)

## Implementation Status
All baseline UX implemented. See `plan.aihistory.md` for file locations.

## Mental model
- Slice shows exactly one state at a time: **Current** = `displayStateId`.
- **Slice Root** = `rootStateId` (root anchor inside history UI only).
- Document Source Image is separate and must not be confused with Slice Root.

## Cursors (always explicit)
- 👁 `displayStateId`: click node/thumb sets this; updates Keyspace + Keyframe immediately.
- ⚙ `operationStateId`: “Use as input” sets this; next AI op uses this input.
- Cursor badges (👁/⚙) appear on node thumbnails in Universal view and Layers panel.

## N paths (seed variants)
- N counts seed variants from Slice Root (children of `rootStateId`).
- Panel thumbnails for paths show **path heads** (current “final” per seed).
- Extending a seed path updates its head thumbnail but does not change N.

## Baseline UI
1) Hidden slices slide left.
2) Persistent top-down Keyframe preview reflects composite of 👁 across slices (debounce ok).

## Universal View (AI tracking mode for selected slice M)
- Left anchor: **Slice Root** node + **Current** node.
- To the right: N seed lanes diverging from Slice Root.
- v1: each seed lane can be a row of thumbnails; show minimal op badges (opType+model).
- Clicking a node time-travels: sets 👁 immediately; keyframe updates.

## Layers View (path panel)
- Layer row always reflects Current (👁).
- Badge “N” (seed path count) opens anchored panel:
  - Header: Slice Root thumb + Current thumb
  - N seed path head thumbs (highlight if Current belongs to that path)
  - Below: ancestry/op list for selected seed path context
- Click any thumb => sets 👁 immediately.
- “Use as input” => sets ⚙.

## Edge cases
- Missing thumbs: placeholders remain clickable.
- Current may be intermediate: highlight where it exists; heads still show per seed.
- No-op history (no seed paths): badge hidden or N=0; header still works when history UI is opened.