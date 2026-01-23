/**
 * WEBZYL WORKER v7.2 - UNIVERSAL SYSTEM (Surgical Update)
 * 
 * NEW in v7.2:
 * - Universal business type support (homestay, restaurant, shop, services, etc.)
 * - Exact mountview config structure (nested objects)
 * - 8 pre-built themes
 * - Universal categories with "Others" option
 * - Updated pricing plans (Basic/Premium/Professional/Enterprise)
 * - Sheet sync hooks (feature-flagged for Phase 1.5)
 * 
 * PRESERVED from v7.1:
 * - All operator endpoints (login, dashboard, update, bookings, gallery)
 * - Subdomain routing
 * - Data endpoints
 * - Booking API integration
 * - CORS handling
 * 
 * Architectural Principles:
 * 1. Worker is a ROUTER, not an HTML processor
 * 2. KV is the authoritative source of truth
 * 3. Pages is the rendering service
 * 4. Keep coupling loose, complexity low
 */

import { handleBookingRequest } from './Booking_Enquiry/files/booking-api.js';
import luxuryHeritage from "./design-profiles/luxury-heritage-v1.json";
import modernPremium from "./design-profiles/modern-premium-v1.json";
import luxuryHeritageCalm from "./design-profiles/variants/luxury-heritage-v1--calm.json";
import luxuryHeritageBold from "./design-profiles/variants/luxury-heritage-v1--bold.json";

// SEO Modules (CEO Directive #3 Compliant + AI Search Era)
import { generateRobotsTxt } from './seo/robots.js';
import { generateSitemapIndex } from './seo/sitemap-index.js';
import { generateSitemapShard } from './seo/sitemap-shard.js';
import { generateFacts, generateFAQ } from './seo/facts.js';
import { generateSchema } from './seo/schema.js';
import { buildMetaTags } from './seo/meta.js';

// =====================================================
// CONFIGURATION CONSTANTS
// =====================================================

// GOVERNANCE: Design profiles are immutable once published.
// Do not modify published profiles. Any change requires a new version ID.
// See DESIGN_PROFILE_GOVERNANCE_v1.md for full rules.
const DESIGN_PROFILES = {
  "luxury-heritage-v1": luxuryHeritage,
  "modern-premium-v1": modernPremium
};

// =====================================================
// DESIGN PROFILE VARIANTS - PHASE 2
// =====================================================
// Variant Strategy:
// - Base profiles remain unchanged (e.g., luxury-heritage-v1)
// - Variants are cosmetic-only (spacing, color mood, motion)
// - Variants must NOT change semantics or layout roles
// - Variants inherit from a base profile
//
// Defined variants for luxury-heritage:
// - calm: More spacious, slower motion, softer accent
// - bold: Tighter spacing, faster motion, vibrant accent
// =====================================================

const DESIGN_PROFILE_VARIANTS = {
  "luxury-heritage-v1--calm": luxuryHeritageCalm,
  "luxury-heritage-v1--bold": luxuryHeritageBold
};

// =====================================================
// EVENT SCHEMA - PHASE 5
// =====================================================
// Privacy-first, SSR-aware event schema.
// Governance: See METRICS_GOVERNANCE_v1.md
//
// Allowed fields:
// - event: String (page_view | cta_click)
// - slug: String (resort identifier)
// - profileId: String (design profile ID)
// - variantId: String | null (design variant ID)
// - experimentId: String | null (experiment ID, if active)
// - experimentVariant: String | null (A | B, if active)
// - ctaName: String | null (booking | whatsapp, for cta_click only)
// - tsBucket: String (ISO timestamp bucketed to nearest hour)
//
// Forbidden fields (NEVER collect):
// - IP addresses, user agents, fingerprints, PII
// - Precise timestamps, session IDs, cookie values
// - Behavioral sequences, cross-site identifiers
// =====================================================

const EVENT_SCHEMA = {
  allowedEvents: ["page_view", "cta_click"],
  requiredFields: ["event", "slug", "tsBucket"],
  optionalFields: ["profileId", "variantId", "experimentId", "experimentVariant", "ctaName"],
  forbiddenFields: [
    "ip", "userAgent", "fingerprint", "sessionId", "userId",
    "cookieId", "deviceId", "timestamp", "email", "phone"
  ]
};

const RESERVED_SUBDOMAINS = [
  'www', 'api', 'admin', 'operator', 'dashboard',
  'app', 'cdn', 'assets', 'static', 'staging', 'dev', 'img'
];

const VALID_SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

// =====================================================
// BOOKING WORKSPACE SHARDING (Zero-Ops Scale)
// =====================================================
// Goal:
// - Route booking sink (Apps Script) by workspaceId.
// - Allocate workspaceId at site creation time (publish) with capacity guardrails.
// - Keep backward compatible defaults: if registry/config missing, fall back to env.BOOKING_WEBHOOK_URL.

const BOOKING_WORKSPACE_REGISTRY_KEY = 'booking:workspaces';
const DEFAULT_WORKSPACE_CAPACITY_SITES = 50000;

// =====================================================
// PERFORMANCE: SSR EDGE CACHE + IN-MEM KV CACHE
// =====================================================
// Goals:
// - Improve cache hit rate by normalizing SSR cache keys (ignore tracking query params).
// - Reduce KV reads on cache misses by caching template/config in-memory per isolate.

const SSR_EDGE_CACHE_TTL_SECONDS = 60;
const MEM_TEMPLATE_TTL_MS = 5 * 60 * 1000;
const MEM_CONFIG_TTL_MS = 60 * 1000;
const MEM_CACHE_MAX_CONFIGS = 200;

const __mem = {
  templateSmartNav: { value: null, expiresAt: 0 },
  configs: new Map()
};

function shouldBypassSSRCache(request, url) {
  if (url.searchParams.has('__nocache')) return true;
  if (url.searchParams.get('cache') === '0') return true;

  const cacheControl = request.headers.get('Cache-Control') || '';
  const pragma = request.headers.get('Pragma') || '';
  if (/no-cache|no-store|max-age=0/i.test(cacheControl)) return true;
  if (/no-cache/i.test(pragma)) return true;
  return false;
}

function buildSSRCacheKeyRequest(url) {
  // Normalize: ignore query params (utm/fbclid/etc) for better hit rate.
  const keyUrl = new URL(url.toString());
  keyUrl.search = '';
  keyUrl.hash = '';
  return new Request(keyUrl.toString(), { method: 'GET' });
}

async function getSmartNavTemplate(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && __mem.templateSmartNav.value && __mem.templateSmartNav.expiresAt > now) {
    return __mem.templateSmartNav.value;
  }
  const template = await env.RESORT_CONFIGS.get('template:smart-nav', { type: 'text' });
  __mem.templateSmartNav.value = template;
  __mem.templateSmartNav.expiresAt = now + MEM_TEMPLATE_TTL_MS;
  return template;
}

