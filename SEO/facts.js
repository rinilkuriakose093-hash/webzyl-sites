/**
 * AGENT-FIRST JSON ENDPOINTS
 * Blueprint: CEO Directive #3 Extended - AI Search Era
 *
 * Serves machine-readable JSON for AI search engines:
 * - OpenAI SearchGPT
 * - Google SGE (Search Generative Experience)
 * - Perplexity AI
 * - Anthropic Claude (future search)
 *
 * Routes:
 * - /{slug}/facts.json - Complete site facts (schema.org data as JSON)
 * - /{slug}/faq.json - FAQ structured data (if available)
 *
 * Why This Matters:
 * AI search engines prefer clean JSON "fact sheets" over HTML scraping.
 * This positions Webzyl years ahead of competitors still doing HTML-only SEO.
 *
 * Cost: Zero KV operations (purely computational, like robots.txt)
 */

import { generateSchema } from './schema.js';

/**
 * Generate facts.json - Complete site facts as JSON
 * Reuses schema.org data from schema.js (single source of truth)
 *
 * @param {Object} sitepkg - Site configuration from KV
 * @param {string} hostname - Site hostname
 * @returns {Response} JSON response with site facts
 */
export function generateFacts(sitepkg, hostname) {
  // Generate schema.org data (source of truth)
  const schema = generateSchema(sitepkg, hostname);

  // Add additional machine-readable facts
  const facts = {
    // Core identity
    name: schema.name,
    type: schema['@type'],
    description: schema.description,
    url: schema.url,

    // Contact & location
    telephone: schema.telephone,
    email: schema.email,
    address: schema.address,

    // Hours & availability
    openingHours: schema.openingHoursSpecification?.map(hours => ({
      days: hours.dayOfWeek,
      opens: hours.opens,
      closes: hours.closes
    })),

    // Pricing (if available)
    priceRange: schema.priceRange,

    // Social proof
    aggregateRating: schema.aggregateRating,

    // Media
    image: schema.image,
    logo: schema.logo,

    // Additional facts for AI
    category: sitepkg.category || sitepkg.business_type || 'resort',
    features: sitepkg.features || [],
    amenities: sitepkg.amenities || [],

    // Metadata
    lastUpdated: new Date().toISOString(),
    dataSource: 'webzyl-platform',
    schemaVersion: '1.0'
  };

  // Remove null/undefined values
  Object.keys(facts).forEach(key => {
    if (facts[key] === null || facts[key] === undefined) {
      delete facts[key];
    }
  });

  return new Response(JSON.stringify(facts, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*', // Allow AI crawlers
      'X-Webzyl-Route': 'facts',
      'X-Webzyl-KV-Ops': '0' // Zero KV operations
    }
  });
}

/**
 * Generate faq.json - FAQ structured data
 *
 * @param {Object} sitepkg - Site configuration from KV
 * @param {string} hostname - Site hostname
 * @returns {Response} JSON response with FAQ data
 */
export function generateFAQ(sitepkg, hostname) {
  // Extract FAQ data from sitepkg
  const faqData = sitepkg.faq || sitepkg.faqs || [];

  // If no FAQ data, return minimal structure
  if (!faqData || faqData.length === 0) {
    const emptyFAQ = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [],
      about: {
        name: sitepkg.name,
        url: `https://${hostname}`
      },
      lastUpdated: new Date().toISOString(),
      dataSource: 'webzyl-platform'
    };

    return new Response(JSON.stringify(emptyFAQ, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Webzyl-Route': 'faq',
        'X-Webzyl-KV-Ops': '0'
      }
    });
  }

  // Build FAQ schema
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqData.map(item => ({
      '@type': 'Question',
      name: item.question || item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer || item.a
      }
    })),
    about: {
      '@type': 'Thing',
      name: sitepkg.name,
      url: `https://${hostname}`
    },
    lastUpdated: new Date().toISOString(),
    dataSource: 'webzyl-platform',
    schemaVersion: '1.0'
  };

  return new Response(JSON.stringify(faq, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Webzyl-Route': 'faq',
      'X-Webzyl-KV-Ops': '0'
    }
  });
}

/**
 * Helper: Escape HTML entities
 * Prevents XSS in JSON responses
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
