# Phase 5: Metrics & Event Pipeline - Deployment Guide

**Phase:** 5 - Metrics & Event Pipeline  
**Status:** Ready for Deployment  
**Governance:** METRICS_GOVERNANCE_v1.md  
**Verification:** PHASE_5_VERIFICATION.md

---

## 📦 Prerequisites

Before deploying Phase 5, ensure the following are complete:

1. ✅ **Phase 1-4 deployed and stable**
   - Design profiles working
   - Variants resolving correctly
   - Experiments assigning deterministically
   - Critical CSS inlining functional

2. ✅ **Backups created**
   - worker.js.backup-before-phase5-metrics
   - template.html.backup-before-phase5-metrics

3. ✅ **Code review complete**
   - PHASE_5_VERIFICATION.md reviewed
   - Privacy compliance verified

---

## 🚀 Deployment Steps

### Step 1: Create EVENTS_KV Namespace

```bash
# Create new KV namespace for event storage
npx wrangler kv:namespace create "EVENTS_KV"
```

**Expected Output:**
```
Add the following to your wrangler.toml:

[[kv_namespaces]]
binding = "EVENTS_KV"
id = "abc123..."
```

**Copy the ID from the output and update wrangler.toml line 25:**
```toml
[[kv_namespaces]]
binding = "EVENTS_KV"
id = "abc123..."  # Replace EVENTS_KV_ID_PLACEHOLDER with this ID
```

---

### Step 2: Update wrangler.toml

Edit `wrangler.toml` and replace `EVENTS_KV_ID_PLACEHOLDER` with the actual KV namespace ID from Step 1.

**Before:**
```toml
[[kv_namespaces]]
binding = "EVENTS_KV"
id = "EVENTS_KV_ID_PLACEHOLDER"
```

**After:**
```toml
[[kv_namespaces]]
binding = "EVENTS_KV"
id = "abc123def456..."  # Your actual KV ID
```

---

### Step 3: Deploy to Cloudflare

```bash
# Deploy worker with event tracking
npx wrangler deploy
```

**Expected Output:**
```
✨ Success! Uploaded webzyl-worker
✨ Deployment complete!
```

---

### Step 4: Verify Deployment

#### 4.1 Test Page View Event (SSR)

1. Visit a live property (e.g., `https://lakeview.webzyl.com`)
2. Check Cloudflare Worker logs:
   ```
   [METRICS] Event emitted: page_view for lakeview
   ```

#### 4.2 Test CTA Click Event (Frontend)

1. Click the "Book Now" button or WhatsApp float on a live property
2. Check browser DevTools Network tab:
   - POST to `/api/event`
   - Status: `204 No Content`
3. Check Cloudflare Worker logs:
   ```
   [METRICS] Event emitted: cta_click for lakeview
   ```

#### 4.3 Verify KV Storage

```bash
# List event keys in KV
npx wrangler kv:key list --binding=EVENTS_KV

# Expected output:
# [
#   { "name": "events:lakeview:page_view:1704036000000:x7k2p9q1w" },
#   { "name": "events:lakeview:cta_click:1704036120000:a3b5c7d9e" }
# ]
```

#### 4.4 Read an Event

```bash
# Get specific event
npx wrangler kv:key get "events:lakeview:page_view:1704036000000:x7k2p9q1w" --binding=EVENTS_KV
```

**Expected Output:**
```json
{
  "event": "page_view",
  "slug": "lakeview",
  "profileId": "luxury-heritage-v1",
  "variantId": "calm",
  "experimentId": null,
  "experimentVariant": null,
  "tsBucket": "2024-12-31T15:00:00.000Z"
}
```

---

## ✅ Post-Deployment Verification

### Privacy Compliance Check

1. **Inspect stored events** - ensure NO PII fields:
   ```bash
   # Read a few events and verify no IP, userAgent, email, phone, etc.
   npx wrangler kv:key get "events:lakeview:page_view:..." --binding=EVENTS_KV
   ```

