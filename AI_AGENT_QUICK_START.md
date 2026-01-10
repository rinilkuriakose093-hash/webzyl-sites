# AI Agent Quick Start Guide

## 📍 Main Instructions Location

**File:** `.github/copilot-instructions.md`

**Full Path:** `C:\Users\rinkuria\OneDrive - Cisco\Desktop\webzyl-worker\.github\copilot-instructions.md`

This file contains comprehensive guidance for all AI coding agents working on this project.

## 🗺️ Quick Reference

### URL Structure (All Under webzyl.com)

| Page | URL | KV Key | Source File |
|------|-----|--------|-------------|
| Homepage | `https://webzyl.com` | `template:brand-homepage` | `webzyl-homepage/index.html` |
| Admin Dashboard | `https://webzyl.com/admin` | `page:ceo-admin-dashboard` | `webzyl-admin-dist/index.html` |
| Operator Dashboard | `https://webzyl.com/operator` | `page:operator-dashboard` | `_external/webzyl-operator/operator-dashboard.html` |
| Property Sites | `https://{slug}.webzyl.com` | `config:{slug}` | Dynamic from KV |

### User Journey

```
1. Homepage (webzyl.com)
   ↓ Click "Start Building"
2. Admin Dashboard (/admin)
   ↓ Create property "grand-royal"
3. Property Live (grand-royal.webzyl.com)
   ↓ Click "Dashboard" button
4. Operator Dashboard (/operator?slug=grand-royal)
   ↓ Manage rooms, gallery, settings
```

### Key Worker Routes (worker.js:458-472)

```javascript
// Main domain routing
if (hostname === 'webzyl.com') {
  '/admin'    → handleCEOAdminDashboard()    [worker.js:1414]
  '/operator' → handleOperatorDashboard()    [worker.js:1443]
  '/'         → handleBrandHomepage()         [worker.js:1381]
}
```

### Deployment Commands

```powershell
# Deploy everything (one command)
.\tools\deploy-all-pages.ps1

# Individual deployments
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:brand-homepage" --path="webzyl-homepage/index.html"
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:ceo-admin-dashboard" --path="webzyl-admin-dist/index.html"
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"
npx wrangler deploy
```

### API Test Tracking

When developing new features:
1. Add test cases to `Api_Testcases/API_Test_Cases.csv`
2. Include: endpoint, method, expected status, request/response examples
3. Update results after testing to ensure no regressions

### Important Rules

❌ **DO NOT:**
- Mutate published design profiles (always version)
- Log PII, IP addresses, or user agents
- Use external Pages deployments (everything under webzyl.com now)
- Add build tools unless explicitly requested

✅ **DO:**
- Store all pages in KV with appropriate keys
- Use `Cache-Control: no-cache` for dashboard pages
- Follow versioning for design profiles
- Add API test cases for new features
- Update `.github/copilot-instructions.md` when architecture changes

### Key Documentation Files

| File | Purpose |
|------|---------|
| `.github/copilot-instructions.md` | **Main instructions for AI agents** |
| `WEBZYL_URL_CONSOLIDATION.md` | URL structure and consolidation |
| `SINGLE_SOURCE_DEPLOYMENT.md` | Deployment architecture |
| `DEPLOYMENT_COMPLETE.md` | Latest deployment status |
| `DESIGN_PROFILE_GOVERNANCE_v1.md` | Design profile rules |
| `METRICS_GOVERNANCE_v1.md` | Analytics and metrics rules |
| `Api_Testcases/README.md` | API testing workflow |

### Common Tasks

**Update Homepage:**
```powershell
# Edit webzyl-homepage/index.html
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:brand-homepage" --path="webzyl-homepage/index.html"
npx wrangler deploy
```

**Update Admin Dashboard:**
```powershell
# Edit webzyl-admin-dist/index.html
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:ceo-admin-dashboard" --path="webzyl-admin-dist/index.html"
npx wrangler deploy
```

**Update Operator Dashboard:**
```powershell
# Edit _external/webzyl-operator/operator-dashboard.html
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"
npx wrangler deploy
```

**View Logs:**
```powershell
npx wrangler tail
```

**Check KV Keys:**
```powershell
npx wrangler kv:key list --binding=RESORT_CONFIGS | grep "page:\|template:"
```

## 📚 Architecture Summary

### KV = Source of Truth
- All property configs: `config:{slug}`
- All dashboard pages: `page:*` or `template:*`
- Booking workspaces: `booking:workspaces`
- No hardcoded property data in worker code

### Worker = Router
- Routes by subdomain and path
- Delegates to appropriate handlers
- Serves pages from KV with no-cache
- Handles all API requests

### Property Flow
```
Worker receives request
  ↓
Extract slug from subdomain
  ↓
Load config from KV (config:{slug})
  ↓
Load template from KV (template:smart-nav)
  ↓
Render with SSR (inject config into template)
  ↓
Return HTML to user
```

## 🔧 Quick Debugging

**Page not loading:**
1. Check KV key exists: `npx wrangler kv:key get --binding=RESORT_CONFIGS "page:xxx"`
2. Check worker logs: `npx wrangler tail`
3. Verify route in worker.js:458-472

**Old content showing:**
1. Clear browser cache (pages use no-cache but browser may cache)
2. Verify latest deployment: `npx wrangler deploy`
3. Check KV has latest content

**API errors:**
1. Check `Api_Testcases/API_Test_Cases.csv` for expected behavior
2. Test with curl or PowerShell
3. Check worker logs for error details

---

## 📞 For AI Agents

When you start working on this project:

1. **Read:** `.github/copilot-instructions.md` (the main instructions file)
2. **Understand:** URL structure and user flow (see above)
3. **Reference:** Relevant governance docs for your feature area
4. **Update:** API test cases when adding new features
5. **Document:** Architecture changes in copilot-instructions.md

**The instructions file is always kept up-to-date with the latest architecture and best practices.**
