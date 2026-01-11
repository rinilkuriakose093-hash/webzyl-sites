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
          
          // STEP 11: v6.2.2 - Emit multi-channel notification event
          await handleBookingNotifications(env, bookingData.slug, enrichedData, config, ctx);
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

/**
 * WEBZYL v6.2.2 - MULTI-CHANNEL WORKER NOTIFICATIONS
 * 
 * Supports:
 * - WhatsApp (Twilio) ✅ ACTIVE
 * - Email (Gmail) ✅ ACTIVE
 * - Telegram (Bot API) 🔜 READY TO ENABLE
 * - Discord (Webhooks) 🔜 READY TO ENABLE
 * - SMS (Twilio) 🔜 READY TO ENABLE
 * - Slack (Webhooks) 🔜 READY TO ENABLE
 * 
 * Architecture: Worker decides, Apps Script delivers
 * - Worker reads config.notifications.channels array
 * - Worker builds messages for each enabled channel
 * - Apps Script routes to appropriate delivery function
 * 
 * @version 6.2.2-multichannel
 * @date 2025-12-28
 */

// ============================================================================
// EVENT SCHEMA v1.0 (MULTI-CHANNEL)
// ============================================================================

const EVENT_SCHEMA_VERSION = "1.0";

function createEventEnvelope(eventType, slug, data) {
  return {
    eventVersion: EVENT_SCHEMA_VERSION,
    eventType: eventType,
    eventId: generateEventId(),
    occurredAt: new Date().toISOString(),
    source: "webzyl.worker",
    tenant: { slug: slug },
    data: data
  };
}

function generateEventId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `evt_${timestamp}_${random}`;
}

// ============================================================================
// PII PROTECTION
// ============================================================================

function maskPhone(phone) {
  if (!phone) return null;
  if (phone.length <= 4) return '*'.repeat(phone.length);
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const maskedLocal = local.length > 2 
    ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
    : '*'.repeat(local.length);
  return `${maskedLocal}@${domain}`;
}

function createSafeBookingLog(booking) {
  return {
    bookingId: booking.bookingId,
    name: booking.name,
    phone: maskPhone(booking.phone),
    email: maskEmail(booking.email),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guests: booking.guests,
    roomType: booking.roomType,
    timestamp: booking.timestamp
  };
}

// ============================================================================
// MULTI-CHANNEL MESSAGE BUILDERS
// ============================================================================

/**
 * Build delivery instructions for all enabled channels
 * This is the KEY function that makes multi-channel work!
 */
