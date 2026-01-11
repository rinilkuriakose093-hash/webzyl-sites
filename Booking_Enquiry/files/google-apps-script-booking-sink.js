/**
 * PHASE 5 — BOOKING INGESTION PIPELINE
 * Status: FROZEN
 * Last verified: 2025-12-23
 * Notes:
 * - End-to-end booking flow verified
 * - Worker → Apps Script → Google Sheets
 * - Do not modify unless fixing a production bug
 */

/**
 * GOOGLE APPS SCRIPT - Booking Sink
 * Phase 4: Booking Enquiry Backend
 * 
 * Responsibilities:
 * - Receive booking data from Cloudflare Worker
 * - Verify HMAC signature
 * - Append to month-based Booking sheets
 * - Return success/failure status
 * 
 * Setup:
 * 1. Create new Apps Script project
 * 2. Deploy as Web App
 * 3. Set BOOKING_HMAC_SECRET in Script Properties
 * 4. Share spreadsheet with script
 */

// Configuration - Set via Script Properties
// Use a unique identifier name to avoid collisions with other files in the same Apps Script project.
const BOOKING_SPREADSHEET_ID = '11HZ5wB5kWa0yAqsI3xuajrN4CN0m7noYr3QjrIYybHs'; // Your Google Sheet ID
const HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('BOOKING_HMAC_SECRET');

/**
 * Main entry point for HTTP POST requests
 */
function doPost(e) {
  try {
    // Parse request
    const payload = JSON.parse(e.postData.contents);
    const signature = e.parameter['X-Signature'] || '';
    // Backward compatible:
    // - Historically sheetName is passed as query param X-Sheet-Name
    // - Newer payloads may include sheetName field
    const sheetName = payload.sheetName || e.parameter['X-Sheet-Name'] || generateSheetName();
    
    // Verify HMAC signature
    if (HMAC_SECRET && !verifySignature(payload, signature)) {
      return createResponse({
        success: false,
        error: 'Invalid signature'
      }, 401);
    }
    
    // Validate payload structure
    const validation = validatePayload(payload);
    if (!validation.valid) {
      return createResponse({
        success: false,
        error: validation.error
      }, 400);
    }

    // Backward compatible default timestamp if missing (do not reject booking)
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }
    
    // Get or create sheet
    const sheet = getOrCreateBookingSheet(sheetName);
    
    // Append booking row
    appendBookingRow(sheet, payload);
    
    // Log successful booking
    logBooking(payload, sheetName);

    // Email notification (ZERO-OPS): send via Google Apps Script only.
    // Must happen AFTER sheet write; must not block booking success.
    trySendOwnerEmailNotification(payload, sheetName);
    
    return createResponse({
      success: true,
      message: 'Booking recorded',
      sheetName: sheetName,
      bookingId: payload.bookingId || '',
      timestamp: new Date().toISOString()
    }, 200);
    
  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return createResponse({
      success: false,
      error: 'Internal server error'
    }, 500);
  }
}

/**
 * Verify HMAC signature
 */
