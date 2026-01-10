<!-- .github/copilot-instructions.md - Guidance for AI coding agents -->
# AI Coding Agent Instructions for webzyl-worker

## Project Overview
- **Purpose:** This is a universal Cloudflare Worker for property management (hotels, homestays, restaurants, shops, services, etc.) with dynamic routing, booking, and admin features.
- **Core file:** `worker.js` (router, API handler, config loader, booking integrator)
- **Config/data:** All property/site config is stored in KV (see `config-*.json`, `mountview.json`, and related files).
- **Design profiles:** Immutable, versioned JSONs in `design-profiles/` and `design-profiles/variants/` (see `DESIGN_PROFILE_GOVERNANCE_v1.md`).

## Architecture & Data Flow
- **Worker = Router:** Handles all HTTP(S) requests, routes by subdomain, and delegates to appropriate handler (booking, admin, static, etc.).
- **KV = Source of Truth:** All runtime config, booking workspace registry, and quotas are in KV. Never hardcode property data in code.
- **Single Domain Architecture:** All Webzyl pages are consolidated under `webzyl.com` domain (homepage, admin, operator). No external Pages deployments.
- **Loose Coupling:** Each major feature (booking, gallery, admin, metrics) is modular and governed by its own rules doc.

## URL Structure (IMPORTANT)
All Webzyl pages are under the main domain:
- **Homepage:** `https://webzyl.com` (KV key: `template:brand-homepage`)
- **Admin Dashboard (CEO):** `https://webzyl.com/admin` (KV key: `page:ceo-admin-dashboard`)
- **Operator Dashboard:** `https://webzyl.com/operator` (KV key: `page:operator-dashboard`)
- **Property Sites:** `https://{slug}.webzyl.com` (e.g., `https://grand-royal.webzyl.com`)

**User Flow:**
1. User visits homepage → clicks "Start Building" → goes to `/admin`
2. In admin dashboard → creates property → property goes live at `{slug}.webzyl.com`
3. In admin dashboard → clicks "Dashboard" button → goes to `/operator?slug={slug}` to manage property

## Key Conventions & Patterns
- **Never mutate published design profiles.** Always create a new version for changes (see `DESIGN_PROFILE_GOVERNANCE_v1.md`).
- **Config keys:** Use `config:<slug>` for property config, `booking:workspaces` for booking registry, etc.
- **Variants:** Cosmetic-only, inherit from base profile, never change semantics/layout (see `DESIGN_PROFILE_VARIANTS`).
- **Event schema:** Strict privacy rules—never log PII, IP, or user agent (see `METRICS_GOVERNANCE_v1.md`).
- **Subdomain routing:** Reserved subdomains (`www`, `admin`, etc.) are handled specially.

## Developer Workflows
- **No build step:** Edit JS/JSON directly. No npm, no bundler, no test runner by default.
- **Manual testing:** Use PowerShell scripts (`tmp_debug_booking.ps1`, etc.) or VS Code tasks for booking and API endpoint tests.
- **API Test Tracking:** When developing new features, add API endpoints and test cases to `Api_Testcases/API_Test_Cases.csv` to track regression testing. Include endpoint, method, expected status, and test results.
- **Debugging:** Use the provided debug scripts and check logs via Cloudflare dashboard.
- **Deployment:**
  - Quick deploy all pages: `.\tools\deploy-all-pages.ps1`
  - Manual: Upload to KV, then `npx wrangler deploy`
  - All secrets/config must be set in KV or environment.

## Integration Points
- **Booking API:** Integrates with Google Apps Script and Cloudflare KV for booking storage and forwarding.
- **Gallery upload:** Uses Cloudflare R2 and D1 (see `handleGalleryUpload()` in `worker.js`).
- **Metrics:** Event schema is privacy-first and SSR-aware (see `METRICS_GOVERNANCE_v1.md`).

## Examples & References
- **Booking workflow:** See `handleBookingRequest` import and usage in `worker.js`.
- **Gallery upload:** See `handleGalleryUpload()` in `worker.js` and related docs.
- **Config patterns:** Reference `config-grand-royal.json`, `mountview.json`, and `BOOKING_WORKSPACE_REGISTRY_KEY` usage.
- **Governance:** All major features have a `*_GOVERNANCE_v1.md` file with rules and rationale.

## What NOT to do
- Do not add build tools, test runners, or package managers unless explicitly requested.
- Do not log or process PII, IP addresses, or user agents.
- Do not mutate published design profiles—always version.

---

---

# Additional Information for AI Agents

## 1. Project Overview & Structure

- **Main Purpose:** Universal Cloudflare Worker for property management (hotels, homestays, restaurants, shops, services, etc.) with dynamic routing, booking, admin, gallery, and metrics features.
- **Core File:**  
	- `worker.js` — The router and main logic hub. Handles all HTTP(S) requests, routes by subdomain, and delegates to handlers (booking, admin, static, etc.).
- **Config/Data Files:**  
	- All property/site config is stored in Cloudflare KV. Local config files include `config-*.json`, `mountview.json`, and related files.
- **Design Profiles:**  
	- Immutable, versioned JSONs in `design-profiles/` and `design-profiles/variants/`. See `DESIGN_PROFILE_GOVERNANCE_v1.md` for rules.

## 2. Major Components & Logic Locations

- **Routing Logic:**
	- In `worker.js`. Routes requests by subdomain and path, delegates to booking, admin, gallery, or static handlers.
	- Main domain routes (worker.js:458-472):
	  - `/admin` → `handleCEOAdminDashboard()` (worker.js:1414)
	  - `/operator` → `handleOperatorDashboard()` (worker.js:1443)
	  - `/` → `handleBrandHomepage()` (worker.js:1381)
