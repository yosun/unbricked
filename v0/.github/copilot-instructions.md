# Copilot Instructions (repo-wide)

These instructions apply automatically in VS Code Copilot Chat.

## Source of truth
- Follow **/CLAUDE.md** as the canonical workflow and standards.
- Use **notes/research.md** and **notes/plan.md** as persistent artifacts.

## Workflow (mandatory)
- **No production code changes** until a plan exists in `notes/plan.md` and the human approves it.
- Default sequence: Research → Plan → Human annotation → TODO checklist → Implement.
- Only implement when the human says exactly: **"implement it all"**.
- Keep diffs small and reviewable.

## Code quality (non-negotiable)
- TypeScript **strict**. Do not use `any` or `unknown`.
- All persisted structures must have:
  - TS types in `src/core/types.ts`
  - Zod validators in `src/core/schema.ts`
- JSON-safe data only (use the JsonValue/JsonObject types already present).
- Prefer small functions and clear names over comments.

## Build discipline
When implementing: run and fix failures immediately:
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
