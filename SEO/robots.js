/**
 * ROBOTS.TXT GENERATOR
 * Blueprint: CEO Directive #3 Compliant
 *
 * Generates robots.txt with sitemap reference and crawler rules.
 * Zero KV operations - purely computational.
 */

export function generateRobotsTxt(hostname) {
  const content = `User-agent: *
Allow: /
Sitemap: https://${hostname}/sitemap.xml

# Disallow internal endpoints
User-agent: *
Disallow: /_internal/
Disallow: /operator/
Disallow: /admin/
Disallow: /api/

# Crawl-delay for aggressive bots
User-agent: GPTBot
Crawl-delay: 10

User-agent: CCBot
Crawl-delay: 10
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400' // 24h browser cache
    }
  });
}