2. **Verify timestamp bucketing** - timestamps should be rounded to the hour:
   ```json
   { "tsBucket": "2024-12-31T15:00:00.000Z" }  // ✅ Correct (hour precision)
   { "tsBucket": "2024-12-31T15:23:47.123Z" }  // ❌ Wrong (precise timestamp)
   ```

### Performance Check

1. **TTFB should remain <50ms**
   - Use browser DevTools or WebPageTest
   - Event emission is async and should not block SSR

2. **No client-side errors**
   - Check browser console for JavaScript errors
   - trackCTAClick() should fail silently if network issues occur

### Experiment Attribution Check

1. **Create test experiment** in a config:
   ```json
   {
     "slug": "testview",
     "branding": { "designProfileId": "luxury-heritage-v1" },
     "experiment": {
       "id": "exp-test",
       "enabled": true,
       "splitRatio": 50
     }
   }
   ```

2. **Visit the property multiple times** and verify:
   - Same browser/device → same `experimentVariant` in all events
   - Events include `experimentId` and `experimentVariant`
   - `variantId` matches the experiment mapping

---

## 🔧 Troubleshooting

### Issue: Events not appearing in KV

**Symptoms:**
- `npx wrangler kv:key list --binding=EVENTS_KV` returns empty array

**Diagnosis:**
```bash
# Check worker logs
npx wrangler tail
```

**Possible Causes:**
1. **KV binding not configured**
   - Verify wrangler.toml has correct EVENTS_KV ID
   - Redeploy after updating wrangler.toml

2. **emitEvent() failing silently**
   - Check logs for `[METRICS] Event emission failed (non-blocking)`
   - Verify EVENT_SCHEMA validation isn't rejecting events

3. **Forbidden field detected**
   - Check logs for `[METRICS] Forbidden field detected`
   - Remove any PII fields from event payloads

---

### Issue: 400 Bad Request on /api/event

**Symptoms:**
- Browser console shows 400 error when clicking CTAs

**Diagnosis:**
- Check payload sent by trackCTAClick()
- Verify event type is `cta_click` (not misspelled)

**Fix:**
```javascript
// Correct payload
{
  "event": "cta_click",
  "ctaName": "booking"
}

// Incorrect (wrong event type)
{
  "event": "click",  // ❌ Not in EVENT_SCHEMA.allowedEvents
  "ctaName": "booking"
}
```

---

### Issue: Experiment attribution missing

**Symptoms:**
- Events have `experimentId: null` when experiment is active

**Diagnosis:**
```bash
# Check config in KV
npx wrangler kv:key get "config:testview" --binding=RESORT_CONFIGS
```

**Verify:**
- `experiment.id` is set
- `experiment.enabled` is true
- Experiment mapping exists in worker.js (lines 1613-1620)

---

### Issue: High KV storage usage

**Symptoms:**
- Cloudflare dashboard shows high KV storage consumption

**Check:**
1. Verify TTL is set (90 days):
   ```javascript
   await env.EVENTS_KV.put(
     `events:${eventId}`,
     JSON.stringify(eventPayload),
     { expirationTtl: 60 * 60 * 24 * 90 }  // ✅ Should be present
   );
   ```

2. Manually delete old events if needed:
   ```bash
   # List all event keys
   npx wrangler kv:key list --binding=EVENTS_KV > events.json

   # Delete old events (adjust timestamp threshold)
   # Use wrangler kv:key delete for each old key
   ```

---

## 📊 Event Query Examples

### Query Events by Slug

```bash
# List all events for a specific property
npx wrangler kv:key list --binding=EVENTS_KV --prefix="events:lakeview:"
```

### Query Events by Type

```bash
# List all page_view events
npx wrangler kv:key list --binding=EVENTS_KV | grep "page_view"

# List all cta_click events
npx wrangler kv:key list --binding=EVENTS_KV | grep "cta_click"
```

