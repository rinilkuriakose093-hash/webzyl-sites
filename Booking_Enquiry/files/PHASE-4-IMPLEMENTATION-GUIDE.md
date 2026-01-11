# Phase 4 - Booking Enquiry Backend
## Complete Implementation Guide

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Setup Instructions](#setup-instructions)
5. [Configuration](#configuration)
6. [Testing](#testing)
7. [Deployment Checklist](#deployment-checklist)
8. [Monitoring](#monitoring)
9. [Troubleshooting](#troubleshooting)

---

## Overview

Phase 4 implements a **zero-ops booking enquiry system** that:

✅ Captures booking enquiries from microsites  
✅ Validates and sanitizes all inputs  
✅ Rate-limits to prevent spam  
✅ Stores enquiries in month-based Google Sheets  
✅ Supports dual routing (Sheet + WhatsApp)  
✅ Provides full audit trail with IP, timestamp, user agent  
✅ Requires zero database or server management  

### What This Is NOT

❌ Full booking engine  
❌ Payment processing  
❌ Inventory management  
❌ Calendar blocking  
❌ OTA integration  

This is deliberately designed as an **enquiry capture system** to avoid false booking guarantees.

---

## Architecture

```
┌─────────────┐
│   Browser   │
│  (Customer) │
└──────┬──────┘
       │ POST /api/booking
       ▼
┌─────────────────────────────┐
│   Cloudflare Worker         │
│  - Validation               │
│  - Rate Limiting (5/hr/IP)  │
│  - Anti-Spam (Honeypot)     │
│  - KV Config Lookup         │
└──────┬──────────────────────┘
       │ Authenticated POST
       ▼
┌─────────────────────────────┐
│   Google Apps Script        │
│  - HMAC Verification        │
│  - Sheet Append (Immutable) │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│   Google Sheets             │
│  Bookings_2025_01           │
│  Bookings_2025_02           │
│  ...                        │
└─────────────────────────────┘
```

### Data Flow

1. **User fills booking form** on microsite
2. **Frontend validates** basic fields
3. **Cloudflare Worker**:
   - Checks rate limit (5 requests/hour/IP/slug)
   - Validates payload structure
   - Fetches config from KV (verify slug + status)
   - Enriches data (timestamp, IP, user agent, CF Ray)
   - Creates HMAC signature
   - Forwards to Apps Script
4. **Apps Script**:
   - Verifies HMAC
   - Gets or creates month sheet (`Bookings_YYYY_MM`)
   - Appends row (immutable, append-only)
   - Returns success
5. **Worker responds** to frontend with success/failure
6. **Frontend shows** confirmation + optional WhatsApp link

---

## Components

### 1. Frontend (Booking Modal)

**File**: `booking-modal.html`

**Features**:
- Responsive modal design
- Client-side validation
- Honeypot anti-spam field
- Date range validation
- Guest count validation
- Loading states
- Success/error messaging
- WhatsApp CTA (if enabled)

**Integration**:
```html
<!-- Add before </body> in template.html -->
<!-- Paste contents of booking-modal.html -->

<!-- Trigger from "Book Now" buttons -->
<button onclick="openBookingModal('Deluxe Room')">Book Now</button>
```

### 2. Cloudflare Worker (API Endpoint)

**File**: `cloudflare-worker-booking-api.js`

**Route**: `POST /api/booking`

**Responsibilities**:
- Rate limiting (in-memory)
- Payload validation
- KV config verification
- Data enrichment
- HMAC signing
- Apps Script forwarding
- WhatsApp URL generation

**Environment Variables Required**:
```bash
BOOKING_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
BOOKING_HMAC_SECRET=your-secret-key-here
```

### 3. Google Apps Script (Booking Sink)

**File**: `google-apps-script-booking-sink.js`

**Responsibilities**:
- HMAC verification
- Sheet creation (month-based)
- Append-only writes
- Audit logging
- Optional email notifications

**Script Properties Required**:
```
BOOKING_HMAC_SECRET = your-secret-key-here
NOTIFICATION_EMAIL = owner@example.com (optional)
```

---

## Setup Instructions

### Step 1: Google Sheets Setup

1. **Create Spreadsheet**:
   ```
   Name: "Resort Bookings - MASTER"
   ```

2. **Note the Spreadsheet ID**:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

3. **First sheet** will be auto-created by Apps Script

### Step 2: Google Apps Script Setup

1. **Create Apps Script Project**:
   - Go to https://script.google.com
   - Click "New Project"
   - Name: "Booking Sink API"

2. **Paste Code**:
   - Copy contents of `google-apps-script-booking-sink.js`
   - Paste into Code.gs

3. **Set Configuration**:
   - Replace `SPREADSHEET_ID` with your actual ID
   
4. **Set Script Properties**:
   - Click ⚙️ (Project Settings)
   - Scroll to "Script Properties"
   - Add property:
     - Key: `BOOKING_HMAC_SECRET`
     - Value: `generate-random-secret-64-chars` (use strong random string)
   - Optional: Add `NOTIFICATION_EMAIL`

5. **Deploy as Web App**:
   - Click "Deploy" → "New deployment"
   - Type: "Web app"
   - Description: "Booking Sink v1"
   - Execute as: **Me**
   - Who has access: **Anyone** (Worker will authenticate via HMAC)
   - Click "Deploy"
   - **Copy the Web App URL** (e.g., `https://script.google.com/macros/s/.../exec`)
   - **Authorize** the script when prompted

6. **Test**:
   ```javascript
   // Run testBookingSink() from Apps Script editor
   // Check if row appears in sheet
   ```

### Step 3: Cloudflare Worker Setup

1. **Add to Existing Worker** or create new:
   ```javascript
   // In your main worker file
   import { handleBookingRequest, handleOptions } from './booking-api.js';
   
   addEventListener('fetch', event => {
     event.respondWith(handleRequest(event.request, event));
   });
   
   async function handleRequest(request, event) {
     const url = new URL(request.url);
     
     if (url.pathname === '/api/booking') {
       if (request.method === 'OPTIONS') {
         return handleOptions();
       }
       return handleBookingRequest(request, event.env || {});
     }
     
     // ... other routes
   }
   ```

2. **Set Environment Variables**:
   - Go to Cloudflare Dashboard
   - Select your Worker
   - Settings → Variables
   - Add:
     ```
     BOOKING_WEBHOOK_URL = [Your Apps Script Web App URL]
     BOOKING_HMAC_SECRET = [Same secret as Apps Script]
     ```

3. **Bind KV Namespace**:
   ```
   Variable name: RESORT_CONFIGS
   KV namespace: [Your existing KV namespace]
   ```

4. **Deploy Worker**:
   ```bash
   wrangler deploy
   ```

### Step 4: Frontend Integration

1. **Add Modal HTML**:
   - Copy `booking-modal.html` contents
   - Paste before `</body>` in your `template.html`

2. **Wire Up Book Buttons**:
   ```html
   <!-- In rooms section -->
   <button class="book-button" onclick="openBookingModal('{{roomType}}')">
     Book Now
   </button>
   
   <!-- In hero section -->
   <a href="#" class="btn-primary" onclick="event.preventDefault(); openBookingModal();">
     Reserve Now
   </a>
   ```

3. **Ensure RESORT_DATA Available**:
   ```javascript
   // Worker should inject this into template
   <script>
   window.RESORT_DATA = {
     slug: "mountview",
     rooms: [...],
     booking: {
       mode: "both", // or "sheet" or "whatsapp"
       whatsappTemplate: "Hi, I want to book {{room}}..."
     },
     ...
   };
   </script>
   ```

---

## Configuration

### Booking Modes

Each SME configures their booking behavior in the Google Sheet:

#### Mode: `sheet`
```json
{
  "booking": {
    "mode": "sheet",
    "sheetName": "Bookings_2025_01"
  }
}
```
- Enquiry saved to Google Sheets only
- No WhatsApp redirect

#### Mode: `whatsapp`
```json
{
  "booking": {
    "mode": "whatsapp",
    "whatsappTemplate": "Hi, I want to enquire about {{room}} from {{checkIn}} to {{checkOut}}"
  }
}
```
- Enquiry NOT saved to Sheets
- Redirects to WhatsApp with pre-filled message
- Requires `contact.phone` or `social.whatsapp` in config

#### Mode: `both`
```json
{
  "booking": {
    "mode": "both",
    "sheetName": "Bookings_2025_01",
    "whatsappTemplate": "..."
  }
}
```
- Saves to Sheets AND shows WhatsApp option
- Recommended for maximum capture

### WhatsApp Template Variables

Available placeholders:
- `{{name}}` - Guest name
- `{{room}}` - Room type
- `{{checkIn}}` - Check-in date
- `{{checkOut}}` - Check-out date
- `{{guests}}` - Number of guests
- `{{notes}}` - Special requests

### Rate Limiting

**Default**: 5 requests per hour per IP per slug

**Why**: Prevents spam while allowing legitimate retries

**Customization**:
```javascript
// In worker config
const CONFIG = {
  RATE_LIMIT: {
    MAX_REQUESTS: 5,
    WINDOW_MINUTES: 60
  }
};
```

---

## Testing

### 1. Manual Frontend Test

1. Open microsite in browser
2. Click "Book Now"
3. Fill form with test data
4. Submit
5. Verify success message appears
6. Check Google Sheet for new row

### 2. API Test (curl)

```bash
curl -X POST https://your-worker.workers.dev/api/booking \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test-resort",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+919876543210",
    "roomType": "Deluxe Room",
    "checkIn": "2025-02-01",
    "checkOut": "2025-02-03",
    "guests": 2,
    "notes": "Test booking",
    "sourceChannel": "api-test"
  }'
```

Expected response:
```json
{
  "success": true,
  "message": "Your enquiry has been received successfully",
  "mode": "sheet",
  "recorded": true
}
```

### 3. Rate Limit Test

```bash
# Send 6 requests quickly
for i in {1..6}; do
  curl -X POST https://your-worker.workers.dev/api/booking \
    -H "Content-Type: application/json" \
    -d '{"slug":"test","name":"Test '$i'","phone":"1234567890","checkIn":"2025-02-01","checkOut":"2025-02-02","guests":1}'
  echo ""
done
```

6th request should return:
```json
{
  "success": false,
  "message": "Too many requests. Please try again in an hour."
}
```

### 4. Honeypot Test

```bash
# Include honeypot field (should be rejected silently)
curl -X POST https://your-worker.workers.dev/api/booking \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test",
    "name": "Bot",
    "phone": "1234567890",
    "website": "spam-value",
    "checkIn": "2025-02-01",
    "checkOut": "2025-02-02",
    "guests": 1
  }'
```

### 5. Validation Tests

**Missing required field**:
```bash
curl -X POST ... -d '{"slug":"test","checkIn":"2025-02-01","checkOut":"2025-02-02"}'
# Should return: "Name is required"
```

**Invalid dates**:
```bash
curl -X POST ... -d '{..., "checkIn":"2025-02-01","checkOut":"2025-02-01"}'
# Should return: "Check-out must be after check-in"
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Google Sheet created
- [ ] Spreadsheet ID recorded
- [ ] Apps Script deployed as Web App
- [ ] Web App URL copied
- [ ] HMAC secret generated (64+ chars)
- [ ] Same secret set in both Apps Script and Worker
- [ ] Worker environment variables configured
- [ ] KV namespace bound
- [ ] Frontend modal added to template
- [ ] Book buttons wired up
- [ ] Test booking submitted successfully

### Post-Deployment

- [ ] Submit test enquiry from production site
- [ ] Verify row appears in Google Sheet
- [ ] Test WhatsApp redirect (if mode = both/whatsapp)
- [ ] Test rate limiting
- [ ] Monitor Apps Script logs
- [ ] Monitor Worker analytics
- [ ] Set up email notifications (optional)

### Monthly Maintenance

- [ ] Check sheet doesn't exceed 1M rows
- [ ] Archive old sheets (older than 3 months)
- [ ] Review spam patterns in logs
- [ ] Adjust rate limits if needed

---

## Monitoring

### Apps Script Execution Log

1. Go to Apps Script project
2. Click "Executions" (left sidebar)
3. View recent executions
4. Check for errors

### Cloudflare Worker Analytics

1. Go to Cloudflare Dashboard
2. Select Worker
3. View Analytics tab
4. Monitor:
   - Request volume
   - Error rate
   - 429 responses (rate limit hits)
   - Latency

### Google Sheets

1. Open spreadsheet
2. Check "Booking_Logs" sheet
3. Monitor for failures
4. Review booking patterns

### Key Metrics to Track

| Metric | Target | Alert If |
|--------|--------|----------|
| Success Rate | >95% | <90% |
| Avg Response Time | <500ms | >2s |
| Rate Limit Hits | <5% | >20% |
| Apps Script Errors | 0 | >5/day |

---

## Troubleshooting

### Issue: Booking not appearing in Sheet

**Possible Causes**:
1. Apps Script not deployed
2. Wrong Web App URL
3. HMAC mismatch
4. Spreadsheet permissions

**Debug Steps**:
```
1. Check Apps Script execution log
2. Verify HMAC secrets match exactly
3. Test with Apps Script testBookingSink()
4. Check spreadsheet sharing settings
```

### Issue: "Invalid signature" Error

**Cause**: HMAC secret mismatch

**Fix**:
```bash
# Generate new secret
openssl rand -hex 32

# Update in BOTH places:
# 1. Apps Script → Script Properties
# 2. Worker → Environment Variables

# Redeploy both
```

### Issue: Rate Limit Too Aggressive

**Symptom**: Legitimate users blocked

**Fix**:
```javascript
// In worker config
const CONFIG = {
  RATE_LIMIT: {
    MAX_REQUESTS: 10, // Increase from 5
    WINDOW_MINUTES: 60
  }
};
```

### Issue: WhatsApp Link Not Working

**Cause**: Missing phone number in config

**Debug**:
```javascript
// Check config has:
{
  "contact": {
    "phone": "+919876543210" // Must include country code
  }
}
// OR
{
  "social": {
    "whatsapp": "919876543210"
  }
}
```

### Issue: CORS Errors

**Symptom**: Browser blocks request

**Fix**:
```javascript
// In worker response headers
'Access-Control-Allow-Origin': 'https://your-domain.com', // Specific domain
// OR
'Access-Control-Allow-Origin': '*' // All domains (less secure)
```

### Issue: Apps Script Timeout

**Symptom**: Apps Script execution exceeds 6 minutes (rare)

**Cause**: Sheet too large

**Fix**:
```javascript
// Archive old sheets
// Keep current month sheet under 50k rows
```

---

## Next Steps (Future Phases)

After Phase 4 is stable, consider:

### Phase 5: Email Notifications
- Send confirmation email to guest
- Send notification to SME owner
- Use Apps Script MailApp or SendGrid

### Phase 6: Admin Dashboard
- View all bookings
- Filter by date, slug, status
- Export to CSV
- Mark as "contacted", "confirmed", etc.

### Phase 7: Calendar Integration
- Block dates in Google Calendar
- Sync with property's calendar
- Prevent double bookings

### Phase 8: Full Booking Engine
- Real-time availability
- Payment processing (Stripe/Razorpay)
- Automated confirmations
- Booking modifications/cancellations

---

## Summary

Phase 4 provides a **production-ready, zero-ops booking enquiry system** that:

✅ **Captures** 100% of booking enquiries  
✅ **Validates** all inputs at multiple layers  
✅ **Prevents spam** with rate limiting + honeypot  
✅ **Stores permanently** in append-only sheets  
✅ **Scales infinitely** with Cloudflare + Sheets  
✅ **Costs almost nothing** to operate  
✅ **Provides full audit trail** for every enquiry  
✅ **Supports dual routing** (Sheet + WhatsApp)  

This is a **solid foundation** for SMEs to start receiving bookings immediately, while keeping the door open for full booking engine features later.

---

**Last Updated**: 2025-12-23  
**Version**: 1.0  
**Status**: Production-Ready
