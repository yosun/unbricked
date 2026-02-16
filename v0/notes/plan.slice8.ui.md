### Slice 8 — UI Plan (Distilled)

**Goal:** Make URL-addressable Spaces feel like *places you enter*, not *resources you load*. Coordinates/URLs are implementation detail; **presence is the UI**.

---

## 8.1 Core UX principles

* **Camera-first:** navigation is movement + portal entry; URL updates silently.
* **No raw IDs by default:** hide UUID/float soup unless “Advanced” toggled.
* **Continuity > snapping:** all Space transitions animate (ease in/out).
* **History = path traveled:** back/forward behaves like “return / re-enter”.

---

## 8.2 MVP UI components (must-have)

### A) SpaceAddressHUD (top-center, subtle)

**Default collapsed:**
`◈ Space` (or `◈ Space 0 · 0 · 0` if you want visible coords)

**On click expands (dropdown):**

* **Current Space:** display friendly address (coords rounded)
* **Copy link**
* **Set as origin**
* **Return to origin**
* **Toggle: Advanced (show raw URL/UUID/precise coords)**

**Placement:** absolute top center; translucent “compass” vibe (not a form).

---

### B) Portal affordance on objects (enterable Spaces)

On hover/select of brick/object:

* `↳ Enter` (primary)
* Optional: `Open in new tab`

**Behavior:** click triggers **camera dolly-in** → loads target Space → URL updates.

---

### C) Spatial transitions (required for believability)

Every navigation action uses:

* **camera animation**
* **preserve orientation** where possible
* optional micro “warp” / fade for loading

---

### D) Spatial back/forward

Bind:

* Browser back/forward (popstate)
* In-app buttons: `← Return` / `→ Re-enter` (optional)

**Semantics:** undo camera/space navigation, not editor operations.

---

## 8.3 Optional (nice-to-have, not MVP)

### E) Galaxy/Minimap overlay (advanced)

* origin marker
* neighboring anchors
* forks/derivatives graph
  Hidden by default, toggled from HUD.

---

## 8.4 Implementation slices (quick breakdown)

1. **Add `SpaceAddressHUD.tsx`**

   * reads current space identity (coords + id)
   * dropdown actions (copy, set origin, return)
   * advanced toggle

2. **Add “Enter” affordance in Brick hover UI**

   * dispatch `navigateToSpace(spaceRef)`

3. **Implement `navigateToSpace(spaceRef)`**

   * animates camera
   * loads space state
   * updates URL (pushState)

4. **Wire popstate for browser back/forward**

   * restores prior space + camera pose
 