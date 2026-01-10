# Webzyl URL Consolidation - Complete Guide

## Overview

All Webzyl pages are now consolidated under the main `webzyl.com` domain for consistency and easier maintenance.

## URL Structure

### Before Consolidation
```
Homepage:          https://webzyl.com
Admin Dashboard:   https://webzyl-admin.pages.dev/        ❌ External
Operator Dashboard: https://webzyl-operator.pages.dev/   ❌ External
Property Sites:    https://{slug}.webzyl.com
```

### After Consolidation ✅
```
Homepage:           https://webzyl.com
Admin Dashboard:    https://webzyl.com/admin              ✅ Consolidated
Operator Dashboard: https://webzyl.com/operator           ✅ Consolidated
Property Sites:     https://{slug}.webzyl.com
```

## Complete User Flow

```
1. User visits homepage
   https://webzyl.com

2. Clicks "Start Building with Webzyl" button
   → https://webzyl.com/admin

3. Creates property (e.g., "grand-royal")
   → Property published at https://grand-royal.webzyl.com

4. Clicks "Dashboard" to manage property
   → https://webzyl.com/operator?slug=grand-royal

5. Makes updates to rooms, gallery, etc.
   → All changes immediately reflected on property site
```

## Technical Implementation

### 1. Worker Routes (worker.js:458-472)

```javascript
if (hostname === 'webzyl.com' || hostname === 'www.webzyl.com') {
  if (!path.startsWith('/api/')) {
    // Admin dashboard (CEO dashboard)
    if (path === '/admin' || path === '/admin/') {
      return handleCEOAdminDashboard(request, env);
    }
    // Operator dashboard
    if (path === '/operator' || path === '/operator/') {
      return handleOperatorDashboard(request, env);
    }
    // Homepage
    return handleBrandHomepage(request, env, ctx);
  }
}
```

### 2. KV Storage Keys

All pages are stored in KV namespace `RESORT_CONFIGS`:

| Page | KV Key | Source File |
|------|--------|-------------|
| Homepage | `template:brand-homepage` | `webzyl-homepage/index.html` |
| Admin Dashboard | `page:ceo-admin-dashboard` | `webzyl-admin-dist/index.html` |
| Operator Dashboard | `page:operator-dashboard` | `_external/webzyl-operator/operator-dashboard.html` |

### 3. Handler Functions

- **`handleBrandHomepage()`** (worker.js:1381) - Serves homepage
- **`handleCEOAdminDashboard()`** (worker.js:1414) - Serves admin dashboard
- **`handleOperatorDashboard()`** (worker.js:1443) - Serves operator dashboard

All handlers use `Cache-Control: no-cache` to ensure latest content.

## Deployment

### Quick Deploy Script

```powershell
# Deploy all pages at once
.\tools\deploy-all-pages.ps1
```

### Manual Deployment

```powershell
# 1. Upload homepage
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:brand-homepage" --path="webzyl-homepage/index.html"

# 2. Upload admin dashboard
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:ceo-admin-dashboard" --path="webzyl-admin-dist/index.html"

# 3. Upload operator dashboard
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"

# 4. Deploy worker
npx wrangler deploy
```

## Benefits

### 1. Unified Domain
✅ All pages under `webzyl.com`
✅ Consistent branding
✅ Easier to remember URLs

### 2. No CORS Issues
✅ Same domain for pages and APIs
✅ Simplified authentication
✅ Better security

### 3. Single Deployment
✅ One KV namespace
✅ One worker deployment
✅ Simplified workflow

### 4. Latest Data Always
✅ No-cache headers
✅ Real-time updates
✅ No stale content

## Testing

### Test Complete Flow

```powershell
# 1. Test homepage
curl https://webzyl.com

# 2. Test admin dashboard
curl https://webzyl.com/admin

# 3. Test operator dashboard
curl https://webzyl.com/operator?slug=grand-royal

# 4. Test property site
curl https://grand-royal.webzyl.com
```

### Expected Results

| URL | Status | Content-Type | Cache-Control |
|-----|--------|--------------|---------------|
| `/` | 200 | text/html | no-cache |
| `/admin` | 200 | text/html | no-cache |
| `/operator` | 200 | text/html | no-cache |
| `/{slug}.webzyl.com` | 200 | text/html | varies |

## Files Modified

### Worker
- `worker.js:458-472` - Added `/admin` route
- `worker.js:1414-1441` - Added `handleCEOAdminDashboard()`

### Homepage
- `webzyl-homepage/index.html:157` - Updated "Get Started" button
- `webzyl-homepage/index.html:169` - Updated "Start Building" button

### Admin Dashboard
- `webzyl-admin-dist/index.html:2441` - Updated operator dashboard links

## Legacy Pages Deployment

The Cloudflare Pages deployments can now be deprecated:
- `webzyl-admin.pages.dev` - No longer needed
- `webzyl-operator.pages.dev` - No longer needed

All production links now point to `webzyl.com/*`.

## Rollback

If needed, revert to previous Pages deployments:

```javascript
// In homepage, change links back to:
href="https://webzyl-admin.pages.dev/"

// In admin dashboard, change links back to:
href="https://webzyl-operator.pages.dev/operator-dashboard?slug=${prop.slug}"
```

Then redeploy affected pages.

## Support

### Common Issues

**404 on /admin:**
- Check KV key exists: `npx wrangler kv:key get --binding=RESORT_CONFIGS "page:ceo-admin-dashboard"`
- Re-upload if missing

**404 on /operator:**
- Check KV key exists: `npx wrangler kv:key get --binding=RESORT_CONFIGS "page:operator-dashboard"`
- Re-upload if missing

**Old content showing:**
- Clear browser cache
- Verify worker deployed: Current Version ID should be latest
- Check Cache-Control headers

### Monitoring

```powershell
# Watch worker logs
npx wrangler tail

# Check KV keys
npx wrangler kv:key list --binding=RESORT_CONFIGS | grep "page:\|template:"
```

## Deployment History

- **Version:** 3d427a24-d138-41ac-85a8-3321d2dbad40
- **Date:** 2026-01-09
- **Status:** ✅ LIVE

---

**All Webzyl pages are now under one domain! 🎉**
