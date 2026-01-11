# 🚀 PHASE 4 QUICK START GUIDE
## From Zero to Production in 30 Minutes

---

## 📦 What You'll Deploy

✅ Booking enquiry capture system  
✅ Google Sheets storage (month-based, auto-scaling)  
✅ Cloudflare Worker API (edge-deployed, globally fast)  
✅ Google Apps Script backend (zero-ops)  
✅ Frontend booking modal (professional UI)  
✅ Anti-spam protection (rate limiting + honeypot)  
✅ HMAC authentication (secure worker ↔ sheets communication)  

---

## ⏱️ Time Estimates

| Task | Time |
|------|------|
| Google Sheets setup | 2 min |
| Apps Script deployment | 10 min |
| Worker deployment | 10 min |
| Frontend integration | 5 min |
| Testing | 5 min |
| **Total** | **~30 min** |

---

## 🎯 Prerequisites

- [ ] Google Account
- [ ] Cloudflare Account (free tier OK)
- [ ] Existing Cloudflare Worker + KV namespace
- [ ] Terminal with `curl` or API testing tool
- [ ] Text editor

---

## 📋 DEPLOYMENT CHECKLIST

### PHASE 1: Google Sheets (5 minutes)

- [ ] **Step 1.1**: Create new Google Sheet
  ```
  Name: "Resort Bookings - MASTER"
  ```

- [ ] **Step 1.2**: Copy Spreadsheet ID from URL
  ```
  https://docs.google.com/spreadsheets/d/[COPY_THIS_ID]/edit
  ```

- [ ] **Step 1.3**: Note it somewhere safe
  ```
  SPREADSHEET_ID = 1abc...xyz
  ```

---

### PHASE 2: Apps Script Deployment (10 minutes)

- [ ] **Step 2.1**: Go to https://script.google.com

- [ ] **Step 2.2**: Click "New Project"

- [ ] **Step 2.3**: Name it "Booking Sink API"

- [ ] **Step 2.4**: Delete default code

- [ ] **Step 2.5**: Copy entire contents of `google-apps-script-booking-sink.js`

- [ ] **Step 2.6**: Paste into Code.gs

- [ ] **Step 2.7**: Update `SPREADSHEET_ID` variable (line ~16)
  ```javascript
  const SPREADSHEET_ID = 'YOUR_ACTUAL_SPREADSHEET_ID_HERE';
  ```

- [ ] **Step 2.8**: Generate HMAC Secret
  ```bash
  # In terminal:
  openssl rand -hex 32
  
  # Copy output (example):
  a1b2c3d4e5f6...xyz789
  ```

- [ ] **Step 2.9**: Set Script Properties
  - Click ⚙️ (Project Settings)
  - Scroll to "Script Properties"
  - Click "Add script property"
  - Key: `BOOKING_HMAC_SECRET`
  - Value: [Paste your generated secret]
  - Click "Save script properties"

- [ ] **Step 2.10**: (Optional) Set notification email
  - Add another property:
  - Key: `NOTIFICATION_EMAIL`
  - Value: `your-email@example.com`

- [ ] **Step 2.11**: Deploy as Web App
  - Click "Deploy" → "New deployment"
  - Click ⚙️ (Select type)
  - Choose "Web app"
  - Description: `v1.0`
  - Execute as: **Me**
  - Who has access: **Anyone**
  - Click "Deploy"

- [ ] **Step 2.12**: Authorize
  - Click "Authorize access"
  - Choose your Google account
  - Click "Advanced" → "Go to Booking Sink API (unsafe)"
  - Click "Allow"

- [ ] **Step 2.13**: Copy Web App URL
  ```
  https://script.google.com/macros/s/[SCRIPT_ID]/exec
  ```

- [ ] **Step 2.14**: Test it
  - In Apps Script editor, select `testBookingSink` function
  - Click "Run"
  - Check your Google Sheet - should see a test row!

---

### PHASE 3: Cloudflare Worker (10 minutes)

- [ ] **Step 3.1**: Create worker file
  ```bash
  # Copy cloudflare-worker-booking-api.js to your project
  # Or add to existing worker
  ```

- [ ] **Step 3.2**: Update main worker to route `/api/booking`
  ```javascript
  // In your worker's main file:
  
  import { handleBookingRequest, handleOptions } from './booking-api.js';
  
  addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request, event));
  });
  
  async function handleRequest(request, event) {
    const url = new URL(request.url);
    
    // Booking endpoint
    if (url.pathname === '/api/booking') {
      if (request.method === 'OPTIONS') {
        return handleOptions();
      }
      return handleBookingRequest(request, event.env);
    }
    
    // Your other routes...
    // return handleOtherRoutes(request, event);
  }
  ```