async function getPropertyConfigSafe(env, slug, forceRefresh = false) {
  const key = `config:${slug}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = __mem.configs.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
  }

  const config = await kvGetJSONSafe(env.RESORT_CONFIGS, key);

  // Prevent unbounded growth across many slugs.
  if (__mem.configs.size >= MEM_CACHE_MAX_CONFIGS) __mem.configs.clear();
  __mem.configs.set(key, { value: config, expiresAt: now + MEM_CONFIG_TTL_MS });
  return config;
}

async function getPropertyConfigSafeUncached(env, slug) {
  // Use for mutation endpoints (read-modify-write) to reduce risk of stale overwrites.
  const key = `config:${slug}`;
  return await kvGetJSONSafe(env.RESORT_CONFIGS, key);
}

async function getBookingWorkspaceRegistry(env) {
  let registry = null;
  try {
    registry = await kvGetJSONSafe(env.RESORT_CONFIGS, BOOKING_WORKSPACE_REGISTRY_KEY);
  } catch (e) {
    registry = null;
  }

  if (!registry || typeof registry !== 'object') {
    return buildDefaultBookingWorkspaceRegistry(env);
  }

  return normalizeBookingWorkspaceRegistry(registry, env);
}

function buildDefaultBookingWorkspaceRegistry(env) {
  // Single-workspace default for backward compatibility.
  const url = (env.BOOKING_WEBHOOK_URL || '').toString().trim();
  return {
    version: 1,
    defaultCapacitySites: DEFAULT_WORKSPACE_CAPACITY_SITES,
    workspaces: [
      {
        id: 'ws1',
        label: 'Workspace 1',
        bookingWebhookUrl: url,
        capacitySites: DEFAULT_WORKSPACE_CAPACITY_SITES,
        siteCount: 0,
        enabled: true
      }
    ],
    updatedAt: new Date().toISOString()
  };
}

function normalizeBookingWorkspaceRegistry(registry, env) {
  const out = { ...registry };
  out.version = out.version || 1;
  out.defaultCapacitySites = Number(out.defaultCapacitySites || DEFAULT_WORKSPACE_CAPACITY_SITES) || DEFAULT_WORKSPACE_CAPACITY_SITES;
  out.workspaces = Array.isArray(out.workspaces) ? out.workspaces : [];

  if (out.workspaces.length === 0) {
    const fallback = buildDefaultBookingWorkspaceRegistry(env);
    out.workspaces = fallback.workspaces;
  }

  out.workspaces = out.workspaces.map((ws, idx) => {
    const id = (ws?.id || `ws${idx + 1}`).toString().trim();
    return {
      id,
      label: (ws?.label || id).toString(),
      bookingWebhookUrl: (ws?.bookingWebhookUrl || '').toString().trim(),
      capacitySites: Number(ws?.capacitySites || out.defaultCapacitySites) || out.defaultCapacitySites,
      siteCount: Number(ws?.siteCount || 0) || 0,
      enabled: ws?.enabled !== false
    };
  });

  return out;
}

function resolveWorkspaceById(registry, workspaceId) {
  const id = (workspaceId || '').toString().trim();
  if (!id) return null;
  return (registry.workspaces || []).find(w => w.id === id) || null;
}

async function allocateWorkspaceIdForNewSite(env, requestedWorkspaceId) {
  const registry = await getBookingWorkspaceRegistry(env);

  // Manual override (if provided and exists).
  if (requestedWorkspaceId) {
    const ws = resolveWorkspaceById(registry, requestedWorkspaceId);
    if (ws && ws.enabled) {
      return { registry, workspaceId: ws.id, chosen: ws, updatedRegistry: null };
    }
  }

  // Auto allocation: fill in order until capacity (default 50k).
  const enabled = (registry.workspaces || []).filter(w => w.enabled);
  let chosen = enabled.find(w => (w.siteCount || 0) < (w.capacitySites || registry.defaultCapacitySites));
  if (!chosen) chosen = enabled[0] || null;

  if (!chosen) {
    // Worst-case fallback to ws1.
    chosen = { id: 'ws1', bookingWebhookUrl: (env.BOOKING_WEBHOOK_URL || '').toString().trim(), enabled: true };
  }

  // Increment siteCount (best-effort).
  const updatedRegistry = { ...registry };
  updatedRegistry.workspaces = (registry.workspaces || []).map(w => {
    if (w.id !== chosen.id) return w;
    return { ...w, siteCount: (Number(w.siteCount || 0) || 0) + 1 };
  });
  updatedRegistry.updatedAt = new Date().toISOString();

  try {
    await env.RESORT_CONFIGS.put(BOOKING_WORKSPACE_REGISTRY_KEY, JSON.stringify(updatedRegistry));
  } catch (e) {
    console.warn('[WORKSPACES] Failed to persist registry update:', e?.message || e);
  }

  return { registry, workspaceId: chosen.id, chosen, updatedRegistry };
}

// 8 Pre-built Themes (NEW in v7.2)
const THEMES = {
  'ocean-breeze': {
    name: 'Ocean Breeze',
    primary: '#14b8a6',
    accent: '#f59e0b'
  },
  'royal-purple': {
    name: 'Royal Purple',
    primary: '#8b5cf6',
    accent: '#ec4899'
  },
  'sky-blue': {
    name: 'Sky Blue',
    primary: '#3b82f6',
    accent: '#06b6d4'
  },
  'fresh-mint': {
    name: 'Fresh Mint',
    primary: '#10b981',
    accent: '#84cc16'
  },
  'sunset-orange': {
    name: 'Sunset Orange',
    primary: '#f97316',
    accent: '#eab308'
  },
  'fiery-red': {
    name: 'Fiery Red',
    primary: '#ef4444',
    accent: '#f59e0b'
  },
  'modern-gray': {
    name: 'Modern Gray',
    primary: '#6b7280',
    accent: '#14b8a6'
  },
  'cherry-blossom': {
    name: 'Cherry Blossom',
    primary: '#ec4899',
    accent: '#f97316'
  }
};

// Universal Categories (NEW in v7.2)
const CATEGORIES = [
  'homestay', 'resort', 'hotel', 'villa', 'cottage',
  'restaurant', 'cafe', 'shop', 'services', 'others'
];

// Pricing Plans (UPDATED in v7.2)
const PRICING_PLANS = {
  basic: {
    name: 'Basic',
    price: 99,
    whatsapp_quota: 20,
    sms_quota: 0
  },
  premium: {
    name: 'Premium',
    price: 199,
    whatsapp_quota: 50,
    sms_quota: 0
  },
  professional: {
    name: 'Professional',
    price: 499,
    whatsapp_quota: 200,
    sms_quota: 0
  },
  enterprise: {
    name: 'Enterprise',
    price: 999,
    whatsapp_quota: 9999,
    sms_quota: 0
  }
};

// Category Default Prices (NEW in v7.2)
const CATEGORY_PRICES = {
  homestay: 1500,
  resort: 5000,
  hotel: 3000,
  villa: 8000,
  cottage: 2000,
  restaurant: 500,
  cafe: 200,
  shop: 0,
  services: 0,
  others: 0
};

// =====================================================
// MEDIA STORAGE CONSTANTS (NEW in v7.3)
// =====================================================

// Image resize widths (fixed, no arbitrary resizing)
const ALLOWED_WIDTHS = [320, 640, 1024, 1600];

// Maximum file sizes by media type (in bytes)
const MAX_SIZES = {
  logo: 5 * 1024 * 1024,      // 5 MB
  gallery: 50 * 1024 * 1024,  // 50 MB
  product: 20 * 1024 * 1024   // 20 MB
};

// Allowed MIME types for uploads
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];

// Image quota limits by plan tier
const QUOTA_LIMITS = {
  trial: {
    logo: 1,
    gallery: 5,
    product: 0
  },
  basic: {
    logo: 1,
    gallery: 10,
    product: 5
  },
  premium: {
    logo: 1,
    gallery: 25,
    product: 15
  },
  professional: {
    logo: 3,
    gallery: 50,
    product: 40
  },
  enterprise: {
    logo: 5,
    gallery: 100,
    product: 80
  }
};

// =====================================================
// MAIN ROUTER
// =====================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const path = url.pathname;
    
    // =====================================================
    // SPECIAL HANDLING FOR IMG SUBDOMAIN (Check FIRST - highest priority)
    // =====================================================
    
    // Special handling for img subdomain - serve images directly
    if (hostname === 'img.webzyl.com' || hostname.startsWith('img.')) {
      // Rewrite path to add /img prefix
      const rewrittenUrl = new URL(request.url);
      rewrittenUrl.pathname = '/img' + path;
      const rewrittenRequest = new Request(rewrittenUrl.toString(), request);
      return handleMediaServe(rewrittenRequest, env);
    }

    // =====================================================
    // WEBZYL BRAND HOMEPAGE (www.webzyl.com and webzyl.com)
    // =====================================================

    if (hostname === 'webzyl.com' || hostname === 'www.webzyl.com') {
      // Skip API paths - they're handled later
      if (!path.startsWith('/api/')) {
        // Serve super admin dashboard at /super-admin path
        if (path === '/super-admin' || path === '/super-admin/') {
          return handleSuperAdminDashboard(request, env);
        }
        // Serve admin dashboard (CEO dashboard) at /admin path
        if (path === '/admin' || path === '/admin/') {
          return handleCEOAdminDashboard(request, env);
        }
        // Serve operator dashboard at /operator path
        if (path === '/operator' || path === '/operator/') {
          return handleOperatorDashboard(request, env);
        }
        // Serve the Webzyl brand identity page
        return handleBrandHomepage(request, env, ctx);
      }
    }

    // =====================================================
    // IMAGE SERVING (Check FIRST - highest priority)
    // =====================================================

    if (path.startsWith('/img/')) {
      return handleMediaServe(request, env);
    }

    // =====================================================
    // SEO ROUTES (CEO Directive #3 Compliant)
    // =====================================================

    // Route 1: robots.txt (zero KV operations)
    if (path === '/robots.txt') {
      return generateRobotsTxt(hostname);
    }

    // Route 2: Sitemap Index (lists 676 shard sitemaps, zero KV operations)
    if (path === '/sitemap.xml') {
      return generateSitemapIndex(hostname);
    }

    // Route 3: Per-Shard Sitemaps (aa-zz, 676 total, cached per-shard)
    const sitemapMatch = path.match(/^\/sitemap-([a-z]{2})\.xml$/);
    if (sitemapMatch) {
      const prefix = sitemapMatch[1];
      return await generateSitemapShard(env.RESORT_CONFIGS, prefix, hostname);
    }

    // =====================================================
    // AGENT-FIRST JSON ENDPOINTS (AI Search Era)
    // =====================================================
    // Route 4: facts.json - Machine-readable site facts for AI search engines
    // (OpenAI SearchGPT, Google SGE, Perplexity AI)
    if (path === '/facts.json') {
      const slug = hostname.split('.')[0]; // Extract slug from subdomain
      const sitepkg = await getPropertyConfigSafe(env, slug);

      if (!sitepkg) {
        return new Response(JSON.stringify({ error: 'Site not found' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'X-Webzyl-Route': 'facts',
            'X-Webzyl-KV-Ops': '1'
          }
        });
      }

      return generateFacts(sitepkg, hostname);
    }

    // Route 5: faq.json - FAQ structured data for AI search engines
    if (path === '/faq.json') {
      const slug = hostname.split('.')[0]; // Extract slug from subdomain
      const sitepkg = await getPropertyConfigSafe(env, slug);

      if (!sitepkg) {
        return new Response(JSON.stringify({ error: 'Site not found' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'X-Webzyl-Route': 'faq',
            'X-Webzyl-KV-Ops': '1'
          }
        });
      }

      return generateFAQ(sitepkg, hostname);
    }

    // =====================================================
    // DATA ENDPOINT (Critical: Check BEFORE subdomain routing)
    // =====================================================
    
    if (path.startsWith('/data/') && path.endsWith('.json')) {
      const slug = path.split('/')[2].replace('.json', '');
      console.log(`[DATA] Request for: ${slug}`);
      return handleDataRequest(slug, env);
    }
    
    // =====================================================
    // SUBDOMAIN ROUTING (Uses same SSR as /s/ path)
    // =====================================================
    
    const propertySlug = extractPropertySlug(hostname);
    
    if (propertySlug) {
      console.log(`[SUBDOMAIN] Detected property: ${propertySlug}`);

      // IMPORTANT: Subdomain requests may still need API routes.
      // Without this, endpoints like /api/booking fall through to SSR and return HTML.
      if (path.startsWith('/api/') && request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-CEO-Token, X-Admin-Token',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      // Admin dashboard routes should also work on subdomains (token-protected, read-only).
      // This is used for production diagnostics (e.g., email routing inspection).
      if (path.startsWith('/__admin')) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type',
              'Access-Control-Max-Age': '86400',
            }
          });
        }

        // Access guard: Require admin token
        if (!validateAdminToken(request, env)) {
          console.warn(`[ADMIN] Unauthorized access attempt to ${path}`);
          return new Response('Forbidden', {
            status: 403,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          });
        }

        if (path === '/__admin' && request.method === 'GET') {
          return handleAdminDashboard(request, env);
        }

        if (path === '/__admin/sites' && request.method === 'GET') {
          return handleAdminSites(request, env);
        }

        if (path === '/__admin/site' && request.method === 'GET') {
          return handleAdminSite(request, env);
        }

        // Maintenance/debug endpoint: reset booking throttles for a site.
        // POST /__admin/booking/reset?slug=grand-royal
        if (path === '/__admin/booking/reset' && request.method === 'POST') {
          return handleAdminResetBooking(request, env);
        }

        if (path === '/__admin/experiments' && request.method === 'GET') {
          return handleAdminExperiments(request, env);
        }

        if (path === '/__admin/metrics' && request.method === 'GET') {
          return handleAdminMetrics(request, env);
        }

        return new Response('Not Found', {
          status: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      if (path === '/api/booking') {
        return handleBookingRequest(request, env, ctx);
      }

      if (path === '/api/event' && request.method === 'POST') {
        return handleEventTrackingRequest(request, env);
      }

      // Edge cache for SSR HTML (fast TTFB). Short TTL to keep config changes fresh.
      const bypassSSRCache = shouldBypassSSRCache(request, url);
      if (request.method === 'GET' && !bypassSSRCache) {
        const cache = caches.default;
        const cacheKey = buildSSRCacheKeyRequest(url);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const hit = new Response(cached.body, cached);
          hit.headers.set('X-Webzyl-Cache', 'HIT');

          // Preserve SSR analytics even on cache hits.
          const cachedSlug = hit.headers.get('X-Webzyl-Slug') || propertySlug;
          const cachedProfileId = hit.headers.get('X-Webzyl-Profile') || null;
          const cachedVariantId = hit.headers.get('X-Webzyl-Variant') || null;
          const cachedExperimentId = hit.headers.get('X-Webzyl-Experiment') || null;
          const cachedExperimentVariant = hit.headers.get('X-Webzyl-Experiment-Variant') || null;
          emitEvent(env, {
            event: 'page_view',
            slug: cachedSlug,
            profileId: cachedProfileId,
            variantId: cachedVariantId,
            experimentId: cachedExperimentId,
            experimentVariant: cachedExperimentVariant
          }).catch(err => console.error('[METRICS] Event emission failed:', err));

          return hit;
        }
      }

      let config = null;
      try {
        config = await getPropertyConfigSafe(env, propertySlug, bypassSSRCache);
      } catch (err) {
        console.error('[CONFIG] Failed to load config JSON:', err?.message || err);
        return new Response('Property configuration error', { status: 500 });
      }
      
      if (!config || config.status !== 'active') {
        return new Response('Property not found', { status: 404 });
      }

      // Ensure slug is present for client-side booking form submissions.
      if (!config.slug) config.slug = propertySlug;
      
      // Load design profile (optional - fallback to legacy template)
      const designProfileId = config.branding?.designProfileId;
      let designProfile = null;
      
      if (designProfileId) {
        if (!DESIGN_PROFILES[designProfileId]) {
          throw new Error(`Unknown design profile: ${designProfileId}`);
        }
        designProfile = DESIGN_PROFILES[designProfileId];
      }
      
      // Phase 3: Check for active experiment (only if design profile exists)
      let variantId = null;
      if (designProfile) {
        if (config.experiment?.id) {
          const experimentVariant = resolveExperimentVariant(config);
          const mappedVariant = mapExperimentToDesignVariant(config.experiment.id, experimentVariant, designProfileId);

          if (mappedVariant) {
            variantId = mappedVariant;
            console.log(`[Experiment] ${propertySlug} → ${config.experiment.id} : ${experimentVariant}`);
          } else {
            // Fallback to Phase 2 variant resolution if experiment mapping doesn't exist
            variantId = resolveDesignProfileVariant(config);
          }
        } else {
          // Phase 2: Resolve and apply variant (no experiment)
          variantId = resolveDesignProfileVariant(config);
        }
        
        // Apply variant override
        const variantKey = `${designProfileId}--${variantId}`;
        if (DESIGN_PROFILE_VARIANTS[variantKey]) {
          const variant = DESIGN_PROFILE_VARIANTS[variantKey];
          designProfile = mergeProfileWithVariant(designProfile, variant);
          console.log(`[DesignProfile] ${propertySlug} → ${designProfileId} + ${variantId}`);
        } else {
          console.log(`[DesignProfile] ${propertySlug} → ${designProfileId}`);
        }
      } else {
        console.log(`[Legacy] ${propertySlug} → Using legacy template (no design profile)`);
      }
      
      const template = await getSmartNavTemplate(env, bypassSSRCache);
      
      if (!template) {
        return new Response('Template not configured. Please upload template to KV.', { status: 500 });
      }
      
      const html = renderSmartTemplate(config, template, designProfile, env, ctx);
      
      // Phase 5: Emit page_view event (non-blocking, fire-and-forget)
      emitEvent(env, {
        event: 'page_view',
        slug: propertySlug,
        profileId: designProfileId || null,
        variantId: variantId || null,
        experimentId: config.experiment?.id || null,
        experimentVariant: config.experiment?.id ? resolveExperimentVariant(config) : null
      }).catch(err => console.error('[METRICS] Event emission failed:', err));
      
      const response = new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Cache briefly for speed (Cache API requires a positive max-age to store).
          'Cache-Control': `public, max-age=${SSR_EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
          'CDN-Cache-Control': `public, max-age=${SSR_EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
          'X-Webzyl-Slug': propertySlug,
          'X-Webzyl-Profile': designProfileId || '',
          'X-Webzyl-Variant': variantId || '',
          'X-Webzyl-Experiment': config.experiment?.id || '',
          'X-Webzyl-Experiment-Variant': config.experiment?.id ? (resolveExperimentVariant(config) || '') : '',
          'X-Webzyl-Cache': 'MISS'
        }
      });

      if (request.method === 'GET' && !bypassSSRCache) {
        const cache = caches.default;
        const cacheKey = buildSSRCacheKeyRequest(url);
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    }
    
    // =====================================================
    // CORS PREFLIGHT
    // =====================================================
    
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-CEO-Token, X-Admin-Token',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
    
    // =====================================================
    // OPERATOR DASHBOARD APIs (Preserved from v7.1)
    // =====================================================
    
    if (path === '/api/operator/login' && request.method === 'GET') {
      return handleOperatorLogin(request, env);
    }
    
    if (path.startsWith('/api/operator/dashboard/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorDashboardData(operatorSlug, env);
    }

    // Backward/alternate operator update endpoint (no slug in path)
    // Some operator UIs POST to /api/operator/update with slug in body/query.
    if (path === '/api/operator/update' && request.method === 'POST') {
      let updates = null;
      try {
        updates = await request.json();
      } catch (e) {
        updates = null;
      }

      const url = new URL(request.url);
      const slugFromQuery = (url.searchParams.get('slug') || '').toString().trim();
      const slugFromBody = (updates && typeof updates === 'object' ? (updates.slug || updates.propertySlug || updates.operatorSlug) : '')
        .toString()
        .trim();

      const resolvedSlug = slugFromQuery || slugFromBody;
      if (!resolvedSlug) {
        return jsonResponse({ error: 'Slug is required' }, 400);
      }

      return handleOperatorUpdateWithUpdates(env, resolvedSlug, updates || {});
    }
    
    if (path.startsWith('/api/operator/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[4];
      return handleOperatorUpdate(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/bookings/')) {
      const operatorSlug = path.split('/')[4];
      return handleOperatorBookings(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/gallery/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpload(request, env, operatorSlug);
    }
    
    if (path.startsWith('/api/operator/hero/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleHeroUpload(request, env, operatorSlug);
    }

    if (path.startsWith('/api/operator/logo/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleLogoUpload(request, env, operatorSlug);
    }

    if (path.startsWith('/api/operator/room/upload/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleRoomImageUpload(request, env, operatorSlug);
    }

    if (path.startsWith('/api/operator/gallery/update/') && request.method === 'POST') {
      const operatorSlug = path.split('/')[5];
      return handleGalleryUpdate(request, env, operatorSlug);
    }
    
    // =====================================================
    // LEGACY APIs (Compatibility)
    // =====================================================
    
    if (path === '/api/admin/publish' && request.method === 'POST') {
      return handlePublish(request, env);
    }
    
    if (path.startsWith('/api/config/')) {
      const configSlug = path.split('/').pop();
      return handleGetConfig(configSlug, env);
    }
    
    if (path === '/api/booking') {
      return handleBookingRequest(request, env, ctx);
    }
    
    // =====================================================
    // EVENT TRACKING ENDPOINT - PHASE 5
    // =====================================================
    // Privacy-first event collection from frontend.
    // Receives cta_click events, enriches with profile/variant data.
    // Governance: See METRICS_GOVERNANCE_v1.md
    // =====================================================
    
    if (path === '/api/event' && request.method === 'POST') {
      return handleEventTrackingRequest(request, env);
    }

    // =====================================================
    // INTERNAL: SITEMAP CACHE INVALIDATION
    // =====================================================
    // Called by Google Apps Script after publishing a site.
    // Invalidates only the affected shard cache (prefix-scoped).
    // CEO Directive #3 Compliant - surgical cache invalidation.
    // =====================================================

    if (path === '/_internal/invalidate-sitemap' && request.method === 'POST') {
      return handleSitemapCacheInvalidation(request, env);
    }

    // =====================================================
    // ADMIN TEMPLATE MANAGEMENT
    // =====================================================
    // Allows updating the KV-backed HTML template that SSR uses.
    // Security: Requires X-Admin-Token header
    // Key: template:smart-nav
    // =====================================================

    if (path === '/api/admin/template/smart-nav') {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (request.method === 'GET' || request.method === 'PUT') {
        return handleAdminSmartNavTemplate(request, env);
      }

      return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // =====================================================
    // BOOKING WORKSPACE REGISTRY (Admin + CEO)
    // =====================================================
    // Stored in KV key: booking:workspaces
    // Used for routing booking sink (Apps Script) by workspaceId.

    if (path === '/api/admin/workspaces') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (!validateAdminToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (request.method === 'GET') {
        const registry = await getBookingWorkspaceRegistry(env);
        return jsonResponse({ ok: true, registry }, 200);
      }

      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        const incoming = body?.registry || body;
        const normalized = normalizeBookingWorkspaceRegistry(incoming || {}, env);
        normalized.updatedAt = new Date().toISOString();
        await env.RESORT_CONFIGS.put(BOOKING_WORKSPACE_REGISTRY_KEY, JSON.stringify(normalized));
        return jsonResponse({ ok: true, registry: normalized }, 200);
      }

      return new Response('Method Not Allowed', { status: 405, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (path === '/api/admin/site-workspace' && request.method === 'POST') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (!validateAdminToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { slug, workspaceId } = await request.json().catch(() => ({}));
      const s = (slug || '').toString().trim();
      const w = (workspaceId || '').toString().trim();

      if (!VALID_SLUG_PATTERN.test(s)) {
        return jsonResponse({ ok: false, error: 'invalid_slug' }, 400);
      }
      if (!w) {
        return jsonResponse({ ok: false, error: 'missing_workspaceId' }, 400);
      }

      const registry = await getBookingWorkspaceRegistry(env);
      const ws = resolveWorkspaceById(registry, w);
      if (!ws || ws.enabled === false) {
        return jsonResponse({ ok: false, error: 'invalid_workspace' }, 400);
      }

      const config = await getPropertyConfigSafeUncached(env, s);
      if (!config) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
      }

      config.workspaceId = w;
      if (!config.booking) config.booking = {};
      config.booking.workspaceId = w;
      config.updatedAt = new Date().toISOString();

      await env.RESORT_CONFIGS.put(`config:${s}`, JSON.stringify(config));
      return jsonResponse({ ok: true, slug: s, workspaceId: w }, 200);
    }

    // SUPER ADMIN: Update any config field
    if (path === '/api/admin/config/update' && request.method === 'POST') {
      if (!validateAdminToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { slug, updates } = await request.json().catch(() => ({}));
      const s = (slug || '').toString().trim();

      if (!VALID_SLUG_PATTERN.test(s)) {
        return jsonResponse({ ok: false, error: 'invalid_slug' }, 400);
      }

      const config = await getPropertyConfigSafeUncached(env, s);
      if (!config) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
      }

      // Apply all updates from super admin
      Object.keys(updates).forEach(key => {
        config[key] = updates[key];
      });

      config.updatedAt = new Date().toISOString();

      await env.RESORT_CONFIGS.put(`config:${s}`, JSON.stringify(config));
      return jsonResponse({ ok: true, slug: s, updated: Object.keys(updates) }, 200);
    }

    // SUPER ADMIN: Change property slug
    if (path === '/api/admin/config/change-slug' && request.method === 'POST') {
      if (!validateAdminToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { oldSlug, newSlug } = await request.json().catch(() => ({}));
      const oldS = (oldSlug || '').toString().trim();
      const newS = (newSlug || '').toString().trim();

      if (!VALID_SLUG_PATTERN.test(oldS) || !VALID_SLUG_PATTERN.test(newS)) {
        return jsonResponse({ ok: false, error: 'invalid_slug' }, 400);
      }

      const oldConfig = await getPropertyConfigSafeUncached(env, oldS);
      if (!oldConfig) {
        return jsonResponse({ ok: false, error: 'old_slug_not_found' }, 404);
      }

      const newExists = await getPropertyConfigSafeUncached(env, newS);
      if (newExists) {
        return jsonResponse({ ok: false, error: 'new_slug_already_exists' }, 409);
      }

      // Update slug in config
      oldConfig.slug = newS;
      oldConfig.subdomain = newS;
      oldConfig.updatedAt = new Date().toISOString();

      // Save to new key
      await env.RESORT_CONFIGS.put(`config:${newS}`, JSON.stringify(oldConfig));

      // Delete old key
      await env.RESORT_CONFIGS.delete(`config:${oldS}`);

      return jsonResponse({ ok: true, oldSlug: oldS, newSlug: newS }, 200);
    }

    // SUPER ADMIN: Reset WhatsApp quota
    if (path === '/api/admin/quota/reset' && request.method === 'POST') {
      if (!validateAdminToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { slug, quotaType } = await request.json().catch(() => ({}));
      const s = (slug || '').toString().trim();

      if (!VALID_SLUG_PATTERN.test(s)) {
        return jsonResponse({ ok: false, error: 'invalid_slug' }, 400);
      }

      const config = await getPropertyConfigSafeUncached(env, s);
      if (!config) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
      }

      // Reset quota based on type
      if (quotaType === 'whatsapp' || !quotaType) {
        config.quota_whatsapp_used = 0;
        const now = new Date();
        config.quota_used_month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }

      config.updatedAt = new Date().toISOString();

      await env.RESORT_CONFIGS.put(`config:${s}`, JSON.stringify(config));
      return jsonResponse({ ok: true, slug: s, quotaType: quotaType || 'whatsapp', reset: true }, 200);
    }

    // CEO variants (same capabilities, CEO auth)
    if (path === '/api/ceo/workspaces') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'X-CEO-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (request.method === 'GET') {
        const registry = await getBookingWorkspaceRegistry(env);
        return jsonResponse({ ok: true, registry }, 200);
      }

      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        const incoming = body?.registry || body;
        const normalized = normalizeBookingWorkspaceRegistry(incoming || {}, env);
        normalized.updatedAt = new Date().toISOString();
        await env.RESORT_CONFIGS.put(BOOKING_WORKSPACE_REGISTRY_KEY, JSON.stringify(normalized));
        return jsonResponse({ ok: true, registry: normalized }, 200);
      }

      return new Response('Method Not Allowed', { status: 405, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (path === '/api/ceo/site-workspace' && request.method === 'POST') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'X-CEO-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      const { slug, workspaceId } = await request.json().catch(() => ({}));
      const s = (slug || '').toString().trim();
      const w = (workspaceId || '').toString().trim();

      if (!VALID_SLUG_PATTERN.test(s)) {
        return jsonResponse({ ok: false, error: 'invalid_slug' }, 400);
      }
      if (!w) {
        return jsonResponse({ ok: false, error: 'missing_workspaceId' }, 400);
      }

      const registry = await getBookingWorkspaceRegistry(env);
      const ws = resolveWorkspaceById(registry, w);
      if (!ws || ws.enabled === false) {
        return jsonResponse({ ok: false, error: 'invalid_workspace' }, 400);
      }

      const config = await getPropertyConfigSafeUncached(env, s);
      if (!config) {
        return jsonResponse({ ok: false, error: 'not_found' }, 404);
      }

      config.workspaceId = w;
      if (!config.booking) config.booking = {};
      config.booking.workspaceId = w;
      config.updatedAt = new Date().toISOString();

      await env.RESORT_CONFIGS.put(`config:${s}`, JSON.stringify(config));
      return jsonResponse({ ok: true, slug: s, workspaceId: w }, 200);
    }
    
    // =====================================================
    // ADMIN DASHBOARD ROUTES - PHASE 6 (READ-ONLY)
    // =====================================================
    // Internal operator dashboard for system visibility.
    // Governance: See ADMIN_DASHBOARD_SCOPE_v1.md
    // Security: Requires X-Admin-Token header
    // Strictly READ-ONLY - no mutations allowed
    // =====================================================
    
    if (path.startsWith('/__admin')) {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Admin-Token, Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }
      
      // Access guard: Require admin token
      if (!validateAdminToken(request, env)) {
        console.warn(`[ADMIN] Unauthorized access attempt to ${path}`);
        return new Response('Forbidden', { 
          status: 403,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
      
      // Route to specific admin handlers
      if (path === '/__admin' && request.method === 'GET') {
        return handleAdminDashboard(request, env);
      }
      
      if (path === '/__admin/sites' && request.method === 'GET') {
        return handleAdminSites(request, env);
      }

      if (path === '/__admin/site' && request.method === 'GET') {
        return handleAdminSite(request, env);
      }

      // Maintenance/debug endpoint: reset booking throttles for a site.
      // POST /__admin/booking/reset?slug=grand-royal
      if (path === '/__admin/booking/reset' && request.method === 'POST') {
        return handleAdminResetBooking(request, env);
      }
      
      if (path === '/__admin/experiments' && request.method === 'GET') {
        return handleAdminExperiments(request, env);
      }
      
      if (path === '/__admin/metrics' && request.method === 'GET') {
        return handleAdminMetrics(request, env);
      }
      
      // Unknown admin route
      return new Response('Not Found', { 
        status: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    }
    
    // =====================================================
    // MEDIA UPLOAD ROUTES (NEW in v7.3)
    // =====================================================
    
    if (path === '/api/media/sign-upload' && request.method === 'POST') {
      return handleMediaSignUpload(request, env);
    }
    
    if (path === '/api/media/confirm-upload' && request.method === 'POST') {
      return handleMediaConfirmUpload(request, env);
    }
    
    if (path.startsWith('/api/media/assets/') && request.method === 'DELETE') {
      const assetId = path.split('/')[4];
      return handleMediaDelete(request, env, assetId);
    }
    
    if (path === '/api/media/assets' && request.method === 'GET') {
      return handleMediaList(request, env);
    }
    
    // =====================================================
    // CEO DASHBOARD APIs (v7.2 - Updated Routes)
    // =====================================================
    
    function validateCEOToken(request, env) {
      const token = request.headers.get('X-CEO-Token');
      if (!token || token !== env.CEO_TOKEN) {
        return false;
      }
      return true;
    }
    
    if (path === '/api/ceo/property/generate' && request.method === 'POST') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleCEOGenerate(request, env);
    }
    
    if (path === '/api/ceo/property/publish' && request.method === 'POST') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleCEOPublish(request, env);
    }
    
    if (path === '/api/ceo/properties' && request.method === 'GET') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleCEOProperties(env);
    }
    
    if (path.startsWith('/api/ceo/property/') && request.method === 'GET') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      const slug = path.split('/')[4];
      return handleCEOGetProperty(slug, env);
    }
    
    if (path.startsWith('/api/ceo/property/') && request.method === 'DELETE') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      const slug = path.split('/')[4];
      return handleCEODeleteProperty(slug, env);
    }

    // =====================================================
    // CEO TIER MANAGEMENT ENDPOINTS
    // =====================================================

    if (path === '/api/ceo/tiers' && request.method === 'GET') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleCEOGetTiers(env);
    }

    if (path === '/api/ceo/tiers' && request.method === 'PUT') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return handleCEOUpdateTiers(request, env);
    }

    if (path.match(/^\/api\/ceo\/property\/[^\/]+\/plan$/) && request.method === 'POST') {
      if (!validateCEOToken(request, env)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      const slug = path.split('/')[4];
      return handleCEOUpdatePropertyPlan(slug, request, env);
    }

    if (path.startsWith('/s/')) {
      const pathname = path;
      const slug = pathname.split('/s/')[1].replace('/', '');

      // Edge cache for SSR HTML (fast TTFB). Short TTL to keep config changes fresh.
      const bypassSSRCache = shouldBypassSSRCache(request, url);
      if (request.method === 'GET' && !bypassSSRCache) {
        const cache = caches.default;
        const cacheKey = buildSSRCacheKeyRequest(url);
        const cached = await cache.match(cacheKey);
        if (cached) {
          const hit = new Response(cached.body, cached);
          hit.headers.set('X-Webzyl-Cache', 'HIT');

          const cachedSlug = hit.headers.get('X-Webzyl-Slug') || slug;
          const cachedProfileId = hit.headers.get('X-Webzyl-Profile') || null;
          const cachedVariantId = hit.headers.get('X-Webzyl-Variant') || null;
          const cachedExperimentId = hit.headers.get('X-Webzyl-Experiment') || null;
          const cachedExperimentVariant = hit.headers.get('X-Webzyl-Experiment-Variant') || null;
          emitEvent(env, {
            event: 'page_view',
            slug: cachedSlug,
            profileId: cachedProfileId,
            variantId: cachedVariantId,
            experimentId: cachedExperimentId,
            experimentVariant: cachedExperimentVariant
          }).catch(err => console.error('[METRICS] Event emission failed:', err));

          return hit;
        }
      }
      
      let config = null;
      try {
        config = await getPropertyConfigSafe(env, slug, bypassSSRCache);
      } catch (err) {
        console.error('[CONFIG] Failed to load config JSON:', err?.message || err);
        return new Response('Property configuration error', { status: 500 });
      }
      
      if (!config || config.status !== 'active') {
        return new Response('Property not found', { status: 404 });
      }

      // Ensure slug is present for client-side booking form submissions.
      if (!config.slug) config.slug = slug;
      
      // Load design profile (optional - fallback to legacy template)
      const designProfileId = config.branding?.designProfileId;
      let designProfile = null;
      
      if (designProfileId) {
        if (!DESIGN_PROFILES[designProfileId]) {
          throw new Error(`Unknown design profile: ${designProfileId}`);
        }
        designProfile = DESIGN_PROFILES[designProfileId];
      }
      
      // Phase 3: Check for active experiment (only if design profile exists)
      let variantId = null;
      if (designProfile) {
        if (config.experiment?.id) {
          const experimentVariant = resolveExperimentVariant(config);
          const mappedVariant = mapExperimentToDesignVariant(config.experiment.id, experimentVariant, designProfileId);
          
          if (mappedVariant) {
            variantId = mappedVariant;
            console.log(`[Experiment] ${slug} → ${config.experiment.id} : ${experimentVariant}`);
          } else {
            variantId = resolveDesignProfileVariant(config);
          }
        } else {
          variantId = resolveDesignProfileVariant(config);
        }
        
        // Apply variant override
        const variantKey = `${designProfileId}--${variantId}`;
        if (DESIGN_PROFILE_VARIANTS[variantKey]) {
          const variant = DESIGN_PROFILE_VARIANTS[variantKey];
          designProfile = mergeProfileWithVariant(designProfile, variant);
          console.log(`[DesignProfile] ${slug} → ${designProfileId} + ${variantId}`);
        } else {
          console.log(`[DesignProfile] ${slug} → ${designProfileId}`);
        }
      } else {
        console.log(`[Legacy] ${slug} → Using legacy template (no design profile)`);
      }
      
      const template = await getSmartNavTemplate(env, bypassSSRCache);
      
      if (!template) {
        return new Response('Template not configured. Please upload template to KV.', { status: 500 });
      }
      
      const html = renderSmartTemplate(config, template, designProfile, env, ctx);
      
      // Phase 5: Emit page_view event (non-blocking, fire-and-forget)
      emitEvent(env, {
        event: 'page_view',
        slug: slug,
        profileId: designProfileId,
        variantId: variantId || null,
        experimentId: config.experiment?.id || null,
        experimentVariant: config.experiment?.id ? resolveExperimentVariant(config) : null
      }).catch(err => console.error('[METRICS] Event emission failed:', err));
      
      const response = new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': `public, max-age=${SSR_EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
          'CDN-Cache-Control': `public, max-age=${SSR_EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
          'X-Webzyl-Slug': slug,
          'X-Webzyl-Profile': designProfileId || '',
          'X-Webzyl-Variant': variantId || '',
          'X-Webzyl-Experiment': config.experiment?.id || '',
          'X-Webzyl-Experiment-Variant': config.experiment?.id ? (resolveExperimentVariant(config) || '') : '',
          'X-Webzyl-Cache': 'MISS'
        }
      });

      if (request.method === 'GET' && !bypassSSRCache) {
        const cache = caches.default;
        const cacheKey = buildSSRCacheKeyRequest(url);
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;
    }
    
    // Root status
    if (path === '/') {
      return jsonResponse({
        status: 'ok',
        service: 'webzyl-worker',
        version: '7.2-universal',
        architecture: 'worker_as_router',
        features: {
          automatic_subdomains: 'slug.webzyl.com',
          data_endpoints: '/data/:slug.json',
          ceo_dashboard: '/api/ceo/* (token protected, CORS enabled)',
          universal_categories: CATEGORIES.length + ' categories',
          themes: Object.keys(THEMES).length + ' themes',
          operator_dashboard: '/api/operator/*',
          kv_authority: 'config:{slug} is source of truth'
        }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  },

  // =====================================================
  // CRON TRIGGERS (NEW - for media cleanup)
  // =====================================================

  async scheduled(event, env, ctx) {
    try {
      console.log(`[CRON] Triggered: ${event.cron}`);

      // Daily cleanup: 2 AM UTC
      if (event.cron === '0 2 * * *') {
        console.log('[CRON] Running daily asset cleanup...');
        await cleanupDeletedAssets(env);
      }

      // Monthly audit: First day of month, 3 AM UTC
      if (event.cron === '0 3 1 * *') {
        console.log('[CRON] Running monthly orphan audit...');
        await auditOrphanedAssets(env);
      }

      return new Response('Cron job completed', { status: 200 });

    } catch (error) {
      console.error('[CRON] Error:', error);
      return new Response(`Cron error: ${error.message}`, { status: 500 });
    }
  }
};

// ============================================================================
// SUBDOMAIN ROUTING - Core Logic (Preserved from v7.1)
// ============================================================================

function extractPropertySlug(hostname) {
  if (!hostname.endsWith('.webzyl.com')) {
    return null;
  }
  
  if (hostname === 'webzyl.com' || hostname === 'www.webzyl.com') {
    return null;
  }
  
  const subdomain = hostname.split('.')[0];
  if (RESERVED_SUBDOMAINS.includes(subdomain)) {
    return null;
  }
  
  if (!VALID_SLUG_PATTERN.test(subdomain)) {
    return null;
  }
  
  return subdomain;
}

// =====================================================
// BRAND HOMEPAGE HANDLER
// =====================================================
// Serves the Webzyl brand identity page for www.webzyl.com
// Template is stored in KV as 'template:brand-homepage'
// =====================================================

async function handleBrandHomepage(request, env, ctx) {
  try {
    // TEMPORARY: Bypass all caching to force fresh content
    // Fetch template from KV directly
    const template = await env.RESORT_CONFIGS.get('template:brand-homepage', { type: 'text' });

    if (!template) {
      return new Response('Brand homepage not configured. Please upload template to KV.', { status: 500 });
    }

    // Return HTML with no-cache headers to prevent any caching
    const response = new Response(template, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'CDN-Cache-Control': 'no-cache, no-store',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Webzyl-Cache': 'BYPASS'
      }
    });

    return response;
  } catch (error) {
    console.error('[BRAND] Error serving homepage:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function handleSuperAdminDashboard(request, env) {
  try {
    // Fetch super admin dashboard HTML from KV
    const html = await env.RESORT_CONFIGS.get('page:super-admin-dashboard', { type: 'text' });

    if (!html) {
      return new Response('Super Admin dashboard not found. Please upload to KV with key: page:super-admin-dashboard', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Serve the dashboard HTML
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache' // Don't cache to always get latest data
      }
    });
  } catch (error) {
    console.error('[SUPER-ADMIN-DASHBOARD] Error serving dashboard:', error);
    return new Response('Error loading super admin dashboard: ' + error.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleCEOAdminDashboard(request, env) {
  try {
    // Fetch CEO admin dashboard HTML from KV (single source of truth)
    const html = await env.RESORT_CONFIGS.get('page:ceo-admin-dashboard', { type: 'text' });

    if (!html) {
      return new Response('Admin dashboard not found. Please upload to KV with key: page:ceo-admin-dashboard', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Serve the dashboard HTML
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache' // Don't cache to always get latest data
      }
    });
  } catch (error) {
    console.error('[CEO-ADMIN-DASHBOARD] Error serving dashboard:', error);
    return new Response('Error loading admin dashboard: ' + error.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleOperatorDashboard(request, env) {
  try {
    // Fetch operator dashboard HTML from KV (single source of truth)
    const html = await env.RESORT_CONFIGS.get('page:operator-dashboard', { type: 'text' });

    if (!html) {
      return new Response('Operator dashboard not found. Please upload to KV with key: page:operator-dashboard', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Serve the dashboard HTML - same domain as API, so no CORS issues
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache' // Don't cache to always get latest data
      }
    });
  } catch (error) {
    console.error('[OPERATOR-DASHBOARD] Error serving dashboard:', error);
    return new Response('Error loading operator dashboard: ' + error.message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handlePropertyRequest(slug, path, request, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);
    
    if (!config) {
      return propertyNotFoundResponse(slug);
    }
    
    if (config.status === 'deleted') {
      return propertyDeletedResponse(slug);
    }
    
    if (config.status === 'inactive' || config.status === 'suspended') {
      return propertyInactiveResponse(slug, config.status);
    }
    
    if (config.status === 'maintenance') {
      return propertyMaintenanceResponse(slug);
    }
    
    console.log(`[PROPERTY] Routing to Pages: ${slug}${path}`);
    
    return await forwardToPages(slug, path, request, env);
    
  } catch (error) {
    console.error(`[PROPERTY] Error handling ${slug}:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function forwardToPages(slug, path, originalRequest, env) {
  try {
    const pagesBaseUrl = 'https://webzyl-sites.pages.dev';
    const pagesUrl = `${pagesBaseUrl}/${slug}${path || ''}`;
    
    console.log(`[FORWARD] ${pagesUrl}`);
    
    const pagesRequest = new Request(pagesUrl, {
      method: originalRequest.method,
      headers: originalRequest.headers,
      body: originalRequest.body,
      redirect: 'follow'
    });
    
    const pagesResponse = await fetch(pagesRequest);
    
    const response = new Response(pagesResponse.body, {
      status: pagesResponse.status,
      statusText: pagesResponse.statusText,
      headers: new Headers(pagesResponse.headers)
    });
    
    response.headers.set('X-Webzyl-Property', slug);
    response.headers.set('X-Webzyl-Served-By', 'worker-router');
    
    if (!response.headers.has('Cache-Control')) {
      response.headers.set('Cache-Control', 'public, max-age=300');
    }
    
    console.log(`[FORWARD] Success: ${pagesResponse.status}`);
    
    return response;
    
  } catch (error) {
    console.error(`[FORWARD] Error:`, error);
    return new Response('Error loading property website', { status: 502 });
  }
}

// ============================================================================
// ERROR RESPONSES (Preserved from v7.1)
// ============================================================================

function propertyNotFoundResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Not Found</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #ef4444; }
      </style>
    </head>
    <body>
      <h1>Property Not Found</h1>
      <p>The property "<strong>${slug}</strong>" does not exist on Webzyl.</p>
      <p><a href="https://webzyl.com">Return to Homepage</a></p>
    </body>
    </html>
  `, {
    status: 404,
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyDeletedResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Removed</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #8b5cf6; }
      </style>
    </head>
    <body>
      <h1>Property Removed</h1>
      <p>This property is no longer available.</p>
      <p>If you believe this is an error, please contact support.</p>
    </body>
    </html>
  `, {
    status: 410,
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyInactiveResponse(slug, status) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Property Inactive</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #f59e0b; }
      </style>
    </head>
    <body>
      <h1>Property Temporarily Unavailable</h1>
      <p>This property is currently inactive (status: ${status}).</p>
      <p>Please contact the property owner for more information.</p>
    </body>
    </html>
  `, {
    status: 403,
    headers: { 'Content-Type': 'text/html' }
  });
}

function propertyMaintenanceResponse(slug) {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Under Maintenance</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 100px auto; text-align: center; }
        h1 { color: #06b6d4; }
      </style>
    </head>
    <body>
      <h1>🔧 Under Maintenance</h1>
      <p>This property is temporarily undergoing maintenance.</p>
      <p>Please check back shortly!</p>
    </body>
    </html>
  `, {
    status: 503,
    headers: { 
      'Content-Type': 'text/html',
      'Retry-After': '3600'
    }
  });
}

// ============================================================================
// OPERATOR DASHBOARD APIs (Preserved from v7.1)
// ============================================================================

async function handleOperatorLogin(request, env) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    console.log(`[OPERATOR] Login successful for ${slug}`);
    
    return jsonResponse({
      success: true,
      slug: slug,
      config: config
    });
    
  } catch (error) {
    console.error('[OPERATOR] Login error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorDashboardData(slug, env) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);

    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    // Handle both flat and nested config structures
    const whatsappUsed = config.quota_whatsapp_used || 0;
    const whatsappLimit = config.quota_whatsapp_monthly || 0;
    const smsUsed = config.quota_sms_used || 0;
    const smsLimit = config.quota_sms_monthly || 0;

    const stats = {
      total_bookings: 0,
      this_month: 0,
      quota_whatsapp_percent: calculateQuotaPercent(whatsappUsed, whatsappLimit),
      quota_sms_percent: calculateQuotaPercent(smsUsed, smsLimit)
    };

    console.log(`[OPERATOR] Dashboard data for ${slug}`);

    return jsonResponse({
      property: config,
      stats: stats,
      bookings: [],
      quota: {
        whatsapp_used: whatsappUsed,
        whatsapp_limit: whatsappLimit,
        sms_used: smsUsed,
        sms_limit: smsLimit,
        current_month: config.quota_used_month || new Date().toISOString().substring(0, 7)
      }
    });

  } catch (error) {
    console.error('[OPERATOR] Dashboard error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorUpdate(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const updates = await request.json();

    return await handleOperatorUpdateWithUpdates(env, slug, updates);
    
  } catch (error) {
    console.error('[OPERATOR] Update error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorUpdateWithUpdates(env, slug, updates) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafeUncached(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    // Update allowed fields
    if (updates.name) config.name = updates.name;
    if (updates.tagline) config.tagline = updates.tagline;
    if (updates.about) config.about = updates.about;

    // Hero title controls (must allow empty string to clear)
    if (Object.prototype.hasOwnProperty.call(updates, 'heroTitle')) {
      config.heroTitle = (updates.heroTitle ?? '').toString();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'heroTitleMode')) {
      config.heroTitleMode = (updates.heroTitleMode ?? '').toString();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'heroTitleModeDesktop')) {
      config.heroTitleModeDesktop = (updates.heroTitleModeDesktop ?? '').toString();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'heroTitleModeMobile')) {
      config.heroTitleModeMobile = (updates.heroTitleModeMobile ?? '').toString();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'heroImageContainsBrand')) {
      const raw = updates.heroImageContainsBrand;
      config.heroImageContainsBrand = (raw === true || String(raw).trim().toLowerCase() === 'true');
    }

    // Header style profile (auto | light | dark | custom)
    if (Object.prototype.hasOwnProperty.call(updates, 'headerStyle')) {
      const hs = updates.headerStyle;
      if (hs && typeof hs === 'object') {
        const mode = String(hs.mode ?? '').trim().toLowerCase();
        const okMode = (mode === 'auto' || mode === 'light' || mode === 'dark' || mode === 'custom') ? mode : 'auto';

        const headerStyle = {
          mode: okMode
        };

        if (okMode === 'custom') {
          // Keep values as-is; SSR sanitizes at render time.
          if (Object.prototype.hasOwnProperty.call(hs, 'textColor')) headerStyle.textColor = (hs.textColor ?? '').toString();
          if (Object.prototype.hasOwnProperty.call(hs, 'brandFontStyle')) headerStyle.brandFontStyle = (hs.brandFontStyle ?? '').toString();
          if (Object.prototype.hasOwnProperty.call(hs, 'brandFontWeight')) headerStyle.brandFontWeight = hs.brandFontWeight;
          if (Object.prototype.hasOwnProperty.call(hs, 'brandFontSizePx')) headerStyle.brandFontSizePx = hs.brandFontSizePx;
        }

        config.headerStyle = headerStyle;
      } else if (hs === null) {
        // Allow clearing
        config.headerStyle = null;
      }
    }

    // Hero background (explicit: none | preset | custom)
    if (Object.prototype.hasOwnProperty.call(updates, 'heroBackground')) {
      const hb = updates.heroBackground;
      if (hb && typeof hb === 'object') {
        const type = String(hb.type ?? '').trim().toLowerCase();
        const value = hb.value == null ? null : String(hb.value).trim();
        if (type === 'none' || type === 'preset' || type === 'custom') {
          config.heroBackground = { type, value: value || null };
        }
      } else if (hb === null) {
        // Allow clearing
        config.heroBackground = null;
      }
    }
    
    // Track whether UI supplied a contact email change.
    const contactEmailProvided = !!(updates && updates.contact && typeof updates.contact === 'object' && Object.prototype.hasOwnProperty.call(updates.contact, 'email'));

    // Track whether UI explicitly supplied an ownerEmail change.
    const ownerEmailProvided = !!(
      (updates && updates.notifications && typeof updates.notifications === 'object' && Object.prototype.hasOwnProperty.call(updates.notifications, 'ownerEmail'))
      || (updates && Object.prototype.hasOwnProperty.call(updates, 'ownerEmail'))
    );

    // Handle nested contact object (v7.2) or flat structure (v7.1)
    if (updates.contact) {
      if (config.contact) {
        config.contact = { ...config.contact, ...updates.contact };
      } else {
        // Fallback for v7.1 flat structure
        if (updates.contact.name) config.contact_name = updates.contact.name;
        if (updates.contact.phone) config.contact_phone = updates.contact.phone;
        if (updates.contact.email) config.contact_email = updates.contact.email;
      }
    }

    // Notifications (v7.2)
    // Needed so dashboards can change where booking emails route (payload.ownerEmail).
    if (updates.notifications && typeof updates.notifications === 'object') {
      if (!config.notifications || typeof config.notifications !== 'object') {
        config.notifications = {};
      }

      const n = updates.notifications;
      if (Object.prototype.hasOwnProperty.call(n, 'enabled')) config.notifications.enabled = !!n.enabled;
      if (Object.prototype.hasOwnProperty.call(n, 'notifyOwner')) config.notifications.notifyOwner = !!n.notifyOwner;
      if (Object.prototype.hasOwnProperty.call(n, 'notifyCustomer')) config.notifications.notifyCustomer = !!n.notifyCustomer;
      if (Object.prototype.hasOwnProperty.call(n, 'language')) config.notifications.language = (n.language ?? '').toString();
      if (Object.prototype.hasOwnProperty.call(n, 'maxPerHour')) config.notifications.maxPerHour = Number(n.maxPerHour || 0) || config.notifications.maxPerHour || 10;

      if (Object.prototype.hasOwnProperty.call(n, 'ownerWhatsapp')) config.notifications.ownerWhatsapp = (n.ownerWhatsapp ?? '').toString();
      if (Object.prototype.hasOwnProperty.call(n, 'ownerEmail')) config.notifications.ownerEmail = (n.ownerEmail ?? '').toString();
    }

    // Backward/alternate payload shapes (some dashboards send ownerEmail at top-level)
    if (Object.prototype.hasOwnProperty.call(updates, 'ownerEmail')) {
      if (!config.notifications || typeof config.notifications !== 'object') {
        config.notifications = {};
      }
      config.notifications.ownerEmail = (updates.ownerEmail ?? '').toString();
    }

    // If the UI updated Contact Email but did NOT explicitly update notifications.ownerEmail,
    // keep them in sync so booking emails route correctly and KV reflects the UI.
    if (contactEmailProvided && !ownerEmailProvided) {
      if (!config.notifications || typeof config.notifications !== 'object') {
        config.notifications = {};
      }
      const nextContactEmail = (updates?.contact?.email ?? '').toString();
      config.notifications.ownerEmail = nextContactEmail;
    }
    
    // Update branding & design profile
    if (updates.branding) {
      config.branding = { ...config.branding, ...updates.branding };
    }
    if (updates.variant) config.variant = updates.variant;
    
    // Update location
    if (updates.location) {
      config.location = { ...config.location, ...updates.location };
    }
    
    // Update embeds
    if (updates.embeds) {
      config.embeds = { ...config.embeds, ...updates.embeds };
    }
    
    // Update category, theme, pricing
    if (updates.category) config.category = updates.category;
    if (updates.templateId) config.templateId = updates.templateId;
    if (updates.basePrice) config.basePrice = updates.basePrice;
    
    // Update hero image
    if (updates.heroImage) config.heroImage = updates.heroImage;
    
    // --- Amenities, Room Types & Reviews wiring ---
    // Defensive: Only update if valid array, else fallback to empty array
    // This ensures dashboard changes are always reflected and prevents undefined/null issues
    if (Array.isArray(updates.rooms)) {
      config.rooms = updates.rooms;
    } else if (updates.rooms !== undefined) {
      config.rooms = [];
    }
    if (Array.isArray(updates.amenities)) {
      config.amenities = updates.amenities;
    } else if (updates.amenities !== undefined) {
      config.amenities = [];
    }
    if (Array.isArray(updates.reviews)) {
      config.reviews = updates.reviews;
    } else if (updates.reviews !== undefined) {
      config.reviews = [];
    }
    // Menu Labels
    if (updates.menuLabels && typeof updates.menuLabels === 'object') {
      config.menuLabels = updates.menuLabels;
    }
    // Gallery update remains as-is
    if (updates.gallery) config.gallery = updates.gallery;
    // --- End amenities/room types/reviews wiring ---
    if (Object.prototype.hasOwnProperty.call(updates, 'videos')) {
      const rawVideos = Array.isArray(updates.videos) ? updates.videos : [];
      const normalizedVideos = rawVideos
        .map(v => {
          if (!v) return null;
          if (typeof v === 'string') return { url: v };
          if (typeof v === 'object') return v;
          return null;
        })
        .filter(Boolean)
        .map(v => {
          const url = normalizeHttpUrl(v.url || v.link || '');
          const title = (v.title ?? '').toString().trim();
          const thumbnail = normalizeHttpUrl(v.thumbnail || v.thumb || '');
          return url ? { url, title, thumbnail } : null;
        })
        .filter(Boolean);

      // Best-effort resolve a couple of missing thumbnails during save.
      // Remaining missing ones will be backfilled on next SSR request.
      let resolvedCount = 0;
      for (const v of normalizedVideos) {
        if (!v.thumbnail && resolvedCount < 2) {
          const resolved = await resolveVideoThumbnailNoFallback(v.url);
          if (resolved) {
            v.thumbnail = resolved;
          }
          resolvedCount++;
        }
      }

      config.videos = normalizedVideos;
    }
    if (updates.social) config.social = { ...config.social, ...updates.social };
    
    config.updatedAt = new Date().toISOString();
    
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[OPERATOR] Updated config for ${slug}`);
    
    return jsonResponse({
      success: true,
      message: 'Property updated successfully',
      config: config
    });
    
  } catch (error) {
    console.error('[OPERATOR] Update error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleOperatorBookings(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10');
    
    const bookings = [];
    
    console.log(`[OPERATOR] Fetched bookings for ${slug}`);
    
    return jsonResponse({
      bookings: bookings,
      total: bookings.length,
      limit: limit
    });
    
  } catch (error) {
    console.error('[OPERATOR] Bookings error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleGalleryUpload(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400);
    }

    // Validate file type
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return jsonResponse({ 
        error: `Invalid file type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}` 
      }, 400);
    }

    // Validate file size (50MB max for gallery)
    if (file.size > MAX_SIZES.gallery) {
      return jsonResponse({ 
        error: `File too large. Max ${MAX_SIZES.gallery / 1024 / 1024}MB` 
      }, 400);
    }

    // Verify tenant exists and is active
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    // Generate asset ID and object path
    const assetId = generateRandomId(8);
    const randomHash = generateRandomId(12);
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 255);
    const objectPath = `${slug}/gallery/${randomHash}/${sanitizedFilename}`;

    console.log(`[OPERATOR] Gallery upload started for ${slug}: ${assetId}`);

    // Get the file buffer
    const arrayBuffer = await file.arrayBuffer();

    // Upload to R2
    await env.MEDIA_R2.put(objectPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    // Record in database
    await env.MEDIA_DB.prepare(`
      INSERT INTO assets (
        id, tenantId, mediaType, objectPath, filename,
        size, contentType, status, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
    `).bind(assetId, slug, 'gallery', objectPath, sanitizedFilename, file.size, file.type).run();

    // Update quota
    const quotaKey = `quota:${slug}:gallery`;
    const quota = await env.RESORT_CONFIGS.get(quotaKey, 'json') || { used: 0 };
    await env.RESORT_CONFIGS.put(quotaKey, JSON.stringify({
      used: quota.used + 1,
      updatedAt: new Date().toISOString()
    }));

    // Build asset URL
    const baseUrl = `https://img.webzyl.com/${slug}/gallery/${assetId}`;

    console.log(`[OPERATOR] Gallery upload successful for ${slug}: ${assetId}`);

    return jsonResponse({
      success: true,
      message: '1 image uploaded successfully',
      assetId,
      assetUrl: baseUrl,
      filename: sanitizedFilename,
      size: file.size,
      variants: {
        thumbnail: `${baseUrl}?w=320`,
        small: `${baseUrl}?w=640`,
        medium: `${baseUrl}?w=1024`,
        large: `${baseUrl}?w=1600`
      }
    });
    
  } catch (error) {
    console.error('[OPERATOR] Upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleHeroUpload(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400);
    }

    // Validate file type
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return jsonResponse({ 
        error: `Invalid file type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}` 
      }, 400);
    }

    // Validate file size (10MB max for hero)
    if (file.size > MAX_SIZES.hero) {
      return jsonResponse({ 
        error: `File too large. Max ${MAX_SIZES.hero / 1024 / 1024}MB` 
      }, 400);
    }

    // Get existing config
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafeUncached(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    // Delete old hero image if exists
    if (config.heroImage) {
      try {
        // Extract object path from old hero URL
        const oldAssetMatch = config.heroImage.match(/img\.webzyl\.com\/.*?\/(hero|gallery)\/([a-zA-Z0-9]+)/);
        if (oldAssetMatch) {
          const oldAssetId = oldAssetMatch[2];
          // Get old asset from DB
          const oldAsset = await env.MEDIA_DB.prepare(
            'SELECT objectPath FROM assets WHERE id = ? AND tenantId = ?'
          ).bind(oldAssetId, slug).first();
          
          if (oldAsset) {
            // Delete from R2
            await env.MEDIA_R2.delete(oldAsset.objectPath);
            // Delete from DB
            await env.MEDIA_DB.prepare('DELETE FROM assets WHERE id = ?').bind(oldAssetId).run();
            console.log(`[OPERATOR] Deleted old hero image: ${oldAssetId}`);
          }
        }
      } catch (deleteError) {
        console.warn('[OPERATOR] Failed to delete old hero:', deleteError);
      }
    }

    // Generate asset ID and object path
    const assetId = generateRandomId(8);
    const randomHash = generateRandomId(12);
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 255);
    const objectPath = `${slug}/hero/${randomHash}/${sanitizedFilename}`;

    console.log(`[OPERATOR] Hero upload started for ${slug}: ${assetId}`);

    // Get the file buffer
    const arrayBuffer = await file.arrayBuffer();

    // Upload to R2
    await env.MEDIA_R2.put(objectPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    // Record in database
    await env.MEDIA_DB.prepare(`
      INSERT INTO assets (
        id, tenantId, mediaType, objectPath, filename,
        size, contentType, status, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
    `).bind(assetId, slug, 'hero', objectPath, sanitizedFilename, file.size, file.type).run();

    // Build asset URL
    const heroUrl = `https://img.webzyl.com/${slug}/hero/${assetId}`;

    // Update config with new hero URL
    config.heroImage = heroUrl;
    config.updatedAt = new Date().toISOString();
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));

    console.log(`[OPERATOR] Hero upload successful for ${slug}: ${assetId}`);

    return jsonResponse({
      success: true,
      message: 'Hero image uploaded successfully',
      assetId,
      heroUrl,
      filename: sanitizedFilename,
      size: file.size
    });
    
  } catch (error) {
    console.error('[OPERATOR] Hero upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleLogoUpload(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return jsonResponse({
        error: `Invalid file type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`
      }, 400);
    }

    // Validate file size (logo)
    if (file.size > MAX_SIZES.logo) {
      return jsonResponse({
        error: `File too large. Max ${Math.round(MAX_SIZES.logo / 1024 / 1024)}MB`
      }, 400);
    }

    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafeUncached(env, slug);

    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    const currentLogoUrl = config.branding?.logoUrl || config.branding?.logo || config.logoUrl || config.logo || '';

    // Delete old logo if it was an uploaded asset
    if (currentLogoUrl) {
      try {
        const oldAssetMatch = currentLogoUrl.match(/img\.webzyl\.com\/.*?\/logo\/([a-zA-Z0-9]+)/);
        if (oldAssetMatch) {
          const oldAssetId = oldAssetMatch[1];
          const oldAsset = await env.MEDIA_DB.prepare(
            'SELECT objectPath FROM assets WHERE id = ? AND tenantId = ?'
          ).bind(oldAssetId, slug).first();

          if (oldAsset) {
            await env.MEDIA_R2.delete(oldAsset.objectPath);
            await env.MEDIA_DB.prepare('DELETE FROM assets WHERE id = ?').bind(oldAssetId).run();
            console.log(`[OPERATOR] Deleted old logo: ${oldAssetId}`);
          }
        }
      } catch (deleteError) {
        console.warn('[OPERATOR] Failed to delete old logo:', deleteError);
      }
    }

    const assetId = generateRandomId(8);
    const randomHash = generateRandomId(12);
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 255);
    const objectPath = `${slug}/logo/${randomHash}/${sanitizedFilename}`;

    console.log(`[OPERATOR] Logo upload started for ${slug}: ${assetId}`);

    const arrayBuffer = await file.arrayBuffer();

    await env.MEDIA_R2.put(objectPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    await env.MEDIA_DB.prepare(`
      INSERT INTO assets (
        id, tenantId, mediaType, objectPath, filename,
        size, contentType, status, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
    `).bind(assetId, slug, 'logo', objectPath, sanitizedFilename, file.size, file.type).run();

    const logoUrl = `https://img.webzyl.com/${slug}/logo/${assetId}`;

    config.branding = { ...(config.branding || {}), logoUrl };
    config.updatedAt = new Date().toISOString();
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));

    console.log(`[OPERATOR] Logo upload successful for ${slug}: ${assetId}`);

    return jsonResponse({
      success: true,
      message: 'Logo uploaded successfully',
      assetId,
      logoUrl,
      filename: sanitizedFilename,
      size: file.size
    });
  } catch (error) {
    console.error('[OPERATOR] Logo upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleRoomImageUpload(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return jsonResponse({ error: 'No file provided' }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return jsonResponse({
        error: `Invalid file type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`
      }, 400);
    }

    // Validate file size (room image - same as hero)
    if (file.size > MAX_SIZES.hero) {
      return jsonResponse({
        error: `File too large. Max ${Math.round(MAX_SIZES.hero / 1024 / 1024)}MB`
      }, 400);
    }

    const assetId = generateRandomId(8);
    const randomHash = generateRandomId(12);
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 255);
    const objectPath = `${slug}/rooms/${randomHash}/${sanitizedFilename}`;

    console.log(`[OPERATOR] Room image upload started for ${slug}: ${assetId}`);

    const arrayBuffer = await file.arrayBuffer();

    await env.MEDIA_R2.put(objectPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    });

    await env.MEDIA_DB.prepare(`
      INSERT INTO assets (
        id, tenantId, mediaType, objectPath, filename,
        size, contentType, status, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
    `).bind(assetId, slug, 'room', objectPath, sanitizedFilename, file.size, file.type).run();

    const imageUrl = `https://img.webzyl.com/${slug}/rooms/${assetId}`;

    console.log(`[OPERATOR] Room image upload successful for ${slug}: ${assetId}`);

    return jsonResponse({
      success: true,
      message: 'Room image uploaded successfully',
      assetId,
      imageUrl,
      filename: sanitizedFilename,
      size: file.size
    });
  } catch (error) {
    console.error('[OPERATOR] Room image upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleGalleryUpdate(request, env, slug) {
  try {
    if (!slug) {
      return jsonResponse({ error: 'Slug is required' }, 400);
    }
    
    const { gallery } = await request.json();
    
    if (!Array.isArray(gallery)) {
      return jsonResponse({ error: 'Gallery must be an array' }, 400);
    }
    
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafeUncached(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    // Handle both nested (v7.2) and flat (v7.1) structures
    config.gallery = gallery;
    if (config.gallery_json !== undefined) {
      config.gallery_json = JSON.stringify(gallery);
    }
    config.updatedAt = new Date().toISOString();
    
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[OPERATOR] Gallery updated for ${slug}`);
    
    return jsonResponse({
      success: true,
      message: 'Gallery updated successfully',
      gallery: gallery
    });
    
  } catch (error) {
    console.error('[OPERATOR] Gallery update error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// DATA REQUEST HANDLER (Preserved from v7.1)
// ============================================================================

async function handleDataRequest(slug, env) {
  try {
    if (!slug || !VALID_SLUG_PATTERN.test(slug)) {
      return jsonResponse({ error: 'Invalid slug' }, 400);
    }

    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);

    if (!config) {
      console.log(`[DATA] Config not found: ${slug}`);
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    if (config.status === 'deleted' || config.status === 'inactive') {
      return jsonResponse({ error: 'Property not available' }, 410);
    }

    console.log(`[DATA] Serving config for: ${slug}`);
    return jsonResponse(config);

  } catch (error) {
    console.error(`[DATA] Error:`, error);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
}

// ============================================================================
// LEGACY PUBLISH API (Preserved from v7.1)
// ============================================================================

async function handlePublish(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    const expectedToken = env.PUBLISH_TOKEN || env.PUBLISH_SECRET;
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      console.log('[PUBLISH] Unauthorized attempt');
      return jsonResponse({ success: false, error: 'unauthorized' }, 401);
    }
    
    const body = await request.json();
    const { slug, config } = body;
    
    if (!slug || !config) {
      console.log('[PUBLISH] Missing slug or config');
      return jsonResponse({ success: false, error: 'missing_slug_or_config' }, 400);
    }
    
    const configKey = `config:${slug}`;
    await env.RESORT_CONFIGS.put(configKey, JSON.stringify(config));
    
    console.log(`[PUBLISH] ✅ Published config for ${slug}`);
    
    // Handle marketplace summary
    const showInMarket = config.showInMarket !== undefined ? config.showInMarket : config.show_in_market;
    
    if (showInMarket) {
      const city = config.location?.city || config.city || '';
      const state = config.location?.state || config.state || '';
      const heroImage = config.branding?.heroImage || config.hero_image || '';
      
      const summary = {
        slug: config.slug,
        name: config.name,
        tagline: config.tagline,
        category: config.category,
        city: city,
        state: state,
        basePrice: config.basePrice || config.base_price || 0,
        rating: config.rating || 0,
        heroImage: heroImage,
        tags: config.tags || []
      };
      
      const summaryKey = `market:summary:${slug}`;
      await env.RESORT_CONFIGS.put(summaryKey, JSON.stringify(summary));
      
      console.log(`[PUBLISH] ✅ Added ${slug} to marketplace`);
    }
    
    return jsonResponse({ 
      success: true,
      slug: slug,
      message: 'Configuration published successfully'
    });
    
  } catch (error) {
    console.error('[PUBLISH] Error:', error);
    return jsonResponse({ 
      success: false, 
      error: 'internal_error',
      message: error.message 
    }, 500);
  }
}

// ============================================================================
// ADMIN DASHBOARD HANDLERS - PHASE 6 (READ-ONLY)
// ============================================================================
// Governance: See ADMIN_DASHBOARD_SCOPE_v1.md
// All endpoints are strictly read-only - no mutations allowed
// ============================================================================

function validateAdminToken(request, env) {
  const token = request.headers.get('X-Admin-Token');
  if (!token || token !== env.ADMIN_TOKEN) {
    return false;
  }
  return true;
}

async function handleAdminSmartNavTemplate(request, env) {
  // Access guard: Require admin token
  if (!validateAdminToken(request, env)) {
    console.warn(`[ADMIN] Unauthorized template access attempt: ${request.method} ${new URL(request.url).pathname}`);
    return new Response('Forbidden', {
      status: 403,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  if (request.method === 'GET') {
    const template = await env.RESORT_CONFIGS.get('template:smart-nav', { type: 'text' });
    if (!template) {
      return jsonResponse({
        ok: false,
        error: 'not_configured',
        message: 'template:smart-nav is not configured in KV'
      }, 404);
    }

    return new Response(template, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // PUT
  const html = await request.text();
  const trimmed = (html || '').trim();

  // Basic safety checks to avoid accidental KV corruption.
  if (!trimmed || trimmed.length < 200) {
    return jsonResponse({ ok: false, error: 'invalid_template', message: 'Template HTML is empty/too short' }, 400);
  }

  // Keep this reasonably small; KV supports larger values but we guard against accidental binary uploads.
  if (trimmed.length > 2_000_000) {
    return jsonResponse({ ok: false, error: 'template_too_large', message: 'Template exceeds 2MB limit' }, 413);
  }

  if (!trimmed.includes('{{HERO_IMAGE}}')) {
    return jsonResponse({ ok: false, error: 'missing_placeholder', message: 'Template must include {{HERO_IMAGE}}' }, 400);
  }

  await env.RESORT_CONFIGS.put('template:smart-nav', trimmed);

  return jsonResponse({ ok: true, key: 'template:smart-nav', bytes: trimmed.length }, 200);
}

async function handleAdminDashboard(request, env) {
  // Minimal HTML dashboard UI
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webzyl Admin Dashboard</title>
  <style>
    :root {
      --bg: #f7fafc;
      --fg: #1a202c;
      --accent: #3182ce;
      --border: #e2e8f0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--fg);
      padding: 2rem;
    }
    h1 { margin-bottom: 0.5rem; }
    .subtitle { color: #718096; margin-bottom: 2rem; }
    nav {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    nav a {
      padding: 0.75rem 1.5rem;
      background: white;
      border: 1px solid var(--border);
      border-radius: 6px;
      text-decoration: none;
      color: var(--accent);
      font-weight: 500;
      transition: all 0.2s;
    }
    nav a:hover {
      background: var(--accent);
      color: white;
      transform: translateY(-2px);
    }
    #content {
      background: white;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 2rem;
      min-height: 400px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      text-align: left;
      padding: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: var(--bg);
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .badge.active { background: #c6f6d5; color: #22543d; }
    .badge.inactive { background: #fed7d7; color: #742a2a; }
  </style>
</head>
<body>
  <h1>🔧 Webzyl Admin Dashboard</h1>
  <p class="subtitle">Read-Only System Visibility</p>
  
  <nav>
    <a href="#" onclick="loadSites(); return false;">📋 Sites</a>
    <a href="#" onclick="loadExperiments(); return false;">🧪 Experiments</a>
    <a href="#" onclick="loadMetrics(); return false;">📊 Metrics</a>
  </nav>
  
  <div id="content">
    <p>Select an option above to view data.</p>
  </div>
  
  <script>
    const ADMIN_TOKEN = '${env.ADMIN_TOKEN}';
    
    async function fetchAdmin(path) {
      const res = await fetch(path, {
        headers: { 'X-Admin-Token': ADMIN_TOKEN }
      });
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      return res.json();
    }
    
    async function loadSites() {
      const content = document.getElementById('content');
      content.innerHTML = '<p>Loading sites...</p>';
      try {
        const data = await fetchAdmin('/__admin/sites');
        content.innerHTML = \`
          <h2>Sites (\${data.total})</h2>
          <table>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Category</th>
                <th>Design Profile</th>
                <th>Variant</th>
                <th>Experiment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              \${data.sites.map(s => \`
                <tr>
                  <td><strong>\${s.slug}</strong></td>
                  <td>\${s.category}</td>
                  <td>\${s.designProfileId}</td>
                  <td>\${s.variantId || '-'}</td>
                  <td>\${s.experimentId || '-'}</td>
                  <td><span class="badge \${s.status}">\${s.status}</span></td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } catch (err) {
        content.innerHTML = \`<p style="color: red;">Error: \${err.message}</p>\`;
      }
    }
    
    async function loadExperiments() {
      const content = document.getElementById('content');
      content.innerHTML = '<p>Loading experiments...</p>';
      try {
        const data = await fetchAdmin('/__admin/experiments');
        content.innerHTML = \`
          <h2>Experiments (\${data.total})</h2>
          <table>
            <thead>
              <tr>
                <th>Experiment ID</th>
                <th>Base Profile</th>
                <th>Variants</th>
                <th>Sites (A / B)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              \${data.experiments.map(e => \`
                <tr>
                  <td><strong>\${e.experimentId}</strong></td>
                  <td>\${e.baseProfileId}</td>
                  <td>\${e.variants.A} vs \${e.variants.B}</td>
                  <td>\${e.sitesPerVariant.A} / \${e.sitesPerVariant.B}</td>
                  <td><span class="badge \${e.status}">\${e.status}</span></td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } catch (err) {
        content.innerHTML = \`<p style="color: red;">Error: \${err.message}</p>\`;
      }
    }
    
    async function loadMetrics() {
      const content = document.getElementById('content');
      content.innerHTML = '<p>Loading metrics...</p>';
      try {
        const data = await fetchAdmin('/__admin/metrics');
        content.innerHTML = \`
          <h2>Metrics Summary</h2>
          <table>
            <tbody>
              <tr><th>Total Page Views</th><td>\${data.summary.totalPageViews}</td></tr>
              <tr><th>Total CTA Clicks</th><td>\${data.summary.totalCTAClicks}</td></tr>
              <tr><th>Conversion Rate</th><td>\${data.summary.conversionRate.toFixed(2)}%</td></tr>
            </tbody>
          </table>
          <h3 style="margin-top: 2rem;">By Site</h3>
          <table>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Page Views</th>
                <th>CTA Clicks</th>
                <th>Conversion</th>
              </tr>
            </thead>
            <tbody>
              \${data.bySite.map(s => \`
                <tr>
                  <td><strong>\${s.slug}</strong></td>
                  <td>\${s.pageViews}</td>
                  <td>\${s.ctaClicks}</td>
                  <td>\${s.conversionRate.toFixed(2)}%</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        \`;
      } catch (err) {
        content.innerHTML = \`<p style="color: red;">Error: \${err.message}</p>\`;
      }
    }
  </script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function handleAdminSites(request, env) {
  try {
    console.log('[ADMIN] Sites request');
    
    // List all configs from KV
    const list = await env.RESORT_CONFIGS.list({ prefix: 'config:' });
    
    const sites = [];
    for (const key of list.keys) {
      const slug = key.name.replace('config:', '');
      const config = await env.RESORT_CONFIGS.get(key.name, { type: 'json' });
      
      if (!config) continue;
      
      // Sanitize config - remove sensitive data
      const site = {
        slug: slug,
        category: config.category || 'unknown',
        theme: config.branding?.theme || 'unknown',
        designProfileId: config.branding?.designProfileId || null,
        variantId: config.variant || null,
        experimentId: config.experiment?.id || null,
        experimentVariant: config.experiment?.id ? resolveExperimentVariant(config) : null,
        status: config.status || 'unknown',
        lastUpdated: config.lastUpdated || null
      };
      
      sites.push(site);
    }
    
    return new Response(JSON.stringify({
      sites: sites,
      total: sites.length
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
    
  } catch (error) {
    console.error('[ADMIN] Sites error:', error);
    return new Response(JSON.stringify({ error: 'Failed to load sites' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

async function handleAdminSite(request, env) {
  try {
    const url = new URL(request.url);
    const slug = (url.searchParams.get('slug') || '').toString().trim();
    if (!slug) {
      return new Response(JSON.stringify({ error: 'missing_slug' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const config = await env.RESORT_CONFIGS.get(`config:${slug}`, { type: 'json' });
    if (!config) {
      return new Response(JSON.stringify({ error: 'not_found', slug }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const normalizeEmail = (value) => {
      if (value === null || value === undefined) return '';
      return String(value).trim().replace(/\s+/g, '');
    };

    const isValidEmail = (email) => {
      if (!email) return false;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
    };

    const notificationsOwnerEmailRaw = (config?.notifications?.ownerEmail || '').toString();
    const contactEmailRaw = (config?.contact?.email || '').toString();

    const notificationsOwnerEmail = notificationsOwnerEmailRaw.toString().trim();
    const contactEmail = contactEmailRaw.toString().trim();

    const notificationsOwnerEmailNormalized = normalizeEmail(notificationsOwnerEmailRaw);
    const contactEmailNormalized = normalizeEmail(contactEmailRaw);

    const effectiveOwnerEmail = (notificationsOwnerEmail || contactEmail || '').toString().trim();
    const effectiveOwnerEmailNormalized = isValidEmail(notificationsOwnerEmailNormalized)
      ? notificationsOwnerEmailNormalized
      : (isValidEmail(contactEmailNormalized) ? contactEmailNormalized : '');

    const payload = {
      slug,
      status: config.status || 'unknown',
      category: config.category || 'unknown',
      booking: {
        mode: config?.booking?.mode || 'unknown',
        sheetName: config?.booking?.sheetName || '',
        workspaceId: (config?.workspaceId || config?.booking?.workspaceId || '').toString().trim(),
      },
      routing: {
        notificationsOwnerEmail,
        contactEmail,
        effectiveOwnerEmail,
        notificationsOwnerEmailRaw,
        contactEmailRaw,
        notificationsOwnerEmailNormalized,
        contactEmailNormalized,
        effectiveOwnerEmailNormalized,
        effectiveOwnerEmailNormalizedValid: isValidEmail(effectiveOwnerEmailNormalized),
      },
      updatedAt: config.updatedAt || config.lastUpdated || null,
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (error) {
    console.error('[ADMIN] Site error:', error);
    return new Response(JSON.stringify({ error: 'Failed to load site' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

async function handleAdminResetBooking(request, env) {
  try {
    const url = new URL(request.url);
    const slug = (url.searchParams.get('slug') || '').toString().trim();

    if (!slug || !VALID_SLUG_PATTERN.test(slug)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_slug' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const key = `config:${slug}`;
    const config = await env.RESORT_CONFIGS.get(key, { type: 'json' });

    if (!config) {
      return new Response(JSON.stringify({ ok: false, error: 'not_found', slug }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    const currentMonth = new Date().toISOString().substring(0, 7);
    const updatedConfig = {
      ...config,
      quota_whatsapp_used: 0,
      quota_sms_used: 0,
      quota_used_month: currentMonth,
      updatedAt: new Date().toISOString(),
    };

    await env.RESORT_CONFIGS.put(key, JSON.stringify(updatedConfig));

    // Clear the hourly rate limit counter (used by booking API).
    const rateKey = `rate:${slug}`;
    await env.RESORT_CONFIGS.delete(rateKey);

    return new Response(JSON.stringify({
      ok: true,
      slug,
      reset: {
        quota: true,
        rate: true,
      },
      month: currentMonth,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (error) {
    console.error('[ADMIN] Reset booking error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'reset_failed' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

async function handleAdminExperiments(request, env) {
  try {
    console.log('[ADMIN] Experiments request');
    
    // List all configs and extract experiments
    const list = await env.RESORT_CONFIGS.list({ prefix: 'config:' });
    
    const experimentsMap = new Map();
    
    for (const key of list.keys) {
      const config = await env.RESORT_CONFIGS.get(key.name, { type: 'json' });
      
      if (!config || !config.experiment?.id) continue;
      
      const experimentId = config.experiment.id;
      const experimentVariant = resolveExperimentVariant(config);
      
      if (!experimentsMap.has(experimentId)) {
        experimentsMap.set(experimentId, {
          experimentId: experimentId,
          baseProfileId: config.branding?.designProfileId || 'unknown',
          variants: {
            A: 'calm',  // From Phase 3 mapping
            B: 'bold'
          },
          sitesPerVariant: {
            A: 0,
            B: 0
          },
          status: config.experiment.enabled ? 'active' : 'inactive',
          totalSites: 0
        });
      }
      
      const exp = experimentsMap.get(experimentId);
      exp.sitesPerVariant[experimentVariant]++;
      exp.totalSites++;
    }
    
    const experiments = Array.from(experimentsMap.values());
    
    return new Response(JSON.stringify({
      experiments: experiments,
      total: experiments.length
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
    
  } catch (error) {
    console.error('[ADMIN] Experiments error:', error);
    return new Response(JSON.stringify({ error: 'Failed to load experiments' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

async function handleAdminMetrics(request, env) {
  try {
    console.log('[ADMIN] Metrics request');
    
    // Query EVENTS_KV for aggregated metrics
    const eventsList = await env.EVENTS_KV.list({ prefix: 'events:' });
    
    let totalPageViews = 0;
    let totalCTAClicks = 0;
    const bySiteMap = new Map();
    const byExperimentMap = new Map();
    
    // Aggregate events
    for (const key of eventsList.keys) {
      const event = await env.EVENTS_KV.get(key.name, { type: 'json' });
      
      if (!event) continue;
      
      // Global totals
      if (event.event === 'page_view') totalPageViews++;
      if (event.event === 'cta_click') totalCTAClicks++;
      
      // By site
      if (!bySiteMap.has(event.slug)) {
        bySiteMap.set(event.slug, { slug: event.slug, pageViews: 0, ctaClicks: 0 });
      }
      const siteData = bySiteMap.get(event.slug);
      if (event.event === 'page_view') siteData.pageViews++;
      if (event.event === 'cta_click') siteData.ctaClicks++;
      
      // By experiment
      if (event.experimentId) {
        const expKey = `${event.experimentId}:${event.experimentVariant}`;
        if (!byExperimentMap.has(expKey)) {
          byExperimentMap.set(expKey, {
            experimentId: event.experimentId,
            variant: event.experimentVariant,
            pageViews: 0,
            ctaClicks: 0
          });
        }
        const expData = byExperimentMap.get(expKey);
        if (event.event === 'page_view') expData.pageViews++;
        if (event.event === 'cta_click') expData.ctaClicks++;
      }
    }
    
    // Calculate conversion rates
    const bySite = Array.from(bySiteMap.values()).map(s => ({
      ...s,
      conversionRate: s.pageViews > 0 ? (s.ctaClicks / s.pageViews) * 100 : 0
    }));
    
    // Format experiment data
    const byExperiment = [];
    const experimentIds = new Set(Array.from(byExperimentMap.values()).map(e => e.experimentId));
    
    for (const experimentId of experimentIds) {
      const variantA = byExperimentMap.get(`${experimentId}:A`) || { pageViews: 0, ctaClicks: 0 };
      const variantB = byExperimentMap.get(`${experimentId}:B`) || { pageViews: 0, ctaClicks: 0 };
      
      byExperiment.push({
        experimentId,
        variantA: {
          pageViews: variantA.pageViews,
          ctaClicks: variantA.ctaClicks,
          conversionRate: variantA.pageViews > 0 ? (variantA.ctaClicks / variantA.pageViews) * 100 : 0
        },
        variantB: {
          pageViews: variantB.pageViews,
          ctaClicks: variantB.ctaClicks,
          conversionRate: variantB.pageViews > 0 ? (variantB.ctaClicks / variantB.pageViews) * 100 : 0
        }
      });
    }
    
    return new Response(JSON.stringify({
      summary: {
        totalPageViews,
        totalCTAClicks,
        conversionRate: totalPageViews > 0 ? (totalCTAClicks / totalPageViews) * 100 : 0
      },
      bySite,
      byExperiment,
      timeRange: 'all'  // v1 - no filtering yet
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
    
  } catch (error) {
    console.error('[ADMIN] Metrics error:', error);
    return new Response(JSON.stringify({ error: 'Failed to load metrics' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
}

async function handleGetConfig(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafeUncached(env, slug);
    
    if (!config) {
      console.log(`[CONFIG] Not found: ${slug}`);
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    console.log(`[CONFIG] Retrieved: ${slug}`);
    return jsonResponse(config);
    
  } catch (error) {
    console.error('[CONFIG] Error:', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
}

async function handleWebsiteSSR(slug, env) {
  try {
    const configKey = `config:${slug}`;
    const config = await getPropertyConfigSafe(env, slug);
    
    if (!config) {
      return new Response('Property not found', { status: 404 });
    }
    
    const fakeRequest = new Request(`https://webzyl-worker.example.com/s/${slug}`);
    return await forwardToPages(slug, '', fakeRequest, env);
    
  } catch (error) {
    console.error('[SSR] Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ============================================================================
// EVENT TRACKING HANDLER - PHASE 5
// ============================================================================
// Privacy-first event endpoint for frontend CTA click tracking.
// Enriches minimal client payload with profile/variant data from KV.
// Governance: See METRICS_GOVERNANCE_v1.md
// ============================================================================

async function handleEventTrackingRequest(request, env) {
  try {
    const payload = await request.json();
    
    // Validate event type
    if (!payload.event || !EVENT_SCHEMA.allowedEvents.includes(payload.event)) {
      return new Response('Invalid event type', { status: 400 });
    }
    
    // For frontend events, slug is determined from hostname
    const url = new URL(request.url);
    const hostname = url.hostname;
    const slug = extractPropertySlug(hostname);
    
    if (!slug) {
      return new Response('Property slug not found', { status: 400 });
    }
    
    // Load config to enrich event with profile/variant/experiment data
    const config = await getPropertyConfigSafe(env, slug);
    
    if (!config || config.status !== 'active') {
      return new Response('Property not found', { status: 404 });
    }
    
    // Enrich payload with profile/variant/experiment data
    const enrichedPayload = {
      event: payload.event,
      slug: slug,
      profileId: config.branding?.designProfileId || null,
      variantId: null,
      experimentId: config.experiment?.id || null,
      experimentVariant: null,
      ctaName: payload.ctaName || null
    };
    
    // Resolve variant (Phase 2/3 logic)
    if (config.experiment?.id) {
      const experimentVariant = resolveExperimentVariant(config);
      enrichedPayload.experimentVariant = experimentVariant;
      
      const designProfileId = config.branding?.designProfileId;
      const mappedVariant = mapExperimentToDesignVariant(config.experiment.id, experimentVariant, designProfileId);
      
      if (mappedVariant) {
        enrichedPayload.variantId = mappedVariant;
      } else {
        enrichedPayload.variantId = resolveDesignProfileVariant(config);
      }
    } else {
      enrichedPayload.variantId = resolveDesignProfileVariant(config);
    }
    
    // Emit event (fire-and-forget, non-blocking)
    emitEvent(env, enrichedPayload).catch(err => 
      console.error('[METRICS] Event emission failed:', err)
    );
    
    // Return 204 No Content (fire-and-forget)
    return new Response(null, { status: 204 });
    
  } catch (error) {
    console.error('[METRICS] Event tracking request failed:', error);
    return new Response('Internal error', { status: 500 });
  }
}

// ============================================================================
// CEO DASHBOARD HANDLERS (v7.2 - UPDATED WITH NESTED STRUCTURE)
// ============================================================================

async function handleCEOGenerate(request, env) {
  try {
    const input = await request.json();
    
    // Validate required fields
    const required = ['businessName', 'phone', 'whatsapp', 'email', 'city', 'state', 'category', 'theme', 'planTier'];
    for (const field of required) {
      if (!input[field]) {
        return jsonResponse({ error: `Missing required field: ${field}` }, 400);
      }
    }
    
    // Generate slug
    const slug = input.customSlug || generateSlug(input.businessName);
    
    // Check slug availability
    const existing = await env.RESORT_CONFIGS.get(`config:${slug}`);
    if (existing) {
      return jsonResponse({ 
        error: 'Slug already exists', 
        suggestion: `${slug}-${input.city.toLowerCase()}` 
      }, 409);
    }
    
    // Generate config with NESTED structure (v7.2)
    const config = generatePropertyTemplate(input, slug);
    
    // AI enhancement if no description provided
    if (!input.description || input.description.trim() === '') {
      try {
        const aiEnhanced = await enhanceWithGemini(config, env);
        return jsonResponse({
          success: true,
          config: aiEnhanced,
          slug: slug,
          message: 'Property generated with AI enhancements'
        });
      } catch (error) {
        console.error('[CEO] AI enhancement failed:', error);
        // Fall back to template only
        return jsonResponse({
          success: true,
          config: config,
          slug: slug,
          message: 'Property generated (AI enhancement failed, using template)'
        });
      }
    }
    
    console.log(`[CEO] Generated config for: ${slug}`);
    
    return jsonResponse({
      success: true,
      config: config,
      slug: slug,
      message: 'Property generated from template'
    });
    
  } catch (error) {
    console.error('[CEO] Generate error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleCEOPublish(request, env) {
  try {
    const { config, slug } = await request.json();
    
    if (!config || !slug) {
      return jsonResponse({ error: 'Missing config or slug' }, 400);
    }
    
    // Validate slug
    if (!VALID_SLUG_PATTERN.test(slug)) {
      return jsonResponse({ error: 'Invalid slug format' }, 400);
    }
    
    // Add metadata
    config.slug = slug;
    config.updatedAt = new Date().toISOString();

    // Workspace sharding (booking sink routing)
    // Assign workspaceId only when publishing a NEW site.
    const existingConfigRaw = await env.RESORT_CONFIGS.get(`config:${slug}`);
    const isNewSite = !existingConfigRaw;

    if (isNewSite) {
      const requestedWorkspaceId = config.workspaceId || config.booking?.workspaceId || null;
      const allocation = await allocateWorkspaceIdForNewSite(env, requestedWorkspaceId);
      config.workspaceId = allocation.workspaceId;
      if (!config.booking) config.booking = {};
      config.booking.workspaceId = allocation.workspaceId;
    } else {
      // Preserve existing workspaceId if present.
      if (config.workspaceId && config.booking) {
        config.booking.workspaceId = config.workspaceId;
      }
    }
    
    // Write to KV
    await env.RESORT_CONFIGS.put(`config:${slug}`, JSON.stringify(config));
    
    // Update market summary
    const summary = {
      slug: config.slug,
      name: config.name,
      tagline: config.tagline,
      category: config.category,
      city: config.location.city,
      state: config.location.state,
      basePrice: config.basePrice || 0,
      rating: config.rating || 0,
      primaryColor: config.branding.primaryColor,
      heroImage: config.branding.heroImage || '',
      showInMarket: config.showInMarket !== false,
      priorityRank: config.priorityRank || 10
    };
    
    await env.RESORT_CONFIGS.put(`market:summary:${slug}`, JSON.stringify(summary));
    
    // Update index
    const indexData = await env.RESORT_CONFIGS.get('ceo:properties:index', { type: 'json' }) || { slugs: [] };
    let slugs = Array.isArray(indexData.slugs) ? indexData.slugs : [];
    
    slugs = slugs.filter(s => s !== config.slug);
    slugs.unshift(config.slug);
    slugs = slugs.slice(0, 1000);
    
    await env.RESORT_CONFIGS.put('ceo:properties:index', JSON.stringify({
      slugs: slugs,
      updatedAt: new Date().toISOString()
    }));
    
    console.log(`[CEO] Published: ${config.slug}`);
    
    return jsonResponse({
      success: true,
      slug: slug,
      url: `https://${slug}.webzyl.com`,
      operatorDashboard: `https://webzyl.com/operator?slug=${slug}`,
      message: 'Property published successfully'
    });
    
  } catch (error) {
    console.error('[CEO] Publish error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleCEOProperties(env) {
  try {
    let indexData = null;
    try {
      indexData = await kvGetJSONSafe(env.RESORT_CONFIGS, 'ceo:properties:index');
    } catch (err) {
      console.warn('[CEO] Index parse failed, falling back to full scan:', err);
      indexData = null;
    }
    
    if (indexData && Array.isArray(indexData.slugs)) {
      const properties = [];
      const slugsToFetch = indexData.slugs.slice(0, 50);
      
      for (const slug of slugsToFetch) {
        let config = null;
        try {
          config = await kvGetJSONSafe(env.RESORT_CONFIGS, `config:${slug}`);
        } catch (err) {
          console.warn(`[CEO] Skipping invalid config:${slug} (JSON parse failed):`, err);
          continue;
        }

        if (!config) continue;

        // Handle both nested and flat structures
        const city = config.location?.city || config.city || '';
        const state = config.location?.state || config.state || '';
        
        properties.push({
          slug: config.slug,
          name: config.name,
          status: config.status,
          city: city,
          state: state,
          category: config.category,
          planTier: config.plan_tier,
          updatedAt: config.updatedAt
        });
      }
      
      return jsonResponse({
        properties: properties,
        total: properties.length
      });
    }
    
    // Fallback: full scan
    console.log('[CEO] Index not found, performing full scan');
    const list = await env.RESORT_CONFIGS.list({ prefix: 'config:' });
    
    const properties = [];
    const indexSlugs = [];
    
    for (const key of list.keys) {
      if (key.name.startsWith('config:') && !key.name.includes(':test')) {
        let config = null;
        try {
          config = await kvGetJSONSafe(env.RESORT_CONFIGS, key.name);
        } catch (err) {
          console.warn(`[CEO] Skipping invalid ${key.name} (JSON parse failed):`, err);
          continue;
        }

        if (!config) continue;

        const city = config.location?.city || config.city || '';
        const state = config.location?.state || config.state || '';
        
        properties.push({
          slug: config.slug,
          name: config.name,
          status: config.status,
          city: city,
          state: state,
          category: config.category,
          planTier: config.plan_tier,
          updatedAt: config.updatedAt
        });
        indexSlugs.push(config.slug);
      }
    }
    
    properties.sort((a, b) => {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
    
    await env.RESORT_CONFIGS.put('ceo:properties:index', JSON.stringify({
      slugs: indexSlugs,
      updatedAt: new Date().toISOString()
    }));
    
    return jsonResponse({
      properties: properties.slice(0, 50),
      total: properties.length
    });
    
  } catch (error) {
    console.error('[CEO] Properties list error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleCEOGetProperty(slug, env) {
  try {
    const config = await getPropertyConfigSafeUncached(env, slug);
    
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }
    
    return jsonResponse(config);
    
  } catch (error) {
    console.error('[CEO] Get property error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleCEODeleteProperty(slug, env) {
  try {
    await env.RESORT_CONFIGS.delete(`config:${slug}`);
    await env.RESORT_CONFIGS.delete(`market:summary:${slug}`);

    const indexData = await env.RESORT_CONFIGS.get('ceo:properties:index', { type: 'json' }) || { slugs: [] };
    const newSlugs = indexData.slugs.filter(s => s !== slug);
    await env.RESORT_CONFIGS.put('ceo:properties:index', JSON.stringify({
      slugs: newSlugs,
      updatedAt: new Date().toISOString()
    }));

    return jsonResponse({
      success: true,
      message: 'Property deleted successfully'
    });

  } catch (error) {
    console.error('[CEO] Delete error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// CEO TIER MANAGEMENT HANDLERS (v2.2.0 - FLEXIBLE TIER SYSTEM)
// ============================================================================

/**
 * GET /api/ceo/tiers
 * Returns the current tier configuration (editable from CEO dashboard)
 */
async function handleCEOGetTiers(env) {
  try {
    // Try to get custom tier config from KV
    let tierConfig = await env.RESORT_CONFIGS.get('system:tier-config', { type: 'json' });

    // If no custom config, return default tier config
    if (!tierConfig) {
      tierConfig = getDefaultTierConfig();
      // Save default config to KV for future edits
      await env.RESORT_CONFIGS.put('system:tier-config', JSON.stringify(tierConfig));
    }

    return jsonResponse({
      success: true,
      tiers: tierConfig
    });

  } catch (error) {
    console.error('[CEO] Get tiers error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * PUT /api/ceo/tiers
 * Updates the tier configuration (only accessible from CEO dashboard)
 */
async function handleCEOUpdateTiers(request, env) {
  try {
    const tierConfig = await request.json();

    // Validate tier config structure
    if (!tierConfig.tiers || !tierConfig.defaultTier) {
      return jsonResponse({ error: 'Invalid tier configuration' }, 400);
    }

    // Add metadata
    tierConfig.metadata = {
      lastUpdated: new Date().toISOString(),
      updatedBy: 'ceo',
      version: tierConfig.version || '1.0'
    };

    // Save to KV
    await env.RESORT_CONFIGS.put('system:tier-config', JSON.stringify(tierConfig));

    console.log('[CEO] Tier config updated successfully');

    return jsonResponse({
      success: true,
      message: 'Tier configuration updated successfully',
      tiers: tierConfig
    });

  } catch (error) {
    console.error('[CEO] Update tiers error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * POST /api/ceo/property/:slug/plan
 * Updates a property's plan tier and associated settings
 */
async function handleCEOUpdatePropertyPlan(slug, request, env) {
  try {
    const { plan, bookingMode, quota, plan_expiry, customBranding, featureOverrides } = await request.json();

    if (!plan) {
      return jsonResponse({ error: 'Plan tier is required' }, 400);
    }

    // Get tier config to validate plan exists
    let tierConfig = await env.RESORT_CONFIGS.get('system:tier-config', { type: 'json' });
    if (!tierConfig) {
      tierConfig = getDefaultTierConfig();
    }

    if (!tierConfig.tiers[plan]) {
      return jsonResponse({ error: `Invalid plan tier: ${plan}` }, 400);
    }

    // Get current property config
    const config = await getPropertyConfigSafeUncached(env, slug);
    if (!config) {
      return jsonResponse({ error: 'Property not found' }, 404);
    }

    // Update plan-related fields
    config.plan = plan;
    config.planTier = plan; // Keep for backwards compatibility

    // Update booking mode
    if (bookingMode) {
      if (!config.booking) config.booking = {};
      config.booking.mode = bookingMode;
      config.booking.enabled = true;
    }

    // Update quota (for tier-2)
    if (quota) {
      if (!config.quota) config.quota = {};
      config.quota.whatsapp_limit = quota.whatsapp_limit || 100;
      config.quota.whatsapp_monthly = config.quota.whatsapp_monthly || 0;
    }

    // Update plan expiry
    if (plan_expiry) {
      config.plan_expiry = plan_expiry;
    }

    // Update custom branding
    if (customBranding !== undefined) {
      if (!config.branding) config.branding = {};
      config.branding.customEnabled = customBranding;
    }

    // Apply tier-specific features from tier config
    const tierFeatures = tierConfig.tiers[plan].features;

    // Store feature overrides if provided
    if (featureOverrides) {
      if (!config.featureOverrides) config.featureOverrides = {};
      config.featureOverrides = featureOverrides;
    }

    // Update booking features based on tier (with overrides)
    if (!config.booking) config.booking = {};
    config.booking.fullBookingSystem = featureOverrides?.booking?.fullBookingSystem ?? tierFeatures.booking.fullBookingSystem;
    config.booking.calendar = featureOverrides?.booking?.calendar ?? tierFeatures.booking.calendar;
    config.booking.dateRangePicker = featureOverrides?.booking?.dateRangePicker ?? tierFeatures.booking.dateRangePicker;
    config.booking.roomTypeSelection = featureOverrides?.booking?.roomTypeSelection ?? tierFeatures.booking.roomTypeSelection;
    config.booking.availabilityManagement = featureOverrides?.booking?.availabilityManagement ?? tierFeatures.booking.availabilityManagement;

    // Update notification channels based on tier (with overrides)
    if (!config.notifications) config.notifications = {};
    if (!config.notifications.channels) config.notifications.channels = {};

    config.notifications.channels = {
      googleSheets: { enabled: tierFeatures.notifications.googleSheets },
      email: {
        enabled: tierFeatures.notifications.emailToOwner,
        ownerEmail: config.contact?.email || '',
        customerConfirmation: featureOverrides?.notifications?.emailToCustomer ?? tierFeatures.notifications.emailToCustomer
      },
      whatsapp: {
        automated: featureOverrides?.notifications?.whatsappAutomation ?? tierFeatures.notifications.whatsappAutomation,
        ctaButton: featureOverrides?.notifications?.whatsappCTA ?? tierFeatures.notifications.whatsappCTA,
        phone: config.contact?.whatsapp || config.contact?.phone || ''
      },
      sms: { enabled: featureOverrides?.notifications?.sms ?? tierFeatures.notifications.sms },
      telegram: { enabled: featureOverrides?.notifications?.telegram ?? tierFeatures.notifications.telegram }
    };

    // Update branding based on tier (with overrides)
    if (!config.branding) config.branding = {};
    config.branding.customThemes = featureOverrides?.branding?.customThemes ?? tierFeatures.branding.customThemes;
    config.branding.removeBranding = featureOverrides?.branding?.removeBranding ?? tierFeatures.branding.removeBranding;
    config.branding.customDomain = featureOverrides?.branding?.customDomain ?? tierFeatures.branding.customDomain;

    // Update quota from tier config
    if (!config.quota) config.quota = {};
    config.quota.whatsapp_limit = quota?.whatsapp_limit || tierFeatures.quota.whatsapp_monthly;
    config.quota.sms_limit = tierFeatures.quota.sms_monthly;
    config.quota.email_limit = tierFeatures.quota.email_monthly;

    // Save updated config
    await env.RESORT_CONFIGS.put(`config:${slug}`, JSON.stringify(config));

    console.log(`[CEO] Updated plan for ${slug} to ${plan}`);

    return jsonResponse({
      success: true,
      message: `Property plan updated to ${plan}`,
      config: {
        slug,
        plan,
        bookingMode: config.booking?.mode,
        quota: config.quota,
        notifications: config.notifications.channels
      }
    });

  } catch (error) {
    console.error('[CEO] Update property plan error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * Returns default tier configuration
 */
function getDefaultTierConfig() {
  return {
    "version": "1.0",
    "tiers": {
      "basic": {
        "id": "basic",
        "name": "Basic",
        "displayName": "Basic (FREE)",
        "marketingName": "Inquiry Mode",
        "price": 0,
        "currency": "USD",
        "billingPeriod": "month",
        "features": {
          "booking": { "mode": "inquiry", "enabled": true, "fullBookingSystem": false, "calendar": false },
          "notifications": { "googleSheets": true, "emailToOwner": true, "emailToCustomer": false, "whatsappCTA": false, "whatsappAutomation": false },
          "quota": { "whatsapp_monthly": 0, "email_monthly": 100 }
        }
      },
      "tier-1": {
        "id": "tier-1",
        "name": "Tier 1",
        "displayName": "Tier 1 - Booking Mode",
        "marketingName": "Booking Mode",
        "subtitle": "Pro 1",
        "price": 29,
        "currency": "USD",
        "billingPeriod": "month",
        "features": {
          "booking": { "mode": "full", "enabled": true, "fullBookingSystem": true, "calendar": true },
          "notifications": { "googleSheets": true, "emailToOwner": true, "emailToCustomer": true, "whatsappCTA": true, "whatsappAutomation": false },
          "quota": { "whatsapp_monthly": 0, "email_monthly": 500 }
        }
      },
      "tier-2": {
        "id": "tier-2",
        "name": "Tier 2",
        "displayName": "Tier 2 - Booking + WhatsApp Auto",
        "marketingName": "Booking + WhatsApp Automation",
        "subtitle": "Pro 2",
        "price": 49,
        "currency": "USD",
        "billingPeriod": "month",
        "features": {
          "booking": { "mode": "full", "enabled": true, "fullBookingSystem": true, "calendar": true },
          "notifications": { "googleSheets": true, "emailToOwner": true, "emailToCustomer": true, "whatsappCTA": true, "whatsappAutomation": true, "sms": true },
          "quota": { "whatsapp_monthly": 100, "sms_monthly": 50, "email_monthly": 1000 }
        },
        "quotaOptions": [100, 250, 500, 1000]
      }
    },
    "defaultTier": "basic",
    "allowDowngrade": true
  };
}

// ============================================================================
// SSR RENDERER WITH BUSINESS INTENT (Add this to worker.js)
// ============================================================================

const THEME_COLORS = {
  'ocean-breeze': {
    primary: '#14b8a6',
    primaryDark: '#0d9488',
    primaryLight: '#5eead4'
  },
  'royal-purple': {
    primary: '#8b5cf6',
    primaryDark: '#7c3aed',
    primaryLight: '#a78bfa'
  },
  'sky-blue': {
    primary: '#3b82f6',
    primaryDark: '#2563eb',
    primaryLight: '#60a5fa'
  },
  'fresh-mint': {
    primary: '#10b981',
    primaryDark: '#059669',
    primaryLight: '#34d399'
  },
  'sunset-orange': {
    primary: '#f97316',
    primaryDark: '#ea580c',
    primaryLight: '#fb923c'
  },
  'fiery-red': {
    primary: '#ef4444',
    primaryDark: '#dc2626',
    primaryLight: '#f87171'
  },
  'modern-gray': {
    primary: '#6b7280',
    primaryDark: '#4b5563',
    primaryLight: '#9ca3af'
  },
  'cherry-blossom': {
    primary: '#ec4899',
    primaryDark: '#db2777',
    primaryLight: '#f472b6'
  }
};

function deriveBusinessIntent(category) {
  const intentMap = {
    hospitality: ['homestay', 'resort', 'hotel', 'villa', 'cottage'],
    retail: ['shop', 'cafe', 'restaurant'],
    service: ['services'],
    generic: ['others']
  };
  
  for (const [intent, cats] of Object.entries(intentMap)) {
    if (cats.includes(category)) return intent;
  }
  return 'generic';
}

function getIntentLabels(intent) {
  const labels = {
    hospitality: {
      offerings: 'Our Rooms',
      offeringsMenu: 'Rooms',
      highlights: 'Amenities',
      highlightsMenu: 'Amenities',
      primaryAction: 'Book Your Stay',
      primaryActionWhatsApp: "Hello! I'd like to book a stay at",
      primaryActionIcon: '📅'
    },
    retail: {
      offerings: 'Our Products',
      offeringsMenu: 'Products',
      highlights: 'Features',
      highlightsMenu: 'Features',
      primaryAction: 'Enquire on WhatsApp',
      primaryActionWhatsApp: "Hello! I'm interested in your products at",
      primaryActionIcon: '💬'
    },
    service: {
      offerings: 'Our Services',
      offeringsMenu: 'Services',
      highlights: 'Why Choose Us',
      highlightsMenu: 'Why Us',
      primaryAction: 'Request a Quote',
      primaryActionWhatsApp: "Hello! I'd like to request a quote from",
      primaryActionIcon: '📋'
    },
    generic: {
      offerings: 'What We Offer',
      offeringsMenu: 'Offerings',
      highlights: 'Highlights',
      highlightsMenu: 'Highlights',
      primaryAction: 'Get In Touch',
      primaryActionWhatsApp: "Hello! I'd like to know more about",
      primaryActionIcon: '✉️'
    }
  };
  
  return labels[intent] || labels.generic;
}

function resolveDesignProfileVariant(siteConfig) {
  // If explicit variant is set in config, use it
  if (siteConfig.branding?.designVariant) {
    return siteConfig.branding.designVariant;
  }
  
  // Otherwise, derive deterministically from site slug
  const slug = siteConfig.slug || '';
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash += slug.charCodeAt(i);
  }
  
  // Alternate between "calm" and "bold" based on hash
  return hash % 2 === 0 ? 'calm' : 'bold';
}

function mergeProfileWithVariant(baseProfile, variantProfile) {
  // Deep copy base profile
  const merged = JSON.parse(JSON.stringify(baseProfile));
  
  // Apply variant overrides
  if (variantProfile.overrides) {
    Object.keys(variantProfile.overrides).forEach(key => {
      if (typeof variantProfile.overrides[key] === 'object' && !Array.isArray(variantProfile.overrides[key])) {
        merged[key] = { ...merged[key], ...variantProfile.overrides[key] };
      } else {
        merged[key] = variantProfile.overrides[key];
      }
    });
  }
  
  return merged;
}

function resolveExperimentVariant(siteConfig) {
  // If explicit variant is set in experiment config, use it
  if (siteConfig.experiment?.variant && siteConfig.experiment.variant !== 'auto') {
    return siteConfig.experiment.variant;
  }
  
  // Otherwise, deterministically assign A or B using slug hashing
  const slug = siteConfig.slug || '';
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash += slug.charCodeAt(i);
  }
  
  // Assign A or B based on hash
  return hash % 2 === 0 ? 'A' : 'B';
}

function mapExperimentToDesignVariant(experimentId, experimentVariant, baseProfileId) {
  // Map experiment combinations to existing design variants
  const experimentMappings = {
    'hero-spacing-test-v1': {
      'A': 'calm',
      'B': 'bold'
    }
  };
  
  const mapping = experimentMappings[experimentId];
  if (!mapping) {
    return null;
  }
  
  return mapping[experimentVariant] || null;
}

function generateCriticalCSS(profile) {
  return `<style>
/* Critical CSS - Token-Dependent Styles (Phase 4 Performance) */
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-tap-highlight-color: transparent; }
body {
  font-family: var(--font-body);
  font-size: var(--font-base);
  line-height: var(--line-height-body);
  color: var(--color-fg);
  background-color: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
h1, h2, h3 {
  font-family: var(--font-display);
  letter-spacing: var(--letter-spacing-heading);
  color: var(--color-fg);
}
h1 { font-size: calc(var(--font-base) * var(--scale-ratio) * var(--scale-ratio) * var(--scale-ratio)); line-height: var(--line-height-display); }
h2 { font-size: calc(var(--font-base) * var(--scale-ratio) * var(--scale-ratio)); line-height: var(--line-height-display); }
h3 { font-size: calc(var(--font-base) * var(--scale-ratio)); line-height: 1.3; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
section { padding: var(--spacing-section) 0; }
img { max-width: 100%; height: auto; display: block; }
</style>`;
}

function generateDesignTokens(profile) {
  return `<style>
:root {
  --font-display: "${profile.typography.fontDisplay}", serif;
  --font-body: "${profile.typography.fontBody}", sans-serif;
  --font-base: ${profile.typography.baseSize}px;
  --scale-ratio: ${profile.typography.scaleRatio};
  --letter-spacing-display: ${profile.typography.letterSpacing.display};
  --letter-spacing-heading: ${profile.typography.letterSpacing.heading};
  --line-height-display: ${profile.typography.lineHeight.display};
  --line-height-body: ${profile.typography.lineHeight.body};
  --spacing-section: ${profile.spacing.section};
  --spacing-component: ${profile.spacing.component};
  --color-bg: ${profile.color.background};
  --color-fg: ${profile.color.foreground};
  --color-accent: ${profile.color.accent};
}
</style>`;
}

// =====================================================
// EVENT EMISSION - PHASE 5
// =====================================================
// Privacy-first event emission to Cloudflare KV.
// Governance: See METRICS_GOVERNANCE_v1.md
// Strategy: Fire-and-forget, non-blocking, no retry logic (zero-ops)
// =====================================================

async function emitEvent(env, eventPayload) {
  try {
    // Validate event type
    if (!EVENT_SCHEMA.allowedEvents.includes(eventPayload.event)) {
      console.warn(`[METRICS] Invalid event type: ${eventPayload.event}`);
      return;
    }

    // Validate required fields
    for (const field of EVENT_SCHEMA.requiredFields) {
      if (!eventPayload[field]) {
        console.warn(`[METRICS] Missing required field: ${field}`);
        return;
      }
    }

    // Check for forbidden fields (privacy enforcement)
    for (const field of EVENT_SCHEMA.forbiddenFields) {
      if (eventPayload[field] !== undefined) {
        console.error(`[METRICS] Forbidden field detected: ${field}. Event rejected.`);
        return;
      }
    }

    // Bucket timestamp to nearest hour (privacy protection)
    const now = new Date();
    const bucketedTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    eventPayload.tsBucket = bucketedTimestamp.toISOString();

    // Generate unique event ID (for append-only storage)
    const eventId = `${eventPayload.slug}:${eventPayload.event}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;

    // Store in KV (append-only, no overwrites)
    // Key format: events:{slug}:{event}:{timestamp}:{random}
    // Value: JSON payload
    await env.EVENTS_KV.put(
      `events:${eventId}`,
      JSON.stringify(eventPayload),
      { expirationTtl: 60 * 60 * 24 * 90 } // 90-day retention
    );

    console.log(`[METRICS] Event emitted: ${eventPayload.event} for ${eventPayload.slug}`);
  } catch (error) {
    // Fire-and-forget: log error but never block SSR or user experience
    console.error(`[METRICS] Event emission failed (non-blocking):`, error.message);
  }
}

function formatPrice(value, unit = '', currencySymbol = '₹') {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return `${currencySymbol}${value.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
  }
  const text = String(value).trim();
  const hasCurrency = /₹|\$|rs\.?|inr/i.test(text);
  if (hasCurrency) {
    return text;
  }
  return `${currencySymbol}${text}${unit ? ` ${unit}` : ''}`;
}

function renderSmartTemplate(config, templateHTML, designProfile, env, ctx) {
  const intent = deriveBusinessIntent(config.category);
  const labels = getIntentLabels(intent);
  const themeId = config.templateId || 'ocean-breeze';
  const themeColors = THEME_COLORS[themeId] || THEME_COLORS['ocean-breeze'];
  const colors = {
    primary: config.branding?.primaryColor || themeColors.primary,
    primaryDark: config.branding?.primaryDark || themeColors.primaryDark,
    primaryLight: config.branding?.primaryLight || themeColors.primaryLight
  };

  const sanitizeHeroObjectPosition = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'center';

    // Allow safe percentage-based focal points like "50% 30%" (x y)
    // Clamp values to [0, 100] to avoid weird/injected CSS.
    const percentMatch = normalized.match(/^(\d{1,3})%\s+(\d{1,3})%$/);
    if (percentMatch) {
      const clamp = (n) => Math.max(0, Math.min(100, n));
      const x = clamp(parseInt(percentMatch[1], 10));
      const y = clamp(parseInt(percentMatch[2], 10));
      return `${x}% ${y}%`;
    }

    const allowed = new Set([
      'center',
      'top',
      'bottom',
      'left',
      'right',
      'center top',
      'center bottom',
      'left top',
      'left bottom',
      'right top',
      'right bottom'
    ]);
    return allowed.has(normalized) ? normalized : 'center';
  };

  const sanitizePercentPair = (value) => {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const match = raw.match(/^\s*(\d{1,3})(?:\s*%?)\s+(\d{1,3})(?:\s*%?)\s*$/);
    if (!match) return null;

    const clamp01 = (n) => Math.max(0, Math.min(100, n));
    const x = clamp01(Number(match[1]));
    const y = clamp01(Number(match[2]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return { x, y };
  };

  const offsetPercentPair = (pair, dx, dy) => {
    if (!pair) return null;
    const clamp01 = (n) => Math.max(0, Math.min(100, n));
    return {
      x: clamp01(Number(pair.x) + Number(dx || 0)),
      y: clamp01(Number(pair.y) + Number(dy || 0))
    };
  };

  const sanitizeHexColor = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex)) return hex;
    return '';
  };

  const sanitizeHeroFontStyle = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'default' || raw === 'system') return '';

    // Allowlist keys -> safe built-in font stacks (no external loads)
    const map = {
      // Use single quotes so we can safely embed this into HTML attributes like: style="--var:..."
      modern: `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'Liberation Sans', sans-serif`,
      classic: `ui-serif, Georgia, 'Times New Roman', Times, serif`,
      elegant: `ui-serif, 'Palatino Linotype', Palatino, Georgia, serif`,
      mono: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`
    };

    return map[raw] || '';
  };

  const sanitizePx = (value, min, max) => {
    if (value === undefined || value === null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    return `${clamped}px`;
  };

  const heroFitModeRaw = String(config.branding?.heroFitMode ?? config.heroFitMode ?? '').trim().toLowerCase();
  const heroFitMode = (heroFitModeRaw === 'contain' || heroFitModeRaw === 'fit' || heroFitModeRaw === 'nocrop') ? 'contain' : 'cover';
  const heroFitClass = heroFitMode === 'cover' ? 'hero-fit-cover' : 'hero-fit-contain';

  const mobileHeroBoxedRaw = config.branding?.mobileHeroBoxed ?? config.mobileHeroBoxed;
  // Default to false (off) for a cleaner mobile hero look
  const mobileHeroBoxed = (mobileHeroBoxedRaw === true || String(mobileHeroBoxedRaw).trim().toLowerCase() === 'true') ? true : false;
  const mobileHeroBoxClass = mobileHeroBoxed ? 'mobile-hero-boxed' : '';

  // Back-compat: heroContentPositionDesktop/Mobile and heroTextPositionDesktop/Mobile map to headline position
  const legacyHeroTextPosDesktop = sanitizePercentPair(
    config.branding?.heroTextPositionDesktop ??
    config.branding?.heroContentPositionDesktop ??
    config.heroTextPositionDesktop ??
    config.heroContentPositionDesktop ??
    ''
  );
  const legacyHeroTextPosMobile = sanitizePercentPair(
    config.branding?.heroTextPositionMobile ??
    config.branding?.heroContentPositionMobile ??
    config.heroTextPositionMobile ??
    config.heroContentPositionMobile ??
    ''
  );

  const hasLegacyHeroTextPos = Boolean(legacyHeroTextPosDesktop || legacyHeroTextPosMobile);
  const heroTextPosClass = hasLegacyHeroTextPos ? 'hero-text-positioned' : '';
  const heroTextPosStyleAttr = hasLegacyHeroTextPos
    ? `style="` +
      (legacyHeroTextPosDesktop ? `--hero-text-x-desktop:${legacyHeroTextPosDesktop.x}%; --hero-text-y-desktop:${legacyHeroTextPosDesktop.y}%; ` : '') +
      (legacyHeroTextPosMobile ? `--hero-text-x-mobile:${legacyHeroTextPosMobile.x}%; --hero-text-y-mobile:${legacyHeroTextPosMobile.y}%;` : '') +
      `"`
    : '';

  const heroHeadlinePosDesktop = sanitizePercentPair(
    config.branding?.heroHeadlinePositionDesktop ?? config.heroHeadlinePositionDesktop ?? ''
  ) ?? legacyHeroTextPosDesktop;
  const heroHeadlinePosMobile = sanitizePercentPair(
    config.branding?.heroHeadlinePositionMobile ?? config.heroHeadlinePositionMobile ?? ''
  ) ?? legacyHeroTextPosMobile;
  const hasHeroHeadlinePos = Boolean(heroHeadlinePosDesktop || heroHeadlinePosMobile);
  const heroHeadlinePosClass = hasHeroHeadlinePos ? 'hero-headline-positioned' : '';
  const heroHeadlinePosStyleAttr = hasHeroHeadlinePos
    ? `style="` +
      (heroHeadlinePosDesktop ? `--hero-headline-x-desktop:${heroHeadlinePosDesktop.x}%; --hero-headline-y-desktop:${heroHeadlinePosDesktop.y}%; ` : '') +
      (heroHeadlinePosMobile ? `--hero-headline-x-mobile:${heroHeadlinePosMobile.x}%; --hero-headline-y-mobile:${heroHeadlinePosMobile.y}%;` : '') +
      `"`
    : '';

  const rawHeroTaglinePosDesktop = sanitizePercentPair(
    config.branding?.heroTaglinePositionDesktop ?? config.heroTaglinePositionDesktop ?? ''
  );
  const rawHeroTaglinePosMobile = sanitizePercentPair(
    config.branding?.heroTaglinePositionMobile ?? config.heroTaglinePositionMobile ?? ''
  );

  // If legacy headline position exists but tagline is not set, offset tagline slightly lower.
  const heroTaglinePosDesktop = rawHeroTaglinePosDesktop ?? offsetPercentPair(heroHeadlinePosDesktop, 0, 8);
  const heroTaglinePosMobile = rawHeroTaglinePosMobile ?? offsetPercentPair(heroHeadlinePosMobile, 0, 10);
  const hasHeroTaglinePos = Boolean(heroTaglinePosDesktop || heroTaglinePosMobile);
  const heroTaglinePosClass = hasHeroTaglinePos ? 'hero-tagline-positioned' : '';
  const heroTaglinePosStyleAttr = hasHeroTaglinePos
    ? `style="` +
      (heroTaglinePosDesktop ? `--hero-tagline-x-desktop:${heroTaglinePosDesktop.x}%; --hero-tagline-y-desktop:${heroTaglinePosDesktop.y}%; ` : '') +
      (heroTaglinePosMobile ? `--hero-tagline-x-mobile:${heroTaglinePosMobile.x}%; --hero-tagline-y-mobile:${heroTaglinePosMobile.y}%;` : '') +
      `"`
    : '';

  const heroPrimaryCtaPosDesktop = sanitizePercentPair(
    config.branding?.heroPrimaryCtaPositionDesktop ?? config.heroPrimaryCtaPositionDesktop ?? ''
  );
  const heroPrimaryCtaPosMobile = sanitizePercentPair(
    config.branding?.heroPrimaryCtaPositionMobile ?? config.heroPrimaryCtaPositionMobile ?? ''
  );
  const hasHeroPrimaryCtaPos = Boolean(heroPrimaryCtaPosDesktop || heroPrimaryCtaPosMobile);
  const heroPrimaryCtaClass = hasHeroPrimaryCtaPos ? 'hero-cta-positioned' : '';
  const heroPrimaryCtaStyleAttr = hasHeroPrimaryCtaPos
    ? `style="` +
      (heroPrimaryCtaPosDesktop ? `--hero-cta-primary-x-desktop:${heroPrimaryCtaPosDesktop.x}%; --hero-cta-primary-y-desktop:${heroPrimaryCtaPosDesktop.y}%; ` : '') +
      (heroPrimaryCtaPosMobile ? `--hero-cta-primary-x-mobile:${heroPrimaryCtaPosMobile.x}%; --hero-cta-primary-y-mobile:${heroPrimaryCtaPosMobile.y}%;` : '') +
      `"`
    : '';

  const heroSecondaryCtaPosDesktop = sanitizePercentPair(
    config.branding?.heroSecondaryCtaPositionDesktop ?? config.heroSecondaryCtaPositionDesktop ?? ''
  );
  const heroSecondaryCtaPosMobile = sanitizePercentPair(
    config.branding?.heroSecondaryCtaPositionMobile ?? config.heroSecondaryCtaPositionMobile ?? ''
  );
  const hasHeroSecondaryCtaPos = Boolean(heroSecondaryCtaPosDesktop || heroSecondaryCtaPosMobile);
  const heroSecondaryCtaClass = hasHeroSecondaryCtaPos ? 'hero-cta-positioned' : '';
  const heroSecondaryCtaStyleAttr = hasHeroSecondaryCtaPos
    ? `style="` +
      (heroSecondaryCtaPosDesktop ? `--hero-cta-secondary-x-desktop:${heroSecondaryCtaPosDesktop.x}%; --hero-cta-secondary-y-desktop:${heroSecondaryCtaPosDesktop.y}%; ` : '') +
      (heroSecondaryCtaPosMobile ? `--hero-cta-secondary-x-mobile:${heroSecondaryCtaPosMobile.x}%; --hero-cta-secondary-y-mobile:${heroSecondaryCtaPosMobile.y}%;` : '') +
      `"`
    : '';

  const whatsappFloatPosDesktop = sanitizePercentPair(
    config.branding?.whatsappFloatPositionDesktop ?? config.whatsappFloatPositionDesktop ?? ''
  );
  const whatsappFloatPosMobile = sanitizePercentPair(
    config.branding?.whatsappFloatPositionMobile ?? config.whatsappFloatPositionMobile ?? ''
  );
  const hasWhatsappFloatPos = Boolean(whatsappFloatPosDesktop || whatsappFloatPosMobile);
  const whatsappFloatPosClass = hasWhatsappFloatPos ? 'whatsapp-float-positioned' : '';
  const whatsappFloatPosStyleAttr = hasWhatsappFloatPos
    ? `style="` +
      (whatsappFloatPosDesktop ? `--whatsapp-x-desktop:${whatsappFloatPosDesktop.x}%; --whatsapp-y-desktop:${whatsappFloatPosDesktop.y}%; ` : '') +
      (whatsappFloatPosMobile ? `--whatsapp-x-mobile:${whatsappFloatPosMobile.x}%; --whatsapp-y-mobile:${whatsappFloatPosMobile.y}%;` : '') +
      `"`
    : '';

  // FOUC Fix: Generate CSS variables for :root to prevent position shift on refresh
  const heroPositionCssVars = [
    heroHeadlinePosDesktop ? `--hero-headline-x-desktop:${heroHeadlinePosDesktop.x}%; --hero-headline-y-desktop:${heroHeadlinePosDesktop.y}%;` : '',
    heroHeadlinePosMobile ? `--hero-headline-x-mobile:${heroHeadlinePosMobile.x}%; --hero-headline-y-mobile:${heroHeadlinePosMobile.y}%;` : '',
    heroTaglinePosDesktop ? `--hero-tagline-x-desktop:${heroTaglinePosDesktop.x}%; --hero-tagline-y-desktop:${heroTaglinePosDesktop.y}%;` : '',
    heroTaglinePosMobile ? `--hero-tagline-x-mobile:${heroTaglinePosMobile.x}%; --hero-tagline-y-mobile:${heroTaglinePosMobile.y}%;` : '',
    heroPrimaryCtaPosDesktop ? `--hero-cta-primary-x-desktop:${heroPrimaryCtaPosDesktop.x}%; --hero-cta-primary-y-desktop:${heroPrimaryCtaPosDesktop.y}%;` : '',
    heroPrimaryCtaPosMobile ? `--hero-cta-primary-x-mobile:${heroPrimaryCtaPosMobile.x}%; --hero-cta-primary-y-mobile:${heroPrimaryCtaPosMobile.y}%;` : '',
    heroSecondaryCtaPosDesktop ? `--hero-cta-secondary-x-desktop:${heroSecondaryCtaPosDesktop.x}%; --hero-cta-secondary-y-desktop:${heroSecondaryCtaPosDesktop.y}%;` : '',
    heroSecondaryCtaPosMobile ? `--hero-cta-secondary-x-mobile:${heroSecondaryCtaPosMobile.x}%; --hero-cta-secondary-y-mobile:${heroSecondaryCtaPosMobile.y}%;` : '',
    whatsappFloatPosDesktop ? `--whatsapp-float-x-desktop:${whatsappFloatPosDesktop.x}%; --whatsapp-float-y-desktop:${whatsappFloatPosDesktop.y}%;` : '',
    whatsappFloatPosMobile ? `--whatsapp-float-x-mobile:${whatsappFloatPosMobile.x}%; --whatsapp-float-y-mobile:${whatsappFloatPosMobile.y}%;` : ''
  ].filter(Boolean).join(' ');
  const heroPositionCssVarsBlock = heroPositionCssVars ? `${heroPositionCssVars}` : '';

  const heroTextColor = sanitizeHexColor(config.branding?.heroTextColor ?? config.heroTextColor ?? '');
  const heroFontFamily = sanitizeHeroFontStyle(config.branding?.heroFontStyle ?? config.heroFontStyle ?? '');
  const heroPrimaryCtaFontFamily = sanitizeHeroFontStyle(
    config.branding?.heroPrimaryCtaFontStyle ?? config.heroPrimaryCtaFontStyle ?? ''
  );
  const heroSecondaryCtaFontFamily = sanitizeHeroFontStyle(
    config.branding?.heroSecondaryCtaFontStyle ?? config.heroSecondaryCtaFontStyle ?? ''
  );
  const heroH1SizeDesktop = sanitizePx(config.branding?.heroTitleFontSizeDesktopPx ?? config.heroTitleFontSizeDesktopPx ?? '', 20, 120);
  const heroH1SizeMobile = sanitizePx(config.branding?.heroTitleFontSizeMobilePx ?? config.heroTitleFontSizeMobilePx ?? '', 20, 120);
  const heroTaglineSizeDesktop = sanitizePx(config.branding?.heroTaglineFontSizeDesktopPx ?? config.heroTaglineFontSizeDesktopPx ?? '', 12, 48);
  const heroTaglineSizeMobile = sanitizePx(config.branding?.heroTaglineFontSizeMobilePx ?? config.heroTaglineFontSizeMobilePx ?? '', 12, 48);
  const heroBg = resolveHeroBackground(config);
  const heroBgHasImage = Boolean(heroBg && heroBg.hasImage && heroBg.url);
  const heroBgMode = (heroBg && heroBg.type) ? heroBg.type : 'preset';

  // ===============================
  // Header Style Profile
  // ===============================
  const sanitizeHeaderWeight = (value) => {
    if (value === undefined || value === null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const clamped = Math.max(300, Math.min(900, Math.round(n / 50) * 50));
    return String(clamped);
  };

  const headerStyle = (config.headerStyle && typeof config.headerStyle === 'object')
    ? config.headerStyle
    : ((config.branding?.headerStyle && typeof config.branding.headerStyle === 'object') ? config.branding.headerStyle : null);

  const headerModeRaw = String(headerStyle?.mode ?? '').trim().toLowerCase();
  const headerMode = (headerModeRaw === 'auto' || headerModeRaw === 'light' || headerModeRaw === 'dark' || headerModeRaw === 'custom')
    ? headerModeRaw
    : 'auto';

  // Structural header style: auto/custom resolve based on hero background (blank => dark header, image => light header).
  const headerModeResolved = (headerMode === 'light' || headerMode === 'dark')
    ? headerMode
    : (heroBgMode === 'none' ? 'dark' : 'light');

  const headerTextColorCustom = sanitizeHexColor(headerStyle?.textColor ?? '');
  // In custom mode without explicit color, use empty string to allow CSS fallback to Auto behavior
  const headerTextColor = (headerMode === 'custom' && !headerTextColorCustom)
    ? ''
    : (headerTextColorCustom || (headerModeResolved === 'dark' ? '#1a202c' : '#ffffff'));

  const headerBrandFontFamily = sanitizeHeroFontStyle(headerStyle?.brandFontStyle ?? '');
  const headerBrandFontWeight = sanitizeHeaderWeight(headerStyle?.brandFontWeight ?? '');
  const headerBrandFontSize = sanitizePx(headerStyle?.brandFontSizePx ?? '', 14, 40);

  // Default to classic serif font for a more stylish look
  const headerBrandFontFamilyEffective = headerBrandFontFamily || `ui-serif, Georgia, 'Times New Roman', Times, serif`;
  const headerBrandFontWeightEffective = headerBrandFontWeight || '800';
  const headerBrandFontSizeEffective = headerBrandFontSize || '24px';

  const bodyClasses = [];
  if (heroBgMode === 'none') bodyClasses.push('hero-bg-none');
  bodyClasses.push(`header-style-${headerModeResolved}`);
  // Only add custom class if actually using a custom color
  if (headerMode === 'custom' && headerTextColorCustom) bodyClasses.push('header-style-custom');
  const bodyClass = bodyClasses.join(' ').trim();

  // If background is explicitly none and no custom hero text color was provided, default to dark for readability.
  const heroTextColorEffective = (!heroTextColor && heroBgMode === 'none') ? '#1a202c' : heroTextColor;
  const hasHeroTextStyle = Boolean(
    heroTextColorEffective ||
    heroFontFamily ||
    heroPrimaryCtaFontFamily ||
    heroSecondaryCtaFontFamily ||
    heroH1SizeDesktop ||
    heroH1SizeMobile ||
    heroTaglineSizeDesktop ||
    heroTaglineSizeMobile
  );
  const heroTextStyleAttr = hasHeroTextStyle
    ? `style="` +
      (heroTextColorEffective ? `--hero-text-color:${heroTextColorEffective}; ` : '') +
      (heroFontFamily ? `--hero-font-family:${heroFontFamily}; ` : '') +
      (heroPrimaryCtaFontFamily ? `--hero-cta-primary-font-family:${heroPrimaryCtaFontFamily}; ` : '') +
      (heroSecondaryCtaFontFamily ? `--hero-cta-secondary-font-family:${heroSecondaryCtaFontFamily}; ` : '') +
      (heroH1SizeDesktop ? `--hero-h1-size-desktop:${heroH1SizeDesktop}; ` : '') +
      (heroH1SizeMobile ? `--hero-h1-size-mobile:${heroH1SizeMobile}; ` : '') +
      (heroTaglineSizeDesktop ? `--hero-tagline-size-desktop:${heroTaglineSizeDesktop}; ` : '') +
      (heroTaglineSizeMobile ? `--hero-tagline-size-mobile:${heroTaglineSizeMobile}; ` : '') +
      `"`
    : '';

  const heroObjectPosition = sanitizeHeroObjectPosition(
    config.heroObjectPosition || config.branding?.heroObjectPosition || ''
  );

  const rawLogoUrl = config.branding?.logoUrl || config.branding?.logo || config.logoUrl || config.logo || '';
  const logoUrl = rawLogoUrl
    ? rawLogoUrl + (rawLogoUrl.includes('img.webzyl.com') ? '?w=320&q=90' : '')
    : '';
  const has_logo = Boolean(rawLogoUrl);

  // Logo Placement Options: header-left (default), header-center, hero-center, hero-overlay
  const logoPlacement = config.branding?.logoPlacement || 'header-left';
  const logoPlacementClass = `logo-placement-${logoPlacement}`;

  // Logo size variants for different placements
  const logoSizeMap = {
    'header-left': 'large',     // 70-90px - Bold statement
    'header-center': 'medium',  // 50-70px - Premium balance
    'hero-center': 'xlarge',    // 80-120px - Large & elegant
    'hero-overlay': 'xxlarge'   // 100-140px - Floating overlay
  };
  const logoSize = logoSizeMap[logoPlacement] || 'medium';

  // Logo Size Multiplier (0.7x to 1.5x)
  const logoSizeMultiplier = config.branding?.logoSizeMultiplier || 1.0;
  const logoSizeMultiplierClass = `logo-size-multiplier-${String(logoSizeMultiplier).replace('.', '-')}`;

  // Logo Border Style (none, badge-light, badge-dark, border-minimal, shadow-only, glass)
  const logoBorderStyle = config.branding?.logoBorderStyle || 'badge-light';
  const logoBorderClass = `logo-border-${logoBorderStyle}`;

  // Logo Shape (auto, rounded, rounded-heavy, circular)
  const logoShape = config.branding?.logoShape || 'rounded';
  const logoShapeClass = `logo-shape-${logoShape}`;

  // Logo Position Offsets (fine-tuning)
  const logoOffsetX = parseInt(config.branding?.logoOffsetX || 0);
  const logoOffsetY = parseInt(config.branding?.logoOffsetY || 0);
  const logoOffsetStyle = (logoOffsetX !== 0 || logoOffsetY !== 0)
    ? `--logo-offset-x: ${logoOffsetX}px; --logo-offset-y: ${logoOffsetY}px;`
    : '';

  // Logo Visibility Toggle
  const logoVisible = config.branding?.logoVisible !== false; // Default to true
  const logoVisibilityClass = logoVisible ? '' : 'logo-hidden';

  // Combined logo style classes
  const logoStyleClasses = `${logoPlacementClass} logo-size-${logoSize} ${logoSizeMultiplierClass} ${logoBorderClass} ${logoShapeClass} ${logoVisibilityClass}`.trim();
  
  const has_gallery = Array.isArray(config.gallery) && config.gallery.length > 0;
  const fallbackVideoThumb = (() => {
    const fromHero = (heroBgHasImage ? heroBg.url : '');
    if (fromHero) return String(fromHero);
    const first = (Array.isArray(config.gallery) && config.gallery.length > 0) ? config.gallery[0] : null;
    const firstUrl = (typeof first === 'string') ? first : (first?.url || '');
    return firstUrl ? String(firstUrl) : '';
  })();
  const videos = normalizeVideoItems(config, fallbackVideoThumb);
  const has_videos = videos.length > 0;

  // Best-effort background backfill for missing thumbnails (non-blocking).
  // This makes Instagram/Vimeo/etc automatically pick up a thumbnail over time.
  try {
    if (env && ctx && config?.slug) {
      const rawVideos = Array.isArray(config?.videos) ? config.videos : [];
      const hasAnyMissingThumb = rawVideos.some(v => {
        if (!v) return false;
        if (typeof v === 'string') return true;
        const url = normalizeHttpUrl(v.url || v.link || '');
        if (!url) return false;
        const thumb = normalizeHttpUrl(v.thumbnail || v.thumb || '');
        return !thumb;
      });

      if (hasAnyMissingThumb) {
        ctx.waitUntil(backfillVideoThumbnails(env, String(config.slug), fallbackVideoThumb));
      }
    }
  } catch (e) {
    console.warn('[VIDEOS] Thumbnail backfill scheduling failed:', e?.message || e);
  }
  const has_offerings = Array.isArray(config.rooms) && config.rooms.length > 0;
  const has_highlights = Array.isArray(config.amenities) && config.amenities.length > 0;
  const has_primary_action = ['hospitality', 'retail', 'service'].includes(intent);
  const has_social = config.social && (config.social.facebook || config.social.instagram || config.social.twitter || config.social.youtube);
  const has_booking = intent === 'hospitality' && Boolean(config.booking);

  // Reviews processing
  const visibleReviews = (Array.isArray(config.reviews) ? config.reviews : [])
    .filter(r => r && r.visible !== false && r.name && r.text)
    .map(r => ({
      name: String(r.name || '').trim(),
      text: String(r.text || '').trim(),
      rating: parseInt(r.rating) || 5,
      date: r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
      STARS: Array(parseInt(r.rating) || 5).fill('⭐')
    }));
  const has_reviews = visibleReviews.length > 0;

  // Hero title (separate from property name)
  const heroTitleText = String(
    config.heroTitle ?? config.branding?.heroTitle ?? ''
  ).trim() || String(config.name || '').trim();

  const normalizeHeroTitleMode = (raw, fallback) => {
    const v = String(raw ?? '').trim().toLowerCase();
    return (v === 'show' || v === 'hide' || v === 'auto') ? v : fallback;
  };

  const heroTitleModeDefault = normalizeHeroTitleMode(
    (config.heroTitleMode ?? config.branding?.heroTitleMode ?? 'auto'),
    'auto'
  );

  const heroTitleModeDesktop = normalizeHeroTitleMode(
    (config.heroTitleModeDesktop ?? config.branding?.heroTitleModeDesktop ?? ''),
    heroTitleModeDefault
  );

  const heroTitleModeMobile = normalizeHeroTitleMode(
    (config.heroTitleModeMobile ?? config.branding?.heroTitleModeMobile ?? ''),
    heroTitleModeDefault
  );

  const heroImageContainsBrandRaw = (config.heroImageContainsBrand ?? config.branding?.heroImageContainsBrand);
  const heroImageContainsBrand = (heroImageContainsBrandRaw === true || String(heroImageContainsBrandRaw).trim().toLowerCase() === 'true');

  const shouldRenderHeroTitleByMode = (mode) => mode === 'hide'
    ? false
    : mode === 'show'
      ? true
      : !(heroImageContainsBrand && has_logo);

  const shouldRenderHeroTitleDesktop = shouldRenderHeroTitleByMode(heroTitleModeDesktop);
  const shouldRenderHeroTitleMobile = shouldRenderHeroTitleByMode(heroTitleModeMobile);
  const has_hero_title = Boolean(heroTitleText && (shouldRenderHeroTitleDesktop || shouldRenderHeroTitleMobile));
  const heroTitleDisplayDesktop = shouldRenderHeroTitleDesktop ? 'block' : 'none';
  const heroTitleDisplayMobile = shouldRenderHeroTitleMobile ? 'block' : 'none';

  const secondaryActionLabel = String(config.branding?.secondaryActionLabel ?? config.secondaryActionLabel ?? '').trim();
  const secondaryActionLink = String(config.branding?.secondaryActionLink ?? config.secondaryActionLink ?? '').trim();
  const secondaryActionIcon = String(config.branding?.secondaryActionIcon ?? config.secondaryActionIcon ?? '').trim();
  const has_secondary_action = Boolean(secondaryActionLabel && secondaryActionLink);

  const primaryActionLabelOverride = String(config.branding?.primaryActionLabel ?? config.primaryActionLabel ?? '').trim();
  const primaryActionLabel = primaryActionLabelOverride || labels.primaryAction;

  // Map embed: template expects a URL for <iframe src="{{MAP_EMBED}}">.
  // Some configs may store the full <iframe ...> markup; normalize to a safe src URL.
  const mapEmbedSrc = normalizeMapEmbedSrc(config.embeds?.map);
  
  let html = templateHTML
    .replace(/{{BUSINESS_NAME}}/g, config.name || '')
    .replace(/{{HERO_TITLE}}/g, heroTitleText)
    .replace(/{{HERO_TITLE_DISPLAY_DESKTOP}}/g, heroTitleDisplayDesktop)
    .replace(/{{HERO_TITLE_DISPLAY_MOBILE}}/g, heroTitleDisplayMobile)
    .replace(/{{HERO_TITLE_MODE_MOBILE}}/g, heroTitleModeMobile)
    .replace(/{{HERO_POSITION_CSS_VARS}}/g, heroPositionCssVarsBlock)
    .replace(/{{TAGLINE}}/g, config.tagline || '')
    .replace(/{{DESCRIPTION}}/g, config.about || '')
    .replace(/{{PRIMARY_COLOR}}/g, colors.primary)
    .replace(/{{PRIMARY_DARK}}/g, colors.primaryDark)
    .replace(/{{PRIMARY_LIGHT}}/g, colors.primaryLight)
    .replace(/{{HERO_IMAGE}}/g, (heroBgHasImage ? heroBg.url : ''))
    .replace(/{{HERO_BG_CLASS}}/g, heroBgMode === 'none' ? 'hero-bg-none' : '')
    .replace(/{{BODY_CLASS}}/g, bodyClass)
    .replace(/{{HEADER_TEXT_COLOR}}/g, headerTextColor)
    .replace(/{{HEADER_BRAND_FONT_FAMILY}}/g, headerBrandFontFamilyEffective)
    .replace(/{{HEADER_BRAND_FONT_WEIGHT}}/g, headerBrandFontWeightEffective)
    .replace(/{{HEADER_BRAND_FONT_SIZE}}/g, headerBrandFontSizeEffective)
    .replace(/{{HERO_FIT_CLASS}}/g, heroFitClass)
    .replace(/{{MOBILE_HERO_BOX_CLASS}}/g, mobileHeroBoxClass)
    .replace(/{{HERO_TEXT_STYLE_ATTR}}/g, heroTextStyleAttr)
    .replace(/{{HERO_TEXT_POSITION_CLASS}}/g, heroTextPosClass)
    .replace(/{{HERO_TEXT_POSITION_STYLE_ATTR}}/g, heroTextPosStyleAttr)
    .replace(/{{HERO_HEADLINE_POSITION_CLASS}}/g, heroHeadlinePosClass)
    .replace(/{{HERO_HEADLINE_POSITION_STYLE_ATTR}}/g, heroHeadlinePosStyleAttr)
    .replace(/{{HERO_TAGLINE_POSITION_CLASS}}/g, heroTaglinePosClass)
    .replace(/{{HERO_TAGLINE_POSITION_STYLE_ATTR}}/g, heroTaglinePosStyleAttr)
    .replace(/{{HERO_PRIMARY_CTA_POSITION_CLASS}}/g, heroPrimaryCtaClass)
    .replace(/{{HERO_PRIMARY_CTA_POSITION_STYLE_ATTR}}/g, heroPrimaryCtaStyleAttr)
    .replace(/{{HERO_SECONDARY_CTA_POSITION_CLASS}}/g, heroSecondaryCtaClass)
    .replace(/{{HERO_SECONDARY_CTA_POSITION_STYLE_ATTR}}/g, heroSecondaryCtaStyleAttr)
    .replace(/{{WHATSAPP_FLOAT_POSITION_CLASS}}/g, whatsappFloatPosClass)
    .replace(/{{WHATSAPP_FLOAT_POSITION_STYLE_ATTR}}/g, whatsappFloatPosStyleAttr)
    .replace(/{{HERO_OBJECT_POSITION}}/g, heroObjectPosition)
    .replace(/{{LOGO_URL}}/g, logoUrl)
    .replace(/{{LOGO_CLASS}}/g, has_logo ? 'has-image' : '')
    .replace(/{{LOGO_STYLE_CLASSES}}/g, logoStyleClasses)
    .replace(/{{LOGO_OFFSET_STYLE}}/g, logoOffsetStyle)
    .replace(/{{PHONE}}/g, config.contact?.phone || '')
    .replace(/{{EMAIL}}/g, config.contact?.email || '')
    .replace(/{{WHATSAPP}}/g, config.contact?.whatsapp || '')
    .replace(/{{ADDRESS}}/g, config.location?.address || '')
    .replace(/{{MAP_LINK}}/g, config.location?.mapLink || '')
    .replace(/{{SLUG}}/g, String(config.slug || ''));
  
  // Menu Labels - custom or defaults
  const menuLabels = config.menuLabels || {};
  const MENU_LABEL_ABOUT = menuLabels.about || 'About';
  const MENU_LABEL_GALLERY = menuLabels.gallery || 'Gallery';
  const MENU_LABEL_VIDEOS = menuLabels.videos || 'Videos';
  const MENU_LABEL_REVIEWS = menuLabels.reviews || 'Testimonials';
  const MENU_LABEL_CONTACT = menuLabels.contact || 'Contact';
  const MENU_LABEL_BOOKING = menuLabels.booking || 'Booking';

  html = html
    .replace(/{{OFFERINGS_LABEL}}/g, labels.offerings)
    .replace(/{{OFFERINGS_MENU_LABEL}}/g, labels.offeringsMenu)
    .replace(/{{HIGHLIGHTS_LABEL}}/g, labels.highlights)
    .replace(/{{HIGHLIGHTS_MENU_LABEL}}/g, labels.highlightsMenu)
    .replace(/{{MENU_LABEL_ABOUT}}/g, MENU_LABEL_ABOUT)
    .replace(/{{MENU_LABEL_GALLERY}}/g, MENU_LABEL_GALLERY)
    .replace(/{{MENU_LABEL_VIDEOS}}/g, MENU_LABEL_VIDEOS)
    .replace(/{{MENU_LABEL_REVIEWS}}/g, MENU_LABEL_REVIEWS)
    .replace(/{{MENU_LABEL_CONTACT}}/g, MENU_LABEL_CONTACT)
    .replace(/{{MENU_LABEL_BOOKING}}/g, MENU_LABEL_BOOKING)
    .replace(/{{PRIMARY_ACTION_LABEL}}/g, primaryActionLabel)
    .replace(/{{PRIMARY_ACTION_WHATSAPP}}/g, `${labels.primaryActionWhatsApp} ${config.name}`)
    .replace(/{{PRIMARY_ACTION_ICON}}/g, labels.primaryActionIcon);

  const primaryActionLink = has_booking
    ? '#booking'
    : (config.contact?.whatsapp
      ? `https://wa.me/${config.contact.whatsapp}?text=${encodeURIComponent(`${labels.primaryActionWhatsApp} ${config.name || ''}`)}`
      : '#contact');
  html = html.replace(/{{PRIMARY_ACTION_LINK}}/g, primaryActionLink);

  const bookingRoomsSource = (Array.isArray(config.rooms) && config.rooms.length > 0) ? config.rooms : [];
  const bookingRoomOptions = bookingRoomsSource.map(r => {
    const name = (typeof r === 'string' ? r : (r?.name || '')).toString().trim();
    if (!name) return '';
    const safe = name.replace(/\"/g, '&quot;');
    return `<option value="${safe}">${name}</option>`;
  }).filter(Boolean).join('\n');
  html = html.replace(/{{BOOKING_ROOM_OPTIONS}}/g, bookingRoomOptions);
  
  html = handleConditional(html, 'HAS_GALLERY', has_gallery);
  html = handleConditional(html, 'HAS_VIDEOS', has_videos);
  html = handleConditional(html, 'HAS_OFFERINGS', has_offerings);
  html = handleConditional(html, 'HAS_HIGHLIGHTS', has_highlights);
  html = handleConditional(html, 'HAS_REVIEWS', has_reviews);
  html = handleConditional(html, 'HAS_BOOKING', has_booking);
  html = handleConditional(html, 'HAS_PRIMARY_ACTION', has_primary_action);
  html = handleConditional(html, 'HAS_SOCIAL', has_social);
  html = handleConditional(html, 'HAS_LOGO', has_logo);
  html = handleConditional(html, 'HAS_HERO_TITLE', has_hero_title);
  html = handleConditional(html, 'HAS_HERO_BG_IMAGE', heroBgHasImage);
  html = handleConditional(html, 'HAS_SECONDARY_ACTION', has_secondary_action);
  
  html = handleConditional(html, 'FACEBOOK', config.social?.facebook);
  html = handleConditional(html, 'INSTAGRAM', config.social?.instagram);
  html = handleConditional(html, 'TWITTER', config.social?.twitter);
  html = handleConditional(html, 'YOUTUBE_SOCIAL', config.social?.youtube);
  html = handleConditional(html, 'MAP_LINK', config.location?.mapLink);
  html = handleConditional(html, 'MAP_EMBED', mapEmbedSrc);
  
  if (config.social) {
    html = html.replace(/{{FACEBOOK}}/g, config.social.facebook || '');
    html = html.replace(/{{INSTAGRAM}}/g, config.social.instagram || '');
    html = html.replace(/{{TWITTER}}/g, config.social.twitter || '');
    html = html.replace(/{{YOUTUBE_SOCIAL}}/g, config.social.youtube || '');
  }

  if (mapEmbedSrc) {
    html = html.replace(/{{MAP_EMBED}}/g, escapeHtmlAttribute(mapEmbedSrc));
  }

  if (has_secondary_action) {
    html = html.replace(/{{SECONDARY_ACTION_LABEL}}/g, secondaryActionLabel);
    html = html.replace(/{{SECONDARY_ACTION_LINK}}/g, secondaryActionLink);
    html = html.replace(/{{SECONDARY_ACTION_ICON}}/g, secondaryActionIcon);
  }
  
  if (has_gallery) {
    const galleryHTML = config.gallery.map(img => {
      const src = typeof img === 'string' ? img : (img?.url || '');
      if (!src) return '';
      return `
        <div class="gallery-item" onclick="openLightbox('${src}')">
          <img src="${src}" alt="Gallery Image">
        </div>
      `;
    }).filter(Boolean).join('\n');
    html = html.replace(/{{#GALLERY}}[\s\S]*?{{\/GALLERY}}/g, galleryHTML);
  }

  if (has_videos) {
    const videosHTML = videos.map(v => {
      const href = escapeHtmlAttribute(v.url);
      const thumb = escapeHtmlAttribute(v.thumbnail || '');
      const title = escapeHtmlAttribute(v.title || 'Video');
      if (!href) return '';
      const imgTag = thumb ? `<img src="${thumb}" alt="${title}">` : '';
      return `
        <a class="gallery-item" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${title}">
          ${imgTag}
        </a>
      `;
    }).filter(Boolean).join('\n');
    html = html.replace(/{{#VIDEOS}}[\s\S]*?{{\/VIDEOS}}/g, videosHTML);
  }

  // Reviews
  if (has_reviews) {
    const reviewsHTML = visibleReviews.map(review => {
      const stars = '⭐'.repeat(review.rating);
      const dateText = review.date ? ` • ${review.date}` : '';
      return `
        <div class="review-card">
          <div class="review-rating">${stars}</div>
          <p class="review-text">"${review.text}"</p>
          <div class="review-author">
            <strong>${review.name}</strong>
            ${dateText ? `<span class="review-date">${dateText}</span>` : ''}
          </div>
        </div>
      `;
    }).join('\n');
    html = html.replace(/{{#REVIEWS}}[\s\S]*?{{\/REVIEWS}}/g, reviewsHTML);
  }

  if (has_highlights) {
    // Property-level amenity icons mapping
    const propertyAmenityIcons = {
      'Free WiFi': '📶', 'WiFi': '📶', 'Free Parking': '🅿️', 'Parking': '🅿️',
      'Hot Water': '♨️', 'Power Backup': '🔋', 'Room Service': '🛎️', '24/7 Room Service': '🛎️',
      '24/7 Support': '📞', 'Air Conditioning': '❄️', 'AC': '❄️', 'Heating': '🔥', 'Heater': '🔥',
      'Swimming Pool': '🏊', 'Pool': '🏊', 'Gym': '💪', 'Fitness Center': '💪',
      'Restaurant': '🍽️', 'Dining': '🍽️', 'Bar': '🍸', 'Spa': '💆', 'Massage': '💆',
      'Garden': '🌳', 'Pet Friendly': '🐕', 'Laundry': '🧺', 'Airport Shuttle': '✈️',
      'Conference Room': '📊', 'Business Center': '💼', 'Kids Play Area': '🎮',
      'Bonfire': '🔥', 'BBQ': '🍖', 'BBQ Facilities': '🍖', 'Barbecue': '🍖',
      'Complimentary Breakfast': '🍳', 'Breakfast': '🍳',
      'TV': '📺', 'Cable TV': '📺', 'Kitchen': '🍳', 'Kitchenette': '🍳',
      'Balcony': '🏞️', 'Terrace': '🏞️', 'Safe': '🔒', 'Security': '🔒'
    };

    // Adaptive sizing based on amenity count
    const totalAmenities = config.amenities.length;
    const getSizeConfig = (count) => {
      if (count <= 6) {
        return { iconSize: '2.5rem', fontSize: '0.95rem', padding: '1.2rem 1.5rem', minWidth: '140px' };
      } else if (count <= 12) {
        return { iconSize: '2rem', fontSize: '0.85rem', padding: '1rem 1.3rem', minWidth: '120px' };
      } else {
        return { iconSize: '1.8rem', fontSize: '0.75rem', padding: '0.9rem 1.1rem', minWidth: '110px' };
      }
    };

    const sizeConfig = getSizeConfig(totalAmenities);

    const highlightsHTML = config.amenities.map((amenity, idx) => {
      const name = (typeof amenity === 'string' ? amenity : (amenity?.name || '')).toString().trim();
      // Check if amenity object has icon, otherwise lookup from mapping, default to ✨
      const icon = (typeof amenity === 'object' && amenity.icon)
        ? amenity.icon.toString()
        : (propertyAmenityIcons[name] || '✨');
      const safeName = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (!name) return '';

      // Alternating gradient colors
      const gradients = [
        `linear-gradient(135deg, ${colors.primary}18, ${colors.primary}28)`,
        `linear-gradient(135deg, ${colors.secondary}18, ${colors.secondary}28)`,
        `linear-gradient(135deg, ${colors.primary}12, ${colors.secondary}22)`
      ];
      const bgGradient = gradients[idx % 3];

      return `
        <div style="
          background: ${bgGradient};
          border: 2px solid ${idx % 2 === 0 ? colors.primary : colors.secondary}35;
          border-radius: 16px;
          padding: ${sizeConfig.padding};
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.6rem;
          min-width: ${sizeConfig.minWidth};
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          cursor: default;
        " onmouseover="this.style.transform='translateY(-4px) scale(1.02)'; this.style.boxShadow='0 8px 20px rgba(0,0,0,0.12)';"
           onmouseout="this.style.transform='translateY(0) scale(1)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)';">
          <div style="font-size: ${sizeConfig.iconSize}; line-height: 1;">${icon}</div>
          <div style="font-size: ${sizeConfig.fontSize}; font-weight: 600; text-align: center; color: #2d3748; line-height: 1.3;">${safeName}</div>
        </div>
      `;
    }).filter(Boolean).join('\n');
    html = html.replace(/{{#HIGHLIGHTS}}[\s\S]*?{{\/HIGHLIGHTS}}/g, highlightsHTML);
  }
  
  if (has_offerings) {
    // Amenity icons mapping
    const amenityIcons = {
      'AC': '❄️', 'Heater': '🔥', 'Single Bed': '🛏️', 'Double Bed': '🛏️', 'King Bed': '🛏️', 'Twin Beds': '🛏️',
      'Attached Bathroom': '🚿', 'Private Bathroom': '🚿', 'TV': '📺', 'WiFi': '📶', 'Mini Fridge': '🧊',
      'Coffee Maker': '☕', 'Balcony': '🏞️', 'Sea View': '🌊', 'Mountain View': '⛰️', 'Garden View': '🌳',
      'Work Desk': '💼', 'Safe': '🔒', 'Wardrobe': '👔', 'Hair Dryer': '💨', 'Iron': '🔌', 'Kettle': '🫖'
    };

    const offeringsHTML = config.rooms.map(room => {
      const roomData = typeof room === 'object' ? room : { name: room };
      const priceValue = roomData.price ?? config.basePrice ?? '';
      const priceUnit = roomData.priceUnit || (intent === 'hospitality' ? '/night' : '');
      const priceLabel = formatPrice(priceValue, priceUnit);
      const image = roomData.image || null;

      // Get room amenities
      const roomAmenities = roomData.amenities || [];
      // Adaptive display based on amenity count - show ALL amenities
      const totalAmenities = roomAmenities.length;

      // Generate amenity visual card if no image
      let visualContent = '';
      if (!image && totalAmenities > 0) {
        // Adaptive sizing based on amenity count
        const getSizeConfig = (count) => {
          if (count <= 4) {
            return { iconSize: '2rem', fontSize: '0.8rem', padding: '0.85rem 1.1rem', minWidth: '100px', gridMin: '95px' };
          } else if (count <= 8) {
            return { iconSize: '1.6rem', fontSize: '0.72rem', padding: '0.7rem 0.95rem', minWidth: '85px', gridMin: '80px' };
          } else if (count <= 12) {
            return { iconSize: '1.4rem', fontSize: '0.65rem', padding: '0.6rem 0.85rem', minWidth: '75px', gridMin: '70px' };
          } else {
            return { iconSize: '1.2rem', fontSize: '0.6rem', padding: '0.5rem 0.75rem', minWidth: '65px', gridMin: '60px' };
          }
        };

        const sizeConfig = getSizeConfig(totalAmenities);

        // Create modern, attractive amenity grid - show ALL amenities
        const amenityGrid = roomAmenities.map((amenity, idx) => {
          const icon = amenityIcons[amenity] || '✨';
          // Alternating gradient colors for each badge
          const gradients = [
            `linear-gradient(135deg, ${colors.primary}20, ${colors.primary}30)`,
            `linear-gradient(135deg, ${colors.secondary}20, ${colors.secondary}30)`,
            `linear-gradient(135deg, ${colors.primary}15, ${colors.secondary}25)`
          ];
          const bgGradient = gradients[idx % 3];

          return `
            <div style="
              background: ${bgGradient};
              border: 1.5px solid ${idx % 2 === 0 ? colors.primary : colors.secondary}40;
              border-radius: 12px;
              padding: ${sizeConfig.padding};
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 0.3rem;
              min-width: ${sizeConfig.minWidth};
              transition: transform 0.2s;
              box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            ">
              <div style="font-size: ${sizeConfig.iconSize}; line-height: 1;">${icon}</div>
              <div style="font-size: ${sizeConfig.fontSize}; font-weight: 600; text-align: center; color: #2d3748; line-height: 1.2;">${amenity}</div>
            </div>
          `;
        }).join('');

        visualContent = `
          <div class="card-image" style="
            background: linear-gradient(135deg, ${colors.primary}08 0%, ${colors.secondary}12 50%, ${colors.primary}08 100%);
            position: relative;
            overflow: hidden;
            padding: 1.75rem 1.25rem;
            min-height: 220px;
            display: flex;
            flex-direction: column;
            justify-content: center;
          ">
            <!-- Decorative background pattern -->
            <div style="
              position: absolute;
              top: -50px;
              right: -50px;
              width: 200px;
              height: 200px;
              background: ${colors.primary}08;
              border-radius: 50%;
              filter: blur(40px);
            "></div>
            <div style="
              position: absolute;
              bottom: -30px;
              left: -30px;
              width: 150px;
              height: 150px;
              background: ${colors.secondary}08;
              border-radius: 50%;
              filter: blur(40px);
            "></div>

            <!-- Enhanced header badge with dark/light contrast -->
            <div style="
              background:
                linear-gradient(135deg,
                  rgba(0,0,0,0.85) 0%,
                  rgba(30,30,30,0.9) 50%,
                  rgba(0,0,0,0.85) 100%);
              color: white;
              padding: 0.7rem 1.5rem;
              border-radius: 30px;
              font-size: 0.95rem;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 1.5px;
              margin-bottom: 1.2rem;
              align-self: center;
              position: relative;
              box-shadow:
                0 0 60px ${colors.primary}FF,
                0 0 40px ${colors.secondary}FF,
                0 0 30px rgba(255,255,255,0.8),
                0 12px 35px rgba(0,0,0,0.6),
                0 0 0 3px ${colors.primary},
                0 0 0 6px white,
                0 0 0 9px ${colors.secondary},
                0 0 0 12px rgba(0,0,0,0.3),
                inset 0 2px 0 rgba(255,255,255,0.3),
                inset 0 -2px 0 rgba(0,0,0,0.5);
              border: none;
              text-shadow:
                0 0 30px ${colors.primary}FF,
                0 0 20px ${colors.secondary}FF,
                0 0 10px rgba(255,255,255,0.8),
                0 3px 8px rgba(0,0,0,0.8),
                2px 2px 4px rgba(0,0,0,0.9);
            ">✨ ROOM FEATURES ✨</div>

            <!-- Scrollable amenity grid container -->
            <div style="
              position: relative;
              max-height: ${totalAmenities > 12 ? '280px' : 'auto'};
              overflow-y: ${totalAmenities > 12 ? 'auto' : 'visible'};
              overflow-x: hidden;
              padding-right: ${totalAmenities > 12 ? '8px' : '0'};
              margin-right: ${totalAmenities > 12 ? '-8px' : '0'};
            ">
              <!-- Beautiful custom scrollbar styles -->
              <style>
                .amenity-scroll::-webkit-scrollbar {
                  width: 8px;
                }
                .amenity-scroll::-webkit-scrollbar-track {
                  background: rgba(255,255,255,0.3);
                  border-radius: 10px;
                  margin: 4px 0;
                }
                .amenity-scroll::-webkit-scrollbar-thumb {
                  background: linear-gradient(135deg, ${colors.primary}, ${colors.secondary});
                  border-radius: 10px;
                  border: 2px solid rgba(255,255,255,0.3);
                }
                .amenity-scroll::-webkit-scrollbar-thumb:hover {
                  background: linear-gradient(135deg, ${colors.secondary}, ${colors.primary});
                }
              </style>

              <!-- Adaptive amenity grid -->
              <div class="amenity-scroll" style="
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(${sizeConfig.gridMin}, 1fr));
                gap: 0.6rem;
                justify-content: center;
              ">
                ${amenityGrid}
              </div>
            </div>

            ${totalAmenities > 12 ? `
              <div style="
                margin-top: 0.8rem;
                text-align: center;
                font-size: 0.7rem;
                font-weight: 600;
                color: ${colors.primary};
                background: linear-gradient(135deg, ${colors.primary}15, ${colors.secondary}15);
                padding: 0.4rem 0.8rem;
                border-radius: 12px;
                display: inline-block;
                align-self: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.06);
                border: 1px solid ${colors.primary}30;
              ">
                ↕️ Scroll to see all ${totalAmenities} amenities
              </div>
            ` : ''}
          </div>
        `;
      } else if (image) {
        visualContent = `<img src="${image}" alt="${roomData.name || 'Offering'}" class="card-image">`;
      }

      return `
        <div class="card">
          ${visualContent}
          <div class="card-content">
            <h3 class="card-title">${roomData.name || ''}</h3>
            <p class="card-text">${roomData.description || ''}</p>
            ${priceLabel ? `<p style="font-size: 1.5rem; color: ${colors.primary}; font-weight: 700;">${priceLabel}</p>` : ''}
          </div>
        </div>
      `;
    }).join('\n');
    html = html.replace(/{{#OFFERINGS}}[\s\S]*?{{\/OFFERINGS}}/g, offeringsHTML);
  }
  
  // Phase 4: Inject design tokens + critical CSS into <head> (only if design profile exists)
  if (designProfile) {
    const designTokens = generateDesignTokens(designProfile);
    const criticalCSS = generateCriticalCSS(designProfile);
    html = html.replace('</head>', `${designTokens}\n${criticalCSS}\n</head>`);
  }
  
  return html;
}

// ============================================================================
// VIDEO THUMBNAIL AUTO-DETECTION (Best-effort)
// ============================================================================

async function fetchTextWithLimit(url, opts) {
  const maxBytes = opts?.maxBytes ?? 120_000;
  const timeoutMs = opts?.timeoutMs ?? 1200;
  const headers = opts?.headers || {};

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: controller.signal
    });
    if (!res.ok) return '';

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      // Still allow unknown content-type; some sites omit it.
    }

    if (!res.body) {
      const text = await res.text();
      return text.slice(0, maxBytes);
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = maxBytes - received;
        if (remaining <= 0) break;
        const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
        chunks.push(slice);
        received += slice.byteLength;
        if (received >= maxBytes) break;
      }
    }

    try { reader.cancel(); } catch (_) {}

    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  } catch (_) {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function extractMetaContent(html, predicate) {
  if (!html) return '';
  const head = html.slice(0, 120_000);
  const metaTags = head.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = {};
    tag.replace(/([a-zA-Z:_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (_m, k, v) => {
      const key = String(k || '').toLowerCase();
      let val = String(v || '').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      attrs[key] = val;
      return '';
    });
    if (predicate(attrs)) {
      return String(attrs.content || '').trim();
    }
  }
  return '';
}

function resolveToAbsoluteHttpUrl(candidate, baseUrl) {
  const raw = String(candidate || '').replace(/&amp;/g, '&').trim();
  if (!raw) return '';

  try {
    // Handle protocol-relative URLs
    if (raw.startsWith('//')) {
      const b = new URL(baseUrl);
      return normalizeHttpUrl(`${b.protocol}${raw}`);
    }

    const u = new URL(raw, baseUrl);
    return normalizeHttpUrl(u.href);
  } catch (_) {
    return '';
  }
}

async function getOpenGraphThumbnailUrl(pageUrl) {
  const html = await fetchTextWithLimit(pageUrl, {
    timeoutMs: 1500,
    maxBytes: 120_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebzylBot/1.0; +https://webzyl.com)'
    }
  });
  if (!html) return '';

  const ogImage = extractMetaContent(html, (a) => {
    const prop = String(a.property || '').toLowerCase();
    return prop === 'og:image' || prop === 'og:image:url' || prop === 'og:image:secure_url';
  });
  if (ogImage) return resolveToAbsoluteHttpUrl(ogImage, pageUrl);

  const twitterImage = extractMetaContent(html, (a) => {
    const name = String(a.name || '').toLowerCase();
    return name === 'twitter:image' || name === 'twitter:image:src';
  });
  if (twitterImage) return resolveToAbsoluteHttpUrl(twitterImage, pageUrl);

  return '';
}

async function getVimeoThumbnailUrl(url) {
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    if (!host.includes('vimeo.com')) return '';
    const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembed, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebzylBot/1.0; +https://webzyl.com)'
      }
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => null);
    const thumb = data && (data.thumbnail_url || data.thumbnail_url_with_play_button);
    return normalizeHttpUrl(thumb || '');
  } catch (_) {
    return '';
  }
}

async function resolveVideoThumbnailBestEffort(url, fallbackThumb) {
  const cleanUrl = normalizeHttpUrl(url);
  if (!cleanUrl) return '';

  const yt = getYouTubeThumbnailUrl(cleanUrl);
  if (yt) return yt;

  const vimeo = await getVimeoThumbnailUrl(cleanUrl);
  if (vimeo) return vimeo;

  const og = await getOpenGraphThumbnailUrl(cleanUrl);
  if (og) return og;

  return normalizeHttpUrl(fallbackThumb);
}

async function resolveVideoThumbnailNoFallback(url) {
  const cleanUrl = normalizeHttpUrl(url);
  if (!cleanUrl) return '';

  const yt = getYouTubeThumbnailUrl(cleanUrl);
  if (yt) return yt;

  const vimeo = await getVimeoThumbnailUrl(cleanUrl);
  if (vimeo) return vimeo;

  const og = await getOpenGraphThumbnailUrl(cleanUrl);
  if (og) return og;

  return '';
}

async function backfillVideoThumbnails(env, slug, fallbackThumb) {
  try {
    const config = await getPropertyConfigSafeUncached(env, slug);
    if (!config) return;

    const list = Array.isArray(config.videos) ? config.videos : [];
    if (list.length === 0) return;

    let changed = false;
    let attempts = 0;

    const updated = list.map((entry) => {
      if (!entry) return entry;

      // Only update object entries; keep strings untouched.
      if (typeof entry === 'string') return entry;

      const url = normalizeHttpUrl(entry.url || entry.link || '');
      if (!url) return entry;

      const existingThumb = normalizeHttpUrl(entry.thumbnail || entry.thumb || '');
      if (existingThumb) return entry;

      // Cap external fetch work per request to keep it safe.
      if (attempts >= 2) return entry;
      attempts++;

      // Placeholder; actual resolution below
      return { ...entry, __needsThumb: true, url };
    });

    for (let i = 0; i < updated.length; i++) {
      const entry = updated[i];
      if (!entry || typeof entry !== 'object' || entry.__needsThumb !== true) continue;

      const resolved = await resolveVideoThumbnailNoFallback(entry.url);
      if (resolved) {
        const { __needsThumb, ...rest } = entry;
        updated[i] = { ...rest, thumbnail: resolved };
        changed = true;
      } else {
        const { __needsThumb, ...rest } = entry;
        updated[i] = rest;
      }
    }

    if (!changed) return;

    config.videos = updated;
    config.updatedAt = new Date().toISOString();
    await env.RESORT_CONFIGS.put(`config:${slug}`, JSON.stringify(config));
    console.log(`[VIDEOS] Backfilled thumbnails: ${slug}`);
  } catch (e) {
    console.warn('[VIDEOS] Backfill failed:', e?.message || e);
  }
}

function handleConditional(html, tag, condition) {
  const regex = new RegExp(`{{#${tag}}}([\\s\\S]*?){{\/${tag}}}`, 'g');
  
  if (condition) {
    return html.replace(regex, '$1');
  } else {
    return html.replace(regex, '');
  }
}

function escapeHtmlAttribute(value) {
  return value === null || value === undefined
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeMapEmbedSrc(raw) {
  if (raw === null || raw === undefined) return '';

  let s = String(raw).trim();
  if (!s) return '';

  // If a full iframe embed snippet was pasted, extract src="...".
  // Example: <iframe src="https://www.google.com/maps/embed?..." ...></iframe>
  const iframeMatch = s.match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
  if (iframeMatch && iframeMatch[2]) {
    s = String(iframeMatch[2]).trim();
  }

  // Guardrails: `{{MAP_EMBED}}` is injected into an attribute.
  // If any tag-ish characters remain, do not render.
  if (!s || /[<>]/.test(s)) return '';

  // Basic URL check. (If empty or non-URL, browsers may iframe the current page.)
  if (!/^https?:\/\//i.test(s)) return '';

  return s;
}

function normalizeHttpUrl(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';

  // Allow users to paste full embed markup (e.g., Instagram blockquote) by extracting the first URL.
  let candidate = s;
  if (/[<>]/.test(candidate)) {
    const m = candidate.match(/https?:\/\/[^\s"'<>]+/i);
    candidate = (m && m[0]) ? m[0] : '';
  }

  candidate = String(candidate || '').replace(/&amp;/g, '&').trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) return '';
  if (/[<>]/.test(candidate)) return '';
  return candidate;
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    return host.includes('youtube.com') || host.includes('youtu.be');
  } catch (_) {
    return false;
  }
}

function getYouTubeThumbnailUrl(url) {
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    let id = '';

    if (host.includes('youtu.be')) {
      id = (u.pathname || '').replace(/^\//, '').split('/')[0] || '';
    } else if (host.includes('youtube.com')) {
      if (u.pathname.startsWith('/watch')) {
        id = u.searchParams.get('v') || '';
      } else if (u.pathname.startsWith('/shorts/')) {
        id = (u.pathname.split('/shorts/')[1] || '').split('/')[0] || '';
      } else if (u.pathname.startsWith('/embed/')) {
        id = (u.pathname.split('/embed/')[1] || '').split('/')[0] || '';
      }
    }

    id = String(id || '').trim();
    if (!id) return '';
    return `https://img.youtube.com/vi/${encodeURIComponent(id)}/maxresdefault.jpg`;
  } catch (_) {
    return '';
  }
}

function convertYouTubeEmbedToWatchUrl(url) {
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();

    // Convert /embed/VIDEO_ID to /watch?v=VIDEO_ID for direct viewing
    if (host.includes('youtube.com') && u.pathname.startsWith('/embed/')) {
      const videoId = (u.pathname.split('/embed/')[1] || '').split('/')[0];
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }

    return url; // Return original URL if not a YouTube embed URL
  } catch (_) {
    return url;
  }
}

function normalizeVideoItems(config, fallbackThumb) {
  const items = [];
  const rawList = Array.isArray(config?.videos) ? config.videos : [];

  for (const entry of rawList) {
    if (!entry) continue;
    const originalUrl = normalizeHttpUrl(typeof entry === 'string' ? entry : (entry.url || entry.link || ''));
    if (!originalUrl) continue;

    // Convert YouTube embed URLs to watch URLs for clickable links
    const url = convertYouTubeEmbedToWatchUrl(originalUrl);

    let thumbnail = normalizeHttpUrl(typeof entry === 'object' ? (entry.thumbnail || entry.thumb || '') : '');
    if (!thumbnail) {
      // Use original URL (might be embed) to get thumbnail, as getYouTubeThumbnailUrl handles both
      const yt = getYouTubeThumbnailUrl(originalUrl);
      thumbnail = yt || normalizeHttpUrl(fallbackThumb);
    }

    const title = (typeof entry === 'object' && entry.title) ? String(entry.title).trim() : '';
    items.push({ url, thumbnail, title });
  }

  // Backward compatible: single YouTube URL stored in embeds.youtube
  const legacy = normalizeHttpUrl(config?.embeds?.youtube);
  if (legacy && isYouTubeUrl(legacy) && !items.some(v => v.url === legacy)) {
    items.push({
      url: legacy,
      thumbnail: getYouTubeThumbnailUrl(legacy) || normalizeHttpUrl(fallbackThumb),
      title: ''
    });
  }

  return items;
}

async function kvGetJSONSafe(namespace, key) {
  const text = await namespace.get(key, { type: 'text' });
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    const sanitized = String(text)
      .replace(/^\uFEFF/, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    if (sanitized !== text) {
      try {
        return JSON.parse(sanitized);
      } catch (_) {
        // fall through
      }
    }

    throw new Error(`KV JSON parse failed for ${key}: ${err?.message || err}`);
  }
}

// ============================================================================
// TEMPLATE GENERATOR (v7.2 - NESTED STRUCTURE)
// ============================================================================

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 30);
}

function generatePropertyTemplate(input, slug) {
  const theme = THEMES[input.theme] || THEMES['ocean-breeze'];
  const plan = PRICING_PLANS[input.planTier] || PRICING_PLANS.premium;
  
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Handle custom category for "Others"
  const category = input.category === 'others' ? (input.customCategory || 'others') : input.category;
  
  // Generate defaults
  const tagline = input.tagline || generateDefaultTagline(category, input.businessName);
  const description = input.description || generateDefaultDescription(category, input.businessName, input.city);
  const basePrice = input.basePrice || CATEGORY_PRICES[input.category] || 0;

  // Hero background (explicit, onboarding default can be "none")
  const heroBackgroundType = String(input.heroBackgroundType ?? '').trim().toLowerCase();
  const heroBackgroundValue = (input.heroBackgroundValue == null ? null : String(input.heroBackgroundValue).trim()) || null;
  const heroBackground = (heroBackgroundType === 'none' || heroBackgroundType === 'preset' || heroBackgroundType === 'custom')
    ? { type: heroBackgroundType, value: heroBackgroundValue }
    : null;

  // Defaults for accommodation categories (homestay/resort/etc.) so sections don't disappear
  const accommodationTypes = ['homestay', 'resort', 'hotel', 'villa', 'cottage'];
  const isAccommodationCategory = accommodationTypes.includes(String(input.category || '').trim().toLowerCase());

  const normalizedBasePrice = (() => {
    const n = Number(basePrice);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const defaultRooms = isAccommodationCategory
    ? (() => {
        const fallbackImage = 'https://images.unsplash.com/photo-1566073771259-6a8506099945';
        const roomImage = (heroBackground?.type === 'custom' ? (heroBackground.value || '') : '') || fallbackImage;

        if (String(input.category || '').trim().toLowerCase() === 'villa') {
          return [
            {
              name: 'Entire Villa',
              description: 'Private stay with comfortable amenities and great views.',
              price: normalizedBasePrice || undefined,
              priceUnit: '/night',
              image: roomImage
            }
          ];
        }

        const base = normalizedBasePrice || undefined;
        const plus = normalizedBasePrice ? Math.round(normalizedBasePrice * 1.25) : undefined;

        return [
          {
            name: 'Standard Room',
            description: 'A comfortable room for a relaxed stay.',
            price: base,
            priceUnit: '/night',
            image: roomImage
          },
          {
            name: 'Deluxe Room',
            description: 'More space and upgraded comfort for families and couples.',
            price: plus,
            priceUnit: '/night',
            image: roomImage
          }
        ];
      })()
    : [];

  const inputAmenities = (Array.isArray(input.amenities) ? input.amenities : []).map(a => String(a || '').trim()).filter(Boolean);
  const amenitiesList = inputAmenities.length ? inputAmenities : [];

  const bookingModeRaw = String(input.bookingMode || '').trim().toLowerCase();
  const bookingMode = (bookingModeRaw === 'sheet' || bookingModeRaw === 'whatsapp' || bookingModeRaw === 'both')
    ? bookingModeRaw
    : 'sheet';
  
  return {
    // Core identity (camelCase)
    slug: slug,
    name: input.businessName,
    tagline: tagline,
    category: category,
    showInMarket: true,
    priorityRank: 10,
    status: 'active',
    templateId: 'resort_v1',
    
    // Nested branding object
    branding: {
      primaryColor: theme.primary,
      logo: input.logoUrl || '',
      // Legacy: keep heroImage only when background is explicitly custom
      heroImage: (heroBackground?.type === 'custom' ? (heroBackground.value || '') : ''),
      heroFitMode: (input.heroFitMode === 'contain' || input.heroFitMode === 'fit' || input.heroFitMode === 'nocrop') ? 'contain' : 'cover',
      heroObjectPosition: input.heroObjectPosition || '',
      mobileHeroBoxed: (input.mobileHeroBoxed === true || String(input.mobileHeroBoxed).trim().toLowerCase() === 'true') ? true : false,
      heroContentPositionDesktop: input.heroContentPositionDesktop || '',
      heroContentPositionMobile: input.heroContentPositionMobile || ''
    },

    // Explicit hero background (recommended)
    heroBackground: heroBackground,
    
    about: description,
    notes: `Created via CEO Dashboard on ${new Date().toISOString()}`,
    
    // Nested location object
    location: {
      address: input.fullAddress || `${input.city}, ${input.state}`,
      mapLink: input.mapLink || '',
      city: input.city,
      state: input.state,
      country: 'India',
      lat: 0,
      lng: 0
    },
    
    tags: [],
    basePrice: basePrice,
    rating: 4.5,
    
    // Nested contact object
    contact: {
      name: input.contactName || 'Owner',
      phone: input.phone,
      email: input.email,
      whatsapp: input.whatsapp
    },
    
    // Nested booking object
    booking: {
      mode: bookingMode,
      sheetName: `Bookings_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`,
      whatsappTemplate: 'Thank you for your booking request! We will contact you shortly.',
      payment: {
        enabled: false,
        provider: null,
        mode: 'disabled',
        currency: 'INR',
        depositPercent: 30,
        testMode: true
      }
    },
    
    // Nested notifications object
    notifications: {
      enabled: true,
      notifyOwner: true,
      notifyCustomer: true,
      ownerWhatsapp: input.whatsapp,
      ownerEmail: input.email,
      language: 'en',
      maxPerHour: 10
    },
    
    // Plan fields (snake_case)
    plan_tier: input.planTier,
    plan_price: plan.price,
    trial_started: '',
    trial_ends: '',
    plan_expiry: expiryDate.toISOString().split('T')[0],
    
    // Quota fields (snake_case)
    quota_whatsapp_monthly: plan.whatsapp_quota,
    quota_sms_monthly: 0,
    quota_used_month: currentMonth,
    quota_whatsapp_used: 0,
    quota_sms_used: 0,
    
    // Empty arrays for operator to fill later (or filled from input)
    gallery: input.gallery || [],
    videos: Array.isArray(input.videos) ? input.videos : [],
    rooms: (Array.isArray(input.rooms) && input.rooms.length > 0) ? input.rooms : [],
    amenities: amenitiesList.map(a => ({ name: a, icon: '✨' })),

    // Reviews/Testimonials (NEW)
    reviews: Array.isArray(input.reviews) && input.reviews.length > 0 ? input.reviews : [],

    social: {
      facebook: input.facebook || '',
      instagram: input.instagram || '',
      twitter: input.twitter || '',
      youtube: input.youtube || ''
    },

    embeds: {
      youtube: input.youtubeEmbed || '',
      map: input.mapsEmbed || input.mapLink || ''
    },

    customDomain: '',
    subdomainEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function getHeroBackgroundPresetUrl(presetId) {
  const id = String(presetId || '').trim();
  // A small curated set (3–6). Keep IDs stable.
  const PRESETS = {
    // Backward-compat default
    'platform-default': 'https://images.unsplash.com/photo-1566073771259-6a8506099945',

    // Curated options
    'minimal-light-01': 'https://images.unsplash.com/photo-1526498460520-4c246339dccb',
    'nature-01': 'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
    'luxury-01': 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb',
    'beach-01': 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21'
  };
  return PRESETS[id] || PRESETS['platform-default'];
}

function resolveHeroBackground(config) {
  // Priority: explicit heroBackground -> legacy heroImage fields -> platform default
  const hb = (config && typeof config === 'object') ? (config.heroBackground ?? config.branding?.heroBackground ?? null) : null;
  const legacyHeroImage = String(config?.heroImage || config?.branding?.heroImage || '').trim();

  if (hb && typeof hb === 'object') {
    const type = String(hb.type ?? '').trim().toLowerCase();
    const value = (hb.value == null ? '' : String(hb.value)).trim();

    if (type === 'none') {
      return { type: 'none', value: null, hasImage: false, url: '' };
    }

    if (type === 'preset') {
      const baseUrl = getHeroBackgroundPresetUrl(value || 'platform-default');
      return { type: 'preset', value: value || 'platform-default', hasImage: true, url: baseUrl };
    }

    if (type === 'custom') {
      if (value) {
        return { type: 'custom', value, hasImage: true, url: value };
      }
      // Explicit custom but no URL => treat as none
      return { type: 'none', value: null, hasImage: false, url: '' };
    }
  }

  if (legacyHeroImage) {
    return { type: 'custom', value: legacyHeroImage, hasImage: true, url: legacyHeroImage };
  }

  // Backward compatible default
  return { type: 'preset', value: 'platform-default', hasImage: true, url: getHeroBackgroundPresetUrl('platform-default') };
}

function generateDefaultTagline(category, businessName) {
  const taglines = {
    homestay: [
      'Experience comfort like home',
      'Your home away from home',
      'Warm hospitality awaits',
      'Where comfort meets tradition',
      'Feel at home, away from home'
    ],
    resort: [
      'Your perfect getaway',
      'Escape to paradise',
      'Where luxury meets nature',
      'Unforgettable experiences await',
      'Discover your perfect retreat'
    ],
    hotel: [
      'Luxury and comfort combined',
      'Where every stay matters',
      'Excellence in hospitality',
      'Your comfort is our priority',
      'Modern elegance, timeless service'
    ],
    villa: [
      'Private paradise awaits',
      'Your exclusive sanctuary',
      'Luxury in every detail',
      'Where privacy meets elegance',
      'Your personal retreat'
    ],
    cottage: [
      'Cozy retreat in nature',
      'Rustic charm, modern comfort',
      'Escape to tranquility',
      'Where nature meets comfort',
      'Your peaceful hideaway'
    ],
    restaurant: [
      'Delicious food, memorable moments',
      'Where flavors come alive',
      'Taste the difference',
      'Culinary excellence awaits',
      'Great food, greater memories'
    ],
    cafe: [
      'Great coffee, better vibes',
      'Your daily coffee ritual',
      'Where coffee meets community',
      'Brew happiness, one cup at a time',
      'Good vibes, great coffee'
    ],
    shop: [
      'Quality products, trusted service',
      'Your trusted shopping destination',
      'Where quality meets value',
      'Shop smart, shop with us',
      'Excellence in every purchase'
    ],
    services: [
      'Professional service you can trust',
      'Excellence in service delivery',
      'Your reliable service partner',
      'Quality service, guaranteed',
      'Service with excellence'
    ],
    others: [
      'Quality service for you',
      'Your trusted partner',
      'Excellence delivered',
      'Where quality matters',
      'Service you can count on'
    ]
  };

  const categoryTaglines = taglines[category] || [`Welcome to ${businessName}`];
  // Pick a random tagline from the array
  return categoryTaglines[Math.floor(Math.random() * categoryTaglines.length)];
}

function generateDefaultDescription(category, businessName, city) {
  const descriptions = {
    homestay: `${businessName} offers comfortable accommodation in ${city}. Experience warm hospitality and a home away from home.`,
    resort: `${businessName} is a premium resort in ${city}, offering world-class amenities and unforgettable experiences.`,
    hotel: `${businessName} provides exceptional hospitality in the heart of ${city}. Modern rooms, excellent service.`,
    villa: `${businessName} is your private villa in ${city}. Spacious, luxurious, and perfect for families or groups.`,
    cottage: `${businessName} offers cozy cottages in ${city}. Perfect for a peaceful retreat surrounded by nature.`,
    restaurant: `${businessName} serves delicious cuisine in ${city}. Fresh ingredients, authentic flavors, and warm ambiance.`,
    cafe: `${businessName} is your favorite cafe in ${city}. Great coffee, tasty snacks, and a welcoming atmosphere.`,
    shop: `${businessName} is your trusted shop in ${city}. Quality products, fair prices, and excellent customer service.`,
    services: `${businessName} provides professional services in ${city}. Reliable, efficient, and customer-focused.`,
    others: `${businessName} is located in ${city}. We offer quality products and services to meet your needs.`
  };
  
  return descriptions[category] || `Welcome to ${businessName} in ${city}.`;
}

// ============================================================================
// AI ENHANCEMENT (Gemini)
// ============================================================================

async function enhanceWithGemini(config, env) {
  try {
    const prompt = `You are a professional content writer for a ${config.category} business.

Business Name: ${config.name}
Category: ${config.category}
Location: ${config.location.city}, ${config.location.state}

Generate a compelling "About" section (2-3 paragraphs, 100-150 words) that:
1. Highlights what makes this ${config.category} special
2. Mentions the location naturally
3. Creates an emotional connection
4. Sounds professional but warm

Return ONLY the description text, no markdown, no labels.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error('AI generation failed');
    }

    const result = await response.json();
    const aiDescription = result.candidates[0]?.content?.parts[0]?.text?.trim();

    if (aiDescription) {
      config.about = aiDescription;
      config.notes += ' | AI-enhanced description';
    }

    return config;
    
  } catch (error) {
    console.error('[AI] Enhancement error:', error);
    // Return original config on error
    return config;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CEO-Token, X-Admin-Token'
    }
  });
}

function calculateQuotaPercent(used, limit) {
  if (limit === 0) return 0;
  return Math.round((used / limit) * 100);
}

// ============================================================================
// MEDIA STORAGE HANDLERS (NEW in v7.3)
// ============================================================================

async function handleMediaSignUpload(request, env) {
  try {
    const body = await request.json();
    const { tenantId, mediaType, filename, contentType, size } = body;

    if (!tenantId || !mediaType || !filename || !contentType || !size) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    if (!['logo', 'gallery', 'product'].includes(mediaType)) {
      return jsonResponse({ error: 'Invalid media type' }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return jsonResponse({ error: 'Unsupported file type' }, 400);
    }

    if (size > MAX_SIZES[mediaType]) {
      return jsonResponse({ 
        error: `File too large. Max ${MAX_SIZES[mediaType] / 1024 / 1024}MB for ${mediaType}` 
      }, 400);
    }

    const systemConfig = await env.RESORT_CONFIGS.get('system:uploads_enabled', 'json');
    if (systemConfig && !systemConfig.enabled) {
      return jsonResponse({ error: 'Uploads temporarily disabled' }, 503);
    }

  const tenantConfig = await getPropertyConfigSafe(env, tenantId);
    
    // Allow pre-publish uploads (tenant will be created when property is published)
    if (!tenantConfig) {
      console.log('[MEDIA] Pre-publish upload allowed for: ' + tenantId);
      // Continue without tenant validation - this is a pre-publish upload
    } else if (tenantConfig.status !== 'active') {
      return jsonResponse({ error: 'Tenant inactive' }, 403);
    }

    const lockKey = `upload-lock:${tenantId}`;
    const existing = await env.RESORT_CONFIGS.get(lockKey);
    if (existing) {
      return jsonResponse({ error: 'Upload already in progress' }, 429);
    }

    await env.RESORT_CONFIGS.put(lockKey, JSON.stringify({ lockedAt: new Date().toISOString() }), { expirationTtl: 60 });

    try {
      const plan = tenantConfig?.plan_tier || 'trial';
      const quotaKey = `quota:${tenantId}:${mediaType}`;
      const quota = await env.RESORT_CONFIGS.get(quotaKey, 'json') || { used: 0 };
      const limit = QUOTA_LIMITS[plan]?.[mediaType] || QUOTA_LIMITS.trial[mediaType];

      if (quota.used >= limit) {
        await env.RESORT_CONFIGS.delete(lockKey);
        return jsonResponse({
          error: 'quota_exceeded',
          message: `${mediaType} limit reached (${quota.used}/${limit})`,
          current: quota.used,
          limit
        }, 429);
      }

      const assetId = generateRandomId(8);
      const randomHash = generateRandomId(12);
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 255);
      const objectPath = `${tenantId}/${mediaType}/${randomHash}/${sanitizedFilename}`;

      await env.MEDIA_DB.prepare(`
        INSERT INTO assets (
          id, tenantId, mediaType, objectPath, filename,
          size, contentType, status, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
      `).bind(assetId, tenantId, mediaType, objectPath, sanitizedFilename, size, contentType).run();

      const uploadUrl = await generatePresignedPutUrl(
        env.R2_ACCOUNT_ID,
        env.R2_ACCESS_KEY_ID,
        env.R2_SECRET_ACCESS_KEY,
        'webzyl-media',
        objectPath,
        contentType,
        14400
      );

      return jsonResponse({
        uploadUrl,
        assetId,
        objectPath,
        expiresAt: new Date(Date.now() + 14400 * 1000).toISOString(),
        headers: { 'Content-Type': contentType, 'X-Content-Hash': 'required' }
      }, 200);

    } catch (error) {
      await env.RESORT_CONFIGS.delete(lockKey);
      throw error;
    }

  } catch (error) {
    console.error('[MEDIA] Sign upload error:', error);
    return jsonResponse({ error: error.message || 'Internal server error' }, 500);
  }
}

async function handleMediaConfirmUpload(request, env) {
  let tenantId = null;
  
  try {
    const body = await request.json();
    const { assetId, contentHash } = body;
    tenantId = body.tenantId;

    if (!assetId || !tenantId) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const asset = await env.MEDIA_DB.prepare(`
      SELECT * FROM assets 
      WHERE id = ? AND tenantId = ? AND status = 'pending'
    `).bind(assetId, tenantId).first();

    if (!asset) {
      return jsonResponse({ error: 'Asset not found or already confirmed' }, 404);
    }

    const head = await env.MEDIA_R2.head(asset.objectPath);
    
    if (!head) {
      return jsonResponse({ error: 'Upload not found in storage' }, 404);
    }

    if (head.size !== asset.size) {
      return jsonResponse({ 
        error: `Upload size mismatch: expected ${asset.size}, got ${head.size}` 
      }, 400);
    }

    await env.MEDIA_DB.prepare(`
      UPDATE assets
      SET status = 'ready', contentHash = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(contentHash, assetId).run();

    const quotaKey = `quota:${tenantId}:${asset.mediaType}`;
    const quota = await env.RESORT_CONFIGS.get(quotaKey, 'json') || { used: 0 };
    await env.RESORT_CONFIGS.put(quotaKey, JSON.stringify({
      used: quota.used + 1,
      updatedAt: new Date().toISOString()
    }));

    const baseUrl = `https://img.webzyl.com/${tenantId}/${asset.mediaType}/${assetId}`;

    return jsonResponse({
      success: true,
      assetId,
      assetUrl: baseUrl,
      variants: {
        thumbnail: `${baseUrl}?w=320`,
        small: `${baseUrl}?w=640`,
        medium: `${baseUrl}?w=1024`,
        large: `${baseUrl}?w=1600`
      }
    }, 200);

  } catch (error) {
    console.error('[MEDIA] Confirm upload error:', error);
    return jsonResponse({ error: error.message || 'Internal server error' }, 500);
  } finally {
    if (tenantId) {
      await env.RESORT_CONFIGS.delete(`upload-lock:${tenantId}`);
    }
  }
}

async function handleMediaServe(request, env) {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length < 4) {
      return new Response('Invalid image path', { status: 400 });
    }

    const [_, tenantId, mediaType, assetId] = pathParts;

    const asset = await env.MEDIA_DB.prepare(`
      SELECT * FROM assets
      WHERE tenantId = ? AND mediaType = ? AND id = ? AND status = 'ready'
    `).bind(tenantId, mediaType, assetId).first();

    if (!asset) {
      return new Response('Image not found', { 
        status: 404,
        headers: { 'Cache-Control': 'public, max-age=60' }
      });
    }

    const requestedWidth = parseInt(url.searchParams.get('w') || '1024');
    const width = clampToAllowedWidth(requestedWidth);

    // Use R2 binding directly instead of public URL
    const r2Object = await env.MEDIA_R2.get(asset.objectPath);
    
    if (!r2Object) {
      console.error(`[MEDIA] R2 object not found: ${asset.objectPath}`);
      return new Response('Image file not found in storage', { status: 404 });
    }

    // Get the image as a blob
    const imageBlob = await r2Object.blob();
    
    // Create a new request for Cloudflare Image Resizing
    const resizeRequest = new Request('https://example.com/image', {
      method: 'POST',
      body: imageBlob,
      headers: {
        'Content-Type': asset.contentType
      }
    });

    // Use Cloudflare's fetch with image resizing
    const imageResponse = await fetch(resizeRequest, {
      cf: {
        image: { 
          width, 
          quality: 85, 
          format: 'auto', 
          metadata: 'none' 
        }
      }
    });

    if (!imageResponse.ok) {
      console.error(`[MEDIA] Image resize failed for: ${asset.objectPath}`);
      // Fallback: return original image without resizing
      return new Response(imageBlob, {
        status: 200,
        headers: {
          'Content-Type': asset.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const headers = new Headers(imageResponse.headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('CDN-Cache-Control', 'public, max-age=31536000');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(imageResponse.body, { 
      status: imageResponse.status,
      headers 
    });

  } catch (error) {
    console.error('[MEDIA] Serve error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

async function handleMediaDelete(request, env) {
  try {
    const url = new URL(request.url);
    const assetId = url.pathname.split('/').pop();
    const tenantId = request.headers.get('X-Tenant-ID');

    if (!assetId || !tenantId) {
      return jsonResponse({ error: 'Missing asset ID or tenant ID' }, 400);
    }

    const asset = await env.MEDIA_DB.prepare(`
      SELECT * FROM assets WHERE id = ? AND tenantId = ?
    `).bind(assetId, tenantId).first();

    if (!asset) {
      return jsonResponse({ error: 'Asset not found' }, 404);
    }

    await env.MEDIA_DB.prepare(`
      UPDATE assets
      SET status = 'deleted', deletedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(assetId).run();

    const quotaKey = `quota:${tenantId}:${asset.mediaType}`;
    const quota = await env.RESORT_CONFIGS.get(quotaKey, 'json') || { used: 0 };
    await env.RESORT_CONFIGS.put(quotaKey, JSON.stringify({
      used: Math.max(0, quota.used - 1),
      updatedAt: new Date().toISOString()
    }));

    return jsonResponse({
      success: true,
      assetId,
      deletedAt: new Date().toISOString(),
      gracePeriod: '30 days'
    }, 200);

  } catch (error) {
    console.error('[MEDIA] Delete error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

async function handleMediaList(request, env) {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId');
    const mediaType = url.searchParams.get('mediaType');
    const status = url.searchParams.get('status') || 'ready';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (!tenantId) {
      return jsonResponse({ error: 'Missing tenant ID' }, 400);
    }

    let query = 'SELECT * FROM assets WHERE tenantId = ? AND status = ?';
    const params = [tenantId, status];

    if (mediaType) {
      query += ' AND mediaType = ?';
      params.push(mediaType);
    }

    query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.MEDIA_DB.prepare(query).bind(...params).all();

    const quotaKey = `quota:${tenantId}:${mediaType || 'gallery'}`;
    const quota = await env.RESORT_CONFIGS.get(quotaKey, 'json') || { used: 0, limit: 5 };

    return jsonResponse({
      assets: results,
      total: results.length,
      limit,
      offset,
      quota
    }, 200);

  } catch (error) {
    console.error('[MEDIA] List error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateRandomId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function clampToAllowedWidth(width) {
  if (width <= ALLOWED_WIDTHS[0]) return ALLOWED_WIDTHS[0];
  if (width >= ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1]) {
    return ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];
  }

  for (let i = 0; i < ALLOWED_WIDTHS.length - 1; i++) {
    const lower = ALLOWED_WIDTHS[i];
    const upper = ALLOWED_WIDTHS[i + 1];
    if (width >= lower && width < upper) {
      const distToLower = width - lower;
      const distToUpper = upper - width;
      return distToLower < distToUpper ? lower : upper;
    }
  }

  return ALLOWED_WIDTHS[1];
}

async function generatePresignedPutUrl(accountId, accessKeyId, secretAccessKey, bucketName, objectKey, contentType, expirySeconds) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: contentType
  });

  return await getSignedUrl(s3Client, command, { expiresIn: expirySeconds });
}

// ============================================================================
// CRON CLEANUP FUNCTIONS
// ============================================================================

async function cleanupDeletedAssets(env) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const { results } = await env.MEDIA_DB.prepare(`
    SELECT id, objectPath FROM assets
    WHERE deletedAt IS NOT NULL
      AND deletedAt < ?
      AND status = 'deleted'
    LIMIT 100
  `).bind(thirtyDaysAgo.toISOString()).all();

  for (const asset of results) {
    try {
      await env.MEDIA_R2.delete(asset.objectPath);
      await env.MEDIA_DB.prepare(`
        UPDATE assets SET status = 'permanently_deleted' WHERE id = ?
      `).bind(asset.id).run();
      console.log(`[CRON] Deleted asset: ${asset.id}`);
    } catch (error) {
      console.error(`[CRON] Failed to delete ${asset.id}:`, error);
    }
  }
}

async function auditOrphanedAssets(env) {
  const { results } = await env.MEDIA_DB.prepare(`
    SELECT objectPath FROM assets WHERE status != 'permanently_deleted'
  `).all();

  const knownPaths = new Set(results.map(r => r.objectPath));
  const listed = await env.MEDIA_R2.list({ limit: 1000 });
  const orphans = [];

  for (const object of listed.objects) {
    if (!knownPaths.has(object.key)) {
      orphans.push({ key: object.key, size: object.size });
    }
  }

  if (orphans.length > 0) {
    console.log(`[CRON] Found ${orphans.length} orphaned objects`, orphans);
  }

  if (listed.truncated) {
    console.warn('[CRON] R2 list truncated - pagination required');
  }
}


// ============================================================================
// SEO: SITEMAP CACHE INVALIDATION HANDLER
// ============================================================================
// CEO Directive #3 Compliant - Surgical Cache Invalidation
//
// Called by Google Apps Script after publishing a site to KV.
// Invalidates only the affected shard cache (prefix-scoped deletion).
// Protects KV write budget by NOT invalidating all 676 shards.
//
// Security: Requires X-Admin-Token header
// ============================================================================

async function handleSitemapCacheInvalidation(request, env) {
  try {
    // Security: Reject non-POST explicitly (prevent accidental crawler hits)
    if (request.method !== 'POST') {
      return new Response('Not Found', { status: 404 }); // Security through obscurity
    }

    // Security: Validate admin token (return 404 on failure, not 403)
    if (!validateAdminToken(request, env)) {
      return new Response('Not Found', { status: 404 }); // Security through obscurity
    }

    // Parse request body (reject malformed JSON early)
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid JSON'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const { prefix, slug } = payload;

    if (!prefix || !/^[a-z]{2}$/.test(prefix)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid prefix. Must be 2 lowercase letters (e.g., "aa", "ab")'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Delete cache key for this shard only (surgical invalidation, single KV write)
    const cacheKey = `sitemap_cache:${prefix}`;

    await env.RESORT_CONFIGS.delete(cacheKey);

    console.log(`[SITEMAP] Cache invalidated for shard: ${prefix} (slug: ${slug || 'unknown'})`);

    return new Response(JSON.stringify({
      success: true,
      prefix: prefix,
      slug: slug,
      message: `Sitemap cache invalidated for shard: ${prefix}`
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('[SITEMAP] Cache invalidation error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
