# AI History UX (Infinitely Reversible Slices)

This document defines UX semantics for **per-slice AI operation history** with **branching** and **time travel** in Unbricked.

---

## Core objects (UX mental model)

### Slice

A slice is one editable object in Keyspace. It displays exactly one state at a time.

### Original

“Original” is the **root state** of the slice’s history DAG (`rootStateId`).

* Shown **only** inside AI history UI.
* Not a toggle/mode for the layer stack.

### Current

“Current” is the state the slice is currently displaying (`displayStateId`).

* Layer stack row always reflects Current.
* Keyframe preview always composites Current for all slices.

---

## Two cursors (must remain explicit)

### 👁 Display cursor (`displayStateId`)

* Controls what is rendered on the slice in Keyspace.
* Therefore controls what appears in:

  * Keyframe preview (top-down composite)
  * Layer stack row thumbnails / visuals

### ⚙ Operation cursor (`operationStateId`)

* Controls which state will be used as input to the next AI operation.
* May differ from 👁.

### Default interaction rules

* Clicking a node/thumbnail => sets **👁 display cursor**
* Separate “Use as input” affordance => sets **⚙ operation cursor**
* Both cursors must be visible in UI at all times when history UI is shown.

Recommended cursor visibility (v1)

* On each node/thumb:

  * Eye badge when state == 👁
  * Gear badge when state == ⚙
  * If both: show both badges (or merged dual badge)
* In headers: show explicit labels “Current (👁)” and “Input (⚙)” where useful.

---

## Global invariants (must never be violated)

1. The layer stack is always the slice’s **Current (👁)** state.
2. Keyframe preview is always the composite of all slices’ **Current (👁)** states.
3. “Original” is a root anchor in history UI, not a view mode.
4. History is a **DAG**; paths are derived, not stored as duplicated arrays.
5. Clicking history is “time travel”: it immediately updates the slice render + keyframe preview.

---

## Baseline UI requirements

### Hidden slice behavior

Hidden layer slices slide **left** (not right). Keep existing interactions intact.

### Persistent Keyframe preview

Add a persistent **Top-down Keyframe preview** UI element that reflects the current Keyspace composite.

* Driven exclusively by 👁 display cursors across slices.
* Updates when display cursor changes (debounce acceptable).
* Must not block interaction; stale preview is acceptable briefly during rapid scrubbing.

---

## Universal View (AI Tracking Mode)

AI tracking mode applies to the currently selected slice **M**.

### Layout (required)

Left anchor shows two explicit nodes side-by-side:

1. **Original** node = `rootStateId` (fixed label “Original”)
2. **Current** node = `displayStateId` (fixed label/badge “Current”)

To the right: history visualization of the slice’s DAG/branches.

* All branches diverge from **Original**.
* “Current” is highlighted wherever it exists in the graph.

### Interaction (required)

* Click node => set 👁 display cursor, update Keyspace + Keyframe immediately
* “Use as input” => set ⚙ operation cursor
* Running an AI op uses ⚙ as input; creates a new OpEdge and output StateNode(s)

### Visualization v1 (acceptable minimum)

* Show each **leaf path** as a row of thumbnails (ancestry chain to root).
* Shared root is **Original**.
* “Current” is highlighted if it appears in any row.
* Optional later: merged DAG layout with connecting curves.

---

## Layers View (Path Panel)

### Badge on layer stack row

If a slice has history:

* Show circular badge “N” where **N = number of leaf states** (branch finals).
* Badge opens an anchored panel (no navigation away).

### Panel content (required)

Header shows two thumbnails side-by-side:

1. **Original** thumbnail (`rootStateId`)
2. **Current** thumbnail (`displayStateId`)

Then:

* Leaf thumbnails (branch finals)

  * Highlight leaf == Current
* Below: ancestry chain for selected leaf/path context

  * Intermediate nodes as clickable thumbnails (or compact strip)

### Panel interactions (required)

* Click any thumbnail (leaf or intermediate) => sets 👁 immediately (updates Keyspace + Keyframe + layer row)
* “Use as input” action => sets ⚙ operation cursor
* Cursor indicators (👁/⚙) must be visible on thumbnails

---

## UX edge cases (expected behavior)

* Missing thumbs: show placeholder + keep clickability.
* History exists but cursors missing (migration): both default to a reasonable leaf else root.
* A leaf may equal Original (no-op history): badge can show N=1; Current highlight still applies.
* Current may be intermediate (not a leaf): highlight “Current” where it exists; leaf list still shows true leafs.

---

## Performance / feel targets (v1)

* Clicking a node feels instant for the slice render; keyframe preview may update with short debounce.
* Scrubbing through history should not freeze UI.
* Avoid expensive recompute loops during rapid selection.

---

## Success criteria (UX)

* Users can always answer:

  * “What am I seeing?” (👁)
  * “What will my next AI op use as input?” (⚙)
* Users can create branches naturally by setting ⚙ to an earlier state and re-running an op.
* Layer stack never lies: it always reflects Current (👁).
