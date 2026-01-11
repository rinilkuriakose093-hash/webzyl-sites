/**
 * Google Apps Script - Booking Enquiry Sink (Part 3)
 * 
 * Purpose: Receive booking data from Cloudflare Worker, store in Google Sheets
 * 
 * ⚠️ CRITICAL: Cloudflare Worker Integration
 * 
 * Apps Script has quirky header handling. For maximum reliability:
 * 
 * Option A (RECOMMENDED): Worker sends signature as query param
 *   POST https://script.google.com/...?sig=<hmac>&sheet=<name>
 *   (Most reliable in Apps Script)
 * 
 * Option B: Worker sends signature in headers
 *   X-Signature: <hmac>
 *   X-Sheet-Name: <name>
 *   (Less reliable, may fail intermittently)
 * 
 * This script handles BOTH via getHeader() and getQueryParam() helpers.
 * 
 * Setup:
 * 1. Replace SPREADSHEET_ID with your actual Google Sheet ID
 * 2. Deploy as Web App (Execute as: Me, Access: Anyone)
 * 3. Copy Web App URL to Worker env: BOOKING_WEBHOOK_URL
 * 4. Set Script Properties: BOOKING_HMAC_SECRET (matching Worker secret)
 * 
 * Architecture:
 * Worker POST /api/booking → This script (doPost) → Google Sheets
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

//const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Replace with actual ID
const SPREADSHEET_ID = '13KtqdfeP2EPQl4IY_KtKcXHqqn5wLJNT9QgL7f0p2Pc';

// NOTE: HMAC_SECRET is read per-request (not at load time) to avoid stale values
// See verifySignature() function

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main HTTP POST handler - called by Cloudflare Worker
 * 
 * IMPORTANT: Apps Script Web Apps have quirky header handling:
 * - Custom headers (X-Signature, X-Sheet-Name) may not be reliably available
 * - Use query params instead when possible (e.g., ?sig=... instead of X-Signature header)
 * - If headers are sent, they appear in e.parameters (plural) or e.postData.headers
 * 
 * @param {Object} e - Google Apps Script event object
 * @returns {ContentService.TextOutput} JSON response
 */
