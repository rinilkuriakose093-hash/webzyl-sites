# Single Source of Truth: Operator Dashboard

## Problem

You had two operator dashboard URLs showing different data:
- `https://webzyl-operator.pages.dev/operator-dashboard?slug=grand-royal` (Pages deployment - outdated)
- `https://webzyl.com/operator?slug=grand-royal` (Worker-served - latest data)

## Solution

Consolidated to **one single source of truth**: `https://webzyl.com/operator`

## How It Works

```
User clicks "Dashboard" button in CEO dashboard
    ↓
https://webzyl.com/operator?slug=grand-royal
    ↓
Worker handler: handleOperatorDashboard() (worker.js:1410)
    ↓
Fetch HTML from KV: key = "page:operator-dashboard"
    ↓
Serve dashboard HTML with Cache-Control: no-cache
    ↓
Dashboard loads and fetches latest config from:
https://webzyl.com/api/config/grand-royal
    ↓
Always shows latest data!
```

## Deployment

To deploy the operator dashboard, run:

```powershell
.\tools\deploy-operator-dashboard.ps1
```

This script:
1. Uploads `_external/webzyl-operator/operator-dashboard.html` to KV
2. Deploys the worker
3. Verifies everything is working

## Manual Deployment (if needed)

```powershell
# Upload to KV
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"

# Deploy worker
npx wrangler deploy
```

## Benefits

✅ **Single source of truth** - Only one place to update dashboard
✅ **No CORS issues** - Dashboard and APIs on same domain
✅ **Latest data** - Always fetches fresh config from API
✅ **Simpler maintenance** - No need to sync two deployments
✅ **Consistent architecture** - Everything served through worker

## What About Pages Deployment?

The Cloudflare Pages deployment (`webzyl-operator.pages.dev`) can be:
- **Deprecated** - No longer needed
- **Kept as backup** - In case you need alternative access
- **Used for testing** - Deploy experimental changes before production

Since all production links now point to `webzyl.com/operator`, the Pages deployment is optional.

## Files Changed

- `worker.js:1410` - Handler with `no-cache` for latest data
- `worker.js:3399` - API response returns `webzyl.com/operator` URL
- `webzyl-admin-dist/index.html:2441` - CEO dashboard links updated
- `tools/deploy-operator-dashboard.ps1` - New deployment script

## Verification

After deployment, test:

```powershell
# Check operator dashboard loads
curl https://webzyl.com/operator?slug=grand-royal

# Should return HTML (not a redirect)
# Dashboard should show latest room data
```

## Next Steps

1. Run the deployment script: `.\tools\deploy-operator-dashboard.ps1`
2. Verify operator dashboard shows latest data
3. Optionally deprecate Pages deployment
4. Update any external documentation referencing the old URL

## Troubleshooting

**Dashboard shows 404:**
- KV key not uploaded. Run: `npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"`

**Dashboard shows old data:**
- Clear browser cache
- Check that dashboard HTML fetches from `webzyl.com/api/config/${slug}`
- Verify worker is deployed: `npx wrangler deploy`

**Changes not appearing:**
- Re-upload to KV with the upload script
- Worker has `Cache-Control: no-cache` so changes should appear immediately