function buildMultiChannelDeliveryInstructions(booking, config) {
  const instructions = {};
  const lang = config.notifications?.language || 'en';
  const enabledChannels = config.notifications?.channels || ['whatsapp', 'email'];
  
  // Owner notifications
  if (config.notifications?.notifyOwner) {
    instructions.owner = {};
    
    // WhatsApp
    if (enabledChannels.includes('whatsapp') && config.notifications.ownerWhatsapp) {
      instructions.owner.whatsapp = {
        to: formatWhatsAppNumber(config.notifications.ownerWhatsapp),
        message: buildOwnerWhatsAppMessage(booking, config, lang)
      };
    }
    
    // Email
    if (enabledChannels.includes('email') && config.notifications.ownerEmail) {
      instructions.owner.email = {
        to: config.notifications.ownerEmail,
        subject: buildOwnerEmailSubject(booking, config, lang),
        htmlBody: buildOwnerEmailHTML(booking, config, lang),
        fromName: config.name || 'Webzyl Bookings',
        replyTo: config.contact?.email || 'bookings@webzyl.com'
      };
    }
    
    // Telegram
    if (enabledChannels.includes('telegram') && config.notifications.ownerTelegram) {
      instructions.owner.telegram = {
        chatId: config.notifications.ownerTelegram,
        message: buildOwnerTelegramMessage(booking, config, lang),
        parseMode: 'Markdown'
      };
    }
    
    // Discord
    if (enabledChannels.includes('discord') && config.notifications.ownerDiscord) {
      instructions.owner.discord = buildOwnerDiscordMessage(booking, config, lang);
    }
    
    // SMS
    if (enabledChannels.includes('sms') && config.notifications.ownerSMS) {
      instructions.owner.sms = {
        to: config.notifications.ownerSMS,
        message: buildOwnerSMSMessage(booking, config, lang)
      };
    }
    
    // Slack
    if (enabledChannels.includes('slack') && config.notifications.ownerSlack) {
      instructions.owner.slack = buildOwnerSlackMessage(booking, config, lang);
    }
  }
  
  // Customer notifications
  if (config.notifications?.notifyCustomer) {
    instructions.customer = {};
    
    // Email (most common for customers)
    if (enabledChannels.includes('customer_email') && booking.email) {
      instructions.customer.email = {
        to: booking.email,
        subject: buildCustomerEmailSubject(booking, config, lang),
        htmlBody: buildCustomerEmailHTML(booking, config, lang),
        fromName: config.name || 'Webzyl',
        replyTo: config.contact?.email || 'support@webzyl.com'
      };
    }
    
    // Telegram (if customer provides Telegram ID)
    if (enabledChannels.includes('customer_telegram') && booking.telegramId) {
      instructions.customer.telegram = {
        chatId: booking.telegramId,
        message: buildCustomerTelegramMessage(booking, config, lang),
        parseMode: 'Markdown'
      };
    }
    
    // SMS (if customer prefers SMS)
    if (enabledChannels.includes('customer_sms') && booking.phone) {
      instructions.customer.sms = {
        to: booking.phone,
        message: buildCustomerSMSMessage(booking, config, lang)
      };
    }
  }
  
  return instructions;
}

// ============================================================================
// WHATSAPP MESSAGES
// ============================================================================

function formatWhatsAppNumber(phone) {
  const cleaned = phone.replace(/\D/g, '');
  const withCountry = cleaned.length === 10 ? '91' + cleaned : cleaned;
  return `whatsapp:+${withCountry}`;
}

function buildOwnerWhatsAppMessage(booking, config, lang) {
  if (lang === 'hi') {
    return `🎉 *नई बुकिंग मिली!*

📝 *विवरण:*
नाम: ${booking.name}
फोन: ${booking.phone}
${booking.email ? `ईमेल: ${booking.email}` : ''}

📅 *तारीख:*
${booking.checkIn ? `चेक-इन: ${formatDate(booking.checkIn)}` : 'जल्द ही'}
${booking.checkOut ? `चेक-आउट: ${formatDate(booking.checkOut)}` : ''}
${booking.guests ? `मेहमान: ${booking.guests}` : ''}
${booking.roomType ? `कमरा: ${booking.roomType}` : ''}

💬 *संदेश:*
${booking.notes || 'कोई संदेश नहीं'}

⏰ ${formatTimestamp(booking.timestamp)}
🆔 ${booking.bookingId}

_${config.name || 'Webzyl'} द्वारा संचालित_`;
  }
  
  return `🎉 *New Booking Received!*

📝 *Details:*
Name: ${booking.name}
Phone: ${booking.phone}
${booking.email ? `Email: ${booking.email}` : ''}

📅 *Dates:*
${booking.checkIn ? `Check-in: ${formatDate(booking.checkIn)}` : 'Coming soon'}
${booking.checkOut ? `Check-out: ${formatDate(booking.checkOut)}` : ''}
${booking.guests ? `Guests: ${booking.guests}` : ''}
${booking.roomType ? `Room: ${booking.roomType}` : ''}

💬 *Message:*
${booking.notes || 'No message'}

⏰ ${formatTimestamp(booking.timestamp)}
🆔 ${booking.bookingId}

_Powered by ${config.name || 'Webzyl'}_`;
}

// ============================================================================
// TELEGRAM MESSAGES
// ============================================================================

