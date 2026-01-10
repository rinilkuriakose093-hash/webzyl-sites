# Admin Dashboard Scope v1 - Read-Only Operations

**Version:** 1.0  
**Date:** January 2026  
**Status:** LOCKED  
**Phase:** 6 - Admin/Operator Dashboard

---

## 🎯 Purpose

The Admin Dashboard provides **read-only visibility** into the live Webzyl platform state. It enables operators to:

1. **Monitor** active sites, design profiles, and experiments
2. **Diagnose** issues without accessing logs
3. **Review** metrics and system health
4. **Audit** configuration compliance

**This dashboard does NOT allow any mutations to production data.**

---

## 👥 Intended Users

### Authorized Users
- **Platform operators** (internal team only)
- **System administrators** (troubleshooting)
- **Data analysts** (metrics review)

### Authorization Method
- **v1 Implementation:** Static admin token via `X-Admin-Token` header
- Token must be configured in environment variables
- No user accounts, no OAuth (v1 simplicity)

### Access Pattern
- **Internal only** - Not customer-facing
- **Authenticated** - Token required for all `/__admin` routes
- **Logged** - All access attempts logged (audit trail)

---

## 📊 Data Sources

The dashboard queries the following read-only data sources:

### Cloudflare KV Namespaces

1. **RESORT_CONFIGS**
   - Site configurations (slug, category, theme, branding)
   - Design profile assignments
   - Experiment configurations
   - Active/inactive status

2. **EVENTS_KV** (Phase 5)
   - Page view events
   - CTA click events
   - Experiment attribution data
   - Timestamp-bucketed analytics

### Cloudflare R2 Buckets

3. **MEDIA_R2** (optional, Phase 7+)
   - Asset metadata (not raw files)
   - Upload counts, sizes

### Cloudflare D1 Database

4. **MEDIA_DB** (optional, Phase 7+)
   - Asset records
   - Upload history

---

## 🚫 Explicitly Forbidden Actions

The dashboard **MUST NEVER** allow:

### ❌ Mutation Operations
- **Create** new sites
- **Update** site configurations
- **Delete** sites or experiments
- **Publish** design profiles
- **Start/Stop** experiments
- **Edit** design tokens
- **Modify** KV data
- **Upload** media assets

### ❌ Data Exposure
- **Raw config blobs** (only sanitized summaries)
- **Secret tokens** (CEO_TOKEN, ADMIN_TOKEN)
- **R2 access keys** (credentials hidden)
- **PII from events** (already blocked by Phase 5 governance)
- **Precise timestamps** (use bucketed tsBucket only)

### ❌ Client-Side Mutations
- No forms that POST to mutation endpoints
- No JavaScript that calls write APIs
- No local storage of credentials
- No XHR/fetch to non-read routes

---

## 🛡️ Security Model

### Access Control
```
IF request.path.startsWith('/__admin'):
  IF request.headers['X-Admin-Token'] !== env.ADMIN_TOKEN:
    RETURN 403 Forbidden
  ELSE:
    PROCEED to read-only handler
```

### Token Management
- **Environment Variable:** `ADMIN_TOKEN` in wrangler.toml (secrets)
- **Rotation:** Manual (v1 - no auto-rotation)
- **Sharing:** Never commit to Git, never log, never expose in responses

### Audit Logging
- Log all admin route access attempts
- Log successful authentications
- Log failed authentication attempts (rate-limit if needed)

---

## 📍 Dashboard Routes

All admin routes are namespaced under `/__admin`:

| Route | Method | Purpose | Auth Required |
|-------|--------|---------|---------------|
| `/__admin` | GET | Dashboard home (HTML UI) | Yes |
| `/__admin/sites` | GET | List all sites with metadata | Yes |
| `/__admin/experiments` | GET | List all active experiments | Yes |
| `/__admin/metrics` | GET | Aggregated analytics | Yes |