### Calculate Conversion Rate

```bash
# Get all events for a property
npx wrangler kv:key list --binding=EVENTS_KV --prefix="events:lakeview:" > lakeview_events.json

# Count page_view events
cat lakeview_events.json | grep "page_view" | wc -l

# Count cta_click events
cat lakeview_events.json | grep "cta_click" | wc -l

# Conversion rate = (cta_clicks / page_views) * 100
```

---

## 🎯 Future Enhancements (Post-Phase 5)

### CEO Dashboard Event Viewer

**Recommended Features:**
1. Query events by slug
2. Filter by date range (tsBucket)
3. Aggregate metrics:
   - Total page views per property
   - Total CTA clicks per property
   - Conversion rate (clicks / views)
4. Experiment performance comparison:
   - Variant A vs Variant B conversion rates

**Implementation Notes:**
- Use Cloudflare KV list() with prefix filtering
- Aggregate client-side (no server-side DB needed)
- Respect 90-day retention window

---

### Google Sheets Export (Optional)

**Use Case:** Export events to Google Sheets for deeper analysis

**Implementation:**
1. Create Google Apps Script webhook (similar to booking API)
2. Add optional `ANALYTICS_WEBHOOK_URL` to wrangler.toml
3. Modify emitEvent() to optionally POST to webhook
4. Google Apps Script appends row to spreadsheet

**Privacy Note:** Ensure webhook also respects METRICS_GOVERNANCE_v1.md

---

## 🔐 Security Notes

### EVENTS_KV Access Control

- **Read access:** CEO dashboard only (secured by CEO_TOKEN)
- **Write access:** Worker only (no public write API)
- **No direct client access:** Events enriched server-side

### PII Prevention Checklist

Before deploying any changes to event schema:
1. ✅ Review METRICS_GOVERNANCE_v1.md
2. ✅ Verify new field is not PII
3. ✅ Add field to EVENT_SCHEMA.optionalFields (never requiredFields unless absolutely necessary)
4. ✅ Test that forbiddenFields validation still works

---

## 📝 Rollback Plan

If issues arise post-deployment:

1. **Restore worker.js:**
   ```bash
   cp worker.js.backup-before-phase5-metrics worker.js
   ```

2. **Restore template.html:**
   ```bash
   cp template.html.backup-before-phase5-metrics template.html
   ```

3. **Remove EVENTS_KV binding from wrangler.toml:**
   ```toml
   # Comment out or delete
   # [[kv_namespaces]]
   # binding = "EVENTS_KV"
   # id = "abc123..."
   ```

4. **Redeploy:**
   ```bash
   npx wrangler deploy
   ```

5. **Verify rollback:**
   - Page loads work (no errors)
   - CTAs still functional (no tracking, but buttons work)

---

## ✅ Deployment Checklist

- [ ] Phase 1-4 stable in production
- [ ] Backups created (worker.js, template.html)
- [ ] EVENTS_KV namespace created
- [ ] wrangler.toml updated with EVENTS_KV ID
- [ ] worker.js deployed successfully
- [ ] Page view events appearing in KV
- [ ] CTA click events appearing in KV
- [ ] No PII in stored events
- [ ] Timestamps bucketed to hour
- [ ] Experiment attribution working
- [ ] TTFB <50ms maintained
- [ ] No client-side errors in console
- [ ] PHASE_5_VERIFICATION.md reviewed

---

**Status:** 🎉 **PHASE 5 DEPLOYED**

**Governance:** All events comply with METRICS_GOVERNANCE_v1.md  
**Privacy:** Zero PII collection  
**Performance:** Non-blocking, fire-and-forget  
**Scalability:** Zero-ops, auto-cleanup via TTL

**Next Steps:**
- Monitor events for first 48 hours
- Build CEO dashboard event viewer (optional)
- Analyze experiment performance (after sufficient data)

**End of Deployment Guide**
