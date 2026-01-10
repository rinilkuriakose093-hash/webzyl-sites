# Webzyl System Metrics Dashboard (Phase 6)

Production-ready **read-only** metrics dashboard for Webzyl platform visibility.

**NOTE:** This is SEPARATE from the CEO/Customer Onboarding Dashboard at webzyl-admin.pages.dev

## 🚀 Deploy to Cloudflare Pages

```bash
cd admin-dashboard
npx wrangler pages deploy . --project-name=webzyl-system-metrics
```

## 🔑 Access

**URL:** https://webzyl-system-metrics.pages.dev

**Token:** `webzyl-admin-dev-2026`

## 📋 Features

- ✅ Token-based authentication (stored in localStorage)
- ✅ Real-time data from production API
- ✅ Sites overview with stats
- ✅ Experiments tracking
- ✅ Metrics & conversion rates
- ✅ Responsive design
- ✅ Auto-logout on unauthorized access

## 🔒 Security

- Token validated against `https://webzyl.com/__admin` API
- No hardcoded credentials in frontend
- Session persistence with localStorage
- Automatic logout on 403 responses
