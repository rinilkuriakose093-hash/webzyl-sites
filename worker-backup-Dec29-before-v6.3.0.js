/**
 * WEBZYL WORKER - Main Entry Point
 * Routes all requests to appropriate handlers
 * 
 * Routes:
 * - /api/admin/publish → Admin endpoint (save config to KV)
 * - /api/config/:slug → Get config from KV
 * - /api/booking → Booking handler
 * - /s/:slug → Website SSR
 */

import { handleBookingRequest, handleOptions } from './Booking_Enquiry/files/booking-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    // ========================================================================
    // ADMIN ENDPOINT: Publish config to KV
    // ========================================================================
    if (url.pathname === '/api/admin/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }
    
    // ========================================================================
    // CONFIG ENDPOINT: Get config from KV
    // ========================================================================
    if (url.pathname.startsWith('/api/config/')) {
      const slug = url.pathname.split('/').pop();
      return handleGetConfig(slug, env);
    }
    
    // ========================================================================
    // BOOKING ENDPOINT: Handle booking requests
    // ========================================================================
    if (url.pathname === '/api/booking') {
      return handleBookingRequest(request, env, ctx);
    }
    
    // ========================================================================
    // WEBSITE SSR: Serve websites at /s/:slug
    // ========================================================================
    if (url.pathname.startsWith('/s/')) {
      const slug = url.pathname.split('/')[2];
      return handleWebsiteSSR(slug, env);
    }
    
    // ========================================================================
    // ROOT: Simple status page
    // ========================================================================
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'webzyl-worker',
        version: '6.2.2',
        endpoints: {
          publish: 'POST /api/admin/publish',
          config: 'GET /api/config/:slug',
          booking: 'POST /api/booking',
          website: 'GET /s/:slug'
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
// ADMIN: PUBLISH CONFIG TO KV
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

// ============================================================================
// GET CONFIG FROM KV
// ============================================================================

async function handleGetConfig(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      console.log(`[CONFIG] Not found: ${slug}`);
      return new Response('Not Found', { status: 404 });
    }
    
    console.log(`[CONFIG] Retrieved: ${slug}`);
    return jsonResponse(config);
    
  } catch (error) {
    console.error('[CONFIG] Error:', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}

// ============================================================================
// WEBSITE SSR (Simple version - returns config as JSON for now)
// ============================================================================

async function handleWebsiteSSR(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(configKey, { type: 'json' });
    
    if (!config) {
      return new Response('Property not found', { status: 404 });
    }
    
    // For now, return JSON
    // TODO: In future, render actual HTML template
    return new Response(JSON.stringify({
      message: 'Website SSR endpoint',
      slug: slug,
      config: config
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
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
      'Access-Control-Allow-Origin': '*'
    }
  });
}
