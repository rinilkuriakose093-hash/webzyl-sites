# Phase 5: Metrics Quick Reference Card

**Phase:** 5 - Metrics & Event Pipeline  
**Status:** ✅ FROZEN  
**Governance:** METRICS_GOVERNANCE_v1.md

---

## 📋 TL;DR

**What:** Privacy-first event tracking for page views and CTA clicks  
**Why:** Enable data-driven decisions for experiments and design profiles  
**How:** Cloudflare KV storage, SSR-aware, zero-ops, deterministic  

---

## 🎯 Event Types

| Event | Trigger | Data Captured |
|-------|---------|---------------|
| `page_view` | SSR render complete | slug, profileId, variantId, experimentId, experimentVariant |
| `cta_click` | User clicks booking/WhatsApp CTA | slug, profileId, variantId, experimentId, experimentVariant, ctaName |

---

## 🔒 Privacy Rules (NEVER Collect)

- ❌ IP addresses
- ❌ User agents
- ❌ Fingerprints
- ❌ Session/Cookie IDs
- ❌ Email/Phone
- ❌ Precise timestamps (bucketed to hour)

---

## 📊 Event Schema

```json
{
  "event": "page_view | cta_click",
  "slug": "lakeview",
  "profileId": "luxury-heritage-v1",
  "variantId": "calm",
  "experimentId": "exp-heritage-calm-vs-bold",
  "experimentVariant": "A",
  "ctaName": "booking | whatsapp",  // cta_click only
  "tsBucket": "2024-12-31T15:00:00.000Z"
}
```

---

## 🗄️ Storage

**Location:** Cloudflare KV (EVENTS_KV binding)  
**Key Format:** `events:{slug}:{event}:{timestamp}:{random}`  
**TTL:** 90 days (auto-cleanup)  

---

## 🚀 Deployment

```bash
# 1. Create KV namespace
npx wrangler kv:namespace create "EVENTS_KV"

# 2. Update wrangler.toml with KV ID
# Replace EVENTS_KV_ID_PLACEHOLDER with actual ID

# 3. Deploy
npx wrangler deploy

# 4. Verify
npx wrangler kv:key list --binding=EVENTS_KV
```

---

## 🔍 Query Events

```bash
# List all events for a property
npx wrangler kv:key list --binding=EVENTS_KV --prefix="events:lakeview:"

# Read specific event
npx wrangler kv:key get "events:lakeview:page_view:1704036000000:x7k2p9q1w" --binding=EVENTS_KV

# Count events by type
npx wrangler kv:key list --binding=EVENTS_KV | grep "page_view" | wc -l
```

---

## 🧪 Test Scenarios

### Test 1: Page View
1. Visit `https://lakeview.webzyl.com`
2. Check logs: `[METRICS] Event emitted: page_view for lakeview`
3. Verify KV: Event with slug=lakeview, event=page_view

### Test 2: CTA Click
1. Click "Book Now" button
2. Check network: POST `/api/event` → 204 No Content
3. Check logs: `[METRICS] Event emitted: cta_click for lakeview`
4. Verify KV: Event with ctaName=booking

### Test 3: Experiment Attribution
1. Create experiment in config
2. Visit property, note variant (A or B)
3. Click CTA
4. Verify: page_view AND cta_click have same experimentVariant

---

## 🐛 Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| No events in KV | Worker logs | Verify EVENTS_KV binding in wrangler.toml |
| 400 on /api/event | Network payload | Ensure event type is `page_view` or `cta_click` |
| Missing experimentId | Config in KV | Verify `experiment.id` and `experiment.enabled` |
| High KV usage | Event TTL | Verify `expirationTtl: 90 days` in emitEvent() |

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| METRICS_GOVERNANCE_v1.md | Privacy rules, compliance |
| PHASE_5_VERIFICATION.md | Verification checklist |
| PHASE_5_DEPLOYMENT_GUIDE.md | Deployment steps, troubleshooting |
| PHASE_5_SUMMARY.md | Implementation overview |

---

## ✅ Deployment Checklist

- [ ] EVENTS_KV namespace created
- [ ] wrangler.toml updated with KV ID
- [ ] worker.js deployed
- [ ] Page view events appearing in KV
- [ ] CTA click events appearing in KV
- [ ] No PII in events
- [ ] Timestamps bucketed to hour
- [ ] Experiment attribution working

---

## 🎯 Metrics You Can Track

- **Property Performance:** Page views, CTA clicks, conversion rate
- **Design Profile Impact:** Which profiles drive more engagement
- **Variant Comparison:** calm vs bold performance
- **Experiment Results:** A/B test winner identification
- **CTA Preference:** Booking vs WhatsApp usage

---

## 🔮 Next Steps (Optional)

1. Build CEO dashboard event viewer
2. Create experiment analysis report
3. Export events to Google Sheets
4. Auto-pause losing experiment variants

---

**Phase 5 Status:** ✅ COMPLETE & FROZEN

**End of Quick Reference**
