/**
 * WEBZYL WORKER v6.3.3 - REFINED ARCHITECTURE + DATA ENDPOINTS
 * 
 * NEW in v6.3.3:
 * - Fixed route order: Data endpoints checked BEFORE subdomain routing
 * 
 * NEW in v6.3.2:
 * - Data endpoint: /data/:slug.json for Pages JavaScript
 * 
 * Architectural Principles:
 * 1. Worker is a ROUTER, not an HTML processor
 * 2. KV is the authoritative source of truth
 * 3. Pages is the rendering service
 * 4. Keep coupling loose, complexity low
 * 
 * Routes:
 * - *.webzyl.com (custom subdomains) → NEW
 * - /api/admin/publish
 * - /api/config/:slug
 * - /api/booking
 * - /api/operator/*
 */

import { handleBookingRequest, handleOptions } from './Booking_Enquiry/files/booking-api.js';

// Reserved subdomains that customers cannot use
const RESERVED_SUBDOMAINS = [
  'www', 'api', 'admin', 'operator', 'dashboard',
  'app', 'cdn', 'assets', 'static', 'staging', 'dev'
];

// Slug validation pattern
const VALID_SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;
    
    // =====================================================
    // AUTOMATIC SUBDOMAIN ROUTING (Core Feature)
    // =====================================================
    
    // CRITICAL: Check for /data/*.json FIRST before subdomain routing
    // Otherwise subdomain routing will catch it and forward to Pages
    if (path.startsWith('/data/') && path.endsWith('.json')) {
      const slug = path.split('/')[2].replace('.json', '');
      console.log(`[DATA] Request for: ${slug}`);
      return handleDataRequest(slug, env);
    }
    
    const propertySlug = extractPropertySlug(hostname);
    
    if (propertySlug) {
      console.log(`[SUBDOMAIN] Detected property: ${propertySlug}`);
      return await handlePropertyRequest(propertySlug, path, request, env);
    }
    
    // =====================================================
    // CORS Preflight
    // =====================================================
    
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    // =====================================================
    // OPERATOR DASHBOARD APIs
    // =====================================================
    
    if (path === '/api/operator/login' && request.method === 'GET') {
      return handleOperatorLogin(request, env);
    }
    
    if (path.startsWith('/api/operator/dashboard/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorDashboard(operatorSlug, env);
    }
    
    if (path.startsWith('/api/operator/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[4];
      return handleOperatorUpdate(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/bookings/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorBookings(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/gallery/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpload(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/gallery/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpdate(request, env, operatorSlug);
    }
    
    // =====================================================
    // EXISTING APIs (v6.2.2 compatibility)
    // =====================================================
    
    if (path === '/api/admin/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }
    
    if (path.startsWith('/api/config/')) {
      const configSlug = path.split('/').pop();
      return handleGetConfig(configSlug, env);
    }
    
    if (path === '/api/booking') {
      return handleBookingRequest(request, env, ctx);
    }
    
    if (path.startsWith('/s/')) {
      const ssrSlug = path.split('/')[2];
      return handleWebsiteSSR(ssrSlug, env);
    }
    
    // Root status
    if (path === '/') {
      return jsonResponse({
        status: 'ok',
        service: 'webzyl-worker',
        version: '6.3.3',
        architecture: 'worker_as_router',
        features: {
          automatic_subdomains: 'slug.webzyl.com',
          data_endpoints: '/data/:slug.json',
          operator_dashboard: '/api/operator/*',
          kv_authority: 'config:{slug} is source of truth'
        }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// ============================================================================
// SUBDOMAIN ROUTING - Core Logic
// ============================================================================

/**
 * Extract property slug from hostname
 * Returns null if not a property subdomain
 */
function extractPropertySlug(hostname) {
  // Only process *.webzyl.com subdomains
  if (!hostname.endsWith('.webzyl.com')) {
    return null;
  }
  
  // Exclude root domain
  if (hostname === 'webzyl.com' || hostname === 'www.webzyl.com') {
    return null;
  }
  
  // Exclude reserved subdomains
  const subdomain = hostname.split('.')[0];
  if (RESERVED_SUBDOMAINS.includes(subdomain)) {
    return null;
  }
  
  // Validate slug format
  if (!VALID_SLUG_PATTERN.test(subdomain)) {
    return null;
  }
  
  return subdomain;
}

/**
 * Handle property website requests
 * This is the ROUTER - it validates and forwards, does NOT process HTML
 */
async function handlePropertyRequest(slug, path, request, env) {
  try {
    // =====================================================
    // AUTHORITATIVE CHECK
    // KV is the single source of truth
    // A property exists IFF this returns valid config
    // =====================================================
    
    const configKey = `config:${slug}`;
    const configRaw = await env.RESORT_CONFIGS.get(configKey);
    
    if (!configRaw) {
      console.log(`[PROPERTY] Not found: ${slug}`);
      return propertyNotFoundResponse(slug);
    }
    
    // Parse config to check status
    let config;
    try {
      config = JSON.parse(configRaw);
    } catch (error) {
      console.error(`[PROPERTY] Invalid JSON for ${slug}:`, error);
      return new Response('Internal Server Error', { status: 500 });
    }
    
    // =====================================================
    // SOFT-DELETE PATTERN
    // Better SEO and support workflows
    // =====================================================
    
    if (config.deleted === true) {
      console.log(`[PROPERTY] Deleted: ${slug}`);
      return propertyDeletedResponse(slug);
    }
    
    // Check active status
    if (config.status !== 'active') {
      console.log(`[PROPERTY] Inactive: ${slug} (status: ${config.status})`);
      return propertyInactiveResponse(slug, config.status);
    }
    
    // =====================================================
    // MAINTENANCE MODE
    // =====================================================
    
    if (config.maintenance === true) {
      console.log(`[PROPERTY] Maintenance: ${slug}`);
      return propertyMaintenanceResponse(slug);
    }
    
    // =====================================================
    // FORWARD TO PAGES (Router Pattern)
    // Worker does NOT process HTML
    // Worker does NOT parse response
    // Worker simply forwards validated requests
    // =====================================================
    
    console.log(`[PROPERTY] Routing to Pages: ${slug}${path}`);
    
    return await forwardToPages(slug, path, request, env);
    
  } catch (error) {
    console.error(`[PROPERTY] Error handling ${slug}:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Forward request to Pages rendering service
 * IMPORTANT: This is a transparent proxy, NOT an HTML processor
 */
async function forwardToPages(slug, path, originalRequest, env) {
  try {
    // Construct Pages URL
    // Note: This couples to Pages structure - document this clearly
    const pagesBaseUrl = 'https://webzyl-sites.pages.dev';
    const pagesUrl = `${pagesBaseUrl}/${slug}${path || ''}`;
    
    console.log(`[FORWARD] ${pagesUrl}`);
    
    // Create new request preserving original headers
    const pagesRequest = new Request(pagesUrl, {
      method: originalRequest.method,
      headers: originalRequest.headers,
      body: originalRequest.body,
      redirect: 'follow'
    });
    
    // Fetch from Pages
    const pagesResponse = await fetch(pagesRequest);
    
    // =====================================================
    // ROUTER PATTERN: Forward response as-is
    // Do NOT parse HTML
    // Do NOT modify body
    // Do preserve caching headers
    // =====================================================
    
    // Clone response to modify only headers
    const response = new Response(pagesResponse.body, {
      status: pagesResponse.status,
      statusText: pagesResponse.statusText,
      headers: new Headers(pagesResponse.headers)
    });
    
    // Add tracking headers (metadata only)
    response.headers.set('X-Webzyl-Property', slug);
    response.headers.set('X-Webzyl-Served-By', 'worker-router');
    
    // Preserve or enhance caching
    if (!response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', 'public, max-age=300');
    }
    
    console.log(`[FORWARD] Success: ${pagesResponse.status}`);
    
    return response;
    
  } catch (error) {
    console.error(`[FORWARD] Error:`, error);
    return new Response('Error loading property website', { status: 502 });
  }
}

// ============================================================================
// ERROR RESPONSES (Branded, user-friendly)
// ============================================================================

function propertyNotFoundResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Not Found</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #ef4444; }
      </style>
    </head>
    <body>
      <h1>Property Not Found</h1>
      <p>The property "<strong>${slug}</strong>" does not exist on Webzyl.</p>
      <p><a href="https://webzyl.com">Return to Homepage</a></p>
    </body>
    </html>
  `, {
    status: 404,
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyDeletedResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Removed</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #8b5cf6; }
      </style>
    </head>
    <body>
      <h1>Property Removed</h1>
      <p>This property is no longer available.</p>
      <p>If you believe this is an error, please contact support.</p>
    </body>
    </html>
  `, {
    status: 410, // 410 Gone (better for SEO than 404)
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyInactiveResponse(slug, status) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Inactive</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #f59e0b; }
      </style>
    </head>
    <body>
      <h1>Property Temporarily Unavailable</h1>
      <p>This property is currently inactive (status: ${status}).</p>
      <p>Please contact the property owner for more information.</p>
    </body>
    </html>
  `, {
    status: 403,
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyMaintenanceResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Under Maintenance</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #06b6d4; }
      </style>
    </head>
    <body>
      <h1>🔧 Under Maintenance</h1>
      <p>This property is temporarily undergoing maintenance.</p>
      <p>Please check back shortly!</p>
    </body>
    </html>
  `, {
    status: 503,
    headers: { 
      'Content-Type': 'text/html',
      'Retry-After': '3600' // Suggest retry after 1 hour
    }
  });
}

// ============================================================================
// OPERATOR DASHBOARD APIs (From v6.3.0 - Unchanged)
// ============================================================================

async function handleOperatorLogin(request, env) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    console.log(`[OPERATOR] Login successful for ${slug}`);
    
    return jsonResponse({
      success: true,
      slug: slug,
      config: config
    });
    
  } catch (error) {
    console.error('[OPERATOR] Login error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorDashboard(slug, env) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    const stats = {
      total_bookings: 0,
      this_month: 0,
      quota_whatsapp_percent: calculateQuotaPercent(
        config.quota_whatsapp_used || 0,
        config.quota_whatsapp_monthly || 0
      ),
      quota_sms_percent: calculateQuotaPercent(
        config.quota_sms_used || 0,
        config.quota_sms_monthly || 0
      )
    };
    
    console.log(`[OPERATOR] Dashboard data for ${slug}`);
    
    return jsonResponse({
      property: config,
      stats: stats,
      bookings: [],
      quota: {
        whatsapp_used: config.quota_whatsapp_used || 0,
        whatsapp_limit: config.quota_whatsapp_monthly || 0,
        sms_used: config.quota_sms_used || 0,
        sms_limit: config.quota_sms_monthly || 0,
        current_month: config.quota_used_month || new Date().toISOString().substring(0, 7)
      }
    });
    
  } catch (error) {
    console.error('[OPERATOR] Dashboard error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorUpdate(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const updates = await request.json();
    
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    if (updates.name) config.name = updates.name;
    if (updates.tagline) config.tagline = updates.tagline;
    if (updates.about) config.about = updates.about;
    
    if (updates.contact) {
      config.contact = {
        ...config.contact,
        ...updates.contact
      };
    }
    
    config.updatedAt = new Date().toISOString();
    
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[OPERATOR] Updated config for ${slug}`);
    
    return jsonResponse({
      success: true,
      message: 'Property updated successfully',
      config: config
    });
    
  } catch (error) {
    console.error('[OPERATOR] Update error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorBookings(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10');
    
    const bookings = [];
    
    console.log(`[OPERATOR] Fetched bookings for ${slug}`);
    
    return jsonResponse({
      bookings: bookings,
      total: bookings.length,
      limit: limit
    });
    
  } catch (error) {
    console.error('[OPERATOR] Bookings error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleGalleryUpload(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    console.log(`[OPERATOR] Gallery upload for ${slug}`);
    
    return jsonResponse({
      success: true,
      message: 'ImageKit integration coming soon',
      url: 'https://placeholder.com/image.jpg'
    });
    
  } catch (error) {
    console.error('[OPERATOR] Upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleGalleryUpdate(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const { gallery } = await request.json();
    
    if (!Array.isArray(gallery)) {
      return jsonResponse({ error: 'Gallery must be an array' }, 400);
    }
    
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    config.gallery_json = JSON.stringify(gallery);
    config.updatedAt = new Date().toISOString();
    
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[OPERATOR] Gallery updated for ${slug}`);
    
    return jsonResponse({
      success: true,
      message: 'Gallery updated successfully',
      gallery: gallery
    });
    
  } catch (error) {
    console.error('[OPERATOR] Gallery update error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// DATA REQUEST HANDLER (NEW - for Pages JavaScript)
// ============================================================================

/**
 * Handle data requests for Pages JavaScript
 * Serves config as JSON for client-side rendering
 * Route: /data/:slug.json
 */
async function handleDataRequest(slug, env) {
  try {
    if (!slug || !VALID_SLUG_PATTERN.test(slug)) {
      return jsonResponse({ error: 'Invalid slug' }, 400);
    }

    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });

    if (!config) {
      console.log(`[DATA] Config not found: ${slug}`);
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    // Check status
    if (config.status !== 'active') {
      console.log(`[DATA] Property inactive: ${slug}`);
      return jsonResponse({ error: 'Property inactive' }, 403);
    }

    console.log(`[DATA] Served config for: ${slug}`);
    
    // Return config with CORS headers (jsonResponse includes them)
    return jsonResponse(config);

  } catch (error) {
    console.error('[DATA] Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// ============================================================================
// EXISTING FUNCTIONS (v6.2.2 compatibility - Unchanged)
// ============================================================================

async function handlePublish(request, env) {
  try {
    const token = request.headers.get('X-Publish-Token');
    const expectedToken = env.PUBLISH_SECRET || 'MyVeryLongSecret123!';
    
    if (!token || token !== expectedToken) {
      console.log('[PUBLISH] Unauthorized: Invalid token');
      return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    }
    
    const body = await request.json();
    const { slug, config } = body;
    
    if (!slug || !config) {
      console.log('[PUBLISH] Missing slug or config');
      return jsonResponse({ success: false, error: 'missing_slug_or_config' }, 400);
    }
    
    const configKey = `config:${slug}`;
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[PUBLISH] ✅ Published config for ${slug}`);
    
    if (config.showInMarket) {
      const summary = {
        slug: config.slug,
        name: config.name,
        tagline: config.tagline,
        category: config.category,
        city: config.location?.city,
        state: config.location?.state,
        basePrice: config.basePrice,
        rating: config.rating,
        heroImage: config.branding?.heroImage,
        tags: config.tags
      };
      
      const summaryKey = `market:summary:${slug}`;
      await env.RESORT_CONFIGS.put(summaryKey, JSON.stringify(summary));
      
      console.log(`[PUBLISH] ✅ Added ${slug} to marketplace`);
    }
    
    return jsonResponse({ 
      success: true,
      slug: slug,
      message: 'Configuration published successfully'
    });
    
  } catch (error) {
    console.error('[PUBLISH] Error:', error);
    return jsonResponse({ 
      success: false, 
      error: 'internal_error',
      message: error.message 
    }, 500);
  }
}

async function handleGetConfig(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      console.log(`[CONFIG] Not found: ${slug}`);
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    console.log(`[CONFIG] Retrieved: ${slug}`);
    return jsonResponse(config);
    
  } catch (error) {
    console.error('[CONFIG] Error:', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}

async function handleWebsiteSSR(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return new Response('Property not found', { status: 404 });
    }
    
    // FIX: Use router pattern (forward, don't redirect)
    // This maintains consistency with subdomain routing
    // Creates single canonical URL experience
    const fakeRequest = new Request(`https://webzyl-worker.example.com/s/${slug}`);
    return await forwardToPages(slug, '', fakeRequest, env);
    
  } catch (error) {
    console.error('[SSR] Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

function calculateQuotaPercent(used, limit) {
  if (limit === 0) return 0;
  return Math.round((used / limit) * 100);
}
