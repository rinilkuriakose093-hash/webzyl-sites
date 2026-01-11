# 🤖 VS CODE AI-ASSISTED INTEGRATION

Each stage has:
1. **Files to open** in VS Code
2. **Exact AI prompt** to paste
3. **What to verify** after changes

---

## 📍 STAGE 1: Add 'img' to Reserved Subdomains

### Files to Open:
- `worker.js`

### Position Cursor:
Line 32 (inside the RESERVED_SUBDOMAINS array)

### AI Prompt for VS Code:
```
Add 'img' to the RESERVED_SUBDOMAINS array after 'dev'
```

### Expected Result:
```javascript
const RESERVED_SUBDOMAINS = [
  'www', 'api', 'admin', 'operator', 'dashboard',
  'app', 'cdn', 'assets', 'static', 'staging', 'dev', 'img'
];
```

### Verify:
- [ ] 'img' added at the end of array
- [ ] No syntax errors
- [ ] Comma after 'dev'

---

## 📍 STAGE 2: Add Media Storage Constants

### Files to Open:
- `worker.js`

### Position Cursor:
After line 130 (after the CATEGORY_PRICES constant)

### AI Prompt for VS Code:
```
After the CATEGORY_PRICES constant, add these new constants for media storage:

1. ALLOWED_WIDTHS - array with [320, 640, 1024, 1600]
2. MAX_SIZES - object with logo: 5MB, gallery: 50MB, product: 20MB (in bytes)
3. ALLOWED_CONTENT_TYPES - array with ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
4. QUOTA_LIMITS - object with nested plan tiers (trial, basic, premium, professional, enterprise) each having logo, gallery, product limits:
   - trial: logo 1, gallery 5, product 0
   - basic: logo 1, gallery 10, product 5
   - premium: logo 1, gallery 25, product 15
   - professional: logo 3, gallery 50, product 40
   - enterprise: logo 5, gallery 100, product 80

Add proper section comment: "MEDIA STORAGE CONSTANTS (NEW in v7.3)"
```

### Expected Result:
```javascript
// =====================================================
// MEDIA STORAGE CONSTANTS (NEW in v7.3)
// =====================================================

const ALLOWED_WIDTHS = [320, 640, 1024, 1600];

const MAX_SIZES = {
  logo: 5 * 1024 * 1024,
  gallery: 50 * 1024 * 1024,
  product: 20 * 1024 * 1024
};

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const QUOTA_LIMITS = {
  trial: { logo: 1, gallery: 5, product: 0 },
  basic: { logo: 1, gallery: 10, product: 5 },
  premium: { logo: 1, gallery: 25, product: 15 },
  professional: { logo: 3, gallery: 50, product: 40 },
  enterprise: { logo: 5, gallery: 100, product: 80 }
};
```

### Verify:
- [ ] All 4 constants added
- [ ] Proper comment section
- [ ] No syntax errors

---

## 📍 STAGE 3: Add Image Serving Route (Highest Priority)

### Files to Open:
- `worker.js`

### Position Cursor:
Line 140 (BEFORE the "DATA ENDPOINT" comment, inside the fetch function)

### AI Prompt for VS Code:
```
Before the "DATA ENDPOINT" section in the fetch function, add this route check:

Add a section for "IMAGE SERVING (Check FIRST - highest priority)" with proper comment formatting.
If path starts with '/img/', return handleMediaServe(request, env)

This must be checked BEFORE other routes because image serving needs highest priority.
```

### Expected Result:
```javascript
    // =====================================================
    // IMAGE SERVING (Check FIRST - highest priority)
    // =====================================================
    
    if (path.startsWith('/img/')) {
      return handleMediaServe(request, env);
    }
```

### Verify:
- [ ] Added BEFORE data endpoint check
- [ ] Proper comment formatting
- [ ] Returns handleMediaServe function call

---

## 📍 STAGE 4: Add Media Upload Routes

### Files to Open:
- `worker.js`

### Position Cursor:
After line 226 (after the booking API route, before CEO dashboard APIs)

