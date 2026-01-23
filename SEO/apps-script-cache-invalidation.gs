/**
 * SITEMAP CACHE INVALIDATION FOR GOOGLE APPS SCRIPT
 * Blueprint: CEO Directive #3 Compliant
 *
 * This function must be added to your Google Sheets Apps Script
 * and called after publishing a site to KV.
 *
 * IMPORTANT: This only invalidates the AFFECTED SHARD, not all 676 shards.
 * This protects KV write budget and follows surgical cache invalidation strategy.
 *
 * Integration Point:
 * Call this function in your publishSiteToKV() function AFTER
 * successfully updating config:{slug} and site_index:{prefix} in KV.
 *
 * Example:
 * ```
 * function publishSiteToKV(slug, config) {
 *   // ... your existing publish logic ...
 *
 *   // Invalidate sitemap cache for affected shard
 *   invalidateSitemapCache(slug);
 * }
 * ```
 */

/**
 * Invalidate sitemap cache for a specific slug's shard
 * Only invalidates the affected shard (prefix-scoped deletion)
 *
 * @param {string} slug - Site slug (e.g., "awesome-resort")
 */
function invalidateSitemapCache(slug) {
  try {
    // Extract prefix (first 2 characters of slug)
    const prefix = slug.substring(0, 2).toLowerCase();

    // Get worker admin endpoint URL
    const WORKER_BASE_URL = PropertiesService.getScriptProperties().getProperty('WORKER_BASE_URL') || 'https://webzyl.com';
    const ADMIN_TOKEN = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');

    if (!ADMIN_TOKEN) {
      Logger.log('[SITEMAP] Warning: No ADMIN_TOKEN configured. Cache invalidation skipped.');
      return;
    }

    // Call worker internal endpoint to delete cache keys
    const url = `${WORKER_BASE_URL}/_internal/invalidate-sitemap`;
    const payload = JSON.stringify({
      prefix: prefix,
      slug: slug
    });

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Admin-Token': ADMIN_TOKEN
      },
      payload: payload,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      Logger.log(`[SITEMAP] Cache invalidated for shard: ${prefix} (slug: ${slug})`);
    } else {
      Logger.log(`[SITEMAP] Cache invalidation failed: ${statusCode} - ${response.getContentText()}`);
    }

  } catch (error) {
    // Non-critical error - sitemap will refresh in 24h anyway
    Logger.log(`[SITEMAP] Cache invalidation error: ${error.message}`);
    Logger.log('[SITEMAP] This is non-critical. Sitemap will auto-refresh in 24 hours.');
  }
}

/**
 * Setup instructions for Apps Script:
 *
 * 1. Open your Google Sheet (e.g., SME_MASTER)
 * 2. Go to Extensions > Apps Script
 * 3. Copy this function into your Code.gs file
 * 4. Add script properties (File > Project Properties > Script Properties):
 *    - WORKER_BASE_URL: https://webzyl.com (or your worker URL)
 *    - ADMIN_TOKEN: <your admin token>
 * 5. In your publishSiteToKV() function, add:
 *    invalidateSitemapCache(slug);
 *    after successfully updating KV
 * 6. Save and test
 *
 * Testing:
 * 1. Publish a test site (e.g., slug: "test-resort")
 * 2. Check Logs (View > Logs) for:
 *    "[SITEMAP] Cache invalidated for shard: te (slug: test-resort)"
 * 3. Verify sitemap cache was deleted:
 *    - Visit: https://test-resort.webzyl.com/sitemap-te.xml
 *    - Check X-Cache header (should be MISS after invalidation, then HIT on next request)
 */
