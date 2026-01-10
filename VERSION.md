# Webzyl Platform - Version History

## v2.0.0 - Super Admin Dashboard (January 10, 2026)

**Git Commit:** `81c2d7b`
**Git Tag:** `v2.0.0`
**Status:** ✅ Production Ready

### Major Features

#### 1. Super Admin Controls in Operator Dashboard
Complete property management integrated into operator dashboard:

**Accessible at:** `https://webzyl.com/operator?slug={property}`

**Super Admin Controls (Red Border Section):**
- **Property Slug Manager** - Change property URL with validation
- **Plan Tier Selector** - Trial, Basic, Standard, Premium
- **Property Status** - Active, Inactive, Suspended
- **WhatsApp Quota Management** - Edit used/monthly limits + instant reset
- **Plan Expiry** - Date picker for subscription management
- **Category Selector** - Hotel, Resort, Homestay, Villa, Apartment
- **Base Price Editor** - Per night pricing

**Quick Actions:**
- 🔄 Reset WhatsApp Quota (one-click, updates month)
- 🔗 Change Slug (validates format, checks duplicates, auto-redirects)

#### 2. Gallery Upload with Cloudflare R2
Full gallery management replacing ImageKit placeholder:

**Upload Flow:**
1. Select image (max 10MB)
2. Get signed upload URL from `/api/media/sign-upload`
3. Upload directly to R2 bucket
4. Confirm via `/api/media/confirm-upload`
5. Auto-add to gallery array and save

**Features:**
- Delete images with 🗑️ button
- Immediate save to backend
- Image URLs: `https://img.webzyl.com/{slug}/gallery/{assetId}`
- Proper error handling and progress indicators

#### 3. Testimonials/Reviews System
Manual review management with brand protection:

**Data Structure:**
```javascript
{
  name: "John Doe",
  rating: 5,           // 1-5 stars
  text: "Amazing!",
  date: "2026-01-10",
  visible: true,       // Hide negative reviews
  source: "manual"
}
```

**Features:**
- Star rating selector (1-5)
- Visibility toggle for brand protection
- Display on live website with navigation menu
- Responsive card layout with CSS styling
- Location: template.html lines 1250-1275

#### 4. New API Endpoints (Super Admin)

**`/api/admin/config/update`** (POST)
- Update any config field
- Requires X-Admin-Token header
- Accepts updates object with any properties
- Returns list of updated fields

**`/api/admin/config/change-slug`** (POST)
```javascript
{
  oldSlug: "grand-royal",
  newSlug: "royal-grand"
}
```
- Validates slug format (lowercase, numbers, hyphens)
- Checks for duplicates (returns 409 if exists)
- Updates config slug/subdomain fields
- Moves KV storage: `config:{oldSlug}` → `config:{newSlug}`
- Deletes old key

**`/api/admin/quota/reset`** (POST)
```javascript
{
  slug: "grand-royal",
  quotaType: "whatsapp"
}
```
- Resets quota_whatsapp_used to 0
- Updates quota_used_month to current month
- Returns success confirmation

**Route Handler:**
- `/super-admin` - Standalone admin dashboard (for future use)

### Bug Fixes

1. **Gallery Delete Implementation**
   - Fixed `renderGallery()` to use `config.gallery` array
   - Implemented `deleteGalleryImage()` with immediate API save
   - Changed delete icon from × to 🗑️

2. **Reviews Persistence**
   - Fixed `handleOperatorUpdateWithUpdates()` missing reviews field
   - Added reviews handling at worker.js lines 1909-1913
   - Reviews now properly save and persist

3. **Empty Amenities Auto-Population**
   - Changed worker.js line 5196 from hardcoded defaults to empty array
   - Amenities section no longer appears when nothing selected

4. **Category Selection Trigger**
   - Added initialization trigger in CEO dashboard
   - Fixed null checks for DOM operations
   - Category change now fires on initial load

### Technical Implementation

**Worker.js Changes:**
```javascript
// Lines 950-976: Super admin config update
if (path === '/api/admin/config/update') { ... }

// Lines 979-1015: Slug change with validation
if (path === '/api/admin/config/change-slug') { ... }

// Lines 1017-1046: Quota reset
if (path === '/api/admin/quota/reset') { ... }

// Lines 1516-1543: Super admin dashboard handler
async function handleSuperAdminDashboard(request, env) { ... }
```