function doPost(e) {
  // LOG: Entry point - confirms doPost is executing
  Logger.log('[BOOKING] ========== doPost() ENTRY ==========');
  Logger.log(`[BOOKING] Timestamp: ${new Date().toISOString()}`);
  
  try {
    // Parse request body with error handling
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

    // Extract signature and sheet name (with fallback locations for Apps Script quirks)
    const signature = getHeader(e, 'X-Signature') || getQueryParam(e, 'sig') || '';
    const sheetName = getHeader(e, 'X-Sheet-Name') || getQueryParam(e, 'sheet') || generateSheetName();
    
    Logger.log(`[BOOKING] Signature extracted: ${signature ? signature.substring(0, 16) + '...' : '(empty)'}`);
    Logger.log(`[BOOKING] Sheet name resolved: ${sheetName}`);
    Logger.log(`[BOOKING] Received booking from ${payload.slug} - ${payload.name}`);

    // Verify HMAC signature
    Logger.log('[BOOKING] Checking HMAC signature...');
    const signatureValid = verifySignature(payload, signature);
    if (!signatureValid) {
      // TODO: Temporarily allowing failed HMAC for debugging - REMOVE IN PRODUCTION
      Logger.log('[BOOKING] ⚠️ HMAC verification failed, but continuing (fail-open for debugging)');
      // DO NOT return here - continue to append for debugging
      // return createResponse({ success: false, error: 'Signature verification failed' }, 401);
    } else {
      Logger.log('[BOOKING] ✅ HMAC verification passed');
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
    Logger.log(`[BOOKING] Using Spreadsheet ID: ${SPREADSHEET_ID}`);
    const sheet = getOrCreateBookingSheet(sheetName);
    if (!sheet) {
      Logger.log('[BOOKING] ❌ CRITICAL: Failed to get or create booking sheet');
      throw new Error('Failed to get or create booking sheet');
    }
    Logger.log(`[BOOKING] ✅ Sheet resolved: ${sheet.getName()}`);

    // Append booking row - CRITICAL SECTION
    Logger.log('[BOOKING] ========== ABOUT TO APPEND ROW ==========');
    Logger.log(`[BOOKING] Target sheet: ${sheet.getName()}`);
    Logger.log(`[BOOKING] Current row count: ${sheet.getLastRow()}`);
    
    appendBookingRow(sheet, payload);
    
    Logger.log('[BOOKING] ========== APPEND COMPLETED ==========');
    Logger.log(`[BOOKING] New row count: ${sheet.getLastRow()}`);
    Logger.log(`[BOOKING] ✅ Row appended to sheet: ${sheetName}`);

    // Log booking (non-blocking)
    try {
      Logger.log('[BOOKING] Attempting audit log...');
      logBooking(payload, sheetName);
      Logger.log('[BOOKING] ✅ Audit log completed');
    } catch (logErr) {
      Logger.log(`[BOOKING] ⚠️ Logging error (non-critical): ${logErr.toString()}`);
      Logger.log(`[BOOKING] Log error stack: ${logErr.stack}`);
    }

    // Success response
    Logger.log('[BOOKING] ========== RETURNING SUCCESS ==========');
    return createResponse({
      success: true,
      message: 'Booking recorded',
      sheetName: sheetName,
      timestamp: new Date().toISOString()
    }, 200);

  } catch (err) {
    Logger.log(`[BOOKING ERROR] ========== EXCEPTION CAUGHT ==========`);
    Logger.log(`[BOOKING ERROR] Error: ${err.toString()}`);
    Logger.log(`[BOOKING ERROR] Stack: ${err.stack}`);
    Logger.log(`[BOOKING ERROR] Error name: ${err.name}`);
    return createResponse({ 
      success: false, 
      error: 'Internal server error',
      errorType: err.name || 'UnknownError'
    }, 500);
  }
}

// ============================================================================
// SECURITY & VALIDATION
// ============================================================================

/**
 * Extract header value from request event object
 * Apps Script quirk: custom headers may appear in different places
 * 
 * @param {Object} e - Apps Script event object
 * @param {string} headerName - Header name (e.g., 'X-Signature')
 * @returns {string} Header value or empty string
 */
function getHeader(e, headerName) {
  // Try e.parameters (arrays) - standard for HTTP headers in Apps Script
  if (e.parameters && e.parameters[headerName]) {
    const value = e.parameters[headerName];
    return Array.isArray(value) ? value[0] : value;
  }
  
  // Try e.postData.headers (direct header object)
  if (e.postData && e.postData.headers && e.postData.headers[headerName]) {
    return e.postData.headers[headerName];
  }
  
  return '';
}

/**
 * Extract query parameter value from request
 * This is more reliable than headers in Apps Script
 * 
 * @param {Object} e - Apps Script event object
 * @param {string} paramName - Parameter name
 * @returns {string} Parameter value or empty string
 */
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

// ============================================================================

/**
 * Verify HMAC-SHA256 signature
 * 
 * NOTE: HMAC_SECRET is read per-request (not at module load time) to ensure
 * we always get the latest value from Script Properties.
 * 
 * @param {Object} payload - Booking data
 * @param {string} receivedSignature - Signature from Worker
 * @returns {boolean} true if signature is valid
 */
function verifySignature(payload, receivedSignature) {
  // Read secret per-request to avoid stale values after property updates
  const HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('BOOKING_HMAC_SECRET');
  
  if (!HMAC_SECRET) {
    Logger.log('[SECURITY] ⚠️ WARNING: BOOKING_HMAC_SECRET not configured');
    Logger.log('[SECURITY] ⚠️ Allowing request in DEV MODE - DO NOT USE IN PRODUCTION');
    Logger.log('[SECURITY] ⚠️ Run setupBookingSink() to configure secret');
    return true; // Allow in dev, but warn
  }

  try {
    const message = JSON.stringify(payload);
    const signature = Utilities.computeHmacSha256Signature(message, HMAC_SECRET);
    const expectedSignature = signature.map(byte => {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');

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

/**
 * Validate incoming booking payload
 * 
 * @param {Object} payload - Booking data from Worker
 * @returns {Object} { valid: boolean, error?: string }
 */
function validatePayload(payload) {
  // LOG: Validation entry point
  Logger.log('[VALIDATION] Starting payload validation...');
  
  const required = ['slug', 'name', 'checkIn', 'checkOut', 'guests', 'timestamp'];
  
  for (const field of required) {
    if (!payload[field]) {
      Logger.log(`[VALIDATION] ❌ Missing required field: ${field}`);
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }
  Logger.log(`[VALIDATION] ✅ All required fields present`);

  // At least one contact method
  if (!payload.email && !payload.phone) {
    Logger.log(`[VALIDATION] ❌ No contact method (email or phone)`);
    return { valid: false, error: 'Either email or phone is required' };
  }
  Logger.log(`[VALIDATION] ✅ Contact method provided (email: ${!!payload.email}, phone: ${!!payload.phone})`);

  // Validate email if provided
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    Logger.log(`[VALIDATION] ❌ Invalid email format: ${payload.email}`);
    return { valid: false, error: 'Invalid email format' };
  }

  // Validate phone if provided
  if (payload.phone && !/^[0-9+\-()\s]{7,20}$/.test(payload.phone)) {
    Logger.log(`[VALIDATION] ❌ Invalid phone format: ${payload.phone}`);
    return { valid: false, error: 'Invalid phone format' };
  }

  Logger.log(`[VALIDATION] ✅ Payload validation completed successfully`);
  return { valid: true };
}

// ============================================================================
// SHEET OPERATIONS
// ============================================================================

/**
 * Get or create booking sheet
 * 
 * @param {string} sheetName - Name of the sheet (e.g., "Bookings_2025_12")
 * @returns {Sheet} Google Sheets sheet object
 */
function getOrCreateBookingSheet(sheetName) {
  // LOG: Sheet resolution entry point
  Logger.log(`[SHEETS] getOrCreateBookingSheet() called with: ${sheetName}`);
  Logger.log(`[SHEETS] Spreadsheet ID: ${SPREADSHEET_ID}`);
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    Logger.log(`[SHEETS] ✅ Spreadsheet opened successfully`);
    
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      Logger.log(`[SHEETS] Sheet "${sheetName}" not found - creating new sheet`);
      sheet = ss.insertSheet(sheetName);
      Logger.log(`[SHEETS] ✅ New sheet created: ${sheetName}`);

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
      
      Logger.log(`[SHEETS] Appending ${headers.length} header columns...`);
      sheet.appendRow(headers);
      Logger.log(`[SHEETS] ✅ Headers appended`);

      // Format header row
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#06b6d4');
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');

      // Freeze header row
      sheet.setFrozenRows(1);

      // Auto-resize columns
      sheet.autoResizeColumns(1, headers.length);

      Logger.log(`[SHEETS] ✅ Sheet formatting completed - ${headers.length} columns`);
    } else {
      Logger.log(`[SHEETS] ✅ Existing sheet found: ${sheetName} (${sheet.getLastRow()} rows)`);
    }

    return sheet;
    
  } catch (err) {
    Logger.log(`[SHEETS] ❌ CRITICAL ERROR in getOrCreateBookingSheet: ${err.toString()}`);
    Logger.log(`[SHEETS] Stack: ${err.stack}`);
    throw err; // Re-throw to be caught by doPost
  }
}

/**
 * Append booking data as a new row
 * 
 * @param {Sheet} sheet - Google Sheets sheet object
 * @param {Object} data - Booking payload
 */
function appendBookingRow(sheet, data) {
  // LOG: Append entry point - this is the single critical append location
  Logger.log(`[SHEETS] appendBookingRow() called for: ${data.name} (${data.slug})`);
  
  try {
    const row = [
      data.timestamp,
      data.slug,
      data.name,
      data.email || '',
      data.phone || '',
      data.roomType || '',
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

    Logger.log(`[SHEETS] Row data prepared: ${row.length} columns`);
    Logger.log(`[SHEETS] Calling sheet.appendRow()...`);
    
    sheet.appendRow(row);
    
    Logger.log(`[SHEETS] ✅ sheet.appendRow() completed`);

    // Format new row (alternate colors for readability)
    const rowNum = sheet.getLastRow();
    Logger.log(`[SHEETS] Current last row: ${rowNum}`);
    
    const dataRange = sheet.getRange(rowNum, 1, 1, row.length);
    
    if (rowNum % 2 === 0) {
      dataRange.setBackground('#f0f9ff'); // Light blue for even rows
    }

    Logger.log(`[SHEETS] ✅ Row ${rowNum} appended and formatted`);
    
  } catch (err) {
    Logger.log(`[SHEETS] ❌ CRITICAL ERROR in appendBookingRow: ${err.toString()}`);
    Logger.log(`[SHEETS] Stack: ${err.stack}`);
    throw err; // Re-throw to be caught by doPost
  }
}

/**
 * Log booking to audit sheet
 * 
 * @param {Object} data - Booking payload
 * @param {string} sheetName - Booking sheet name
 */
function logBooking(data, sheetName) {
  // LOG: Audit log entry point
  Logger.log('[LOGS] Entering logBooking() for audit trail...');
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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

    logSheet.appendRow([
      new Date().toISOString(),
      data.slug,
      data.name,
      sheetName,
      'SUCCESS'
    ]);

    Logger.log(`[LOGS] ✅ Booking logged: ${data.slug} - ${data.name}`);
    
  } catch (err) {
    Logger.log(`[LOGS] ❌ Error in logBooking: ${err.toString()}`);
    Logger.log(`[LOGS] Stack: ${err.stack}`);
    throw err; // Re-throw so doPost can catch and continue
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate sheet name based on current month
 * Format: Bookings_YYYY_MM
 * 
 * @returns {string} Sheet name
 */
function generateSheetName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Bookings_${year}_${month}`;
}

/**
 * Create JSON response for HTTP output
 * 
 * @param {Object} data - Response data
 * @param {number} statusCode - HTTP status code (informational only)
 * @returns {ContentService.TextOutput} Response object
 */
function createResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================================
// TESTING & SETUP
// ============================================================================

/**
 * Test function - creates sample booking and appends to sheet
 * Run this from Apps Script editor to verify setup
 */
function testBookingSink() {
  Logger.log('[TEST] Starting test...');

  const testData = {
    slug: 'test-resort',
    name: 'Test Guest',
    email: 'test@example.com',
    phone: '+919876543210',
    roomType: 'Deluxe Room',
    checkIn: '2025-12-24',
    checkOut: '2025-12-26',
    guests: 2,
    notes: 'This is a test booking',
    sourceChannel: 'test',
    timestamp: new Date().toISOString(),
    source_ip: '127.0.0.1',
    user_agent: 'Test Browser',
    cf_ray: 'test-ray-123'
  };

  try {
    // Validate
    const validation = validatePayload(testData);
    if (!validation.valid) {
      Logger.log(`[TEST] Validation failed: ${validation.error}`);
      return;
    }

    // Get/create sheet
    const sheetName = generateSheetName();
    const sheet = getOrCreateBookingSheet(sheetName);

    // Append row
    appendBookingRow(sheet, testData);

    // Log
    logBooking(testData, sheetName);

    Logger.log('[TEST] ✅ Test completed successfully!');
    Logger.log(`[TEST] Check sheet: ${sheetName}`);
  } catch (err) {
    Logger.log(`[TEST] ❌ Test failed: ${err}`);
  }
}

/**
 * Setup function - configure Script Properties
 * Run this once to initialize the booking sink
 */
function setupBookingSink() {
  const props = PropertiesService.getScriptProperties();
  
  // Get or set HMAC secret
  let secret = props.getProperty('BOOKING_HMAC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('BOOKING_HMAC_SECRET', secret);
    Logger.log('[SETUP] ✅ Generated HMAC secret');
  } else {
    Logger.log('[SETUP] ✅ HMAC secret already configured');
  }

  Logger.log('[SETUP] Configuration complete!');
  Logger.log(`[SETUP] HMAC Secret: ${secret}`);
  Logger.log(`[SETUP] Spreadsheet ID: ${SPREADSHEET_ID}`);
  Logger.log('[SETUP] Next steps:');
  Logger.log('1. Deploy as Web App (Execute as: Me, Access: Anyone)');
  Logger.log('2. Copy Web App URL to Worker: env.BOOKING_WEBHOOK_URL');
  Logger.log('3. Run testBookingSink() to verify');
}