function verifySignature(payload, receivedSignature) {
  if (!HMAC_SECRET) {
    Logger.log('WARNING: HMAC_SECRET not configured');
    return true; // Allow in dev, but log warning
  }
  
  try {
    const message = JSON.stringify(payload);
    const signature = Utilities.computeHmacSha256Signature(message, HMAC_SECRET);
    const expectedSignature = signature.map(byte => {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
    
    return expectedSignature === receivedSignature;
  } catch (error) {
    Logger.log('Signature verification error: ' + error.toString());
    return false;
  }
}

/**
 * Validate incoming payload
 */
function validatePayload(payload) {
  // Backward compatible: older payloads included timestamp; newer payloads may omit it.
  const required = ['slug', 'name', 'checkIn', 'checkOut', 'guests'];
  
  for (const field of required) {
    if (!payload[field]) {
      return {
        valid: false,
        error: `Missing required field: ${field}`
      };
    }
  }
  
  // At least one contact method
  if (!payload.email && !payload.phone) {
    return {
      valid: false,
      error: 'Either email or phone is required'
    };
  }
  
  return { valid: true };
}

/**
 * Send a professional owner email notification.
 *
 * Design requirements:
 * - MUST be sent from Apps Script (MailApp), not Worker
 * - Trigger AFTER successful sheet write
 * - Email failure must NOT break booking (log only)
 * - Zero external dependencies
 */
function trySendOwnerEmailNotification(payload, sheetName) {
  try {
    // Option A (recommended): Worker passes per-site ownerEmail in the payload.
    // No global fallback is used to prevent inbox storms.
    const to = (payload.ownerEmail || '').trim();
    if (!to) {
      Logger.log('[EMAIL] No payload.ownerEmail provided; skipping owner email.');
      return;
    }

    const propertyName = (payload.propertyName || payload.slug || 'Property').toString();
    const subject = `🔔 New Booking Enquiry – ${propertyName}`;

    const htmlBody = buildOwnerBookingEmailHtml(payload, {
      propertyName: propertyName,
      sheetName: sheetName
    });

    // MailApp sender is the Apps Script account; set display name + reply-to.
    // Note: MailApp doesn't guarantee a custom From address; replyTo is the reliable control.
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: htmlBody,
      name: 'Webzyl Bookings',
      replyTo: 'bookings@webzyl.com'
    });

    Logger.log(`[EMAIL] Owner notification sent to ${to} for slug=${payload.slug} bookingId=${payload.bookingId || ''}`);
  } catch (error) {
    Logger.log('[EMAIL] Failed to send owner notification: ' + (error && error.toString ? error.toString() : String(error)));
  }
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

  const hasEmail = !!email;
  const hasRoomType = !!roomType;
  const hasNotes = !!notes;

  const row = (label, value, icon) => `
    <tr>
      <td style="padding:8px 10px; font-weight:600; color:#0f172a; width: 40%; vertical-align: top;">${icon} ${label}</td>
      <td style="padding:8px 10px; color:#0f172a; vertical-align: top;">${value || '<span style=\"color:#64748b\">Not provided</span>'}</td>
    </tr>
  `;

  const section = (title, bg, innerHtml) => `
    <div style="background:${bg}; border-radius:12px; padding:14px; margin: 14px 0;">
      <div style="font-size:14px; font-weight:700; color:#0f172a; margin-bottom:8px;">${title}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        ${innerHtml}
      </table>
    </div>
  `;

  const customerSection = section(
    '👤 Customer Details',
    '#f0f9ff',
    [
      row('Name', name, '✅'),
      row('Phone', phone, '📞'),
      hasEmail ? row('Email', email, '📧') : ''
    ].join('')
  );

  const bookingSection = section(
    '📅 Booking Details',
    '#fef3c7',
    [
      row('Check-in', checkIn, '📅'),
      row('Check-out', checkOut, '📅'),
      row('Guests', guests, '👥'),
      hasRoomType ? row('Room type', escapeHtml(roomType), '🛏️') : ''
    ].join('')
  );

  const notesSection = hasNotes
    ? section(
        '📝 Special Requests',
        '#f1f5f9',
        `<tr><td style="padding:8px 10px; color:#0f172a;">${escapeHtml(notes).replace(/\n/g, '<br/>')}</td></tr>`
      )
    : '';

  const footer = `
    <div style="background:#fafafa; border-radius:12px; padding:12px; margin-top: 14px; color:#334155; font-size:12px;">
      <div><strong>Booking ID:</strong> ${bookingId || '<span style="color:#64748b">(not provided)</span>'}</div>
      <div><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</div>
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
  return (value === null || value === undefined)
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

/**
 * Get or create booking sheet for current month
 */
function getOrCreateBookingSheet(sheetName) {
  const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    // Create new sheet
    sheet = ss.insertSheet(sheetName);
    
    // Add headers
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
    
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Format header row
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#06b6d4');
    headerRange.setFontColor('#ffffff');
    
    // Freeze header row
    sheet.setFrozenRows(1);
    
    // Auto-resize columns
    sheet.autoResizeColumns(1, headers.length);
    
    Logger.log('Created new booking sheet: ' + sheetName);
  }
  
  return sheet;
}

/**
 * Append booking row to sheet
 */
function appendBookingRow(sheet, data) {
  const row = [
    data.timestamp || new Date().toISOString(),
    data.slug || '',
    data.name || '',
    data.email || '',
    data.phone || '',
    data.roomType || 'Not specified',
    data.checkIn || '',
    data.checkOut || '',
    data.guests || 0,
    data.notes || '',
    data.source_ip || '',
    data.user_agent || '',
    data.cf_ray || '',
    data.sourceChannel || 'microsite',
    data.config_version || ''
  ];
  
  sheet.appendRow(row);
  
  // Format the new row
  const lastRow = sheet.getLastRow();
  
  // Alternate row colors for readability
  if (lastRow % 2 === 0) {
    sheet.getRange(lastRow, 1, 1, row.length).setBackground('#f0f9ff');
  }
  
  // Format date columns
  sheet.getRange(lastRow, 7).setNumberFormat('yyyy-mm-dd'); // Check-in
  sheet.getRange(lastRow, 8).setNumberFormat('yyyy-mm-dd'); // Check-out
  
  Logger.log('Appended booking: ' + data.name + ' for ' + data.slug);
}

/**
 * Log booking to separate log sheet
 */
function logBooking(data, sheetName) {
  try {
    const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
    let logSheet = ss.getSheetByName('Booking_Logs');
    
    if (!logSheet) {
      logSheet = ss.insertSheet('Booking_Logs');
      logSheet.appendRow(['Timestamp', 'Slug', 'Guest Name', 'Sheet Name', 'Status']);
      logSheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
      logSheet.setFrozenRows(1);
    }
    
    logSheet.appendRow([
      new Date().toISOString(),
      data.slug,
      data.name,
      sheetName,
      'SUCCESS'
    ]);
  } catch (error) {
    Logger.log('Failed to write to log: ' + error.toString());
  }
}

/**
 * Generate sheet name in format: Bookings_YYYY_MM
 */
function generateSheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Bookings_${year}_${month}`;
}

