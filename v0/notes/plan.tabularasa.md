# Plan — Tabula Rasa → Image Ingest → Default Operation → BrickUI Expand (v1)

## North Star

Unbricked begins as **tabula rasa**: a quiet white space with a blinking unbrick-cube cursor.
The user taps anywhere — not to open a “file dialog” as a ritual of bureaucracy — but to **enter an idea**.

From that first gesture, we support two births of an image:

1. **Import** an existing image
2. **Describe** an image and generate it via **fal.ai** (through our proxy)

Either way, the result is the same:
the image **expands into 3D**, runs the **default operation** (e.g., SAM3 segmentation), and becomes **BrickUI**.

We don’t “apply filters.”
We **reveal structure**.

---

## Goals

* Provide a single, intuitive entry flow from **blank space → image → BrickUI**.
* Support a **Settings panel** that defines the **default operation** for new images (SAM3 segmentation, Canny edges, etc.).
* Make the default operation visible (and optionally overridable) inside the ingest flow.
* Turn the imported/generated image into a **BrickUI object** in-world (3D-first), not a flat document artifact.
* Ensure the pipeline produces durable editor-grade provenance (OperatorRuns + GraphPatch), even in MVP form.

---

## Non-goals (for this slice)

* Image-to-3D reconstruction (Gaussian splats / mesh) beyond “image becomes a plane / textured slice.”
* Advanced operator parameter UI (we’ll allow minimal knobs, but no huge control panels).
* Full graph editor UI or node view.
* Multi-image composition, timelines, or multi-space packages.

---

## User Experience Spec

### A) Tabula Rasa Start State

* The canvas shows:

  * A subtle **unbrick cube cursor** (blinking).
  * Minimal hint text: “Tap to begin.”
* Any click/tap on empty space opens **Image Ingest**.

### B) Image Ingest Panel (the “first spell”)

Panel contains:

* Two tabs (or two big buttons):

  * **Import Image**
  * **Describe → Generate**
* A “Default operation” row at the top:

  * Label: **Default operation**
  * Control: dropdown (SAM3 segmentation, Canny edges, None, etc.)
  * This dropdown is pre-filled from **Settings**
  * Optional “gear” icon to jump to Settings panel

#### Import Image flow

* User selects a file
* We show:

  * quick thumbnail preview
  * “Create Space” (primary)
  * “Cancel”
* On commit:

  * create payload
  * spawn the image in-world (centered / framed)
  * immediately enqueue the default operation

#### Describe → Generate flow (fal.ai)

* Text box prompt
* “Generate” (primary)
* States:

  * generating…
  * success: preview shown
  * failure: error + retry
* On commit:

  * store returned image as payload (url or downloaded blob, depending on current architecture)
  * spawn in-world
  * enqueue default operation

### C) BrickUI Expansion (the reveal)

When the image is committed:

* The image appears as a plane (or thin slab) in the 3D space.
* We show an **operation progress affordance** (small, calm):

  * “Segmenting…” (or “Detecting edges…”, etc.)
* When the default operation completes:

  * BrickUI “unfolds” / “expands”:

    * segmented outlines appear
    * slices become interactable objects
    * selection works immediately

**Important:** BrickUI expansion should feel like a *single semantic event*, not a chain of UI chores.

---

## Settings Panel Spec

Add/update Settings panel to include:

### “Default operation for new images”

* Dropdown list backed by our operation registry:

  * SAM3 segmentation
  * Canny edge detection
  * (optional) Scene detection
  * (optional) Depth estimate
  * None (manual / no auto-processing)

### Persistence

* Persist settings locally (localStorage is acceptable for MVP).
* Treat a settings change as an editor action *only if we want it undoable*.

  * MVP recommendation: settings changes are not undoable (they’re global preferences).
  * But we should still record them in a simple “preferences” object for reproducibility.

---

## Operation Registry (MVP but real)

Define a simple internal registry for operations:

Each operation defines:

* `id` (stable string)
* `label`
* `kind` (local | remote)
* `inputs` (image payload required)
* `outputs` (segments | edges | masks | annotations)
* `defaultParams` (optional minimal)

MVP operations:

* **sam3.segment**

  * output: segments / masks
* **canny.edges**

  * output: edge map / overlay + optional contours
* **none**

  * output: none (just place image)

We should treat the “default operation” as a first-class concept that is easy to expand.

---

## Data & State (editor-grade spine, minimal)

### New concept: Project Preferences

* `projectPreferences.defaultImageOperationId`

### Image ingest creates:

* A new Space node (or inserts into current Space, depending on current navigation)
* A new Image payload reference

### Applying the default operation creates:

* an OperatorRun record (even if minimal)
* a resulting derived payload/annotation (segments, edges)
* a GraphPatch that attaches the derived artifacts to the image layer / BrickUI object

The point is: the UI magic remains “one flow,” but the data stays composable.

---

## Async + Failure Modes

We need explicit states for remote operations:

* queued → running → success | error | canceled

If SAM3 (or other operation) fails:

* keep the image placed
* show a small warning badge
* allow “Retry operation” or “Choose different operation”

If fal.ai generate fails:

* keep the panel open with error + retry
* do not create partial Space

---

## Visual / Motion Notes (minimal but meaningful)

* “Tap to begin” → panel appears with soft motion (not modal violence).
* On commit, the image should **arrive** into space with a slight depth cue:

  * it becomes a tangible object, not a flat upload.
* BrickUI expansion:

  * outlines/masks fade in and lock to geometry
  * no fireworks; just “ah, structure.”

---

## Implementation Steps (Slices)

### Slice 1 — Preferences plumbing

* Add projectPreferences storage (local + in-memory).
* Add Settings panel UI for default operation.

### Slice 2 — Image Ingest panel

* Tabula rasa click opens panel
* Import image path → preview → commit

### Slice 3 — fal.ai generate path

* Prompt → generate → preview → commit
* Connect to our proxy contract

### Slice 4 — Default operation execution

* When an image is committed, run the selected default operation
* Track async state + error handling

### Slice 5 — BrickUI expansion hookup

* Convert operation outputs into BrickUI interactables
* Ensure selection works immediately after completion

---

## Acceptance Criteria

* From a blank start, a user can:

  1. tap anywhere
  2. import an image (or generate one)
  3. see it appear in 3D space
  4. see the default operation run automatically
  5. end with BrickUI segmentation ready for interaction

* Settings panel:

  * changing default operation affects subsequent imports/generations

* Robustness:

  * remote operation failures do not break the space
  * user can retry with same or different operation

---

## Demo Script (for the product narrative)

“In the beginning, there was an idea.”
Tap.
Import or describe.
The image arrives into space.
And without asking you to become a pipeline engineer, Unbricked reveals the structure inside the image — as BrickUI.

Because the unexamined brick is not worth editing.
