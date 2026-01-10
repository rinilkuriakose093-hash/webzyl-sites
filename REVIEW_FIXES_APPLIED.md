# Review Comments - Fixes Applied ✅

**Date:** December 23, 2025
**Files Modified:** 
- `src/google-apps-script/booking-sink.js`
- `src/worker/booking-api.js`

---

## Summary of Fixes

### 1. ✅ **CRITICAL FIX: Header Extraction Pattern**

**Issue:** Custom headers sent by Worker were not reliably available in Apps Script via `e.parameter['X-Signature']`

**Root Cause:** Apps Script Web Apps don't consistently expose HTTP headers in `e.parameter`. They may appear in:
- `e.parameters` (plural, as arrays)
- `e.postData.headers` (direct object)
- Query string parameters (most reliable)

**Fix Applied:**
- **Apps Script:** Added `getHeader()` and `getQueryParam()` helper functions to check multiple locations
- **Apps Script:** Modified `doPost()` to use fallback chain:
  ```javascript
  const signature = getHeader(e, 'X-Signature') || getQueryParam(e, 'sig') || '';
  const sheetName = getHeader(e, 'X-Sheet-Name') || getQueryParam(e, 'sheet') || generateSheetName();
  ```
- **Worker:** Changed from sending headers to sending signature as query params (RECOMMENDED approach):
  ```javascript
  const webhookUrl = new URL(env.BOOKING_WEBHOOK_URL);
  webhookUrl.searchParams.append('sig', signature);
  webhookUrl.searchParams.append('sheet', sheetName);
  ```

**Impact:** Eliminates intermittent failures from header loss in Apps Script

**Testing:** Next booking submission will use query params and should be more reliable

---

### 2. ✅ **CRITICAL FIX: HMAC Secret Timing**

**Issue:** `HMAC_SECRET` was read at module load time, causing stale values if secret was updated

**Original Code:**
```javascript
const HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('BOOKING_HMAC_SECRET');
```

**Fix Applied:**
- Moved secret reading into `verifySignature()` function
- Now reads fresh value on every request
- Added inline comments explaining the change

**New Code:**
```javascript
function verifySignature(payload, receivedSignature) {
  const HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('BOOKING_HMAC_SECRET');
  // ... rest of function
}
```

**Impact:** Secret updates in Script Properties immediately take effect (no reload needed)

---

### 3. ✅ **IMPORTANT FIX: JSON Parse Safety**

**Issue:** Malformed JSON payload caused unhandled exception → 500 error instead of 400

**Original Code:**
```javascript
const payload = JSON.parse(e.postData.contents);
```

**Fix Applied:**
- Wrapped JSON parsing in try-catch
- Returns 400 (Bad Request) for invalid JSON
- Includes `errorType: 'JSON_PARSE_ERROR'` for debugging

**New Code:**
```javascript
let payload;
try {
  payload = JSON.parse(e.postData.contents);
} catch (parseErr) {
  Logger.log(`[BOOKING] JSON parse error: ${parseErr}`);
  return createResponse({ 
    success: false, 
    error: 'Invalid JSON payload',
    errorType: 'JSON_PARSE_ERROR'
  }, 400);
}
```

**Impact:** Better error reporting and correct HTTP status codes

---

### 4. ✅ **IMPROVEMENT: Error Response Granularity**

**Issue:** Generic 500 error didn't indicate actual error type

**Original Code:**
```javascript
return createResponse({ success: false, error: 'Internal server error' }, 500);
```

**Fix Applied:**
- Added `errorType` field to error responses
- Uses `err.name` from caught exceptions

**New Code:**
```javascript
return createResponse({ 
  success: false, 
  error: 'Internal server error',
  errorType: err.name || 'UnknownError'
}, 500);
```

**Impact:** Easier debugging - error logs will show actual error type (ReferenceError, TypeError, etc.)

---

### 5. ✅ **CLEANUP: Removed Unused Helper**

**Issue:** `bytesToHex()` function was defined but never used

**Action:** Removed the unused function (logic was already inline in `verifySignature()`)

---

### 6. ✅ **DOCUMENTATION: Critical Header Handling Notice**

**Added to booking-sink.js header comment:**
```javascript
/**
 * ⚠️ CRITICAL: Cloudflare Worker Integration
 * 
 * Apps Script has quirky header handling. For maximum reliability:
 * 
 * Option A (RECOMMENDED): Worker sends signature as query param
 *   POST https://script.google.com/...?sig=<hmac>&sheet=<name>
 *   (Most reliable in Apps Script)
 * 
 * Option B: Worker sends signature in headers
 *   X-Signature: <hmac>
 *   X-Sheet-Name: <name>
 *   (Less reliable, may fail intermittently)
 */
```

---

## Files Modified Summary

### `src/google-apps-script/booking-sink.js`
- ✅ Added `getHeader(e, headerName)` - checks e.parameters and e.postData.headers
- ✅ Added `getQueryParam(e, paramName)` - extracts query parameters  
- ✅ Modified `doPost()` - uses fallback chain for signature/sheetName
- ✅ Wrapped JSON parsing in try-catch with 400 error response
- ✅ Moved HMAC_SECRET reading into `verifySignature()` 
- ✅ Added `errorType` to error responses
- ✅ Removed unused `bytesToHex()` function
- ✅ Added critical documentation header about Apps Script header quirks

### `src/worker/booking-api.js`
- ✅ Changed webhook call to use query params instead of headers
- ✅ Uses `new URL()` and `searchParams.append()` for safe URL construction
- ✅ Added inline comment explaining the query param approach

---

## Testing Checklist

Before deploying to production:

- [ ] **Deploy Apps Script** with updated code
- [ ] **Run `setupBookingSink()`** in Apps Script editor to initialize HMAC secret
- [ ] **Run `testBookingSink()`** to verify sheet creation and row append
- [ ] **Update Worker** with new webhook URL (with query params)
- [ ] **Test booking submission** from `test-booking.html`
- [ ] **Verify** row appears in Google Sheet with correct data
- [ ] **Check Apps Script logs** for no errors
- [ ] **Update HMAC_SECRET** in Script Properties to match Worker's `BOOKING_HMAC_SECRET`

---

## Backup Files Created

Before applying fixes, backups were created:
- `src/worker/booking-api.js.backup` (7,509 bytes)
- `src/components/booking-modal.html.backup` (15,104 bytes)

These can be used to rollback if needed.

---

## Architecture Diagram (Updated)

```
Booking Modal (test-booking.html)
         ↓ POST /api/booking
         ↓
    Worker API (booking-api.js)
      - Rate limiting ✅
      - Validation ✅
      - HMAC signature ✅
         ↓ POST ?sig=...&sheet=...
         ↓
   Apps Script Sink (booking-sink.js)
      - getQueryParam() extraction ✅
      - HMAC verification ✅
      - Sheet creation ✅
         ↓
    Google Sheets (monthly partition)
      - Bookings_2025_12 ✅
      - Booking_Logs ✅
```

---

## Next Steps

1. **Deploy updated Apps Script** to Web App
2. **Update Worker environment** with correct BOOKING_WEBHOOK_URL
3. **Run end-to-end test** from booking modal
4. **Monitor logs** for any issues
5. **Phase 4:** Implement email notification channel

---

**Status:** ✅ All critical review comments addressed
**Risk Level:** 🟢 Low (backward compatible, improved reliability)
**Rollback Plan:** Use .backup files if needed