/**
 * Create HTTP response
 */
function createResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  
  // Note: Apps Script doesn't support custom HTTP status codes
  // Status is communicated via the response body
  return output;
}

/**
 * Test function - can be run manually
 */
function testBookingSink() {
  const testPayload = {
    slug: 'test-resort',
    propertyName: 'Test Resort',
    name: 'Test Guest',
    email: 'test@example.com',
    phone: '+919876543210',
    roomType: 'Deluxe Room',
    checkIn: '2025-01-15',
    checkOut: '2025-01-17',
    guests: 2,
    notes: 'Test booking',
    ownerEmail: 'owner@example.com',
    bookingId: 'evt_1234567890_abc',
    timestamp: new Date().toISOString(),
    source_ip: '192.168.1.1',
    user_agent: 'Test Agent',
    cf_ray: 'test-ray',
    sourceChannel: 'microsite',
    config_version: 'v1'
  };
  
  const sheet = getOrCreateBookingSheet(generateSheetName());
  appendBookingRow(sheet, testPayload);
  
  Logger.log('Test booking created successfully');
}

/**
 * Manual email test (run from Apps Script editor)
 *
 * Prereq:
 * - Set Script Property DEFAULT_OWNER_EMAIL to your inbox
 */
function testOwnerBookingEmail() {
  const payload = {
    slug: 'grand-royal',
    propertyName: 'Grand Royal',
    name: 'Email Test',
    phone: '+919999999999',
    email: 'customer@example.com',
    checkIn: '2026-01-15',
    checkOut: '2026-01-18',
    guests: 3,
    roomType: 'Deluxe Room',
    notes: 'Late check-in please.\nNeed airport pickup.',
    bookingId: 'evt_test_123',
    ownerEmail: '',
    timestamp: new Date().toISOString()
  };

  // This sends to DEFAULT_OWNER_EMAIL if ownerEmail is blank.
  trySendOwnerEmailNotification(payload, 'Bookings_Test');
  Logger.log('Triggered test owner booking email');
}

/**
 * Get booking statistics
 */
function getBookingStats(sheetName) {
  try {
    const sheet = getOrCreateBookingSheet(sheetName || generateSheetName());
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    // Skip header row
    const bookings = values.slice(1);
    
    const stats = {
      total: bookings.length,
      bySlug: {},
      byChannel: {},
      recent: bookings.slice(-10).reverse() // Last 10 bookings
    };
    
    bookings.forEach(row => {
      const slug = row[1];
      const channel = row[13];
      
      stats.bySlug[slug] = (stats.bySlug[slug] || 0) + 1;
      stats.byChannel[channel] = (stats.byChannel[channel] || 0) + 1;
    });
    
    Logger.log(JSON.stringify(stats, null, 2));
    return stats;
  } catch (error) {
    Logger.log('Error getting stats: ' + error.toString());
    return null;
  }
}

/**
 * Clean up old sheets (archive)
 * Run this monthly to keep spreadsheet manageable
 */
function archiveOldSheets() {
  const ss = SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  
  sheets.forEach(sheet => {
    const name = sheet.getName();
    
    // Check if it's a booking sheet (format: Bookings_YYYY_MM)
    const match = name.match(/^Bookings_(\d{4})_(\d{2})$/);
    
    if (match) {
      const sheetYear = parseInt(match[1]);
      const sheetMonth = parseInt(match[2]);
      
      // Archive if older than 3 months
      const monthsOld = (currentYear - sheetYear) * 12 + (currentMonth - sheetMonth);
      
      if (monthsOld > 3) {
        // Could move to a separate "Archive" spreadsheet
        // For now, just log
        Logger.log('Sheet ready for archive: ' + name + ' (' + monthsOld + ' months old)');
      }
    }
  });
}

/**
 * Send email notification for new booking (optional)
 */
function sendBookingNotification(data, sheetName) {
  try {
    // Get notification email from script properties
    const notificationEmail = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_EMAIL');
    
    if (!notificationEmail) {
      return;
    }
    
    const subject = `New Booking Enquiry: ${data.slug}`;
    const body = `
New booking enquiry received:

Resort: ${data.slug}
Guest: ${data.name}
Email: ${data.email}
Phone: ${data.phone}
Room: ${data.roomType}
Check-in: ${data.checkIn}
Check-out: ${data.checkOut}
Guests: ${data.guests}
Notes: ${data.notes}

Recorded in: ${sheetName}
Timestamp: ${data.timestamp}
    `;
    
    MailApp.sendEmail(notificationEmail, subject, body);
    Logger.log('Notification email sent to: ' + notificationEmail);
  } catch (error) {
    Logger.log('Failed to send notification: ' + error.toString());
  }
}
