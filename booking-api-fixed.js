// CLOUDFLARE WORKER - Booking API Endpoint
// Phase 4: Booking Enquiry Backend
// File: worker.js (add to existing worker or create new route)

/**
 * POST /api/booking
 * Handles booking enquiry submissions
 *
 * Architecture:
 * Browser → Worker (validate + rate limit) → Apps Script → Sheets
 */

// Rate limiting store (in-memory for this worker instance)
const rateLimitStore = new Map();

// Configuration
const CONFIG = {
  RATE_LIMIT: {
    MAX_REQUESTS: 5,
    WINDOW_MINUTES: 60
  },
  APPS_SCRIPT_URL: '', // Set via environment variable: BOOKING_WEBHOOK_URL      
  HMAC_SECRET: '' // Set via environment variable: BOOKING_HMAC_SECRET
};

/**
 * Main handler for booking endpoint
 */
async function handleBookingRequest(request, env) {
  // Only accept POST
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405); 
  }

  try {
    // Parse request body
    const bookingData = await request.json();

    // Get client IP and headers for rate limiting and audit
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';       
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const cfRay = request.headers.get('CF-Ray') || 'unknown';

    // STEP 1: Rate Limiting
    const rateLimitKey = `${bookingData.slug}:${clientIP}`;
    if (isRateLimited(rateLimitKey)) {
      return jsonResponse({
        success: false,
        message: 'Too many requests. Please try again in an hour.'
      }, 429);
    }

    // STEP 2: Validate required fields
    const validation = validateBookingData(bookingData);
    if (!validation.valid) {
      return jsonResponse({
        success: false,
        message: validation.error
      }, 400);
    }

    // STEP 3: Optional KV config lookup - skip strict validation to allow new resorts
    // This enables resorts to accept bookings before configs are published to KV
    const config = await env.RESORT_CONFIGS.get(`config:${bookingData.slug}`, { type: 'json' });
    
    // Only check status if config exists in KV
    if (config && config.status !== 'active') {
      return jsonResponse({
        success: false,
        message: 'Bookings are currently unavailable'
      }, 403);
    }

    // STEP 4: Enrich booking data with metadata
    const enrichedData = {
      ...bookingData,
      timestamp: new Date().toISOString(),
      source_ip: clientIP,
      user_agent: userAgent,
      cf_ray: cfRay,
      config_version: config?.updatedAt || 'unknown'
    };

    // STEP 5: Get booking mode from config (or use defaults)
    const bookingMode = config?.booking?.mode || 'sheet';
    const sheetName = config?.booking?.sheetName || generateSheetName();

    // STEP 6: Forward to Apps Script (if sheet mode or both)
    let appsScriptSuccess = false;
    if (bookingMode === 'sheet' || bookingMode === 'both') {
      try {
        const appsScriptUrl = env.BOOKING_WEBHOOK_URL;
        if (!appsScriptUrl) {
          console.error('BOOKING_WEBHOOK_URL not configured');
        } else {
          // Create HMAC signature for security
          const signature = await createHMAC(enrichedData, env.BOOKING_HMAC_SECRET);
          
          const appsScriptResponse = await fetch(appsScriptUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Signature': signature,
              'X-Sheet-Name': sheetName
            },
            body: JSON.stringify(enrichedData)
          });

          const result = await appsScriptResponse.json();
          appsScriptSuccess = result.success || false;
          
          if (appsScriptSuccess) {
            console.log(`[BOOKING] Forwarded to Apps Script: ${bookingData.slug}`);
          }
        }
      } catch (err) {
        console.error('[BOOKING] Apps Script forward error:', err.message);
        appsScriptSuccess = false;
      }
    }

    // STEP 7: Return success response
    return jsonResponse({
      status: 'ok',
      success: true,
      message: 'Booking received successfully',
      mode: bookingMode,
      appScriptForwarded: appsScriptSuccess
    });

  } catch (err) {
    console.error('[BOOKING] Error:', err.message);
    return jsonResponse({ success: false, error: 'invalid_json' }, 400);
  }
}

/**
 * Handle OPTIONS for CORS
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

/**
 * Validate booking data
 */
function validateBookingData(data) {
  if (!data.name || data.name.trim().length === 0) {
    return { valid: false, error: 'Name is required' };
  }
  if (!data.phone || data.phone.trim().length === 0) {
    return { valid: false, error: 'Phone is required' };
  }
  if (!data.slug || data.slug.trim().length === 0) {
    return { valid: false, error: 'Invalid resort' };
  }
  if (data.name.length > 100) {
    return { valid: false, error: 'Name too long' };
  }
  return { valid: true };
}

/**
 * Rate limiting check
 */
function isRateLimited(key) {
  const now = Date.now();
  const windowMs = CONFIG.RATE_LIMIT.WINDOW_MINUTES * 60 * 1000;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, []);
  }
  
  let requests = rateLimitStore.get(key);
  requests = requests.filter(time => now - time < windowMs);
  rateLimitStore.set(key, requests);
  
  if (requests.length >= CONFIG.RATE_LIMIT.MAX_REQUESTS) {
    return true;
  }
  
  requests.push(now);
  return false;
}

/**
 * Generate sheet name based on current month
 */
function generateSheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Bookings ${year}-${month}`;
}

/**
 * Create HMAC signature
 */
async function createHMAC(data, secret) {
  if (!secret) return '';
  
  const message = JSON.stringify(data);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * JSON response helper
 */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export { handleBookingRequest, handleOptions };
