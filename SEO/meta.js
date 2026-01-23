/**
 * META TAGS BUILDER (DERIVES FROM SCHEMA.JS)
 * Blueprint: Perfect SEO infrastructure (Line 2518-2530)
 *
 * Generates Open Graph, Twitter Card, and canonical tags.
 * IMPORTANT: This derives from schema.js (source of truth).
 * Never duplicates logic - always derives from schema.
 *
 * Output:
 * - Open Graph tags (og:title, og:description, og:image, og:url)
 * - Twitter Card tags
 * - Canonical URL
 * - Additional SEO meta tags
 */

import { generateSchema, extractMetadata } from './schema.js';

/**
 * Build meta tags HTML string
 * Derives all metadata from schema.js to ensure consistency
 * @param {Object} sitepkg - Site package from KV
 * @param {string} hostname - Request hostname
 * @returns {string} HTML meta tags
 */
export function buildMetaTags(sitepkg, hostname) {
  // Generate schema first (source of truth)
  const schema = generateSchema(sitepkg, hostname);
  const meta = extractMetadata(schema);

  // Build meta tags array
  const tags = [
    // Open Graph
    `<meta property="og:type" content="business.business">`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `<meta property="og:url" content="${meta.url}">`,
    `<meta property="og:site_name" content="${escapeHtml(meta.title)}">`,

    // Twitter Card
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}">`,

    // Canonical
    `<link rel="canonical" href="${meta.url}">`,

    // Additional SEO
    `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<meta name="googlebot" content="index, follow">`
  ];

  // Add image if available
  if (meta.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(meta.image)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(meta.image)}">`);
  }

  return tags.join('\n  ');
}

/**
 * Escape HTML special characters
 * Prevents XSS and ensures valid HTML
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
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
