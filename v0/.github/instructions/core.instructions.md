---
name: "Unbricked Core Rules"
description: "Data model, zod validation, GraphPatch discipline"
applyTo: "src/core/**/*.ts"
---

# Core (src/core) rules
- Maintain invariants: Space/Edge/Payload/Annotation/OperatorRun/GraphPatch/Manifest stay coherent.
- Any persisted change requires both TS type updates and Zod schema updates.
- Prefer pure functions; keep patch application deterministic and validation-first.
- Do not introduce `any` or `unknown`.
- When adding fields: consider migration/defaults and how older manifests behave.