**Operator Dashboard (operator-dashboard.html):**
```javascript
// Lines 1295-1369: Super admin UI fields
// Lines 2274-2282: Load super admin fields from config
// Lines 2833-2838: Save super admin fields to config
// Lines 3668-3750: Super admin action functions
```

**Template (template.html):**
```javascript
// Lines 1250-1275: Reviews section HTML
// Lines 830-884: Reviews CSS styling
// Line 1126: Navigation menu link
```

### Files Changed

**Core:**
- `worker.js` (212KB → 214KB) - 3 new API endpoints, slug change logic
- `operator-dashboard.html` (NEW) - Full operator dashboard with super admin controls
- `template.html` (55KB) - Reviews section added
- `super-admin-dashboard.html` (NEW) - Standalone admin interface

**Configuration:**
- `VERSION.md` - Updated with v2.0.0 documentation

### Deployment Information
```bash
# Deploy worker
npx wrangler deploy

# Upload operator dashboard
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" \
  --path="operator-dashboard.html"

# Upload super admin dashboard
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:super-admin-dashboard" \
  --path="super-admin-dashboard.html"
```

### Security

**Authentication:**
- All super admin endpoints require `X-Admin-Token` header
- Token: `webzyl-admin-dev-2026` (defined in wrangler.toml)
- Change token for production deployment

**Validation:**
- Slug format: `/^[a-z0-9-]+$/`
- Duplicate slug checks before rename
- Plan tier enum validation
- Status enum validation

### Restoration Instructions
```bash
# Restore from git tag
git checkout v2.0.0

# Deploy
npx wrangler deploy

# Upload dashboards
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" \
  --path="operator-dashboard.html"
```

### What's Next
- [ ] Role-based access control (separate owner/employee dashboards)
- [ ] Audit log for super admin changes
- [ ] Bulk property operations
- [ ] Advanced analytics dashboard
- [ ] Email notification system

---

## v1.0.0 - Production Release (January 10, 2026)

**Git Commit:** `aad35eb`
**Worker Deployment:** `888c83ae-542c-461c-b96e-6dd685963ead`
**Status:** ✅ Production Ready

### Major Features

#### 1. Complete URL Consolidation
All Webzyl services consolidated under single domain architecture:

| Service | URL | Status |
|---------|-----|--------|
| Homepage | https://webzyl.com | ✅ Live |
| Admin Dashboard | https://webzyl.com/admin | ✅ Live |
| Operator Dashboard | https://webzyl.com/operator?slug={property} | ✅ Live |
| Property Sites | https://{slug}.webzyl.com | ✅ Live |

**Benefits:**
- Single source of truth
- Simplified deployment
- Consistent user experience
- Removed Pages.dev dependencies

#### 2. Next-Generation Amenity Visual Cards
Revolutionary amenity display system for rooms without images:

**Adaptive Sizing:**
- **1-4 amenities:** Large cards (2rem icons, 100px width)
- **5-8 amenities:** Medium cards (1.6rem icons, 85px width)
- **9-12 amenities:** Small cards (1.4rem icons, 75px width)
- **13+ amenities:** Compact cards (1.2rem icons, 65px width) + scrollable

**Visual Features:**
- Dark badge with multi-color glow effect ("✨ ROOM FEATURES ✨")
- Custom gradient scrollbar (primary → secondary colors)
- Glassmorphism effects with blur circles
- Alternating gradient backgrounds per amenity
- Auto-scrollable grid (280px max height for 12+ items)
- Scroll indicator: "↕️ Scroll to see all X amenities"

**Supported Amenities:** 21 icons
- AC ❄️, Heater 🔥, WiFi 📶, TV 📺
- Single/Double/King/Twin Beds 🛏️
- Attached/Private Bathroom 🚿
- Mini Fridge 🧊, Coffee Maker ☕
- And more...

**Implementation:**
- Location: `worker.js:4450-4630`
- Icon mapping: `worker.js:4433-4439`
- No more "Plus X more" limitations - all amenities visible

#### 3. Dashboard Consolidation
Unified dashboard architecture:

