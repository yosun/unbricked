# Copilot setup (VS Code)

This repo uses file-based custom instructions (recommended over settings-based).

## Instruction files used
- `.github/copilot-instructions.md` (repo-wide)
- `.github/instructions/*.instructions.md` (path-scoped via `applyTo`)
- `AGENTS.md` and `CLAUDE.md` (agent instructions; broad compatibility)

## Recommended VS Code settings
This repo includes `.vscode/settings.json` that enables:
- including applied/referenced instructions in the chat context
- picking up `AGENTS.md` and `CLAUDE.md` automatically

If you don’t see instruction files being used, open Copilot Chat “References” and verify which instruction files were loaded.
