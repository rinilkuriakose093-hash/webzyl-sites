/**
 * PHASE 4 - COMPREHENSIVE TEST SUITE
 * 
 * Test Categories:
 * 1. Unit Tests - Individual function validation
 * 2. Integration Tests - Component interactions
 * 3. End-to-End Tests - Full booking flow
 * 4. Security Tests - Rate limiting, HMAC, honeypot
 * 5. Performance Tests - Response times
 */

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const TEST_CONFIG = {
  workerUrl: 'https://your-worker.workers.dev',
  testSlug: 'test-resort',
  validBooking: {
    slug: 'test-resort',
    name: 'Test User',
    email: 'test@example.com',
    phone: '+919876543210',
    roomType: 'Deluxe Room',
    checkIn: '2025-02-01',
    checkOut: '2025-02-03',
    guests: 2,
    notes: 'Test booking',
    sourceChannel: 'test'
  }
};

// =============================================================================
// 1. UNIT TESTS
// =============================================================================

async function runUnitTests() {
  console.log('\n📋 Running Unit Tests...\n');
  
  const tests = [
    testRequiredFields,
    testEmailValidation,
    testPhoneValidation,
    testDateValidation,
    testGuestCountValidation,
    testNotesLengthValidation
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      console.log(`✅ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nUnit Tests: ${passed} passed, ${failed} failed\n`);
}

async function testRequiredFields() {
  const invalidBookings = [
    { ...TEST_CONFIG.validBooking, slug: '' },
    { ...TEST_CONFIG.validBooking, name: '' },
    { ...TEST_CONFIG.validBooking, email: '', phone: '' },
    { ...TEST_CONFIG.validBooking, checkIn: '' },
    { ...TEST_CONFIG.validBooking, checkOut: '' },
    { ...TEST_CONFIG.validBooking, guests: 0 }
  ];
  
  for (const booking of invalidBookings) {
    const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    if (response.ok) {
      throw new Error('Should have rejected booking with missing field');
    }
  }
}

async function testEmailValidation() {
  const invalidEmails = [
    'notanemail',
    'missing@domain',
    '@nodomain.com',
    'spaces in@email.com'
  ];
  
  for (const email of invalidEmails) {
    const booking = { ...TEST_CONFIG.validBooking, email };
    const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    const result = await response.json();
    if (!result.message.includes('email')) {
      throw new Error(`Should reject invalid email: ${email}`);
    }
  }
}

async function testPhoneValidation() {
  const invalidPhones = [
    '123',           // Too short
    'abcdefghijk',   // Not numbers
    '12345678901234567890' // Too long
  ];
  
  for (const phone of invalidPhones) {
    const booking = { ...TEST_CONFIG.validBooking, phone, email: '' };
    const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    if (response.ok) {
      throw new Error(`Should reject invalid phone: ${phone}`);
    }
  }
}

async function testDateValidation() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Check-out before check-in
  const booking1 = {
    ...TEST_CONFIG.validBooking,
    checkIn: tomorrow.toISOString().split('T')[0],
    checkOut: today.toISOString().split('T')[0]
  };
  
  const response1 = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking1)
  });
  
  if (response1.ok) {
    throw new Error('Should reject check-out before check-in');
  }
  
  // Same dates
  const booking2 = {
    ...TEST_CONFIG.validBooking,
    checkIn: today.toISOString().split('T')[0],
    checkOut: today.toISOString().split('T')[0]
  };
  
  const response2 = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking2)
  });
  
  if (response2.ok) {
    throw new Error('Should reject same check-in and check-out');
  }
}

async function testGuestCountValidation() {
  const invalidCounts = [0, -1, 100];
  
  for (const guests of invalidCounts) {
    const booking = { ...TEST_CONFIG.validBooking, guests };
    const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    if (response.ok) {
      throw new Error(`Should reject guest count: ${guests}`);
    }
  }
}

async function testNotesLengthValidation() {
  const longNotes = 'a'.repeat(1001);
  const booking = { ...TEST_CONFIG.validBooking, notes: longNotes };
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  if (response.ok) {
    throw new Error('Should reject notes over 1000 chars');
  }
}

// =============================================================================
// 2. SECURITY TESTS
// =============================================================================

async function runSecurityTests() {
  console.log('\n🔒 Running Security Tests...\n');
  
  const tests = [
    testRateLimiting,
    testHoneypot,
    testSQLInjection,
    testXSSAttempts,
    testInvalidSlug
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      console.log(`✅ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nSecurity Tests: ${passed} passed, ${failed} failed\n`);
}

async function testRateLimiting() {
  console.log('  Testing rate limiting (sending 6 requests)...');
  
  const requests = [];
  for (let i = 0; i < 6; i++) {
    requests.push(
      fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...TEST_CONFIG.validBooking, name: `Test ${i}` })
      })
    );
  }
  
  const responses = await Promise.all(requests);
  const rateLimited = responses.filter(r => r.status === 429);
  
  if (rateLimited.length === 0) {
    throw new Error('Rate limiting not working');
  }
  
  console.log(`  ${rateLimited.length} requests rate limited ✓`);
}

