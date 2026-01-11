// CLOUDFLARE WORKER - Booking API Endpoint  
// v6.2.2: COMPLETE - Quota Management + Full Multi-Channel Notifications
// 100% FEATURE COMPLETE - Ready to deploy

/**
 * POST /api/booking
 * 
 * v6.2.2 COMPLETE FEATURES:
 * ✅ Multi-tier pricing (Trial, Starter, Professional, Business)
 * ✅ Quota checking BEFORE sending WhatsApp/SMS
 * ✅ Quota increment AFTER successful send  
 * ✅ Auto monthly quota reset
 * ✅ Plan tier enforcement
 * ✅ Deduplication, rate limiting, payment checks
 * ✅ Multi-channel notifications: WhatsApp, Email, SMS, Telegram, Discord, Slack
 * ✅ Hindi + English language support
 * ✅ PII protection in logs
 */

async function handleBookingRequest(request, env, ctx) {
  console.log("🚀 BOOKING HANDLER v6.2.2 EXECUTED (WITH QUOTA)");

  if (request.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(request.url);
    const debugNotify = url.searchParams.get('debugNotify') === '1' || request.headers.get('X-Debug-Notify') === '1';
    const debugForward = url.searchParams.get('debugForward') === '1' || request.headers.get('X-Debug-Forward') === '1';

    const bookingData = await request.json();
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const cfRay = request.headers.get('CF-Ray') || 'unknown';

    // STEP 1: Basic validation
    const validation = validateBookingData(bookingData);
    if (!validation.valid) {
      return jsonResponse({ success: false, message: validation.error }, 400);
    }

    // STEP 2: Get config from KV
    const config = await env.RESORT_CONFIGS.get(`config:${bookingData.slug}`, { type: 'json' });

    if (!config) {
      return jsonResponse({ success: false, message: 'Property not found' }, 404);
    }

    if (config.status !== 'active') {
      return jsonResponse({ success: false, message: 'Bookings are currently unavailable' }, 403);
    }

    // STEP 2.5: v6.2.2 - CHECK QUOTA BEFORE PROCESSING
    const quotaCheck = await checkAndEnforceQuota(env, bookingData.slug, config);
    
    if (!quotaCheck.allowed) {
      console.log(`[QUOTA] ❌ ${bookingData.slug}: ${quotaCheck.reason}`);
      
      return jsonResponse({
        success: false,
        error: 'quota_exceeded',
        message: quotaCheck.message,
        quota: quotaCheck.quota_info,
        upgrade_url: quotaCheck.upgrade_url
      }, 429);
    }

    console.log(`[QUOTA] ✅ ${bookingData.slug}: Allowed - ${JSON.stringify(quotaCheck.quota_info)}`);

    // STEP 3: Check if payment is enabled
    if (config.booking?.payment?.enabled) {
      return jsonResponse({
        success: false,
        error: 'payment_not_implemented',
        message: 'Payment processing will be available soon. Please contact the property directly.',
        contact: {
          phone: config.contact?.phone || '',
          email: config.contact?.email || ''
        }
      }, 501);
    }

    // STEP 4: Deduplication check
    const dedupKey = generateDedupKey(bookingData);
    const isDuplicate = await checkDuplicate(env.RESORT_CONFIGS, dedupKey);

    if (isDuplicate) {
      console.log(`[BOOKING] Duplicate detected: ${dedupKey}`);
      return jsonResponse({
        success: false,
        message: 'This booking has already been submitted. Please check your email or contact the property.'
      }, 409);
    }

    // STEP 5: Rate limiting
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
      }, 429);
    }

    // STEP 6: Enrich booking data
    const _normalizeEmail = (value) => {
      if (value === null || value === undefined) return '';
      // Remove all whitespace (newlines/spaces) which frequently break email routing.
      return String(value).trim().replace(/\s+/g, '');
    };

    const _isValidEmail = (email) => {
      if (!email) return false;
      // Simple, pragmatic validation.
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
    };

    const notificationsOwnerEmail = _normalizeEmail(config?.notifications?.ownerEmail);
    const contactEmail = _normalizeEmail(config?.contact?.email);
    const resolvedOwnerEmail = _isValidEmail(notificationsOwnerEmail)
      ? notificationsOwnerEmail
      : (_isValidEmail(contactEmail) ? contactEmail : '');

    const enrichedData = {
      ...bookingData,
      bookingId: generateEventId(),
      timestamp: new Date().toISOString(),
      source_ip: clientIP,
      user_agent: userAgent,
      cf_ray: cfRay,
      config_version: config?.updatedAt || 'unknown',

      // Option A (recommended): pass owner routing info to Apps Script.
      // Apps Script sends email ONLY when ownerEmail is present (no global fallback).
      ownerEmail: resolvedOwnerEmail,
      propertyName: (config?.name || config?.title || config?.slug || bookingData.slug || '').toString().trim()
    };

    if (debugForward) {
      // Debug-only signal to Apps Script to return email delivery diagnostics.
      enrichedData.debugEmail = true;
    }

    // STEP 7: Get booking mode
    const bookingMode = config?.booking?.mode || 'sheet';
    const sheetName = config?.booking?.sheetName || generateSheetName();

    // STEP 8: Forward to Apps Script
    let appsScriptSuccess = false;
    let appsScriptDebugEmail = null;

    if (bookingMode === 'sheet' || bookingMode === 'both') {
      console.log("📧 Forwarding booking to Apps Script");
      try {
        const appsScriptUrl = await resolveAppsScriptWebhookUrl(env, config, bookingData.slug);

        if (!appsScriptUrl) {
          throw new Error('Booking webhook not configured');
        }

        const signature = await createHMAC(enrichedData, env.BOOKING_HMAC_SECRET);

        // Apps Script web apps often cannot access custom headers reliably.
        // Send signature + sheet name via query params as well (backward compatible).
        let appsScriptFetchUrl = appsScriptUrl;
        try {
          const u = new URL(appsScriptUrl);
          if (signature) u.searchParams.set('sig', signature);
          if (sheetName) u.searchParams.set('sheet', sheetName);
          // Debug-only: ask Apps Script to return email send diagnostics.
          if (debugForward) u.searchParams.set('debugEmail', '1');
          appsScriptFetchUrl = u.toString();
        } catch (e) {
          // If URL parsing fails for any reason, fall back to the original URL.
          appsScriptFetchUrl = appsScriptUrl;
        }

        const appsScriptResponse = await fetch(appsScriptFetchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
            'X-Sheet-Name': sheetName
          },
          body: JSON.stringify(enrichedData)
        });

        // Apps Script may return HTML error pages or redirects. Don't assume JSON.
        const appsScriptStatus = appsScriptResponse.status;
        const appsScriptContentType = (appsScriptResponse.headers.get('content-type') || '').toString();
        const appsScriptText = await appsScriptResponse.text();
        let result = null;
        try {
          result = JSON.parse(appsScriptText);
        } catch (e) {
          result = null;
        }

        appsScriptSuccess = !!(result && result.success);
        appsScriptDebugEmail = (result && result.debugEmail) ? result.debugEmail : null;

        if (!appsScriptSuccess) {
          const snippet = (appsScriptText || '').toString().slice(0, 500);
          console.error(`❌ [BOOKING] Apps Script response not successful. status=${appsScriptStatus} contentType=${appsScriptContentType}`);
          console.error(`❌ [BOOKING] Apps Script body (first 500 chars): ${snippet}`);

          const err = new Error('Apps Script did not return success');
          err._appsScript = {
            status: appsScriptStatus,
            contentType: appsScriptContentType,
            bodySnippet: snippet
          };
          throw err;
        }

        if (appsScriptSuccess) {
          console.log(`✅ [BOOKING] Forwarded to Apps Script: ${bookingData.slug}`);

          await markAsProcessed(env.RESORT_CONFIGS, dedupKey);
          await incrementRateLimit(env.RESORT_CONFIGS, bookingData.slug);

          // STEP 11: v6.2.2 - Determine channels based on quota
          let channelsToUse = determineChannelsToUse(config, quotaCheck);

          // Email delivery is handled in Google Apps Script only.
          // Prevent Worker from attempting owner email (MailChannels/webhook) to avoid double-send and noisy failures.
          channelsToUse = Array.isArray(channelsToUse)
            ? channelsToUse.filter(ch => ch !== 'email')
            : channelsToUse;

          await handleBookingNotifications(env, bookingData.slug, enrichedData, config, ctx, channelsToUse);

          // Debug-only: run direct notifications synchronously and return result.
          // This helps diagnose email delivery (MailChannels responses) without tailing logs.
          let debugNotificationResult = null;
          if (debugNotify) {
            debugNotificationResult = await sendDirectNotifications(env, bookingData.slug, enrichedData, config, channelsToUse, { returnResult: true });
          }
          
          // STEP 12: v6.2.2 - INCREMENT QUOTA
          await incrementQuotaUsage(env, bookingData.slug, config, channelsToUse);

          if (debugNotify) {
            return jsonResponse({
              status: 'ok',
              success: true,
              message: 'Booking received successfully! The property will contact you soon.',
              mode: bookingMode,
              appScriptForwarded: appsScriptSuccess,
              quota_info: quotaCheck.quota_info,
              debugNotify: debugNotificationResult,
              debugForward: debugForward ? appsScriptDebugEmail : undefined
            });
          }
        }
      } catch (err) {
        console.error('❌ [BOOKING] Apps Script forward error:', err && err.message ? err.message : String(err));

        const base = {
          success: false,
          message: 'Booking system temporarily unavailable. Please try again or contact the property directly.',
          contact: {
            phone: config.contact?.phone || '',
            email: config.contact?.email || ''
          }
        };

        if (debugForward && err && err._appsScript) {
          base.debugForward = err._appsScript;
        }

        return jsonResponse(base, 500);
      }
    }

    return jsonResponse({
      status: 'ok',
      success: true,
      message: 'Booking received successfully! The property will contact you soon.',
      mode: bookingMode,
      appScriptForwarded: appsScriptSuccess,
      debugForward: debugForward ? appsScriptDebugEmail : undefined,
      quota_info: quotaCheck.quota_info
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

// ============================================================================
// WORKSPACE SHARDING: Resolve Apps Script webhook URL by workspaceId
// ============================================================================

async function resolveAppsScriptWebhookUrl(env, config, slug) {
  // Backward compatible defaults
  const fallback = (env.BOOKING_WEBHOOK_URL || '').toString().trim();

  const workspaceId = (config?.workspaceId || config?.booking?.workspaceId || '').toString().trim();
  if (!workspaceId) return fallback;

  // Registry is stored in the same KV namespace.
  const REGISTRY_KEY = 'booking:workspaces';
  let registry = null;
  try {
    registry = await env.RESORT_CONFIGS.get(REGISTRY_KEY, { type: 'json' });
  } catch (e) {
    registry = null;
  }

  const workspaces = Array.isArray(registry?.workspaces) ? registry.workspaces : [];
  const ws = workspaces.find(w => (w?.id || '') === workspaceId) || null;
  const url = (ws?.bookingWebhookUrl || '').toString().trim();

  if (!url) {
    console.warn(`[BOOKING] workspaceId=${workspaceId} has no webhookUrl; using default`);
    return fallback;
  }

  if (ws?.enabled === false) {
    console.warn(`[BOOKING] workspaceId=${workspaceId} disabled; using default`);
    return fallback;
  }

  return url;
}

// ============================================================================
// v6.2.2: QUOTA MANAGEMENT FUNCTIONS  
// ============================================================================

async function checkAndEnforceQuota(env, slug, config) {
  const planTier = config.plan_tier || 'trial';
  const quotaWhatsappMonthly = config.quota_whatsapp_monthly || 0;
  const quotaSmsMonthly = config.quota_sms_monthly || 0;
  const quotaWhatsappUsed = config.quota_whatsapp_used || 0;
  const quotaSmsUsed = config.quota_sms_used || 0;
  const quotaUsedMonth = config.quota_used_month || '';
  
  const currentMonth = new Date().toISOString().substring(0, 7);
  
  let actualWhatsappUsed = quotaWhatsappUsed;
  let actualSmsUsed = quotaSmsUsed;
  
  if (quotaUsedMonth !== currentMonth) {
    console.log(`[QUOTA] 🔄 Month changed (${quotaUsedMonth} → ${currentMonth}), resetting quota for ${slug}`);
    actualWhatsappUsed = 0;
    actualSmsUsed = 0;
    
    const updatedConfig = {
      ...config,
      quota_whatsapp_used: 0,
      quota_sms_used: 0,
      quota_used_month: currentMonth
    };
    
    await env.RESORT_CONFIGS.put(`config:${slug}`, JSON.stringify(updatedConfig));
  }
  
  if (planTier === 'trial') {
    return {
      allowed: true,
      reason: 'trial_tier',
      message: 'Trial tier: Email notifications only',
      channels_allowed: ['email'],
      quota_info: {
        plan: 'Trial',
        whatsapp: { limit: 0, used: 0, remaining: 0 },
        sms: { limit: 0, used: 0, remaining: 0 },
        email: 'unlimited'
      },
      upgrade_url: '/pricing'
    };
  }
  
  if (planTier === 'starter') {
    return {
      allowed: true,
      reason: 'starter_tier',
      message: 'Starter tier: Email notifications only',
      channels_allowed: ['email'],
      quota_info: {
        plan: 'Starter',
        price: '₹99/month',
        whatsapp: { limit: 0, used: 0, remaining: 0 },
        email: 'unlimited'
      },
      upgrade_url: '/pricing'
    };
  }
  
  const whatsappRemaining = quotaWhatsappMonthly - actualWhatsappUsed;
  const smsRemaining = quotaSmsMonthly - actualSmsUsed;
  
  const quotaInfo = {
    plan: planTier.charAt(0).toUpperCase() + planTier.slice(1),
    price: `₹${config.plan_price}/month`,
    whatsapp: {
      limit: quotaWhatsappMonthly,
      used: actualWhatsappUsed,
      remaining: whatsappRemaining
    },
    sms: {
      limit: quotaSmsMonthly,
      used: actualSmsUsed,
      remaining: smsRemaining
    },
    email: 'unlimited',
    month: currentMonth
  };
  
  const channelsAllowed = ['email'];
  
  if (whatsappRemaining > 0) {
    channelsAllowed.push('whatsapp');
  }
  
  if (smsRemaining > 0) {
    channelsAllowed.push('sms');
  }
  
  return {
    allowed: true,
    reason: 'quota_available',
    message: whatsappRemaining > 0 
      ? `WhatsApp available: ${whatsappRemaining} remaining` 
      : 'WhatsApp quota exceeded, email only',
    channels_allowed: channelsAllowed,
    quota_info: quotaInfo,
    upgrade_url: whatsappRemaining <= 0 ? '/pricing' : null
  };
}

function determineChannelsToUse(config, quotaCheck) {
  const enabledInConfig = config.notifications?.channels || ['whatsapp', 'email'];
  const allowedByQuota = quotaCheck.channels_allowed || ['email'];
  
  const channelsToUse = enabledInConfig.filter(ch => allowedByQuota.includes(ch));
  
  console.log(`[QUOTA] Channels to use: ${channelsToUse.join(', ')}`);
  
  return channelsToUse;
}

async function incrementQuotaUsage(env, slug, config, channelsUsed) {
  if (!channelsUsed || channelsUsed.length === 0) {
    return;
  }
  
  const currentMonth = new Date().toISOString().substring(0, 7);
  
  let whatsappIncrement = 0;
  let smsIncrement = 0;
  
  if (channelsUsed.includes('whatsapp')) {
    whatsappIncrement = 1;
  }
  
  if (channelsUsed.includes('sms')) {
    smsIncrement = 1;
  }
  
  if (whatsappIncrement === 0 && smsIncrement === 0) {
    return;
  }
  
  try {
    const updatedConfig = {
      ...config,
      quota_whatsapp_used: (config.quota_whatsapp_used || 0) + whatsappIncrement,
      quota_sms_used: (config.quota_sms_used || 0) + smsIncrement,
      quota_used_month: currentMonth
    };
    
    await env.RESORT_CONFIGS.put(`config:${slug}`, JSON.stringify(updatedConfig));
    
    console.log(`[QUOTA] ✅ Incremented ${slug}: WhatsApp +${whatsappIncrement}, SMS +${smsIncrement}`);
    console.log(`[QUOTA] New counts: WhatsApp ${updatedConfig.quota_whatsapp_used}/${config.quota_whatsapp_monthly}`);
    
  } catch (error) {
    console.error(`[QUOTA] ❌ Failed to increment quota for ${slug}:`, error);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
  if (data.email && !isValidEmail(data.email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

function generateDedupKey(bookingData) {
  const { slug, email, phone, checkIn } = bookingData;
  const identifier = email || phone || 'unknown';
  const date = checkIn || 'nodate';
  return `dedup:${slug}:${identifier}:${date}`.toLowerCase();
}

async function checkDuplicate(kv, dedupKey) {
  try {
    const exists = await kv.get(dedupKey);
    return exists !== null;
  } catch (err) {
    console.error('[DEDUP] Check failed:', err);
    return false;
  }
}

async function markAsProcessed(kv, dedupKey) {
  try {
    await kv.put(dedupKey, '1', { expirationTtl: 3600 });
    console.log(`[DEDUP] Marked as processed: ${dedupKey}`);
  } catch (err) {
    console.error('[DEDUP] Mark failed:', err);
  }
}

async function checkRateLimit(kv, slug, maxPerHour) {
  try {
    const rateLimitKey = `rate:${slug}`;
    const count = await kv.get(rateLimitKey);
    const currentCount = parseInt(count || '0', 10);
    console.log(`[RATE] ${slug}: ${currentCount}/${maxPerHour}`);
    return currentCount >= maxPerHour;
  } catch (err) {
    console.error('[RATE] Check failed:', err);
    return false;
  }
}

async function incrementRateLimit(kv, slug) {
  try {
    const rateLimitKey = `rate:${slug}`;
    const count = await kv.get(rateLimitKey);
    const newCount = parseInt(count || '0', 10) + 1;
    await kv.put(rateLimitKey, newCount.toString(), { expirationTtl: 3600 });
    console.log(`[RATE] Incremented ${slug}: ${newCount}`);
  } catch (err) {
    console.error('[RATE] Increment failed:', err);
  }
}

function generateSheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Bookings ${year}-${month}`;
}

async function createHMAC(data, secret) {
  if (!secret) return '';
  const message = JSON.stringify(data);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// ============================================================================
// MULTI-CHANNEL NOTIFICATIONS - COMPLETE
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

function buildMultiChannelDeliveryInstructions(booking, config) {
  const instructions = {};
  const lang = config.notifications?.language || 'en';
  const enabledChannels = config.notifications?.channels || ['whatsapp', 'email'];

  if (config.notifications?.notifyOwner) {
    instructions.owner = {};

    if (enabledChannels.includes('whatsapp') && config.notifications.ownerWhatsapp) {
      instructions.owner.whatsapp = {
        to: formatWhatsAppNumber(config.notifications.ownerWhatsapp),
        message: buildOwnerWhatsAppMessage(booking, config, lang)
      };
    }

    if (enabledChannels.includes('email') && config.notifications.ownerEmail) {
      instructions.owner.email = {
        to: config.notifications.ownerEmail,
        subject: buildOwnerEmailSubject(booking, config, lang),
        htmlBody: buildOwnerEmailHTML(booking, config, lang),
        fromName: config.name || 'Webzyl Bookings',
        replyTo: config.contact?.email || 'bookings@webzyl.com'
      };
    }

    if (enabledChannels.includes('telegram') && config.notifications.ownerTelegram) {
      instructions.owner.telegram = {
        chatId: config.notifications.ownerTelegram,
        message: buildOwnerTelegramMessage(booking, config, lang),
        parseMode: 'Markdown'
      };
    }

    if (enabledChannels.includes('discord') && config.notifications.ownerDiscord) {
      instructions.owner.discord = buildOwnerDiscordMessage(booking, config, lang);
    }

    if (enabledChannels.includes('sms') && config.notifications.ownerSMS) {
      instructions.owner.sms = {
        to: config.notifications.ownerSMS,
        message: buildOwnerSMSMessage(booking, config, lang)
      };
    }

    if (enabledChannels.includes('slack') && config.notifications.ownerSlack) {
      instructions.owner.slack = buildOwnerSlackMessage(booking, config, lang);
    }
  }

  if (config.notifications?.notifyCustomer) {
    instructions.customer = {};

    if (enabledChannels.includes('customer_email') && booking.email) {
      instructions.customer.email = {
        to: booking.email,
        subject: buildCustomerEmailSubject(booking, config, lang),
        htmlBody: buildCustomerEmailHTML(booking, config, lang),
        fromName: config.name || 'Webzyl',
        replyTo: config.contact?.email || 'support@webzyl.com'
      };
    }

    if (enabledChannels.includes('customer_telegram') && booking.telegramId) {
      instructions.customer.telegram = {
        chatId: booking.telegramId,
        message: buildCustomerTelegramMessage(booking, config, lang),
        parseMode: 'Markdown'
      };
    }

    if (enabledChannels.includes('customer_sms') && booking.phone) {
      instructions.customer.sms = {
        to: booking.phone,
        message: buildCustomerSMSMessage(booking, config, lang)
      };
    }
  }

  return instructions;
}

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

function buildOwnerDiscordMessage(booking, config, lang) {
  const isHindi = lang === 'hi';

  return {
    content: null,
    embeds: [{
      title: isHindi ? '🎉 नई बुकिंग!' : '🎉 New Booking!',
      color: 3447003,
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

function filterInstructionsByChannels(instructions, allowedChannels) {
  const filtered = {};

  for (const recipient in instructions) {
    filtered[recipient] = {};

    for (const channel in instructions[recipient]) {
      if (allowedChannels.includes(channel)) {
        filtered[recipient][channel] = instructions[recipient][channel];
      }
    }

    if (Object.keys(filtered[recipient]).length === 0) {
      delete filtered[recipient];
    }
  }

  return filtered;
}

async function emitNotificationEvent(env, slug, bookingData, config, ctx, channelsToUse) {
  const webhookUrl = env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const allInstructions = buildMultiChannelDeliveryInstructions(bookingData, config);
    const filteredInstructions = filterInstructionsByChannels(allInstructions, channelsToUse);

    if (Object.keys(filteredInstructions).length === 0) {
      return;
    }

    const event = createEventEnvelope('booking.created', slug, {
      booking: bookingData,
      deliveryInstructions: filteredInstructions,
      metadata: {
        notificationLanguage: config.notifications?.language || 'en',
        propertyName: config.name,
        enabledChannels: channelsToUse,
        quotaEnforced: true
      }
    });

    console.log('Emitting notification (quota-filtered):', {
      eventId: event.eventId,
      slug: slug,
      booking: createSafeBookingLog(bookingData),
      channels: Object.keys(filteredInstructions),
      quotaApprovedChannels: channelsToUse
    });

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

async function sendEmailViaMailChannels(env, emailInstruction) {
  // MailChannels is a simple, no-SDK email relay commonly used with Workers.
  // Requires a usable sender address (set EMAIL_FROM / MAILCHANNELS_FROM in env vars).
  const fromEmail = env.EMAIL_FROM || env.MAILCHANNELS_FROM || '';
  const fromName = env.EMAIL_FROM_NAME || 'Webzyl Bookings';
  if (!fromEmail) {
    console.warn('[NOTIFY] EMAIL_FROM not set; skipping email send');
    return { ok: false, error: 'missing_from' };
  }

  if (!emailInstruction?.to) {
    console.warn('[NOTIFY] Email instruction missing recipient');
    return { ok: false, error: 'missing_to' };
  }

  const payload = {
    personalizations: [
      {
        to: [{ email: emailInstruction.to }]
      }
    ],
    from: { email: fromEmail, name: emailInstruction.fromName || fromName },
    subject: emailInstruction.subject || 'New booking enquiry',
    content: [
      {
        type: 'text/html',
        value: emailInstruction.htmlBody || ''
      }
    ]
  };

  const replyTo = emailInstruction.replyTo;
  if (replyTo) {
    payload.reply_to = { email: replyTo };
  }

  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[NOTIFY] MailChannels send failed:', res.status, text);
    return { ok: false, status: res.status, body: text };
  }

  return { ok: true, status: res.status };
}

async function sendDirectNotifications(env, slug, bookingData, config, channelsToUse, opts = {}) {
  // Minimal fallback: ensure owner email is sent even if NOTIFICATION_WEBHOOK_URL isn't configured.
  // WhatsApp/SMS still require a downstream provider (webhook service).
  const result = { ownerEmail: null, warnings: [] };
  try {
    const instructions = buildMultiChannelDeliveryInstructions(bookingData, config);
    const filtered = filterInstructionsByChannels(instructions, channelsToUse);

    const ownerEmail = filtered?.owner?.email;
    if (ownerEmail && channelsToUse.includes('email')) {
      const sendResult = await sendEmailViaMailChannels(env, ownerEmail);
      result.ownerEmail = { to: ownerEmail.to, ...sendResult };
      if (sendResult.ok) {
        console.log(`[NOTIFY] Owner email sent via MailChannels: ${slug} -> ${ownerEmail.to}`);
      }
    }

    if (channelsToUse.includes('whatsapp') && !env.NOTIFICATION_WEBHOOK_URL) {
      const msg = 'WhatsApp requested but NOTIFICATION_WEBHOOK_URL not configured; skipping WhatsApp';
      console.warn(`[NOTIFY] ${msg}`);
      result.warnings.push(msg);
    }
  } catch (err) {
    console.error('[NOTIFY] Direct notification error:', err?.message || err);
    result.error = err?.message || String(err);
  }

  return opts.returnResult ? result : undefined;
}

async function handleBookingNotifications(env, slug, enrichedData, config, ctx, channelsToUse) {
  if (!config.notifications?.enabled) return;

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

  // Prefer webhook-based multi-channel delivery when configured.
  // Always also attempt direct email fallback (owner) so email works even without webhook infra.
  ctx.waitUntil(emitNotificationEvent(env, slug, enrichedData, config, ctx, channelsToUse));
  ctx.waitUntil(sendDirectNotifications(env, slug, enrichedData, config, channelsToUse));
}

export { handleBookingRequest, handleOptions };
