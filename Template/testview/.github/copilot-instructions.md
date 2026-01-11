<!-- .github/copilot-instructions.md - guidance for AI coding agents -->
# Guidance for AI coding agents (concise)

This repository is a small static/template view project. Below are the essential, actionable facts to help an AI agent be productive immediately.

- Project purpose: build and edit HTML view templates and the associated mount configuration stored in `data/mountview.json`.
- Key files:
  - `QUICKSTART.md`, `SETUP_INSTRUCTIONS.txt`: environment and manual run notes.
  - `IMPLEMENTATION_SUMMARY.md`, `FEATURE_CONFIG.md`: design rationale and feature rules.
  - `template.html`, `template2.html`, `template3.html`, `template4.html`: canonical templates; `template4.html.bak` is a backup copy.
  - `data/mountview.json`: authoritative runtime configuration used by the view.

- Architecture / big picture:
  - This workspace contains static HTML templates and a JSON mount configuration. There is no build system or server code in-repo — changes are applied directly to templates and `data/mountview.json`.
  - Typical workflow: update a template (one of the `template*.html` files), then adjust `data/mountview.json` to match the view's mount points.

- Editing conventions and patterns:
  - Prefer adding a new `templateN.html` or creating a `.bak` backup before modifying an existing template (repository already contains `template4.html.bak`).
  - Keep structural changes limited to one template per change; update `data/mountview.json` entries in the same commit when the template requires new mount keys.
  - Use the naming pattern `template<index>.html` for view variants.

- Integration points and external dependencies:
  - The repo appears to be a client-side/static view layer; external systems read `data/mountview.json`. When editing config, ensure keys/types match existing readers (non-repo) — consult `IMPLEMENTATION_SUMMARY.md` for hints.

- Developer workflows (what to run):
  - There is no build/test script in the repository. Recommended manual steps:
    1. Edit template (`template4.html` etc.).
    2. Validate syntax in a browser or HTML linter (not included in repo).
    3. Update `data/mountview.json` as needed.

- What NOT to assume:
  - There are no npm/pyproject/build files here — do not add build-tool specific assumptions unless the user requests them.
  - No tests are present; do not attempt to run non-existent test tooling.

- Examples from repo to reference in PRs or messages:
  - When changing a mount key, update `data/mountview.json` alongside `templateN.html` (see `data/mountview.json`).
  - When editing `template4.html`, preserve patterns seen in `template3.html` and `template4.html.bak` (use them as style/structure references).

If any of this is unclear or you want me to include CI instructions or linters, tell me which tools you prefer and I will update this guidance and add minimal automation.
