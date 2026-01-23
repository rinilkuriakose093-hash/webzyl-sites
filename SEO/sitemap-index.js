/**
 * SITEMAP INDEX GENERATOR
 * Blueprint: CEO Directive #3 Compliant
 *
 * Generates sitemap index listing all 676 shard sitemaps.
 * Zero KV operations - purely computational.
 * Google/Bing crawlers follow the shard URLs to get actual site URLs.
 */

export function generateSitemapIndex(hostname) {
  // Generate all 676 shard prefixes (aa-zz)
  const prefixes = [];
  for (let a of 'abcdefghijklmnopqrstuvwxyz') {
    for (let b of 'abcdefghijklmnopqrstuvwxyz') {
      prefixes.push(a + b);
    }
  }

  const today = new Date().toISOString().split('T')[0];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${prefixes.map(prefix => `  <sitemap>
    <loc>https://${hostname}/sitemap-${prefix}.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600' // 1h browser cache
    }
  });
}
