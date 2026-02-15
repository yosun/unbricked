---
name: "Unbricked UI Rules"
description: "3D-first prism slices; avoid form-based layer panels"
applyTo: "src/ui/**/*.ts,src/ui/**/*.tsx,src/App.tsx"
---

# UI rules (3D-first)
- Default mental model: **3D iso is primary**, 2D is a projection.
- Layers are spatial slices in a translucent prism; selection should be spatial/pick-based.
- Avoid “form-first” UX and heavy panels; keep the MVP interaction minimal and legible.
- Keep R3F components small; prefer explicit props and lightweight state.
