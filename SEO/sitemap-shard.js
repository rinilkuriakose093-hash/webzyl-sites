/**
 * SITEMAP SHARD GENERATOR
 * Blueprint: CEO Directive #3 Compliant
 *
 * Generates per-shard sitemap (e.g., /sitemap-aa.xml).
 * Uses KV cache with 24h TTL to protect read budget.
 * Only reads 1 shard (not all 676).
 *
 * Cache Strategy:
 * - Cache Key: sitemap_cache:{prefix}
 * - Cache Timestamp: sitemap_cache_ts:{prefix}
 * - TTL: 24 hours
 * - Invalidation: Per-shard on publish (surgical, not global)
 */

export async function generateSitemapShard(KV, prefix, hostname) {
  // Check per-shard cache first
  const cacheKey = `sitemap_cache:${prefix}`;
  const cacheTs = `sitemap_cache_ts:${prefix}`;

  const cached = await KV.get(cacheKey);
  const cachedTime = await KV.get(cacheTs);

  const now = Date.now();
  const isStale = !cachedTime || (now - parseInt(cachedTime) > 86400000); // 24h

  // Return cached version if fresh
  if (cached && !isStale) {
    return new Response(cached, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'HIT'
      }
    });
  }

  // Cache miss - read ONLY this shard (not all 676)
  const shardData = await KV.get(`site_index:${prefix}`, { type: 'json' });

  // Handle empty shard
  if (!shardData || shardData.length === 0) {
    const emptySitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`;

    return new Response(emptySitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'MISS-EMPTY'
      }
    });
  }

  // Generate sitemap XML for this shard
  const today = new Date().toISOString().split('T')[0];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${shardData.map(slug => `  <url>
    <loc>https://${hostname}/${slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>`;

  // Cache this shard for 24h (KV writes only on cache miss)
  await Promise.all([
    KV.put(cacheKey, sitemap, { expirationTtl: 86400 }),
    KV.put(cacheTs, now.toString(), { expirationTtl: 86400 })
  ]);

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': 'MISS-GENERATED'
    }
  });
}