### Non-Routes (Forbidden)
- `/__admin/sites` POST/PUT/DELETE → **NOT IMPLEMENTED**
- `/__admin/experiments` POST/PUT/DELETE → **NOT IMPLEMENTED**
- `/__admin/publish` → **NOT IMPLEMENTED** (use CEO dashboard)
- `/__admin/upload` → **NOT IMPLEMENTED** (use Operator dashboard)

---

## 📋 Endpoint Specifications

### GET /__admin/sites

**Purpose:** List all properties with design profile and experiment info

**Response Format:**
```json
{
  "sites": [
    {
      "slug": "lakeview",
      "category": "resort",
      "theme": "Luxury Heritage",
      "designProfileId": "luxury-heritage-v1",
      "variantId": "calm",
      "experimentId": null,
      "status": "active",
      "lastUpdated": "2026-01-01T00:00:00.000Z"
    },
    {
      "slug": "mountview",
      "category": "resort",
      "theme": "Luxury Heritage",
      "designProfileId": "luxury-heritage-v1",
      "variantId": null,
      "experimentId": "exp-heritage-calm-vs-bold",
      "experimentVariant": "A",
      "status": "active",
      "lastUpdated": "2026-01-01T00:00:00.000Z"
    }
  ],
  "total": 2
}
```

**Data Sanitization:**
- ✅ Include: slug, category, theme, profileId, variantId, experimentId, status
- ❌ Exclude: phone, email, address, secret tokens, raw config

---

### GET /__admin/experiments

**Purpose:** List all active experiments with variant distribution

**Response Format:**
```json
{
  "experiments": [
    {
      "experimentId": "exp-heritage-calm-vs-bold",
      "baseProfileId": "luxury-heritage-v1",
      "variants": {
        "A": "calm",
        "B": "bold"
      },
      "sitesPerVariant": {
        "A": 12,
        "B": 13
      },
      "status": "active",
      "totalSites": 25
    }
  ],
  "total": 1
}
```

**Calculation Logic:**
- Count sites with matching experimentId
- Group by experimentVariant (using resolveExperimentVariant)
- Approximate counts (no guarantee of exact real-time accuracy)

---

### GET /__admin/metrics

**Purpose:** Aggregated analytics from Phase 5 events

**Response Format:**
```json
{
  "summary": {
    "totalPageViews": 1234,
    "totalCTAClicks": 234,
    "conversionRate": 18.96
  },
  "bySite": [
    {
      "slug": "lakeview",
      "pageViews": 500,
      "ctaClicks": 95,
      "conversionRate": 19.0
    }
  ],
  "byExperiment": [
    {
      "experimentId": "exp-heritage-calm-vs-bold",
      "variantA": {
        "pageViews": 250,
        "ctaClicks": 50,
        "conversionRate": 20.0
      },
      "variantB": {
        "pageViews": 250,
        "ctaClicks": 45,
        "conversionRate": 18.0
      }
    }
  ],
  "timeRange": "last7days"
}
```

**Data Aggregation:**
- Query EVENTS_KV for events in time range
- Group by slug, experimentId, experimentVariant
- Calculate counts and rates
- Return aggregate data only (no raw event logs)

---

## 🎨 Dashboard UI (Optional v1)

### Minimal HTML Page at `/__admin`

**Requirements:**
- **Read-only** - No forms, no input fields
- **Navigation** - Links to /sites, /experiments, /metrics
- **Data Display** - Render JSON as HTML tables
- **Design Tokens** - Use existing Webzyl design system
- **No Framework** - Vanilla HTML/CSS/JS only

**Structure:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Webzyl Admin Dashboard</title>
  <style>/* Use design tokens */</style>
</head>
<body>
  <h1>Webzyl Admin Dashboard (Read-Only)</h1>
  <nav>
    <a href="/__admin/sites">Sites</a>
    <a href="/__admin/experiments">Experiments</a>
    <a href="/__admin/metrics">Metrics</a>
  </nav>
  <main id="content">
    <!-- JavaScript fetches and renders JSON -->
  </main>
