/**
 * SCHEMA.ORG GENERATOR (SOURCE OF TRUTH)
 * Blueprint: Multi-Vertical Expansion Map (Lines 5045-5056)
 *
 * Generates Schema.org JSON-LD structured data based on business type.
 * This is the SINGLE SOURCE OF TRUTH for all SEO metadata.
 * meta.js derives Open Graph tags from this schema.
 *
 * Business Type Routing (Blueprint Line 4968-4972):
 * - resort/homestay → LodgingBusiness
 * - shop → Store
 * - service → ProfessionalService
 * - restaurant → Restaurant
 * - cafe → CafeOrCoffeeShop
 * - clinic → MedicalClinic
 * - gym → SportsActivityLocation
 * - school → EducationalOrganization
 */

// Schema.org type mapping (Blueprint compliant)
const SCHEMA_TYPE_MAP = {
  'resort': 'LodgingBusiness',
  'homestay': 'LodgingBusiness',
  'hotel': 'LodgingBusiness',
  'shop': 'Store',
  'service': 'ProfessionalService',
  'restaurant': 'Restaurant',
  'cafe': 'CafeOrCoffeeShop',
  'clinic': 'MedicalClinic',
  'gym': 'SportsActivityLocation',
  'school': 'EducationalOrganization'
};

/**
 * Generate Schema.org JSON-LD structured data
 * @param {Object} sitepkg - Site package from KV
 * @param {string} hostname - Request hostname (e.g., slug.webzyl.com)
 * @returns {Object} Schema.org JSON-LD object
 */
export function generateSchema(sitepkg, hostname) {
  // Extract business type (support both 'category' and 'business_type' fields)
  const businessType = sitepkg.category || sitepkg.business_type || 'resort';
  const schemaType = SCHEMA_TYPE_MAP[businessType] || 'LocalBusiness';

  // Build base schema
  const schema = {
    "@context": "https://schema.org",
    "@type": schemaType,
    "name": sitepkg.name,
    "description": sitepkg.about || sitepkg.tagline,
    "url": `https://${hostname}`
  };

  // Add contact information if available
  if (sitepkg.contact?.phone) {
    schema.telephone = sitepkg.contact.phone;
  }
  if (sitepkg.contact?.email) {
    schema.email = sitepkg.contact.email;
  }

  // Add address if available
  if (sitepkg.location) {
    schema.address = {
      "@type": "PostalAddress",
      "streetAddress": sitepkg.location.address || '',
      "addressLocality": sitepkg.location.city || '',
      "addressRegion": sitepkg.location.state || '',
      "addressCountry": sitepkg.location.country || 'IN'
    };

    // Add geo coordinates if available
    if (sitepkg.location.lat && sitepkg.location.lng) {
      schema.geo = {
        "@type": "GeoCoordinates",
        "latitude": sitepkg.location.lat,
        "longitude": sitepkg.location.lng
      };
    }
  }

  // Add hero image if available
  if (sitepkg.heroImage || sitepkg.branding?.heroImage) {
    schema.image = sitepkg.heroImage || sitepkg.branding.heroImage;
  }

  // Add rating if available
  if (sitepkg.rating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": sitepkg.rating,
      "bestRating": "5"
    };
  }

  // Add price range if available
  if (sitepkg.basePrice) {
    schema.priceRange = sitepkg.basePrice;
  }

  return schema;
}

/**
 * Get schema type for a given business type
 * Used by meta.js to derive og:type
 * @param {string} businessType - Business type (resort, shop, etc.)
 * @returns {string} Schema.org type
 */
export function getSchemaType(businessType) {
  return SCHEMA_TYPE_MAP[businessType] || 'LocalBusiness';
}

/**
 * Extract essential metadata from schema for meta tags
 * Used by meta.js to ensure consistency
 * @param {Object} schema - Generated schema object
 * @returns {Object} Essential metadata
 */
export function extractMetadata(schema) {
  return {
    title: schema.name,
    description: schema.description,
    image: schema.image,
    url: schema.url,
    type: schema["@type"]
  };
}