**CEO Admin Dashboard** (`/admin`)
- Multi-property overview
- Analytics and metrics
- Global configuration
- File: `_backups/20260110_working_state/ceo-admin-dashboard.html`

**Operator Dashboard** (`/operator`)
- Property-specific management
- Room configuration
- Amenity selection (checkboxes)
- Image upload functionality
- Booking management
- File: `_backups/20260110_working_state/operator-dashboard.html`

### Technical Implementation

#### Worker Routes (worker.js)
```javascript
// Lines 458-472: Main routing
if (hostname === 'webzyl.com') {
  if (path === '/admin') return handleCEOAdminDashboard(request, env);
  if (path === '/operator') return handleOperatorDashboard(request, env);
  return handleBrandHomepage(request, env, ctx);
}

// Lines 1414-1441: Admin handler
async function handleCEOAdminDashboard(request, env) { ... }

// Lines 1443-1470: Operator handler
async function handleOperatorDashboard(request, env) { ... }

// Lines 4450-4630: Amenity card generator
// - Adaptive sizing logic
// - Scrollable container
// - Custom scrollbar styles
```

#### Template (template.html)
- Responsive design with mobile menu
- Hero section: `min-height: 100vh`
- Navigation: About, Rooms, Amenities, Gallery, Videos, Contact, Booking
- Sections visible immediately (no fade-in delay)
- Size: 55KB

#### Configuration
- **KV Storage:**
  - `config:{slug}` - Property configurations
  - `template:smart-nav` - Main template
  - `page:ceo-admin-dashboard` - Admin page
  - `page:operator-dashboard` - Operator page
  - `page:homepage` - Brand homepage
- **CORS:** Configured for API access

### Files Changed
**Core Files:**
- `worker.js` (212KB) - Main application logic
- `template.html` (55KB) - HTML template
- `wrangler.toml` (3.1KB) - Cloudflare configuration
- `package.json` - Dependencies

**Dashboards:**
- `webzyl-admin-dist/index.html` - Admin dashboard
- `admin-dashboard/index.html` - Alternative admin
- `webzyl-homepage/index.html` - Brand homepage

**Configuration:**
- `config-grand-royal.json` - Grand Royal property
- `cors.json` - CORS settings
- `design-profiles/` - Design tokens

**Documentation:**
- `.github/copilot-instructions.md` - AI agent guide
- `AI_AGENT_QUICK_START.md` - Quick reference
- `NEXT_GEN_AMENITY_CARDS.md` - Amenity cards documentation
- `WEBZYL_URL_CONSOLIDATION.md` - URL architecture
- `OPERATOR_DASHBOARD_CONSOLIDATION.md` - Dashboard docs
- 20+ other .md files

**Backup:**
- `_backups/20260110_working_state/` - Complete backup with restoration instructions

### Git Statistics
- **Commit:** `aad35eb`
- **Files Added:** 58
- **Lines Added:** 40,305
- **Tag:** `v1.0.0`

### Deployment Information
```
Worker Version: 888c83ae-542c-461c-b96e-6dd685963ead
Deployed: January 10, 2026, 03:43 IST
Status: Production
Environment: Cloudflare Workers
```

### Bindings
- **KV:** RESORT_CONFIGS, EVENTS_KV
- **D1:** MEDIA_DB
- **R2:** MEDIA_R2
- **Vars:** BOOKING_WEBHOOK_URL, ADMIN_TOKEN, etc.

### Known Issues
None currently reported.

### Restoration Instructions
```bash
# Restore from backup
cp _backups/20260110_working_state/worker.js ./
cp _backups/20260110_working_state/template.html ./
cp _backups/20260110_working_state/wrangler.toml ./

# Upload template
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:smart-nav" --path="template.html"

# Deploy
npx wrangler deploy

# Or checkout from git
git checkout v1.0.0
```

### What's Next
Future enhancements to consider:
- [ ] Address spacing between header and content (requires careful approach)
- [ ] Additional amenity icons
- [ ] Mobile performance optimizations
- [ ] Enhanced analytics dashboard
- [ ] Multi-language support

---

**Developed with:** Claude Sonnet 4.5
**Co-Authored-By:** Claude Sonnet 4.5 <noreply@anthropic.com>
