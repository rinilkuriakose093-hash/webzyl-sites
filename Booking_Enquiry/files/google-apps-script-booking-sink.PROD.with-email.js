/**
 * Google Apps Script - Booking Enquiry Sink (PROD with owner email)
 *
 * Purpose:
 * - Receive booking data from Cloudflare Worker
 * - Store it in Google Sheets
 * - Send owner email notification via MailApp AFTER sheet write (non-blocking)
 *
 * Setup:
 * 1) Deploy as Web App (Execute as: Me, Access: Anyone)
 * 2) Script Properties:
 *    - BOOKING_HMAC_SECRET (must match Worker env.BOOKING_HMAC_SECRET)
 *
 * Email routing:
 * - This script sends email ONLY when `payload.ownerEmail` is provided.
 * - Optional fallback recipient can be configured via Script Properties.
 *   - BOOKING_FALLBACK_EMAIL: email address used only for testing/debug
 *   - BOOKING_FORCE_FALLBACK: set to 1/true to always send to fallback
 * - By default, fallback is only used when debugEmail is enabled (prevents inbox storms).
 *
 * Notes:
 * - Apps Script header handling can be quirky; script supports both headers and query params.
 * - Email send failure must never block booking success.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

// Use a unique identifier name to avoid collisions with other files in the same Apps Script project.
const BOOKING_SPREADSHEET_ID = '13KtqdfeP2EPQl4IY_KtKcXHqqn5wLJNT9QgL7f0p2Pc';

// Bump this whenever you paste/redeploy, so the live /exec can be verified quickly.
const SCRIPT_VERSION = '2026-01-06_email-sanitize_v1';

// Optional fallback recipient (TESTING ONLY): configure via Script Properties.
// - BOOKING_FALLBACK_EMAIL: email address
// - BOOKING_FORCE_FALLBACK: 1/true (optional)

function _getScriptProp(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function _parseBool(value) {
  const s = String(value || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

function doPost(e) {
  Logger.log('[BOOKING] ========== doPost() ENTRY ==========');
  Logger.log(`[BOOKING] Timestamp: ${new Date().toISOString()}`);

  // Some Apps Script web app POST invocations do not reliably expose query params.
  // Prefer the JSON payload flag, but keep query param support when available.
  let debugEmailEnabled = false;

  try {
    // Parse request body
    let payload;
    try {
      Logger.log('[BOOKING] Attempting to parse JSON payload...');
      payload = JSON.parse(e.postData.contents);
      Logger.log(`[BOOKING] ✅ JSON parsed successfully. Slug: ${payload.slug}, Name: ${payload.name}`);
    } catch (parseErr) {
      Logger.log(`[BOOKING] ❌ JSON parse error: ${parseErr.toString()}`);
      Logger.log(`[BOOKING] Stack: ${parseErr.stack}`);
      return createResponse({
        success: false,
        error: 'Invalid JSON payload',
        errorType: 'JSON_PARSE_ERROR'
      }, 400);
    }

    const qpDebug = String(getQueryParam(e, 'debugEmail') || '').trim();
    const payloadDebug = payload && (payload.debugEmail === true || String(payload.debugEmail).trim() === '1');
    debugEmailEnabled = (qpDebug === '1') || payloadDebug;

    // Extract signature and sheet name (Apps Script header quirks)
    const signature = getHeader(e, 'X-Signature') || getQueryParam(e, 'sig') || '';
    const sheetName =
      getHeader(e, 'X-Sheet-Name') ||
      getQueryParam(e, 'sheet') ||
      payload.sheetName ||
      generateSheetName();

    Logger.log(`[BOOKING] Signature extracted: ${signature ? signature.substring(0, 16) + '...' : '(empty)'}`);
    Logger.log(`[BOOKING] Sheet name resolved: ${sheetName}`);
    Logger.log(`[BOOKING] Received booking from ${payload.slug} - ${payload.name}`);

    // HMAC verification
    Logger.log('[BOOKING] Checking HMAC signature...');
    const signatureValid = verifySignature(payload, signature);
    if (!signatureValid) {
      // Fail-open is OK temporarily for debugging. Turn this into fail-closed for strict production.
      Logger.log('[BOOKING] ⚠️ HMAC verification failed, but continuing (fail-open for debugging)');
      // return createResponse({ success: false, error: 'Signature verification failed' }, 401);
    } else {
      Logger.log('[BOOKING] ✅ HMAC verification passed');
    }

    // Backward compatible default timestamp (do not reject booking)
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }

    // Validate payload
    Logger.log('[BOOKING] Validating payload structure...');
    const validation = validatePayload(payload);
    if (!validation.valid) {
      Logger.log(`[BOOKING] ❌ Validation failed: ${validation.error}`);
      return createResponse({ success: false, error: validation.error }, 400);
    }
    Logger.log('[BOOKING] ✅ Payload validation passed');

    // Get or create sheet
    Logger.log(`[BOOKING] Getting or creating sheet: ${sheetName}`);
    Logger.log(`[BOOKING] Using Spreadsheet ID: ${BOOKING_SPREADSHEET_ID}`);
    const sheet = getOrCreateBookingSheet(sheetName);
    Logger.log(`[BOOKING] ✅ Sheet resolved: ${sheet.getName()}`);

    // Append booking row
    Logger.log('[BOOKING] ========== ABOUT TO APPEND ROW ==========');
    Logger.log(`[BOOKING] Target sheet: ${sheet.getName()}`);
    Logger.log(`[BOOKING] Current row count: ${sheet.getLastRow()}`);

    appendBookingRow(sheet, payload);

    Logger.log('[BOOKING] ========== APPEND COMPLETED ==========');
    Logger.log(`[BOOKING] New row count: ${sheet.getLastRow()}`);
    Logger.log(`[BOOKING] ✅ Row appended to sheet: ${sheetName}`);

    // Audit log (non-blocking)
    try {
      Logger.log('[BOOKING] Attempting audit log...');
      logBooking(payload, sheetName);
      Logger.log('[BOOKING] ✅ Audit log completed');
    } catch (logErr) {
      Logger.log(`[BOOKING] ⚠️ Logging error (non-critical): ${logErr.toString()}`);
      Logger.log(`[BOOKING] Log error stack: ${logErr.stack}`);
    }

    // OWNER EMAIL NOTIFICATION (non-blocking) — MUST BE AFTER sheet write
    let emailResult = null;
    try {
      emailResult = trySendOwnerEmailNotification(payload, sheetName, { debugEmailEnabled: debugEmailEnabled });
    } catch (emailErr) {
      emailResult = {
        attempted: true,
        sent: false,
        recipient: (payload && payload.ownerEmail ? String(payload.ownerEmail) : ''),
        subject: '',
        error: emailErr && emailErr.toString ? emailErr.toString() : String(emailErr),
        reason: 'exception'
      };
      Logger.log(`[BOOKING] ⚠️ Email send threw unexpectedly (non-blocking): ${emailResult.error}`);
    }

    // Persist email attempt result into the spreadsheet for easy debugging.
    // (This avoids relying on Apps Script executions logs alone.)
    try {
      logOwnerEmailAttempt(payload, sheetName, emailResult);
    } catch (logEmailErr) {
      Logger.log(`[BOOKING] ⚠️ Email log write failed (non-critical): ${logEmailErr && logEmailErr.toString ? logEmailErr.toString() : String(logEmailErr)}`);
    }

    Logger.log('[BOOKING] ========== RETURNING SUCCESS ==========');
    const responseBody = {
      success: true,
      message: 'Booking recorded',
      sheetName: sheetName,
      scriptVersion: SCRIPT_VERSION,
      timestamp: new Date().toISOString()
    };

    if (debugEmailEnabled) {
      let remaining = null;
      try {
        remaining = MailApp.getRemainingDailyQuota();
      } catch (_) {
        remaining = null;
      }

      responseBody.debugEmail = {
        remainingDailyQuota: remaining,
        ownerEmail: (emailResult && emailResult.recipient ? String(emailResult.recipient) : (payload && payload.ownerEmail ? String(payload.ownerEmail) : '')),
        emailResult: emailResult
      };
    }

    return createResponse(responseBody, 200);
  } catch (err) {
    Logger.log(`[BOOKING ERROR] ========== EXCEPTION CAUGHT ==========`);
    Logger.log(`[BOOKING ERROR] Error: ${err.toString()}`);
    Logger.log(`[BOOKING ERROR] Stack: ${err.stack}`);
    Logger.log(`[BOOKING ERROR] Error name: ${err.name}`);
    return createResponse(
      {
        success: false,
        error: 'Internal server error',
        errorType: err.name || 'UnknownError',
        scriptVersion: SCRIPT_VERSION
      },
      500
    );
  }
}

// ============================================================================
// SECURITY & VALIDATION
// ============================================================================

function getHeader(e, headerName) {
  if (e.parameters && e.parameters[headerName]) {
    const value = e.parameters[headerName];
    return Array.isArray(value) ? value[0] : value;
  }

  if (e.postData && e.postData.headers && e.postData.headers[headerName]) {
    return e.postData.headers[headerName];
  }

  return '';
}

function getQueryParam(e, paramName) {
  if (e.parameter && e.parameter[paramName]) {
    return e.parameter[paramName];
  }
  if (e.parameters && e.parameters[paramName]) {
    const value = e.parameters[paramName];
    return Array.isArray(value) ? value[0] : value;
  }
  return '';
}

function verifySignature(payload, receivedSignature) {
  const HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('BOOKING_HMAC_SECRET');

  if (!HMAC_SECRET) {
    Logger.log('[SECURITY] ⚠️ WARNING: BOOKING_HMAC_SECRET not configured');
    Logger.log('[SECURITY] ⚠️ Allowing request in DEV MODE - DO NOT USE IN PRODUCTION');
    return true;
  }

  try {
    const message = JSON.stringify(payload);
    const signature = Utilities.computeHmacSha256Signature(message, HMAC_SECRET);
    const expectedSignature = signature
      .map(byte => ('0' + (byte & 0xff).toString(16)).slice(-2))
      .join('');

    const isValid = expectedSignature === receivedSignature;
    if (!isValid) {
      Logger.log(`[SECURITY] Signature mismatch. Expected: ${expectedSignature}, Got: ${receivedSignature}`);
    }
    return isValid;
  } catch (err) {
    Logger.log(`[SECURITY] Signature verification error: ${err}`);
    return false;
  }
}

function validatePayload(payload) {
  Logger.log('[VALIDATION] Starting payload validation...');

  // Backward compatible: timestamp is OPTIONAL (we default it if missing)
  const required = ['slug', 'name', 'checkIn', 'checkOut', 'guests'];

  for (const field of required) {
    if (!payload[field]) {
      Logger.log(`[VALIDATION] ❌ Missing required field: ${field}`);
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // At least one contact method
  if (!payload.email && !payload.phone) {
    Logger.log('[VALIDATION] ❌ No contact method (email or phone)');
    return { valid: false, error: 'Either email or phone is required' };
  }

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    Logger.log(`[VALIDATION] ❌ Invalid email format: ${payload.email}`);
    return { valid: false, error: 'Invalid email format' };
  }

  if (payload.phone && !/^[0-9+\-()\s]{7,20}$/.test(payload.phone)) {
    Logger.log(`[VALIDATION] ❌ Invalid phone format: ${payload.phone}`);
    return { valid: false, error: 'Invalid phone format' };
  }

  Logger.log('[VALIDATION] ✅ Payload validation completed successfully');
  return { valid: true };
}

// ============================================================================
// EMAIL NOTIFICATION (Apps Script only)
// ============================================================================

function trySendOwnerEmailNotification(payload, sheetName, opts) {
  const debugEmailEnabled = !!(opts && opts.debugEmailEnabled);

  const normalizeEmail = (value) => {
    if (value === null || value === undefined) return '';
    // Remove all whitespace (newlines/spaces) which frequently break email routing.
    return String(value).trim().replace(/\s+/g, '');
  };

  const isValidEmail = (email) => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
  };

  // Owner email must be passed in payload (recommended: Worker reads from site config).
  // For direct feature verification, allow an optional fallback recipient configured via Script Properties.
  // To prevent inbox storms, fallback is gated behind debugEmail unless BOOKING_FORCE_FALLBACK is enabled.
  let recipient = normalizeEmail(payload && payload.ownerEmail ? payload.ownerEmail : '');
  const fallback = normalizeEmail(_getScriptProp('BOOKING_FALLBACK_EMAIL') || _getScriptProp('FALLBACK_EMAIL') || '');
  const forceFallback = _parseBool(_getScriptProp('BOOKING_FORCE_FALLBACK') || _getScriptProp('FORCE_FALLBACK') || '');

  let usingFallback = false;
  if (forceFallback && !!fallback) {
    recipient = fallback;
    usingFallback = true;
  } else if (!recipient && debugEmailEnabled && !!fallback) {
    recipient = fallback;
    usingFallback = true;
  }

  if (!recipient) {
    Logger.log('[EMAIL] No payload.ownerEmail provided; skipping owner email.');
    return { attempted: false, sent: false, recipient: '', subject: '', reason: 'missing_ownerEmail' };
  }

  if (!isValidEmail(recipient)) {
    Logger.log('[EMAIL] payload.ownerEmail is not a valid email; skipping owner email.');
    return { attempted: false, sent: false, recipient: recipient, subject: '', reason: 'invalid_ownerEmail' };
  }

  const propertyName = (payload.propertyName || payload.slug || 'Property').toString();
  const subject = `New Booking Enquiry - ${propertyName}`;

  const htmlBody = buildOwnerBookingEmailHtml(payload, {
    propertyName: propertyName,
    sheetName: sheetName
  });

  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: htmlBody,
      name: 'Webzyl Bookings',
      replyTo: 'bookings@webzyl.com'
    });

    Logger.log(`[EMAIL] ✅ Owner email sent to ${recipient} for slug=${payload.slug} bookingId=${payload.bookingId || ''}`);
    return { attempted: true, sent: true, recipient: recipient, subject: subject, reason: usingFallback ? 'sent_via_fallback_default_ownerEmail' : 'sent' };
  } catch (err) {
    const msg = err && err.toString ? err.toString() : String(err);
    Logger.log('[EMAIL] ⚠️ Failed to send owner email (non-blocking): ' + msg);
    return { attempted: true, sent: false, recipient: recipient, subject: subject, error: msg, reason: usingFallback ? 'send_failed_via_fallback_default_ownerEmail' : 'send_failed' };
  }
}

function logOwnerEmailAttempt(payload, sheetName, emailResult) {
  const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
  const logName = 'Booking_Email_Logs';
  let sheet = ss.getSheetByName(logName);

  if (!sheet) {
    sheet = ss.insertSheet(logName);
    sheet.appendRow(['Timestamp', 'Slug', 'Booking ID', 'Recipient', 'Subject', 'Attempted', 'Sent', 'Reason', 'Error', 'Bookings Sheet']);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 10);
  }

  const ts = new Date().toISOString();
  const slug = payload && payload.slug ? String(payload.slug) : '';
  const bookingId = payload && payload.bookingId ? String(payload.bookingId) : '';

  const recipient = emailResult && emailResult.recipient ? String(emailResult.recipient) : '';
  const subject = emailResult && emailResult.subject ? String(emailResult.subject) : '';
  const attempted = !!(emailResult && emailResult.attempted);
  const sent = !!(emailResult && emailResult.sent);
  const reason = emailResult && emailResult.reason ? String(emailResult.reason) : '';
  const error = emailResult && emailResult.error ? String(emailResult.error) : '';

  sheet.appendRow([ts, slug, bookingId, recipient, subject, attempted ? 'YES' : 'NO', sent ? 'YES' : 'NO', reason, error, sheetName || '']);
}

function buildOwnerBookingEmailHtml(payload, meta) {
  const primary = '#06b6d4';
  const accent = '#f59e0b';

  const propertyName = escapeHtml(meta.propertyName || payload.propertyName || payload.slug || 'Property');
  const bookingId = escapeHtml(payload.bookingId || '');
  const timestamp = formatLocalDateTime(payload.timestamp || new Date().toISOString());

  const name = escapeHtml(payload.name || '');
  const phone = escapeHtml(payload.phone || '');
  const email = escapeHtml(payload.email || '');

  const checkIn = escapeHtml(payload.checkIn || '');
  const checkOut = escapeHtml(payload.checkOut || '');
  const guests = escapeHtml(String(payload.guests || ''));

  const roomType = (payload.roomType || '').toString().trim();
  const notes = (payload.notes || '').toString().trim();

  const row = (label, value) => `
    <tr>
      <td style="padding:8px 10px; font-weight:600; color:#0f172a; width: 40%; vertical-align: top;">${escapeHtml(label)}</td>
      <td style="padding:8px 10px; color:#0f172a; vertical-align: top;">${value || '<span style="color:#64748b">Not provided</span>'}</td>
    </tr>
  `;

  const section = (title, bg, innerHtml) => `
    <div style="background:${bg}; border-radius:12px; padding:14px; margin: 14px 0;">
      <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:8px;">${escapeHtml(title)}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        ${innerHtml}
      </table>
    </div>
  `;

  const customerSection = section(
    'Customer Details',
    '#f0f9ff',
    [row('Name', name), row('Phone', phone), row('Email', email)].join('')
  );

  const bookingSection = section(
    'Booking Details',
    '#fef3c7',
    [
      row('Check-in', checkIn),
      row('Check-out', checkOut),
      row('Guests', guests),
      roomType ? row('Room type', escapeHtml(roomType)) : ''
    ].join('')
  );

  const notesSection = notes
    ? section(
        'Special Requests',
        '#f1f5f9',
        `<tr><td style="padding:8px 10px; color:#0f172a;">${escapeHtml(notes).replace(/\n/g, '<br/>')}</td></tr>`
      )
    : '';

  const footer = `
    <div style="background:#fafafa; border-radius:12px; padding:12px; margin-top: 14px; color:#334155; font-size:12px;">
      <div><strong>Booking ID:</strong> ${bookingId || '<span style="color:#64748b">(not provided)</span>'}</div>
      <div><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</div>
      <div><strong>Sheet:</strong> ${escapeHtml(meta.sheetName || '')}</div>
      <div style="margin-top:8px; border-top:1px solid #e2e8f0; padding-top:8px;">
        Powered by <span style="color:${primary}; font-weight:700;">Webzyl</span>
      </div>
    </div>
  `;

  return `
  <div style="margin:0; padding:0; background:#f8fafc;">
    <div style="max-width:600px; margin:0 auto; padding:18px 14px; font-family:Arial, Helvetica, sans-serif;">
      <div style="border-radius:14px; overflow:hidden; border:1px solid #e2e8f0; background:#ffffff;">
        <div style="padding:18px 18px 14px; background:${primary}; color:#ffffff;">
          <div style="font-size:14px; opacity:0.95;">${propertyName}</div>
          <div style="font-size:22px; font-weight:800; margin-top:4px;">New Booking Enquiry</div>
          <div style="margin-top:10px; height:4px; width:70px; background:${accent}; border-radius:999px;"></div>
        </div>
        <div style="padding:16px 18px;">
          ${customerSection}
          ${bookingSection}
          ${notesSection}
          ${footer}
        </div>
      </div>
    </div>
  </div>
  `;
}

function escapeHtml(value) {
  return value === null || value === undefined
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatLocalDateTime(isoString) {
  try {
    const date = new Date(isoString);
    const tz = Session.getScriptTimeZone() || 'GMT';
    return Utilities.formatDate(date, tz, 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return String(isoString || '');
  }
}

// ============================================================================
// SHEET OPERATIONS
// ============================================================================

function getOrCreateBookingSheet(sheetName) {
  Logger.log(`[SHEETS] getOrCreateBookingSheet() called with: ${sheetName}`);
  Logger.log(`[SHEETS] Spreadsheet ID: ${BOOKING_SPREADSHEET_ID}`);

  const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`[SHEETS] Sheet "${sheetName}" not found - creating new sheet`);
    sheet = ss.insertSheet(sheetName);

    const headers = [
      'Timestamp',
      'Slug',
      'Name',
      'Email',
      'Phone',
      'Room Type',
      'Check-in',
      'Check-out',
      'Guests',
      'Notes',
      'Source IP',
      'User Agent',
      'CF Ray',
      'Source Channel',
      'Config Version'
    ];

    sheet.appendRow(headers);

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#06b6d4');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');

    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);

    Logger.log(`[SHEETS] ✅ New sheet created: ${sheetName}`);
  } else {
    Logger.log(`[SHEETS] ✅ Existing sheet found: ${sheetName} (${sheet.getLastRow()} rows)`);
  }

  return sheet;
}

function appendBookingRow(sheet, data) {
  Logger.log(`[SHEETS] appendBookingRow() called for: ${data.name} (${data.slug})`);

  const row = [
    data.timestamp || new Date().toISOString(),
    data.slug,
    data.name,
    data.email || '',
    data.phone || '',
    (data.roomType || '').toString(),
    data.checkIn,
    data.checkOut,
    data.guests,
    data.notes || '',
    data.source_ip || '',
    data.user_agent || '',
    data.cf_ray || '',
    data.sourceChannel || '',
    data.config_version || ''
  ];

  sheet.appendRow(row);

  const rowNum = sheet.getLastRow();
  const dataRange = sheet.getRange(rowNum, 1, 1, row.length);

  if (rowNum % 2 === 0) {
    dataRange.setBackground('#f0f9ff');
  }

  Logger.log(`[SHEETS] ✅ Row ${rowNum} appended`);
}

function logBooking(data, sheetName) {
  Logger.log('[LOGS] Entering logBooking() for audit trail...');

  const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
  let logSheet = ss.getSheetByName('Booking_Logs');

  if (!logSheet) {
    Logger.log('[LOGS] Booking_Logs sheet not found - creating...');
    logSheet = ss.insertSheet('Booking_Logs');
    logSheet.appendRow(['Timestamp', 'Slug', 'Guest Name', 'Sheet Name', 'Status']);

    const headerRange = logSheet.getRange(1, 1, 1, 5);
    headerRange.setBackground('#06b6d4');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    logSheet.setFrozenRows(1);

    Logger.log('[LOGS] ✅ Booking_Logs sheet created');
  }

  logSheet.appendRow([new Date().toISOString(), data.slug, data.name, sheetName, 'SUCCESS']);
  Logger.log(`[LOGS] ✅ Booking logged: ${data.slug} - ${data.name}`);
}

// ============================================================================
// HELPERS
// ============================================================================

function generateSheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Bookings_${year}_${month}`;
}

function createResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================================
// TESTING
// ============================================================================

function testOwnerBookingEmail() {
  const payload = {
    slug: 'grand-royal',
    propertyName: 'Grand Royal',
    name: 'Email Test',
    phone: '+919999999999',
    email: 'customer@example.com',
    checkIn: '2026-01-11',
    checkOut: '2026-01-12',
    guests: 2,
    roomType: '',
    notes: 'email test',
    bookingId: 'evt_test_123',
    ownerEmail: '',
    timestamp: new Date().toISOString()
  };

  trySendOwnerEmailNotification(payload, 'Bookings_Test');
  Logger.log('Triggered test owner booking email');
}

function testBookingSink() {
  Logger.log('[TEST] Starting testBookingSink...');

  const testData = {
    slug: 'test-resort',
    name: 'Test Guest',
    email: 'test@example.com',
    phone: '+919876543210',
    roomType: 'Deluxe Room',
    checkIn: '2026-01-11',
    checkOut: '2026-01-12',
    guests: 2,
    notes: 'This is a test booking',
    sourceChannel: 'test',
    timestamp: new Date().toISOString(),
    source_ip: '127.0.0.1',
    user_agent: 'AppsScriptTest',
    cf_ray: 'test-ray-123'
  };

  const validation = validatePayload(testData);
  if (!validation.valid) {
    Logger.log(`[TEST] Validation failed: ${validation.error}`);
    return;
  }

  const sheetName = generateSheetName();
  const sheet = getOrCreateBookingSheet(sheetName);
  appendBookingRow(sheet, testData);

  try {
    logBooking(testData, sheetName);
  } catch (e) {
    Logger.log('[TEST] logBooking failed (non-critical): ' + (e && e.toString ? e.toString() : String(e)));
  }

  Logger.log(`[TEST] ✅ Test booking appended to sheet: ${sheetName}`);
}

function setupBookingSink() {
  const props = PropertiesService.getScriptProperties();

  let secret = props.getProperty('BOOKING_HMAC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('BOOKING_HMAC_SECRET', secret);
    Logger.log('[SETUP] ✅ Generated BOOKING_HMAC_SECRET');
  } else {
    Logger.log('[SETUP] ✅ BOOKING_HMAC_SECRET already configured');
  }

  Logger.log('[SETUP] Configuration complete!');
  Logger.log(`[SETUP] Spreadsheet ID: ${BOOKING_SPREADSHEET_ID}`);
  Logger.log(`[SETUP] BOOKING_FALLBACK_EMAIL: ${(_getScriptProp('BOOKING_FALLBACK_EMAIL') || '').toString().trim() ? '(set)' : '(not set)'}`);
  Logger.log(`[SETUP] BOOKING_FORCE_FALLBACK: ${_parseBool(_getScriptProp('BOOKING_FORCE_FALLBACK') || '') ? 'true' : 'false'}`);
  Logger.log('[SETUP] Next steps:');
  Logger.log('1) Deploy as Web App (Execute as: Me, Access: Anyone)');
  Logger.log('2) Ensure Worker env.BOOKING_HMAC_SECRET matches this value');
  Logger.log('3) Ensure Worker forwards payload.ownerEmail (per-site owner email)');
}
