# KV Configuration Structure

**Phase 5 Reference Documentation**  
*Last updated: December 24, 2025*

---

## Overview

Resort configurations are stored in Cloudflare KV under the namespace `RESORT_CONFIGS`.

**Key Pattern:** `config:<slug>`

---

## Configuration Schema

```json
{
  "slug": "mountview",
  "name": "Mount View Resort",
  "status": "active",
  "updatedAt": "2025-12-24T00:00:00Z",
  
  "booking": {
    "mode": "sheet",
    "sheetName": "Bookings_2025-12",
    "enabled": true,
    "whatsappNumber": "+919876543210"
  },
  
  "contact": {
    "phone": "+919876543210",
    "email": "info@mountview.com",
    "address": "123 Resort Road, Hill Station"
  },
  
  "theme": {
    "primaryColor": "#06b6d4",
    "accentColor": "#0891b2"
  },
  
  "rooms": [
    {
      "name": "Deluxe Room",
      "type": "deluxe",
      "capacity": 2,
      "price": 5000
    }
  ],
  
  "features": ["wifi", "pool", "restaurant", "parking"]
}
```

---

## Key Fields

### Core Identity
- `slug` **(required)** - Unique identifier, URL-safe
- `name` **(required)** - Display name
- `status` **(required)** - `active` | `inactive` | `maintenance`
- `updatedAt` - ISO 8601 timestamp

### Booking Configuration
- `booking.mode` - `sheet` | `disabled` | `both`
- `booking.sheetName` - Target sheet in Google Sheets (auto-generated if not set)
- `booking.enabled` - Boolean toggle
- `booking.whatsappNumber` - For WhatsApp CTA on success

### Optional Metadata
- `contact` - Contact information object
- `theme` - Theming overrides
- `rooms` - Array of room types
- `features` - Array of feature tags

---

## Usage in Worker

```javascript
// Fetch config
const config = await env.RESORT_CONFIGS.get(
  `config:${slug}`, 
  { type: 'json' }
);

// Check status
if (config?.status !== 'active') {
  // Reject booking
}

// Get booking mode
const mode = config?.booking?.mode || 'sheet';
```

---

## Default Behavior

If KV lookup returns `null`:
- Booking mode defaults to `'sheet'`
- Sheet name is auto-generated: `Bookings_YYYY-MM`
- Booking is allowed (fail-open for new resorts)

---

## Publishing Configs

Use Wrangler KV CLI:

```bash
wrangler kv:key put --binding=RESORT_CONFIGS \
  "config:mountview" \
  "$(cat mountview.json)"
```

Or via API/dashboard.

---

## Notes

- Configs are cached at the edge (eventual consistency)
- Updates may take 60s to propagate globally
- Always validate JSON before publishing
- Keep configs under 25MB (KV limit)
