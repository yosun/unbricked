# Unbricked — Agent Operating Rules (Claude 4.6 / Copilot)

This repo follows the “Research → Plan → Annotate → Todo → Implement” workflow.

## Non-negotiable workflow
1) **Research**
   - Deep-read relevant folders.
   - Write findings into **notes/research.md** (persistent artifact).
2) **Plan**
   - Write a detailed **notes/plan.md** with:
     - file paths to be modified/created
     - code snippets where appropriate
     - tradeoffs + constraints
3) **Annotation cycle**
   - The human edits notes/plan.md with inline notes.
   - You update the plan to address notes.
   - **Do not implement yet.**
4) **Todo list**
   - Add a granular checklist to notes/plan.md.
5) **Implementation**
   - Only when told: **“implement it all”**
   - Mark tasks completed inside notes/plan.md as you go.
   - Don’t stop until all tasks complete.
   - Continuously run typecheck/tests and fix issues.

These rules mirror the discipline: separate thinking from typing; the plan is the shared mutable artifact.

## Codebase standards
- TypeScript strict; never use `any` or `unknown`.
- All persisted structures must have:
  - TS types (src/core/types.ts)
  - Zod validators (src/core/schema.ts)
- Keep code clean:
  - Avoid unnecessary comments/JSDoc.
  - Prefer explicit types and small functions.

## MVP product principles
- “Everything is a Space you can enter.”
- 3D-first UI (iso) with 2D as projection.
- Layers are spatial slices in a translucent prism.
- Segmentation is a first-class fork:
  - segmentation-first vs holistic reconstruction.

## Data model (canonical)
- Space, Edge, Payload, Annotation, OperatorRun, GraphPatch, Manifest

## Useful commands
- pnpm i
- pnpm dev
- pnpm typecheck
- pnpm test
- pnpm lint
- pnpm format
