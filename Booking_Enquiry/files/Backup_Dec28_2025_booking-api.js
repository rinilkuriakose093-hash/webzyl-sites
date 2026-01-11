// CLOUDFLARE WORKER - Booking API Endpoint
// v6.0: Enhanced with notifications + payment routing
// Phase 6: Booking with deduplication, rate limiting, payment checks

/**
 * POST /api/booking
 * Handles booking enquiry submissions
 *
 * v6.0 Enhancements:
 * - Deduplication (prevent duplicate bookings)
 * - KV-based rate limiting (respects config.notifications.maxPerHour)
 * - Payment routing (returns 501 if payment enabled)
 * - Notification hooks (prepared for Phase 6)
 *
 * Architecture:
 * Browser → Worker (validate + dedupe + rate limit) → Apps Script → Sheets
 */

/**
 * Main handler for booking endpoint
 */
async function handleBookingRequest(request, env, ctx) {
  console.log("🔥 BOOKING HANDLER v6.0 EXECUTED");
  
  // Only accept POST
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
  }

  try {
    // Parse request body
    const bookingData = await request.json();

    // Get client metadata
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const cfRay = request.headers.get('CF-Ray') || 'unknown';

    // STEP 1: Basic validation
    const validation = validateBookingData(bookingData);
    if (!validation.valid) {
      return jsonResponse({
        success: false,
        message: validation.error
      }, 400);
    }

    // STEP 2: Get config from KV
    const config = await env.RESORT_CONFIGS.get(`config:${bookingData.slug}`, { type: 'json' });
    
    // Check if property exists and is active
    if (!config) {
      return jsonResponse({
        success: false,
        message: 'Property not found'
      }, 404);
    }

    if (config.status !== 'active') {
      return jsonResponse({
        success: false,
        message: 'Bookings are currently unavailable'
      }, 403);
    }

    // STEP 3: v6.0 - Check if payment is enabled
    if (config.booking?.payment?.enabled) {
      // Payment bookings not implemented yet (Phase 7)
      return jsonResponse({
        success: false,
        error: 'payment_not_implemented',
        message: 'Payment processing will be available soon. Please contact the property directly.',
        contact: {
          phone: config.contact?.phone || '',
          email: config.contact?.email || ''
        }
      }, 501); // 501 = Not Implemented
    }

    // STEP 4: v6.0 - Deduplication check
    const dedupKey = generateDedupKey(bookingData);
    const isDuplicate = await checkDuplicate(env.RESORT_CONFIGS, dedupKey);
    
    if (isDuplicate) {
      console.log(`[BOOKING] Duplicate detected: ${dedupKey}`);
      return jsonResponse({
        success: false,
        message: 'This booking has already been submitted. Please check your email or contact the property.'
      }, 409); // 409 = Conflict
    }

    // STEP 5: v6.0 - Rate limiting (KV-based, per-slug)
    const maxPerHour = config.notifications?.maxPerHour || 10;
    const isLimited = await checkRateLimit(env.RESORT_CONFIGS, bookingData.slug, maxPerHour);
    
    if (isLimited) {
      console.log(`[BOOKING] Rate limit exceeded for ${bookingData.slug}`);
      return jsonResponse({
        success: false,
        message: 'Too many booking requests. Please try again in an hour or contact the property directly.',
        contact: {
          phone: config.contact?.phone || '',
          email: config.contact?.email || ''
        }
      }, 429); // 429 = Too Many Requests
    }

    // STEP 6: Enrich booking data with metadata
    const enrichedData = {
      ...bookingData,
      timestamp: new Date().toISOString(),
      source_ip: clientIP,
      user_agent: userAgent,
      cf_ray: cfRay,
      config_version: config?.updatedAt || 'unknown'
    };

    // STEP 7: Get booking mode from config
    const bookingMode = config?.booking?.mode || 'sheet';
    const sheetName = config?.booking?.sheetName || generateSheetName();

    // STEP 8: Forward to Apps Script
    let appsScriptSuccess = false;
    
    console.log("➡️ Forwarding to Apps Script", {
      mode: bookingMode,
      webhookUrlPresent: !!env.BOOKING_WEBHOOK_URL
    });

    if (bookingMode === 'sheet' || bookingMode === 'both') {
      console.log("🚀 Forwarding booking to Apps Script");
      try {
        const appsScriptUrl = env.BOOKING_WEBHOOK_URL;
        
        if (!appsScriptUrl) {
          console.error('❌ BOOKING_WEBHOOK_URL not configured');
          throw new Error('Booking webhook not configured');
        }

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
          console.log(`✅ [BOOKING] Forwarded to Apps Script: ${bookingData.slug}`);
          
          // STEP 9: v6.0 - Mark as processed (set dedup key)
          await markAsProcessed(env.RESORT_CONFIGS, dedupKey);
          
          // STEP 10: v6.0 - Increment rate limit counter
          await incrementRateLimit(env.RESORT_CONFIGS, bookingData.slug);
          
          // STEP 11: v6.0 - Emit notification event (Phase 6)
          if (config.notifications?.enabled) {
            ctx.waitUntil(
              emitNotificationEvent(env, bookingData.slug, enrichedData, config)
            );
          }
        }
      } catch (err) {
        console.error('❌ [BOOKING] Apps Script forward error:', err.message);
        return jsonResponse({
          success: false,
          message: 'Booking system temporarily unavailable. Please try again or contact the property directly.',
          contact: {
            phone: config.contact?.phone || '',
            email: config.contact?.email || ''
          }
        }, 500);
      }
    }

    // STEP 12: Return success response
    return jsonResponse({
      status: 'ok',
      success: true,
      message: 'Booking received successfully! The property will contact you soon.',
      mode: bookingMode,
      appScriptForwarded: appsScriptSuccess
    });

  } catch (err) {
    console.error('❌ [BOOKING] Error:', err.message);
    return jsonResponse({ 
      success: false, 
      error: 'processing_error',
      message: 'Unable to process booking. Please try again.'
    }, 500);
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
    return { valid: false, error: 'Invalid property' };
  }
  if (data.name.length > 100) {
    return { valid: false, error: 'Name too long' };
  }
  // Optional: Validate email format if provided
  if (data.email && !isValidEmail(data.email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

/**
 * v6.0: Generate deduplication key
 * Creates a unique key based on slug, email/phone, and check-in date
 */
function generateDedupKey(bookingData) {
  const { slug, email, phone, checkIn } = bookingData;
  const identifier = email || phone || 'unknown';
  const date = checkIn || 'nodate';
  // Hash-like key: dedup:slug:identifier:date
  return `dedup:${slug}:${identifier}:${date}`.toLowerCase();
}

/**
 * v6.0: Check if booking is duplicate
 */
async function checkDuplicate(kv, dedupKey) {
  try {
    const exists = await kv.get(dedupKey);
    return exists !== null;
  } catch (err) {
    console.error('[DEDUP] Check failed:', err);
    return false; // Fail open - don't block legitimate bookings
  }
}

/**
 * v6.0: Mark booking as processed
 */
async function markAsProcessed(kv, dedupKey) {
  try {
    // Store for 1 hour (3600 seconds)
    await kv.put(dedupKey, '1', { expirationTtl: 3600 });
    console.log(`[DEDUP] Marked as processed: ${dedupKey}`);
  } catch (err) {
    console.error('[DEDUP] Mark failed:', err);
  }
}

/**
 * v6.0: Check rate limit (KV-based)
 */
async function checkRateLimit(kv, slug, maxPerHour) {
  try {
    const rateLimitKey = `rate:${slug}`;
    const count = await kv.get(rateLimitKey);
    const currentCount = parseInt(count || '0', 10);
    
    console.log(`[RATE] ${slug}: ${currentCount}/${maxPerHour}`);
    
    return currentCount >= maxPerHour;
  } catch (err) {
    console.error('[RATE] Check failed:', err);
    return false; // Fail open
  }
}

/**
 * v6.0: Increment rate limit counter
 */
async function incrementRateLimit(kv, slug) {
  try {
    const rateLimitKey = `rate:${slug}`;
    const count = await kv.get(rateLimitKey);
    const newCount = parseInt(count || '0', 10) + 1;
    
    // Store for 1 hour
    await kv.put(rateLimitKey, newCount.toString(), { expirationTtl: 3600 });
    console.log(`[RATE] Incremented ${slug}: ${newCount}`);
  } catch (err) {
    console.error('[RATE] Increment failed:', err);
  }
}

/**
 * v6.0: Emit notification event (Phase 6 preparation)
 * Fire-and-forget event emission - no state stored in KV
 * 
 * The notification webhook (Apps Script or future notifier) will:
 * - Receive the event
 * - Send WhatsApp/Email
 * - Handle retries if needed
 * 
 * Worker responsibility: emit event only
 */
async function emitNotificationEvent(env, slug, bookingData, config) {
  try {
    // Check if notification webhook is configured
    if (!env.NOTIFICATION_WEBHOOK_URL) {
      console.log('[NOTIFY] Webhook not configured, skipping event emission');
      return;
    }

    const notificationEvent = {
      eventType: 'BOOKING_CREATED',
      slug: slug,
      timestamp: bookingData.timestamp,
      booking: {
        name: bookingData.name,
        phone: bookingData.phone,
        email: bookingData.email || '',
        checkIn: bookingData.checkIn || '',
        checkOut: bookingData.checkOut || '',
        guests: bookingData.guests || '',
        roomType: bookingData.roomType || '',
        notes: bookingData.notes || ''
      },
      recipient: {
        whatsapp: config.notifications.ownerWhatsapp || null,
        email: config.notifications.ownerEmail || null,
        language: config.notifications.language || 'en'
      },
      configVersion: bookingData.config_version
    };

    // Fire-and-forget: emit event asynchronously
    await fetch(env.NOTIFICATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Event-Type': 'BOOKING_CREATED',
        'X-Slug': slug
      },
      body: JSON.stringify(notificationEvent)
    });

    console.log(`✅ [NOTIFY] Event emitted for ${slug}`);
  } catch (err) {
    console.error('[NOTIFY] Event emission failed:', err);
    // Fail silently - don't block booking
  }
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
  
  const key = await crypto.subtle.importKey(
    'raw', 
    keyData, 
    { name: 'HMAC', hash: 'SHA-256' }, 
    false, 
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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