- [ ] **Step 3.3**: Set environment variables in Cloudflare Dashboard
  - Go to Cloudflare Dashboard
  - Select your Worker
  - Click "Settings" → "Variables"
  - Add variable:
    - Name: `BOOKING_WEBHOOK_URL`
    - Value: [Your Apps Script Web App URL]
    - Type: Secret (encrypted)
  - Add another variable:
    - Name: `BOOKING_HMAC_SECRET`
    - Value: [Same secret from Apps Script]
    - Type: Secret (encrypted)

- [ ] **Step 3.4**: Verify KV binding
  - In Settings → "Variables"
  - Check "KV Namespace Bindings"
  - Should see: `RESORT_CONFIGS` → [your KV namespace]

- [ ] **Step 3.5**: Deploy worker
  ```bash
  wrangler deploy
  
  # Or deploy via Dashboard:
  # - Copy worker code
  # - Paste in Dashboard editor
  # - Click "Save and Deploy"
  ```

- [ ] **Step 3.6**: Test API endpoint
  ```bash
  curl -X POST https://your-worker.workers.dev/api/booking \
    -H "Content-Type: application/json" \
    -d '{
      "slug": "test-resort",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+919876543210",
      "roomType": "Deluxe",
      "checkIn": "2025-02-01",
      "checkOut": "2025-02-03",
      "guests": 2,
      "notes": "Test",
      "sourceChannel": "test"
    }'
  
  # Expected response:
  # {
  #   "success": true,
  #   "message": "Your enquiry has been received successfully",
  #   "mode": "sheet",
  #   "recorded": true
  # }
  ```

- [ ] **Step 3.7**: Check Google Sheet
  - Open your spreadsheet
  - Should see new sheet: `Bookings_2025_12` (current month)
  - Should see your test booking row

---

### PHASE 4: Frontend Integration (5 minutes)

- [ ] **Step 4.1**: Copy booking modal HTML
  - Open `booking-modal.html`
  - Copy entire contents

- [ ] **Step 4.2**: Add to your template
  - Open your `template.html`
  - Find closing `</body>` tag
  - Paste modal HTML just before `</body>`

- [ ] **Step 4.3**: Wire up "Book Now" buttons
  ```html
  <!-- In your rooms section: -->
  <button class="book-button" onclick="openBookingModal('{{roomType}}')">
    Book Now
  </button>
  
  <!-- In hero section: -->
  <a href="#" class="btn-primary" onclick="event.preventDefault(); openBookingModal();">
    Reserve Now
  </a>
  ```

- [ ] **Step 4.4**: Ensure RESORT_DATA is injected
  ```javascript
  // Your Worker should inject this into template:
  <script>
  window.RESORT_DATA = {
    slug: "{{slug}}",
    name: "{{name}}",
    rooms: {{roomsJSON}},
    booking: {{bookingJSON}},
    contact: {{contactJSON}}
  };
  </script>
  ```

- [ ] **Step 4.5**: Deploy updated template
  - Commit to git
  - Push to Cloudflare Pages
  - Or upload manually

---

### PHASE 5: Testing (5 minutes)

- [ ] **Test 5.1**: Open your microsite
  ```
  https://your-site.com
  ```

- [ ] **Test 5.2**: Click "Book Now"
  - Modal should open
  - Form should be visible
  - Date picker should work

- [ ] **Test 5.3**: Fill form with valid data
  - Name: Your name
  - Email: Your email
  - Phone: Valid phone
  - Dates: Future dates
  - Guests: 2
  - Notes: Test booking from production

- [ ] **Test 5.4**: Submit form
  - Should show loading state
  - Should show success message
  - Should show WhatsApp link (if mode = both/whatsapp)

- [ ] **Test 5.5**: Verify in Google Sheet
  - Open spreadsheet
  - Check current month sheet
  - Find your booking row
  - Verify all fields populated

- [ ] **Test 5.6**: Test validation
  - Try submitting empty form → Should show errors
  - Try invalid email → Should show error
  - Try checkout before checkin → Should show error

- [ ] **Test 5.7**: Test rate limiting
  - Submit 6 bookings quickly
  - 6th should be blocked with "Too many requests"

---

## ✅ POST-DEPLOYMENT VERIFICATION

### Critical Checks

- [ ] Booking form opens without errors
- [ ] Form submission works end-to-end
- [ ] Data appears in Google Sheet
- [ ] Timestamps are correct (UTC)
- [ ] Rate limiting works (5 requests/hour)
- [ ] Validation works (required fields, formats)
- [ ] Success/error messages display
- [ ] WhatsApp link generated (if applicable)
- [ ] No console errors in browser
- [ ] Worker logs show no errors

### Monitoring Setup