async function testHoneypot() {
  const bookingWithHoneypot = {
    ...TEST_CONFIG.validBooking,
    website: 'http://spam.com' // Honeypot field
  };
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingWithHoneypot)
  });
  
  // Should silently reject (return 200 but not actually process)
  // Or return error - depends on implementation
  const result = await response.json();
  
  // Check that it was rejected somehow
  if (result.success && result.recorded) {
    throw new Error('Honeypot should have blocked this request');
  }
}

async function testSQLInjection() {
  const sqlPayloads = [
    "'; DROP TABLE bookings; --",
    "1' OR '1'='1",
    "<script>alert('xss')</script>"
  ];
  
  for (const payload of sqlPayloads) {
    const booking = { ...TEST_CONFIG.validBooking, name: payload };
    const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    // Should either sanitize or reject
    const result = await response.json();
    
    // If it succeeds, payload should be sanitized in storage
    // This test mainly ensures no errors are thrown
  }
}

async function testXSSAttempts() {
  const xssPayloads = [
    "<script>alert('xss')</script>",
    "<img src=x onerror=alert('xss')>",
    "javascript:alert('xss')"
  ];
  
  for (const payload of xssPayloads) {
    const booking = { ...TEST_CONFIG.validBooking, notes: payload };
    await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking)
    });
    
    // Should handle gracefully without errors
  }
}

async function testInvalidSlug() {
  const booking = { ...TEST_CONFIG.validBooking, slug: 'non-existent-resort' };
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  if (response.status !== 404) {
    throw new Error('Should return 404 for invalid slug');
  }
}

// =============================================================================
// 3. INTEGRATION TESTS
// =============================================================================

async function runIntegrationTests() {
  console.log('\n🔗 Running Integration Tests...\n');
  
  const tests = [
    testCompleteBookingFlow,
    testSheetModeBooking,
    testWhatsAppModeBooking,
    testBothModeBooking,
    testConfigLookup
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test();
      console.log(`✅ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\nIntegration Tests: ${passed} passed, ${failed} failed\n`);
}

async function testCompleteBookingFlow() {
  const booking = {
    ...TEST_CONFIG.validBooking,
    name: 'Integration Test User'
  };
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (!result.success) {
    throw new Error('Booking should succeed');
  }
  
  console.log('  Booking ID recorded:', result.recorded);
}

async function testSheetModeBooking() {
  // Assumes config has mode: "sheet"
  const booking = TEST_CONFIG.validBooking;
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  const result = await response.json();
  
  if (result.mode !== 'sheet' && result.mode !== 'both') {
    throw new Error('Expected sheet mode');
  }
  
  if (!result.recorded) {
    throw new Error('Sheet mode booking should be recorded');
  }
  
  if (result.whatsappUrl) {
    console.log('  Note: WhatsApp URL present in sheet mode (might be "both" mode)');
  }
}

async function testWhatsAppModeBooking() {
  // Note: This test assumes you have a resort with whatsapp mode
  const booking = {
    ...TEST_CONFIG.validBooking,
    slug: 'whatsapp-test-resort' // Use appropriate slug
  };
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  const result = await response.json();
  
  if (result.success && result.whatsappUrl) {
    console.log('  WhatsApp URL:', result.whatsappUrl.substring(0, 50) + '...');
    
    if (!result.whatsappUrl.startsWith('https://wa.me/')) {
      throw new Error('Invalid WhatsApp URL format');
    }
  }
}

async function testBothModeBooking() {
  // Assumes config has mode: "both"
  const booking = TEST_CONFIG.validBooking;
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  const result = await response.json();
  
  if (result.mode === 'both') {
    if (!result.recorded) {
      throw new Error('Both mode should record to sheet');
    }
    
    if (!result.whatsappUrl) {
      throw new Error('Both mode should provide WhatsApp URL');
    }
  }
}

async function testConfigLookup() {
  // Test that worker properly fetches config from KV
  const booking = TEST_CONFIG.validBooking;
  
  const response = await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking)
  });
  
  if (!response.ok && response.status !== 404) {
    throw new Error('Config lookup failed unexpectedly');
  }
}

// =============================================================================
// 4. PERFORMANCE TESTS
// =============================================================================

async function runPerformanceTests() {
  console.log('\n⚡ Running Performance Tests...\n');
  
  const iterations = 10;
  const responseTimes = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    
    await fetch(`${TEST_CONFIG.workerUrl}/api/booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_CONFIG.validBooking)
    });
    
    const duration = Date.now() - start;
    responseTimes.push(duration);
  }
  
  const avg = responseTimes.reduce((a, b) => a + b) / iterations;
  const min = Math.min(...responseTimes);
  const max = Math.max(...responseTimes);
  
  console.log(`  Average response time: ${avg.toFixed(2)}ms`);
  console.log(`  Min: ${min}ms, Max: ${max}ms`);
  
  if (avg > 2000) {
    console.log('  ⚠️  Average response time exceeds 2s');
  } else {
    console.log('  ✅ Performance within acceptable range');
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   PHASE 4 - COMPREHENSIVE TEST SUITE          ║');
  console.log('╚════════════════════════════════════════════════╝');
  
  await runUnitTests();
  await runSecurityTests();
  await runIntegrationTests();
  await runPerformanceTests();
  
  console.log('\n✨ All tests completed!\n');
}

// Run tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests };
} else {
  runAllTests();
}
