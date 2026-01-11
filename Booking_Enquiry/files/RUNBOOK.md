# Booking System Runbook

**Troubleshooting Guide**  
*Phase 5 - Production Support*

---

## Common Issues & Solutions

### 1. Booking Submissions Not Reaching Google Sheets

**Symptoms:**
- Frontend shows success
- No row appears in Google Sheets
- Worker logs show "BOOKING HANDLER EXECUTED"

**Debug Steps:**

```bash
# 1. Check Worker logs
wrangler tail

# Look for these logs:
# ✅ "🔥 BOOKING HANDLER EXECUTED"
# ✅ "➡️ Evaluating Apps Script forwarding"
# ✅ "🚀 Forwarding booking to Apps Script"

# 2. Verify environment variables
wrangler secret list

# Required:
# - BOOKING_WEBHOOK_URL
# - BOOKING_HMAC_SECRET
```

**Common Causes:**

| Issue | Fix |
|-------|-----|
| `BOOKING_WEBHOOK_URL` not set | `wrangler secret put BOOKING_WEBHOOK_URL` |
| Apps Script URL changed after redeploy | Update secret with new URL |
| HMAC mismatch | Ensure both Worker and Apps Script have same secret |
| Apps Script permissions issue | Re-authorize Web App deployment |

---

### 2. "Booking is temporarily unavailable" Error

**Symptoms:**
- Modal shows error immediately
- No backend call made

**Cause:**
Frontend cannot resolve `slug` from `window.RESORT_DATA` or fallback.

**Fix:**

```javascript
// In template HTML, ensure:
<script>
  window.RESORT_DATA = {
    slug: "mountview",  // ← Must be present
    // ... rest of data
  };
</script>
```

---

### 3. Rate Limiting Triggered

**Symptoms:**
- HTTP 429 response
- Error: "Too many requests. Please try again in an hour."

**Debug:**

```bash
# Check rate limit config in booking-api.js
# Default: 5 requests per hour per IP+slug
```

**Fix:**
- Wait 60 minutes, or
- Adjust `CONFIG.RATE_LIMIT` in `booking-api.js` (not recommended for production)

---

### 4. Apps Script Returns 403 Forbidden

**Symptoms:**
- Worker logs show fetch error
- Apps Script not appending data

**Cause:**
Web App deployment not set to "Anyone" or permissions changed.

**Fix:**

1. Open Apps Script project
2. **Deploy** → **Manage Deployments**
3. Click ⚙️ on active deployment → **Edit**
4. Set **Execute as:** Me
5. Set **Who has access:** Anyone
6. Click **Deploy**
7. Copy new Web App URL
8. Update Worker secret: `wrangler secret put BOOKING_WEBHOOK_URL`

---

### 5. HMAC Signature Verification Fails

**Symptoms:**
- Apps Script logs: "Invalid signature"
- Booking not saved

**Fix:**

```bash
# Ensure both sides use the same secret
wrangler secret put BOOKING_HMAC_SECRET

# Then in Apps Script:
# File → Project Settings → Script Properties
# Key: BOOKING_HMAC_SECRET
# Value: <same value as Worker>
```

---

### 6. WhatsApp Link Not Appearing

**Symptoms:**
- Booking succeeds
- WhatsApp CTA button not shown

**Cause:**
Apps Script not returning `whatsappUrl` in response.

**Debug:**

Check Apps Script response includes:

```javascript
{
  "success": true,
  "whatsappUrl": "https://wa.me/919876543210?text=..."
}
```

**Fix:**

Verify `config.booking.whatsappNumber` exists in KV config.

---

### 7. Date Validation Errors

**Symptoms:**
- "Check-out date must be after check-in date"
- Dates look correct

**Cause:**
Timezone mismatch or invalid date parsing.

**Fix:**

Dates are normalized to `YYYY-MM-DD` format:

```javascript
checkIn: new Date(formData.get('checkIn')).toISOString().split('T')[0]
```

Ensure browser date inputs are valid.

---

## Health Check Commands

```bash
# 1. Test Worker endpoint
curl -X POST https://webzyl-worker.rinil-kuriakose093.workers.dev/api/booking \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "mountview",
    "name": "Test User",
    "phone": "+919999999999",
    "checkIn": "2025-12-25",
    "checkOut": "2025-12-26",
    "guests": 2
  }'

# Expected: { "success": true, ... }

# 2. Check KV config
wrangler kv:key get --binding=RESORT_CONFIGS "config:mountview"

# 3. View live logs
wrangler tail --format pretty
```

---

## Emergency Rollback

If Phase 5 breaks production:

```bash
# 1. Git tag exists (if initialized)
git checkout phase-4-stable

# 2. Deploy previous version
wrangler deploy

# 3. Disable booking modal in templates
# Comment out: <script src="booking-modal.html"></script>
```

---

## Monitoring Checklist

**Daily:**
- [ ] Check Google Sheets for new bookings
- [ ] Scan Worker logs for errors: `wrangler tail`

**Weekly:**
- [ ] Verify Apps Script quota usage
- [ ] Review rate limit triggers

**After Config Changes:**
- [ ] Test end-to-end booking flow
- [ ] Verify KV propagation (wait 60s)

---

## Support Contacts

**Infrastructure:**
- Cloudflare Workers: [Frozen contract - worker.js]
- KV Store: `RESORT_CONFIGS`

**Backend:**
- Apps Script Web App: See `BOOKING_CONFIG_REFERENCE.md`
- Google Sheets: See `BOOKING_CONFIG_REFERENCE.md`

**Secrets:**
- Stored in Wrangler (encrypted)
- Access: `wrangler secret list`

---

## Related Documentation

- [BOOKING_CONFIG_REFERENCE.md](BOOKING_CONFIG_REFERENCE.md) - Frozen URLs and IDs
- [KV_CONFIG_STRUCTURE.md](KV_CONFIG_STRUCTURE.md) - Config schema
- [QUICK-START-GUIDE.md](QUICK-START-GUIDE.md) - Setup instructions
- [PHASE-4-IMPLEMENTATION-GUIDE.md](PHASE-4-IMPLEMENTATION-GUIDE.md) - Architecture details