- [ ] Check Cloudflare Worker Analytics
  - Go to Worker → Analytics
  - Verify requests are being logged
  - Check error rate (should be <5%)

- [ ] Check Apps Script Execution Log
  - Go to Apps Script → Executions
  - Verify successful executions
  - No errors visible

- [ ] Set up alerts (optional)
  - Cloudflare: Email on error rate >10%
  - Google Sheets: Notify on new row (via Apps Script)

---

## 🎉 SUCCESS!

If all checks passed, you now have:

✅ **Production-ready booking enquiry system**  
✅ **Zero database management**  
✅ **Zero server management**  
✅ **Globally distributed (Cloudflare Edge)**  
✅ **Secure (HMAC, rate limiting, honeypot)**  
✅ **Scalable (handles 100K+ bookings/month)**  
✅ **Auditable (full IP, timestamp, user agent logs)**  
✅ **Cost-effective (<$5/month even at scale)**  

---

## 🔧 COMMON ISSUES & FIXES

### Issue: "Invalid signature" error

**Fix:**
```bash
# Regenerate secret
openssl rand -hex 32

# Update in BOTH places:
# 1. Apps Script → Script Properties → BOOKING_HMAC_SECRET
# 2. Worker → Settings → Variables → BOOKING_HMAC_SECRET

# Must match EXACTLY
```

### Issue: Booking not appearing in sheet

**Check:**
1. Apps Script execution log for errors
2. Web App URL is correct in Worker env vars
3. Spreadsheet ID is correct in Apps Script
4. Sheet permissions (shareable with anyone who has link)

### Issue: "Too many requests" immediately

**Fix:**
```javascript
// Increase rate limit in worker
const CONFIG = {
  RATE_LIMIT: {
    MAX_REQUESTS: 10, // Increase from 5
    WINDOW_MINUTES: 60
  }
};
```

### Issue: Modal not opening

**Check:**
1. Booking modal HTML was added to template
2. `window.RESORT_DATA` is defined
3. No JavaScript errors in console
4. `openBookingModal()` function is defined

---

## 📊 ANALYTICS & TRACKING

### Metrics to Monitor

| Metric | Where to Find | Target |
|--------|---------------|--------|
| Booking success rate | Worker Analytics | >95% |
| Avg response time | Worker Analytics | <500ms |
| Rate limit hits | Worker Logs | <5% of total |
| Apps Script errors | Apps Script Executions | 0 |
| Bookings/day | Google Sheets | Track trend |

### Google Analytics Events (optional)

```javascript
// Track booking form opens
gtag('event', 'booking_form_open', {
  'event_category': 'engagement',
  'event_label': roomType
});

// Track successful bookings
gtag('event', 'booking_success', {
  'event_category': 'conversion',
  'value': 1
});
```

---

## 🚀 NEXT STEPS

### Immediate (Week 1)
- [ ] Monitor for first real bookings
- [ ] Respond to test bookings within 24h
- [ ] Set up email notifications
- [ ] Create process for following up

### Short-term (Month 1)
- [ ] Archive old sheets (>3 months)
- [ ] Review booking patterns
- [ ] Optimize WhatsApp templates
- [ ] Add more room types if needed

### Medium-term (Quarter 1)
- [ ] Build admin dashboard
- [ ] Add calendar integration
- [ ] Implement email confirmations
- [ ] Add booking status tracking

### Long-term (Year 1)
- [ ] Full booking engine
- [ ] Payment integration
- [ ] Availability calendar
- [ ] OTA integrations

---

## 📞 SUPPORT

### Resources
- Full documentation: `PHASE-4-IMPLEMENTATION-GUIDE.md`
- Test suite: `test-suite.js`
- Environment config: `.env.example`

### Troubleshooting
- Check Apps Script execution logs
- Check Cloudflare Worker logs
- Check browser console
- Review this checklist

---

## 📝 MAINTENANCE SCHEDULE

### Daily
- [ ] Check for new bookings
- [ ] Respond to enquiries

### Weekly
- [ ] Review error logs
- [ ] Check success rates
- [ ] Test booking flow

### Monthly
- [ ] Archive old sheets
- [ ] Review rate limiting
- [ ] Check storage costs
- [ ] Update templates if needed

### Quarterly
- [ ] Security audit
- [ ] Performance review
- [ ] Update dependencies
- [ ] Plan improvements

---

**Deployment Date**: _____________  
**Deployed By**: _____________  
**Version**: 1.0  
**Status**: ☐ Testing  ☐ Staging  ☐ **Production**

---

🎊 **CONGRATULATIONS!** 🎊

You've successfully deployed a production-grade, zero-ops booking enquiry system that will serve your SME clients reliably for years to come.

---

*Last Updated: 2025-12-23*  
*Phase 4 - Booking Enquiry Backend*
