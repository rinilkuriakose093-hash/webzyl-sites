# Restore Instructions - v2.1.0 Pre-Session Backup

**Backup Date:** January 11, 2026
**Version:** v2.1.0 (Pre-Session)
**Git Commit:** 601712f

## Quick Restore

```bash
# Navigate to project root
cd C:\Users\rinkuria\OneDrive - Cisco\Desktop\webzyl-worker

# Restore from this backup
cp "_backups\20260111_v2.1.0_pre-session\worker.js" ./
cp "_backups\20260111_v2.1.0_pre-session\template.html" ./
cp "_backups\20260111_v2.1.0_pre-session\operator-dashboard.html" ./
cp "_backups\20260111_v2.1.0_pre-session\ceo-admin-dashboard.html" ./
cp "_backups\20260111_v2.1.0_pre-session\wrangler.toml" ./

# Upload template to KV
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:smart-nav" --path="template.html"

# Deploy worker
npx wrangler deploy

# Upload dashboards
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="operator-dashboard.html"
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:ceo-admin-dashboard" --path="ceo-admin-dashboard.html"
```

## Or Restore from Git Tag

```bash
git checkout v2.1.0
npx wrangler deploy
```

## Files Included

- worker.js (Main application logic)
- template.html (HTML template)
- operator-dashboard.html (Operator dashboard)
- ceo-admin-dashboard.html (CEO admin dashboard)
- wrangler.toml (Cloudflare configuration)
- package.json (Dependencies)
- _kv_template_smart-nav.html (KV template backup)
- _kv_config_grand-royal.json (Configuration backup)
- VERSION.md (Version documentation)

## Status at Backup

All systems operational, ready for next development session.