### AI Prompt for VS Code:
```
After the booking API route (line with handleBookingRequest), add a new section for "MEDIA UPLOAD ROUTES (NEW in v7.3)".

Add these 4 routes:
1. POST /api/media/sign-upload → handleMediaSignUpload(request, env)
2. POST /api/media/confirm-upload → handleMediaConfirmUpload(request, env)
3. DELETE /api/media/assets/:id → handleMediaDelete(request, env)
4. GET /api/media/assets → handleMediaList(request, env)

Use the same formatting style as existing routes with proper if/else if structure.
```

### Expected Result:
```javascript
    // =====================================================
    // MEDIA UPLOAD ROUTES (NEW in v7.3)
    // =====================================================
    
    if (path === '/api/media/sign-upload' && request.method === 'POST') {
      return handleMediaSignUpload(request, env);
    }
    
    if (path === '/api/media/confirm-upload' && request.method === 'POST') {
      return handleMediaConfirmUpload(request, env);
    }
    
    if (path.startsWith('/api/media/assets/') && request.method === 'DELETE') {
      return handleMediaDelete(request, env);
    }
    
    if (path === '/api/media/assets' && request.method === 'GET') {
      return handleMediaList(request, env);
    }
```

### Verify:
- [ ] All 4 routes added
- [ ] After booking API
- [ ] Before CEO dashboard
- [ ] No syntax errors

---

## 📍 STAGE 5: Add Cron Handler for Scheduled Tasks

### Files to Open:
- `worker.js`

### Position Cursor:
Line 323 (after the closing brace of fetch function, before the final closing brace of export default)

### AI Prompt for VS Code:
```
After the fetch() function closes, add a scheduled() function for cron triggers.

The structure should be:
- async scheduled(event, env, ctx)
- Inside try/catch
- If event.cron === '0 2 * * *' call cleanupDeletedAssets(env)
- If event.cron === '0 3 1 * *' call auditOrphanedAssets(env)
- Log any errors to console

Add proper comment: "CRON TRIGGERS (NEW - for media cleanup)"

Important: This goes AFTER the fetch function closes but BEFORE the final closing brace of "export default"
```

### Expected Result:
```javascript
  },  // ← This closes fetch function
  
  // =====================================================
  // CRON TRIGGERS (NEW - for media cleanup)
  // =====================================================
  
  async scheduled(event, env, ctx) {
    try {
      if (event.cron === '0 2 * * *') {
        await cleanupDeletedAssets(env);
      }
      if (event.cron === '0 3 1 * *') {
        await auditOrphanedAssets(env);
      }
    } catch (error) {
      console.error('[CRON] Error:', error);
    }
  }
};  // ← This closes export default
```

### Verify:
- [ ] After fetch() closing brace
- [ ] Before export default closing brace
- [ ] Proper async/await syntax
- [ ] Error handling included

---

## 📍 STAGE 6: Add All Media Handler Functions

### Files to Open:
- `worker.js`
- `MEDIA_HANDLERS.txt` (provided below)

### Position Cursor:
Line 1636 (at the very end of the file, after all existing functions)

### AI Prompt for VS Code:
```
At the END of worker.js (after all existing handler functions), add the complete media storage implementation.

Add these functions in order:
1. handleMediaSignUpload(request, env) - validates upload request, checks quotas, generates pre-signed URL
2. handleMediaConfirmUpload(request, env) - verifies upload, marks asset ready, updates quota
3. handleMediaServe(request, env) - serves images via CDN with optimization
4. handleMediaDelete(request, env) - soft deletes assets
5. handleMediaList(request, env) - lists tenant's assets

Plus utility functions:
- generateRandomId(length)
- clampToAllowedWidth(width)
- generatePresignedPutUrl(...) - generates S3-compatible pre-signed URLs
- cleanupDeletedAssets(env) - cron function
- auditOrphanedAssets(env) - cron function

Use the provided MEDIA_HANDLERS.txt file as reference.

Add proper section comment: "MEDIA STORAGE HANDLERS (NEW in v7.3)"
```

### Files to Provide:
I'll create `MEDIA_HANDLERS.txt` with the complete code in the next step.

### Verify:
- [ ] All 5 main handlers added
- [ ] All 5 utility functions added
- [ ] No syntax errors
- [ ] Proper async/await usage
- [ ] Error handling included

---

## 📍 STAGE 7: Update wrangler.toml

### Files to Open:
- `wrangler.toml` (your existing one)
- `wrangler-new.toml` (provided)

