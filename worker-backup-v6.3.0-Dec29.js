/**
 * WEBZYL WORKER v6.3.0 - Main Entry Point
 * 
 * NEW in v6.3.0:
 * - Subdomain routing (mountview.webzyl.com)
 * - Operator dashboard APIs (/api/operator/*)
 * - Custom domain support
 * 
 * Routes:
 * - /api/admin/publish → Admin endpoint (save config to KV)
 * - /api/config/:slug → Get config from KV
 * - /api/booking → Booking handler
 * - /api/operator/* → NEW: Operator dashboard APIs
 * - /s/:slug → Website SSR (legacy support)
 * - mountview.webzyl.com → NEW: Subdomain routing
 */

import { handleBookingRequest, handleOptions } from './Booking_Enquiry/files/booking-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;
    
    // ========================================================================
    // SUBDOMAIN DETECTION (NEW in v6.3.0)
    // ========================================================================
    
    const isSubdomain = hostname.endsWith('.webzyl.com') && 
                       hostname !== 'webzyl.com' &&
                       hostname !== 'www.webzyl.com' &&
                       !hostname.startsWith('webzyl-worker') &&
                       !hostname.startsWith('webzyl-sites');
    
    let slug = null;
    if (isSubdomain) {
      slug = hostname.split('.')[0]; // Extract "mountview" from "mountview.webzyl.com"
      console.log(`[SUBDOMAIN] Detected: ${slug} from ${hostname}`);
    }
    
    // ========================================================================
    // SUBDOMAIN ROUTING (NEW)
    // Route: mountview.webzyl.com → Redirect to Pages
    // ========================================================================
    
    if (slug && path === '/') {
      // Redirect to Cloudflare Pages URL
      const pagesUrl = `https://webzyl-sites.pages.dev/${slug}`;
      return Response.redirect(pagesUrl, 302);
    }
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    // ========================================================================
    // OPERATOR DASHBOARD APIS (NEW in v6.3.0)
    // ========================================================================
    
    // Login/Auth
    if (path === '/api/operator/login' && request.method === 'GET') {
      return handleOperatorLogin(request, env);
    }
    
    // Get dashboard data
    if (path.startsWith('/api/operator/dashboard/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorDashboard(operatorSlug, env);
    }
    
    // Update property details
    if (path.startsWith('/api/operator/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[4];
      return handleOperatorUpdate(request, env, operatorSlug);
    }
    
    // Get bookings
    if (path.startsWith('/api/operator/bookings/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorBookings(request, env, operatorSlug);
    }
    
    // Gallery upload
    if (path.startsWith('/api/operator/gallery/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpload(request, env, operatorSlug);
    }
    
    // Gallery update
    if (path.startsWith('/api/operator/gallery/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpdate(request, env, operatorSlug);
    }
    
    // ========================================================================
    // EXISTING ROUTES (Unchanged from v6.2.2)
    // ========================================================================
    
    // Admin publish
    if (path === '/api/admin/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }
    
    // Get config
    if (path.startsWith('/api/config/')) {
      const configSlug = path.split('/').pop();
      return handleGetConfig(configSlug, env);
    }
    
    // Booking
    if (path === '/api/booking') {
      return handleBookingRequest(request, env, ctx);
    }
    
    // Legacy SSR
    if (path.startsWith('/s/')) {
      const ssrSlug = path.split('/')[2];
      return handleWebsiteSSR(ssrSlug, env);
    }
    
    // Root status
    if (path === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'webzyl-worker',
        version: '6.3.0',
        new_features: {
          subdomain_routing: 'mountview.webzyl.com',
          operator_dashboard: '/api/operator/*'
        },
        endpoints: {
          publish: 'POST /api/admin/publish',
          config: 'GET /api/config/:slug',
          booking: 'POST /api/booking',
          website: 'GET /s/:slug',
          operator_login: 'GET /api/operator/login?slug=:slug',
          operator_dashboard: 'GET /api/operator/dashboard/:slug'
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 404
    return new Response('Not Found', { status: 404 });
  }
};

// ============================================================================
// OPERATOR DASHBOARD APIS (NEW in v6.3.0)
// ============================================================================

async function handleOperatorLogin(request, env) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    // Check if property exists
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
    
    // Fetch config
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    // Calculate stats
    const stats = {
      total_bookings: 0, // TODO: Get from bookings
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
      bookings: [], // TODO: Fetch from bookings sheet
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
    
    // Fetch existing config
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    // Update allowed fields
    if (updates.name) config.name = updates.name;
    if (updates.tagline) config.tagline = updates.tagline;
    if (updates.about) config.about = updates.about;
    
    if (updates.contact) {
      config.contact = {
        ...config.contact,
        ...updates.contact
      };
    }
    
    // Update timestamp
    config.updatedAt = new Date().toISOString();
    
    // Save back to KV
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
    
    // TODO: Implement bookings fetch from Google Sheets
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
    
    // TODO: Implement ImageKit upload
    // For now, return placeholder
    
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
    
    // Fetch existing config
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    // Update gallery
    config.gallery_json = JSON.stringify(gallery);
    config.updatedAt = new Date().toISOString();
    
    // Save back to KV
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
// EXISTING FUNCTIONS (Unchanged from v6.2.2)
// ============================================================================

async function handlePublish(request, env) {
  try {
    // Verify secret token
    const token = request.headers.get('X-Publish-Token');
    const expectedToken = env.PUBLISH_SECRET || 'MyVeryLongSecret123!';
    
    if (!token || token !== expectedToken) {
      console.log('[PUBLISH] Unauthorized: Invalid token');
      return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    }
    
    // Parse request
    const body = await request.json();
    const { slug, config } = body;
    
    if (!slug || !config) {
      console.log('[PUBLISH] Missing slug or config');
      return jsonResponse({ success: false, error: 'missing_slug_or_config' }, 400);
    }
    
    // Save to KV
    const configKey = `config:${slug}`;
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[PUBLISH] ✅ Published config for ${slug}`);
    console.log(`[PUBLISH] Notification config:`, config.notifications);
    
    // Also save to marketplace index if show_in_market is true
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
    
    // Redirect to Pages URL
    const pagesUrl = `https://webzyl-sites.pages.dev/${slug}`;
    return Response.redirect(pagesUrl, 302);
    
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
