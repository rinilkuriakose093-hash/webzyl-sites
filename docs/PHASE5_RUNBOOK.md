# Phase 5 Runbook — Common Issues & Resolution

## System Overview

```
Booking Modal (Frontend)
    ↓ POST /api/booking
Cloudflare Worker (booking-api.js)
    ↓ Validate + HMAC + Forward
Google Apps Script (doPost)
    ↓ Verify HMAC + Validate
Google Sheets (Bookings_YYYY_MM)
```

---

## Troubleshooting Guide

### Issue 1: Booking Returns 403 (Unavailable)

**Symptom:**
```json
{ "success": false, "message": "Bookings are currently unavailable for this resort." }
```

**Root Cause:**
- Resort config missing from KV
- OR `config.status !== 'active'`

**Diagnosis:**
```bash
# Check if config exists
wrangler kv:key get "config:mountview"
```

**Resolution:**
```bash
# Create minimal config
echo '{
  "slug": "mountview",
  "status": "active",
  "booking": {"mode": "sheet"}
}' > config-mountview.json

wrangler kv:key put "config:mountview" --path config-mountview.json
```

---

### Issue 2: 429 (Rate Limited)

**Symptom:**
```json
{ "success": false, "message": "Too many requests. Please try again later." }
```

**Root Cause:**
- More than 5 requests per hour from same IP + slug

**Resolution:**
- Wait 1 hour, OR
- Test from different IP/location, OR
- Increase `RATE_LIMIT_MAX` in booking-api.js (production requires code change + deploy)

**For Testing:**
```powershell
# Use VPN/proxy for testing multiple requests
# OR test with different slug to avoid rate limit
```

---

### Issue 3: appScriptForwarded = false

**Symptom:**
```json
{
  "success": true,
  "appScriptForwarded": false,
  "message": "Your enquiry has been received successfully"
}
```

**Root Cause:**
- Apps Script webhook not configured, OR
- Apps Script endpoint unreachable, OR
- HMAC secret mismatch

**Diagnosis:**
```bash
# Check Worker env variables
wrangler env:list

# Check if BOOKING_WEBHOOK_URL is set
wrangler secret list

# Check if BOOKING_HMAC_SECRET is set
wrangler secret list
```

**Resolution:**

1. **Verify Worker Config:**
   ```bash
   # Should show BOOKING_WEBHOOK_URL and BOOKING_HMAC_SECRET
   wrangler secret list
   ```

2. **Verify Apps Script Deployment:**
   - Go to Apps Script editor
   - Deploy → Check latest deployment is active
   - Copy Web App URL
   - Set in Worker: `wrangler secret put BOOKING_WEBHOOK_URL`

3. **Verify HMAC Secret Matches:**
   - In Apps Script: Run `setupBookingSink()`
   - This generates a secret and logs it
   - Set same value in Worker: `wrangler secret put BOOKING_HMAC_SECRET`

4. **Test Webhook Directly:**
   ```powershell
   $body = @{
     slug = "mountview"
     name = "Test"
     email = "test@test.com"
     checkIn = "2025-12-25"
     checkOut = "2025-12-26"
     guests = 1
     timestamp = Get-Date -Format o
   } | ConvertTo-Json
   
   Invoke-RestMethod `
     -Uri "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/usercontent/drive/YOUR_ID" `
     -Method POST `
     -ContentType "application/json" `
     -Body $body
   ```

---

### Issue 4: Row Not Appearing in Sheet

**Symptom:**
- Booking returns success
- `appScriptForwarded: true`
- But no row in Google Sheet

**Root Cause:**
- HMAC verification failure (fail-open logging the issue), OR
- Validation failure, OR
- Sheet creation/append failure

**Diagnosis:**
```javascript
// In Apps Script Editor:
// 1. Check Executions tab (View → Executions)
// 2. Click on any execution
// 3. Read the logs
```

**Expected Log Pattern (Success):**
```
[BOOKING] ========== doPost() ENTRY ==========
[BOOKING] ✅ JSON parsed successfully
[BOOKING] ✅ HMAC verification passed
[VALIDATION] ✅ Payload validation completed successfully
[SHEETS] ✅ Existing sheet found: Bookings_2025_12
[SHEETS] ========== ABOUT TO APPEND ROW ==========
[SHEETS] ✅ sheet.appendRow() completed
[SHEETS] ✅ Row 48 appended and formatted
[BOOKING] ========== RETURNING SUCCESS ==========
```

**Resolution by Log Type:**

