# Restore / Revert Kit (2026-01-05 hero title)

This folder contains a point-in-time snapshot of the key moving parts:
- Worker source: `worker.js`
- KV template source used for deployment: `_tmp_smart-nav.html`
- Operator Pages local source (from repo): `operator-dashboard.local.html`, `operator-login.local.html`
- Live KV exports: `kv.template_smart-nav.live.html`, `kv.config_grand-royal.live.json`
- Live Pages HTML snapshots: `operator-dashboard.pages.live.html`, `operator-login.pages.live.html`, `onboarding.pages.live.html`

## Quick revert options

### A) Revert KV template only (fastest)
From repo root:

```powershell
npx wrangler kv:key put "template:smart-nav" --binding RESORT_CONFIGS --path "backups/2026-01-05_hero-title/kv.template_smart-nav.live.html"
```

### B) Revert `config:grand-royal`
```powershell
npx wrangler kv:key put "config:grand-royal" --binding RESORT_CONFIGS --path "backups/2026-01-05_hero-title/kv.config_grand-royal.live.json"
```

### C) Revert Worker to the backed-up code
Copy back the file, then deploy:

```powershell
Copy-Item -Force "backups/2026-01-05_hero-title/worker.js" "./worker.js"
wrangler deploy
```

### D) Revert Operator Pages UI
This depends on your Cloudflare Pages project name and build setup.
If your operator project name is `webzyl-operator` and it deploys static HTML from `_external/webzyl-operator`:

```powershell
Set-Location "_external/webzyl-operator"
wrangler pages deploy . --project-name=webzyl-operator
```

## Verification
- SSR check: `https://grand-royal.webzyl.com/?__nocache=1`
- Operator UI: `https://webzyl-operator.pages.dev/operator-dashboard?slug=grand-royal`