function buildOwnerTelegramMessage(booking, config, lang) {
  if (lang === 'hi') {
    return `🎉 *नई बुकिंग मिली!*

📝 *विवरण:*
• नाम: ${booking.name}
• फोन: ${booking.phone}
${booking.email ? `• ईमेल: ${booking.email}` : ''}

📅 *तारीख:*
${booking.checkIn ? `• चेक-इन: ${formatDate(booking.checkIn)}` : ''}
${booking.checkOut ? `• चेक-आउट: ${formatDate(booking.checkOut)}` : ''}
${booking.guests ? `• मेहमान: ${booking.guests}` : ''}
${booking.roomType ? `• कमरा: ${booking.roomType}` : ''}

💬 *संदेश:* ${booking.notes || 'कोई संदेश नहीं'}

🆔 बुकिंग ID: \`${booking.bookingId}\``;
  }
  
  return `🎉 *New Booking Received!*

📝 *Details:*
• Name: ${booking.name}
• Phone: ${booking.phone}
${booking.email ? `• Email: ${booking.email}` : ''}

📅 *Dates:*
${booking.checkIn ? `• Check-in: ${formatDate(booking.checkIn)}` : ''}
${booking.checkOut ? `• Check-out: ${formatDate(booking.checkOut)}` : ''}
${booking.guests ? `• Guests: ${booking.guests}` : ''}
${booking.roomType ? `• Room: ${booking.roomType}` : ''}

💬 *Message:* ${booking.notes || 'No message'}

🆔 Booking ID: \`${booking.bookingId}\``;
}

function buildCustomerTelegramMessage(booking, config, lang) {
  if (lang === 'hi') {
    return `✅ *बुकिंग की पुष्टि*

प्रिय ${booking.name},

धन्यवाद! हमने आपकी बुकिंग प्राप्त कर ली है।

🏨 *${config.name}*
${config.location?.address || ''}

${booking.checkIn ? `📅 चेक-इन: ${formatDate(booking.checkIn)}` : ''}
${booking.checkOut ? `📅 चेक-आउट: ${formatDate(booking.checkOut)}` : ''}

🆔 बुकिंग ID: \`${booking.bookingId}\`

हम जल्द ही आपसे संपर्क करेंगे!`;
  }
  
  return `✅ *Booking Confirmed*

Dear ${booking.name},

Thank you! We've received your booking.

🏨 *${config.name}*
${config.location?.address || ''}

${booking.checkIn ? `📅 Check-in: ${formatDate(booking.checkIn)}` : ''}
${booking.checkOut ? `📅 Check-out: ${formatDate(booking.checkOut)}` : ''}

🆔 Booking ID: \`${booking.bookingId}\`

We'll contact you shortly!`;
}

// ============================================================================
// DISCORD MESSAGES
// ============================================================================

function buildOwnerDiscordMessage(booking, config, lang) {
  const isHindi = lang === 'hi';
  
  return {
    content: null,
    embeds: [{
      title: isHindi ? '🎉 नई बुकिंग!' : '🎉 New Booking!',
      color: 3447003, // Blue
      fields: [
        {
          name: isHindi ? '👤 ग्राहक' : '👤 Customer',
          value: `${booking.name}\n${booking.phone}${booking.email ? `\n${booking.email}` : ''}`,
          inline: false
        },
        {
          name: isHindi ? '📅 तारीख' : '📅 Dates',
          value: booking.checkIn 
            ? `${isHindi ? 'चेक-इन' : 'Check-in'}: ${formatDate(booking.checkIn)}\n${isHindi ? 'चेक-आउट' : 'Check-out'}: ${formatDate(booking.checkOut)}`
            : isHindi ? 'जल्द ही' : 'Coming soon',
          inline: true
        },
        {
          name: isHindi ? '🛏️ विवरण' : '🛏️ Details',
          value: `${booking.guests ? `${isHindi ? 'मेहमान' : 'Guests'}: ${booking.guests}\n` : ''}${booking.roomType ? `${isHindi ? 'कमरा' : 'Room'}: ${booking.roomType}` : ''}`,
          inline: true
        }
      ],
      footer: {
        text: `${config.name || 'Webzyl'} • ${booking.bookingId}`
      },
      timestamp: new Date().toISOString()
    }]
  };
}

