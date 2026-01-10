# Metrics Governance v1

**(Privacy-First, Deterministic Analytics)**

## Purpose

Metrics exist to:
- **Measure what matters** (views, engagement, experiments)
- **Optimize conversions** safely
- **Validate design decisions** with data
- **Respect user privacy** absolutely

**Metrics are not surveillance.**  
All data collection follows strict privacy-first and zero-ops principles.

---

## Core Principles

### 1. Privacy is Non-Negotiable

**NO Personal Data Collection:**
- ❌ No IP addresses stored
- ❌ No user fingerprinting
- ❌ No cookies for tracking
- ❌ No session replay
- ❌ No user agent strings
- ❌ No geolocation
- ❌ No third-party trackers

**What We Collect:**
- ✅ Aggregate page views (per slug)
- ✅ Section visibility (hero, gallery, contact)
- ✅ CTA intent (booking click, WhatsApp click)
- ✅ Experiment assignment (A/B)
- ✅ Timestamp (bucketed to hour)

### 2. Deterministic Attribution

- Experiment assignment is deterministic (slug-based)
- Same metrics for same slug
- Reproducible results
- No runtime randomness

### 3. Zero-Ops Operation

- Events fire asynchronously
- No response blocking
- No retry logic (fire-and-forget)
- Append-only storage
- No complex aggregation at write time

### 4. SSR-Aware Metrics

- Page views counted at SSR time
- Design profile + variant captured
- Experiment attribution automatic
- No client-side guessing

---

## Event Schema (v1)

### Allowed Fields

```typescript
{
  event: string,           // Event type: "page_view", "cta_click", etc.
  slug: string,            // Property slug (e.g., "mountview")
  profileId: string,       // Design profile ID (e.g., "luxury-heritage-v1")
  variantId?: string,      // Variant ID (e.g., "calm", "bold")
  experimentId?: string,   // Experiment ID if active
  experimentVariant?: string, // Experiment variant (A/B)
  ctaName?: string,        // CTA identifier for click events
  tsBucket: string         // Timestamp bucket (YYYY-MM-DD-HH)
}
```

### Field Constraints

**event:**
- Allowed values: `page_view`, `cta_click`
- No custom event names in v1

**slug:**
- Property identifier only
- No user identifiers

**profileId, variantId:**
- Design system identifiers
- From SSR resolution

**experimentId, experimentVariant:**
- From Phase 3 experiment system
- Deterministic assignment only

**tsBucket:**
- Format: `YYYY-MM-DD-HH`
- Hourly granularity only
- No precise timestamps stored

---

## Events Collected (v1)

### 1. Page View (SSR)

**Trigger:** Successful page render at SSR  
**Timing:** After HTML generation, before response  
**Non-blocking:** Yes

**Fields:**
```javascript
{
  event: "page_view",
  slug: "mountview",
  profileId: "luxury-heritage-v1",
  variantId: "calm",
  experimentId: "hero-spacing-test-v1",  // if active
  experimentVariant: "A",                 // if active
  tsBucket: "2026-01-01-14"
}
```

### 2. CTA Click (Frontend)

**Trigger:** User clicks booking or WhatsApp CTA  
**Timing:** Client-side intent capture  
**Non-blocking:** Yes (beacon API or async POST)

**Fields:**
```javascript
{
  event: "cta_click",
  slug: "mountview",
  ctaName: "booking" | "whatsapp",
  tsBucket: "2026-01-01-14"
}
```

**Enrichment:**  
Worker enriches with profileId, variantId, experimentId from config.

---

## Explicitly Forbidden Data

### Personal Identifiable Information (PII)

- ❌ Names
- ❌ Email addresses  
- ❌ Phone numbers
- ❌ Physical addresses

### Technical Identifiers

- ❌ IP addresses (even hashed)
- ❌ User agent strings
- ❌ Device fingerprints
- ❌ Cookie values
- ❌ Session IDs

### Behavioral Tracking

- ❌ Click streams
- ❌ Scroll depth
- ❌ Mouse movements
- ❌ Time on page
- ❌ Session replay

**Violations of this list are governance failures.**

---

## Data Retention

### Storage Policy

**Append-Only:**
- Events written once
- Never updated
- Never deleted automatically

**Retention Assumption:**
- Store events for analysis period (e.g., 90 days)
- Manual purge after analysis complete
- No automated retention enforcement in v1

### Access Control

- Events stored in Cloudflare KV (owner-only access)
- OR Google Apps Script (authenticated endpoint)
- No public API for event data

---

## Event Sink Implementation

### Option A: Cloudflare KV (Recommended v1)

```javascript
// Append-only writes
await env.METRICS_KV.put(
  `event:${slug}:${Date.now()}`,
  JSON.stringify(eventObject),
  { expirationTtl: 7776000 } // 90 days
);
```

**Pros:**
- Zero external dependencies
- Fast writes
- Built-in expiration
- Owner-controlled

**Cons:**
- Manual export for analysis
- No built-in aggregation

### Option B: Google Apps Script

```javascript
// Fire-and-forget POST
fetch("https://script.google.com/macros/s/.../exec", {
  method: "POST",
  body: JSON.stringify(eventObject)
}).catch(() => {}); // No retries
```

**Pros:**
- Automatically logs to Google Sheets
- Easy analysis in Sheets
- No KV storage used

**Cons:**
- External dependency
- Network latency
- Potential failures

**v1 Choice:** Start with KV for reliability. Add GAS later for reporting.

---

## Privacy Guarantees

### What We Promise

1. **No user tracking** across sites or sessions
2. **No PII collection** of any kind
3. **No third-party sharing** of event data
4. **Aggregate analysis only** - no individual behavior tracking
5. **Transparent collection** - documented in governance

### Compliance

- **GDPR Safe:** No personal data = no consent required
- **CCPA Safe:** No sale of data, no personal data
- **Privacy-First:** Designed for privacy from day one

---

## Metrics Usage

### Valid Use Cases

✅ Measure page view counts per property  
✅ Compare experiment variant performance  
✅ Track CTA click rates  
✅ Analyze design profile effectiveness  
✅ Optimize conversion funnels

### Invalid Use Cases

❌ User profiling  
❌ Behavioral targeting  
❌ Cross-site tracking  
❌ Retargeting campaigns  
❌ Third-party data sales

---

## One-Line Rule

> **If a metric requires collecting personal data or tracking individuals, it doesn't belong in Webzyl.**

---

## Status

**Version:** 1.0  
**Status:** LOCKED  
**Last Updated:** January 1, 2026  
**Compliance:** Privacy-first, zero-ops, deterministic