**If logs show HMAC failure:**
```
[SECURITY] ⚠️ WARNING: BOOKING_HMAC_SECRET not configured
[SECURITY] ⚠️ Allowing request in DEV MODE
```
→ Run `setupBookingSink()` in Apps Script

**If logs show validation failure:**
```
[VALIDATION] ❌ Missing required field: timestamp
```
→ Check Worker is sending all required fields

**If logs show sheet append failure:**
```
[SHEETS] ❌ CRITICAL ERROR in appendBookingRow: SpreadsheetApp error
[SHEETS] Stack: ...
```
→ Check:
- SPREADSHEET_ID is correct in Apps Script
- User running Apps Script has permission to edit sheet
- Sheet exists or can be created

---

### Issue 5: No Logs in Apps Script Executions

**Symptom:**
- Booking submission shows no execution in Executions tab
- OR execution shows but no logs

**Root Cause:**
- Apps Script not receiving request at all, OR
- Wrong deployment ID in Worker, OR
- Apps Script version not deployed

**Diagnosis:**
```javascript
// In Apps Script Editor:
// 1. Run testBookingSink() manually
// 2. Check Executions tab for that run
// 3. If you see logs there, Apps Script code is working
```

**Resolution:**
1. Verify Worker has correct `BOOKING_WEBHOOK_URL`:
   ```bash
   wrangler secret list | grep BOOKING_WEBHOOK_URL
   ```

2. Test URL directly in browser/curl:
   ```bash
   # Should give an error (POST with no data) but confirms endpoint exists
   curl "https://script.google.com/macros/s/YOUR_ID/usercontent"
   ```

3. Re-deploy Apps Script:
   - Apps Script Editor → Deploy → New Deployment
   - Copy new URL
   - Update Worker secret: `wrangler secret put BOOKING_WEBHOOK_URL`
   - Redeploy Worker: `wrangler deploy`

---

### Issue 6: HMAC Signature Mismatch

**Symptom (in Apps Script logs):**
```
[SECURITY] Signature mismatch. Expected: a1b2c3d4..., Got: x9y8z7w6...
```

**Root Cause:**
- HMAC_SECRET in Worker differs from Apps Script
- OR payload is being modified in transit

**Resolution:**
```bash
# 1. Get the secret from Apps Script
# Run in Apps Script: setupBookingSink()
# Copy the logged secret value

# 2. Update Worker with same value
wrangler secret put BOOKING_HMAC_SECRET

# 3. Paste the value from Apps Script

# 4. Re-deploy Worker
wrangler deploy
```

---

### Issue 7: Sheet Not Created (Monthly Rotation)

**Symptom:**
- Expected `Bookings_2025_12` but not created
- Bookings going to wrong month

**Root Cause:**
- Manual sheet name mismatch in config, OR
- System date is wrong on Apps Script server

**Resolution:**
```javascript
// In Apps Script, test date generation:
function testDateGeneration() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const expected = `Bookings_${year}_${month}`;
  Logger.log('Expected sheet name: ' + expected);
}
```

**If you need a specific month:**
```json
{
  "booking": {
    "sheetName": "Bookings_2025_12"
  }
}
```

---

## Performance Monitoring

### Check Worker Performance
```bash
# View last 100 requests
wrangler tail --sampling 1
```

### Check Apps Script Performance
1. Apps Script Editor → Executions
2. Filter by:
   - Time range
   - Execution status (successful/failed)
   - Run time duration

### Metrics to Monitor
- **Worker latency:** Should be <500ms
- **Apps Script latency:** Usually 500-2000ms
- **Sheet append latency:** Depends on spreadsheet size
- **Rate limit:** 5 requests/hour per IP+slug (working as intended)

---

## Rollback Procedures

### If Worker Deployment Breaks Bookings

```bash
# 1. View deployment history
wrangler rollback

# 2. To rollback to previous version
wrangler rollback --version <VERSION_ID>
```

### If Apps Script Breaks

```javascript
// In Apps Script Editor:
// 1. Version history (left sidebar)
// 2. Click on a previous version
// 3. Deploy → New Deployment → select that version
```

---

## Emergency Contacts

**Phase 5 is FROZEN** — Only fix production bugs.

For issues:
1. Check logs in Apps Script Executions tab
2. Review this runbook
3. If still unclear, enable verbose logging and re-test

---

**Last Updated:** 2025-12-24  
**Phase:** 5 (Frozen)  
**Maintainer:** Production Support