### AI Prompt for VS Code:
```
Update wrangler.toml to add media storage bindings:

1. Add R2 bucket binding:
   - binding: "MEDIA_R2"
   - bucket_name: "webzyl-media"

2. Add D1 database binding:
   - binding: "MEDIA_DB"
   - database_name: "webzyl-media"
   - database_id: "PASTE_YOUR_D1_ID_HERE" (placeholder)

3. Add environment variables in [vars] section:
   - R2_ACCOUNT_ID = "7b3b529f5441edf25f03e227349ca21a"
   - R2_ACCESS_KEY_ID = "PASTE_YOUR_ACCESS_KEY_HERE"
   - R2_SECRET_ACCESS_KEY = "PASTE_YOUR_SECRET_KEY_HERE"
   - DASHBOARD_ORIGIN = "https://operator.webzyl.com"

4. Add cron triggers:
   [triggers]
   crons = ["0 2 * * *", "0 3 1 * *"]

Keep all existing bindings and variables unchanged.
```

### Expected Result:
Updated wrangler.toml with new sections added (see provided file)

### Verify:
- [ ] R2 binding added
- [ ] D1 binding added
- [ ] Env vars added
- [ ] Cron triggers added
- [ ] Existing KV binding preserved

---

## 📍 STAGE 8: Create Migration File

### Files to Create:
- `migrations/001_create_assets.sql`

### AI Prompt for VS Code:
```
Create a new file: migrations/001_create_assets.sql

This SQL migration creates the assets table for media storage with:

Columns:
- id (TEXT PRIMARY KEY)
- tenantId (TEXT NOT NULL)
- mediaType (TEXT NOT NULL)
- objectPath (TEXT NOT NULL)
- filename (TEXT NOT NULL)
- size (INTEGER NOT NULL)
- width (INTEGER)
- height (INTEGER)
- contentType (TEXT NOT NULL)
- contentHash (TEXT)
- status (TEXT DEFAULT 'pending')
- createdAt (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
- updatedAt (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
- deletedAt (TIMESTAMP)

Indexes:
- idx_assets_tenant on (tenantId)
- idx_assets_status on (status)
- idx_assets_deleted on (deletedAt) WHERE deletedAt IS NOT NULL
- idx_assets_tenant_type on (tenantId, mediaType)
- idx_assets_tenant_status on (tenantId, status)
- idx_assets_cleanup on (deletedAt, status) WHERE deletedAt IS NOT NULL

Use the provided SQL file as reference.
```

### Verify:
- [ ] File created in migrations folder
- [ ] Table structure correct
- [ ] All indexes created
- [ ] IF NOT EXISTS clauses used

---

## 📍 STAGE 9: Update package.json

### Files to Open:
- `package.json` (create if doesn't exist)

### AI Prompt for VS Code:
```
Create or update package.json to include AWS SDK dependencies for R2 pre-signed URLs.

Add these dependencies:
- @aws-sdk/client-s3: ^3.478.0
- @aws-sdk/s3-request-presigner: ^3.478.0

Also add devDependencies:
- @cloudflare/workers-types: ^4.20241127.0
- wrangler: ^3.78.0

Include basic package metadata:
- name: "webzyl-worker"
- version: "7.3.0"
- description: "Webzyl Worker with Media Storage"

Add scripts:
- "dev": "wrangler dev"
- "deploy": "wrangler deploy"
```

### Verify:
- [ ] Dependencies added
- [ ] DevDependencies added
- [ ] Scripts included
- [ ] Valid JSON syntax

---

## ✅ FINAL VERIFICATION CHECKLIST

After all stages complete:

```
Run in VS Code terminal:

1. Check syntax:
   wrangler dev --dry-run

2. Check for errors:
   Look for red squiggly lines in worker.js

3. Verify structure:
   - [ ] 'img' in RESERVED_SUBDOMAINS
   - [ ] 4 new constants after CATEGORY_PRICES
   - [ ] Image route before data endpoint
   - [ ] 4 media routes after booking
   - [ ] Scheduled function after fetch
   - [ ] All handler functions at end
   - [ ] wrangler.toml updated
   - [ ] migrations folder exists
   - [ ] package.json updated
```

---

## 🚀 READY TO USE

Each stage is independent. Complete them in order, verify, then move to next.

**VS Code will do the heavy lifting!**