</body>
</html>
```

**Interactivity:**
- Click link → Fetch JSON → Render as table
- No mutations, no POST requests
- No local storage of sensitive data

---

## ✅ Compliance with Existing Governance

### Design Profile Governance (Phase 1)
- ✅ Dashboard displays profileId but cannot edit
- ✅ No per-site CSS mutations
- ✅ Profiles remain immutable

### Experiments Governance (Phase 3)
- ✅ Dashboard shows experiment status but cannot start/stop
- ✅ Variant assignment remains deterministic
- ✅ No experiment mutations allowed

### Metrics Governance (Phase 5)
- ✅ Dashboard shows aggregate metrics only
- ✅ No PII exposed (already blocked by EVENT_SCHEMA)
- ✅ Timestamps remain bucketed (tsBucket)
- ✅ No raw event log access

---

## 🔒 Privacy & Security Guarantees

### Privacy
- **No PII exposure** - All metrics are aggregate
- **No tracking users** - Dashboard cannot identify individuals
- **Compliant with Phase 5** - Same privacy rules apply

### Security
- **Authentication required** - X-Admin-Token on all routes
- **Read-only by design** - No mutation endpoints exist
- **Audit logging** - All access logged for review
- **Token rotation** - Manual for v1, auto in v2+

### Data Integrity
- **No mutations** - KV/R2/D1 data cannot be modified via dashboard
- **No deletions** - Dashboard cannot delete configs or events
- **Deterministic views** - Dashboard reflects exact system state

---

## 🚀 Implementation Constraints

### Phase 6 v1 Limits
- **Static token auth** (no OAuth, no user accounts)
- **No pagination** (display all sites/experiments at once)
- **No filtering** (no search, no date range pickers)
- **No real-time updates** (refresh to update)
- **No export** (no CSV/Excel downloads)

### Future Enhancements (v2+)
- OAuth2 authentication
- Role-based access control (viewer vs admin)
- Pagination for large datasets
- Search and filtering
- Real-time WebSocket updates
- CSV/JSON export
- Grafana/Datadog integration

---

## 📏 Governance Rules

### Golden Rule
- ✅ Backups created before Phase 6 changes

### Read-Only Principle
- ❌ NEVER implement mutation endpoints in /__admin routes
- ❌ NEVER expose write APIs via dashboard
- ❌ NEVER allow client-side mutations

### Determinism Principle
- ✅ Dashboard reflects exact system state
- ✅ No cached/stale data (always fresh from KV)
- ✅ Experiment variant assignment matches Phase 3 logic

### Privacy Principle
- ✅ No PII in responses
- ✅ Aggregate metrics only
- ✅ Timestamps bucketed (if displayed)

### Security Principle
- ✅ Authentication required on all admin routes
- ✅ Tokens never logged or exposed
- ✅ Failed auth attempts logged

---

## 🎯 Success Criteria

Phase 6 is complete when:

1. ✅ All admin routes return 403 without valid token
2. ✅ `/__admin/sites` returns sanitized site metadata
3. ✅ `/__admin/experiments` returns experiment summaries
4. ✅ `/__admin/metrics` returns aggregated analytics
5. ✅ No mutation endpoints exist in `/__admin` namespace
6. ✅ Dashboard UI renders data in readable format
7. ✅ No governance rules violated
8. ✅ Verification checklist passes
9. ✅ Documentation complete

---

## 📚 Related Documentation

- **Phase 1:** DESIGN_PROFILE_GOVERNANCE_v1.md
- **Phase 3:** EXPERIMENTS_GOVERNANCE_v1.md
- **Phase 5:** METRICS_GOVERNANCE_v1.md
- **Complete System:** COMPLETE_INDEX.md

---

## 🔐 Environment Variables Required

```toml
# wrangler.toml (secrets)
[vars]
ADMIN_TOKEN = "admin-secret-token-here"  # DO NOT COMMIT
```

**Deployment:**
```bash
# Set secret via wrangler
npx wrangler secret put ADMIN_TOKEN
# Enter secret value when prompted
```

---

**Status:** 🔒 **LOCKED**  
**Phase 6 Scope Defined**  
**Implementation Ready**

**End of Scope Document**