// ============================================================================
// SMS MESSAGES (Keep Short - 160 chars)
// ============================================================================

function buildOwnerSMSMessage(booking, config, lang) {
  if (lang === 'hi') {
    return `नई बुकिंग: ${booking.name}, ${booking.phone}. ${booking.checkIn ? formatDate(booking.checkIn) : 'जल्द ही'}. ID: ${booking.bookingId}`;
  }
  return `New booking: ${booking.name}, ${booking.phone}. ${booking.checkIn ? formatDate(booking.checkIn) : 'Soon'}. ID: ${booking.bookingId}`;
}

function buildCustomerSMSMessage(booking, config, lang) {
  if (lang === 'hi') {
    return `${config.name}: बुकिंग पुष्टि! ID: ${booking.bookingId}. हम जल्द संपर्क करेंगे।`;
  }
  return `${config.name}: Booking confirmed! ID: ${booking.bookingId}. We'll contact you soon.`;
}

// ============================================================================
// SLACK MESSAGES
// ============================================================================

function buildOwnerSlackMessage(booking, config, lang) {
  const isHindi = lang === 'hi';
  
  return {
    text: isHindi ? '🎉 नई बुकिंग मिली!' : '🎉 New Booking Received!',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: isHindi ? '🎉 नई बुकिंग!' : '🎉 New Booking!',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*${isHindi ? 'नाम' : 'Name'}:*\n${booking.name}`
          },
          {
            type: 'mrkdwn',
            text: `*${isHindi ? 'फोन' : 'Phone'}:*\n${booking.phone}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: booking.checkIn ? `*${isHindi ? 'चेक-इन' : 'Check-in'}:*\n${formatDate(booking.checkIn)}` : ''
          },
          {
            type: 'mrkdwn',
            text: booking.guests ? `*${isHindi ? 'मेहमान' : 'Guests'}:*\n${booking.guests}` : ''
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${config.name || 'Webzyl'} • ${booking.bookingId}`
          }
        ]
      }
    ]
  };
}

// ============================================================================
// EMAIL MESSAGES (Same as before - already work!)
// ============================================================================

function buildOwnerEmailSubject(booking, config, lang) {
  return lang === 'hi' 
    ? `🎉 नई बुकिंग - ${booking.name}`
    : `🎉 New Booking - ${booking.name}`;
}

function buildCustomerEmailSubject(booking, config, lang) {
  return lang === 'hi'
    ? `✅ बुकिंग की पुष्टि - ${config.name}`
    : `✅ Booking Confirmation - ${config.name}`;
}

function buildOwnerEmailHTML(booking, config, lang) {
  const isHindi = lang === 'hi';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #06b6d4, #0891b2); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
    .booking-card { background: #f9fafb; border-left: 4px solid #06b6d4; padding: 20px; margin: 20px 0; border-radius: 5px; }
    .detail-row { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 ${isHindi ? 'नई बुकिंग!' : 'New Booking!'}</h1>
    </div>
    <div class="content">
      <div class="booking-card">
        <h3>${isHindi ? '👤 ग्राहक विवरण' : '👤 Customer Details'}</h3>
        <div class="detail-row"><strong>${isHindi ? 'नाम' : 'Name'}:</strong> ${booking.name}</div>
        <div class="detail-row"><strong>${isHindi ? 'फोन' : 'Phone'}:</strong> ${booking.phone}</div>
        ${booking.email ? `<div class="detail-row"><strong>${isHindi ? 'ईमेल' : 'Email'}:</strong> ${booking.email}</div>` : ''}
      </div>
      ${booking.checkIn ? `<div class="booking-card">
        <h3>${isHindi ? '📅 बुकिंग तारीख' : '📅 Booking Dates'}</h3>
        <div class="detail-row"><strong>${isHindi ? 'चेक-इन' : 'Check-in'}:</strong> ${formatDate(booking.checkIn)}</div>
        ${booking.checkOut ? `<div class="detail-row"><strong>${isHindi ? 'चेक-आउट' : 'Check-out'}:</strong> ${formatDate(booking.checkOut)}</div>` : ''}
        ${booking.guests ? `<div class="detail-row"><strong>${isHindi ? 'मेहमान' : 'Guests'}:</strong> ${booking.guests}</div>` : ''}
      </div>` : ''}
      <p><strong>🆔 ${isHindi ? 'बुकिंग ID' : 'Booking ID'}:</strong> ${booking.bookingId}</p>
    </div>
  </div>
</body>
</html>`;
}

function buildCustomerEmailHTML(booking, config, lang) {
  const isHindi = lang === 'hi';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #06b6d4, #0891b2); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
    .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ ${isHindi ? 'बुकिंग की पुष्टि' : 'Booking Confirmed'}</h1>
    </div>
    <div class="content">
      <p>${isHindi ? 'प्रिय' : 'Dear'} <strong>${booking.name}</strong>,</p>
      <p>${isHindi ? 'धन्यवाद! हमने आपकी बुकिंग प्राप्त कर ली है।' : 'Thank you! We have received your booking.'}</p>
      <h3>🏨 ${config.name}</h3>
      ${config.location?.address ? `<p>${config.location.address}</p>` : ''}
      ${booking.checkIn ? `<p><strong>${isHindi ? 'चेक-इन' : 'Check-in'}:</strong> ${formatDate(booking.checkIn)}</p>` : ''}
      <p><strong>🆔 ${isHindi ? 'बुकिंग ID' : 'Booking ID'}:</strong> ${booking.bookingId}</p>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================================================
// NOTIFICATION EMISSION
// ============================================================================

async function emitNotificationEvent(env, slug, bookingData, config, ctx) {
  const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  try {
    // Build multi-channel delivery instructions
    const deliveryInstructions = buildMultiChannelDeliveryInstructions(
      bookingData, 
      config
    );
    
    // Skip if nothing to send
    if (Object.keys(deliveryInstructions).length === 0) {
      return;
    }
    
    // Create versioned event
    const event = createEventEnvelope(
      'booking.created',
      slug,
      {
        booking: bookingData,
        deliveryInstructions: deliveryInstructions,
        metadata: {
          notificationLanguage: config.notifications?.language || 'en',
          propertyName: config.name,
          enabledChannels: config.notifications?.channels || ['whatsapp', 'email']
        }
      }
    );
    
    // Log PII-safe version
    console.log('Emitting multi-channel notification:', {
      eventId: event.eventId,
      slug: slug,
      booking: createSafeBookingLog(bookingData),
      channels: Object.keys(deliveryInstructions),
      enabledChannels: config.notifications?.channels
    });
    
    // Send to Apps Script
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    
    if (!response.ok) {
      console.error(`Notification webhook failed: ${response.status}`);
    } else {
      console.log(`Multi-channel event sent: ${event.eventId}`);
    }
    
  } catch (error) {
    console.error('Notification emission error:', error.message);
  }
}

async function handleBookingNotifications(env, slug, enrichedData, config, ctx) {
  if (!config.notifications?.enabled) return;
  
  // Rate limiting
  const notifyRateKey = `notify_rate:${slug}`;
  const notifyCount = parseInt(await env.RESORT_CONFIGS.get(notifyRateKey) || "0");
  const notifyMax = config.notifications?.maxPerHour || 10;
  
  if (notifyCount >= notifyMax) {
    console.log(`Notification rate limit exceeded for ${slug}`);
    return;
  }
  
  await env.RESORT_CONFIGS.put(notifyRateKey, String(notifyCount + 1), { 
    expirationTtl: 3600 
  });
  
  ctx.waitUntil(
    emitNotificationEvent(env, slug, enrichedData, config, ctx)
  );
}

// ============================================================================
// EXPORT / INTEGRATION
// ============================================================================

/**
 * Add these functions to your existing booking-api.js
 * 
 * In handleBooking(), after saving booking:
 * 
 * await handleBookingNotifications(env, slug, enrichedData, config, ctx);
 */