- **Booking Logic:**
	- `handleBookingRequest` (imported in `worker.js` from `Booking_Enquiry/files/booking-api.js`). Integrates with Google Apps Script and Cloudflare KV.
- **Gallery Upload:**
	- `handleGalleryUpload()` in `worker.js`. Uses Cloudflare R2 and D1 for file storage and metadata.
- **Config Loading:**
	- Functions like `getPropertyConfigSafe`, `getSmartNavTemplate` in `worker.js` load config from KV.
- **Metrics/Event Schema:**
	- Defined in `worker.js` and governed by `METRICS_GOVERNANCE_v1.md`. Strict privacy rules—never log PII, IP, or user agent.
- **Dashboard Pages:**
	- All pages served from KV with `Cache-Control: no-cache` for latest content
	- Homepage: `webzyl-homepage/index.html` → KV key `template:brand-homepage`
	- Admin: `webzyl-admin-dist/index.html` → KV key `page:ceo-admin-dashboard`
	- Operator: `_external/webzyl-operator/operator-dashboard.html` → KV key `page:operator-dashboard`

## 3. Editing Rules & Checks

- **Design Profiles:**  
	- Never mutate published profiles. Always create a new version for changes. See `DESIGN_PROFILE_GOVERNANCE_v1.md`.
- **Config Keys:**  
	- Use `config:<slug>` for property config, `booking:workspaces` for booking registry, etc.
- **Variants:**  
	- Cosmetic-only, inherit from base profile, never change semantics/layout. See `DESIGN_PROFILE_VARIANTS`.
- **Event Schema:**  
	- Never log or process PII, IP addresses, or user agents.
- **Subdomain Routing:**  
	- Reserved subdomains (`www`, `admin`, etc.) are handled specially in routing logic.

## 4. Developer Workflows

- **No Build Step:**
	- Edit JS/JSON directly. No npm, no bundler, no test runner by default.
- **Manual Testing:**
	- Use PowerShell scripts (`tmp_debug_booking.ps1`, etc.) or VS Code tasks for booking and API endpoint tests.
- **API Test Tracking:**
	- When developing new features, add API endpoints and test cases to `Api_Testcases/API_Test_Cases.csv`.
	- Track: endpoint URL, method, description, request/response samples, expected status codes.
	- Update test results after each major feature to ensure existing functionality doesn't break.
	- This helps maintain regression test coverage as the system grows.
- **Debugging:**
	- Use debug scripts and check logs via Cloudflare dashboard.
- **Deployment:**
	- Use wrangler CLI or Cloudflare dashboard. All secrets/config must be set in KV or environment.

## 5. Integration Points

- **Booking API:**  
	- Integrates with Google Apps Script and Cloudflare KV for booking storage and forwarding.
- **Gallery Upload:**  
	- Uses Cloudflare R2 and D1 (see `handleGalleryUpload()` in `worker.js`).
- **Metrics:**  
	- Event schema is privacy-first and SSR-aware (see `METRICS_GOVERNANCE_v1.md`).

## 6. How to Edit and Debug

- **Find Logic:**  
	- Use semantic search or grep to locate functions, config keys, or handlers in `worker.js` and related files.
- **Edit Safely:**  
	- For config or design profile changes, always version and never overwrite published data.
- **Test Changes:**  
	- Use provided PowerShell scripts or VS Code tasks to simulate booking, gallery upload, or API calls.
- **Debug Issues:**  
	- Check logs, use debug scripts, and refer to governance docs for rules and expected behaviors.
- **Fixes:**  
	- Make targeted edits in the relevant handler or config file, validate with manual tests, and ensure compliance with governance docs.

## 7. Example: Editing Smart Nav Template

- **Location:**  
	- Template is stored in KV as `template:smart-nav`. Local file: `kv-template-smart-nav.html`.
- **Edit Process:**  
	- Update the local template file, then upload to KV using wrangler or dashboard.
- **Logic Tie-In:**  
	- `getSmartNavTemplate()` in `worker.js` loads this template for rendering.

## 8. Key Files & References

- `worker.js` — Main router and logic
- `config-*.json`, `mountview.json` — Property/site config
- `design-profiles/`, `design-profiles/variants/` — Design profiles
- `METRICS_GOVERNANCE_v1.md`, `DESIGN_PROFILE_GOVERNANCE_v1.md` — Governance rules
- `tmp_debug_booking.ps1`, `tmp_call_appsscript_debug.ps1` — Debug scripts
- `kv-template-smart-nav.html` — Smart nav template

### Dashboard & Page Files
- `webzyl-homepage/index.html` — Main homepage (webzyl.com)
- `webzyl-admin-dist/index.html` — CEO admin dashboard (webzyl.com/admin)
- `_external/webzyl-operator/operator-dashboard.html` — Operator dashboard (webzyl.com/operator)

### Deployment & Documentation
- `tools/deploy-all-pages.ps1` — Deploy all pages with one command
- `WEBZYL_URL_CONSOLIDATION.md` — URL structure and consolidation guide
- `SINGLE_SOURCE_DEPLOYMENT.md` — Deployment architecture
- `Api_Testcases/API_Test_Cases.csv` — API test case tracking

---

**If anything is unclear, check the relevant `*_GOVERNANCE_v1.md` or ask for clarification. Always follow versioning and privacy rules.**
