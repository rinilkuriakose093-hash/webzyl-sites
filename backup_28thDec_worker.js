/**
 * PHASE 6 – v6.0 ENHANCEMENTS
 * Status: UPDATED
 * Last modified: 2025-12-28
 * Notes:
 * - Added v6.0 notification + payment support
 * - Event-driven architecture (no state in KV for notifications)
 * - Backward compatible with existing flows
 */

// Worker for Webzyl - Multi-tenant Resort/Hotel Website Engine
// Uses module syntax (Wrangler v4 compatible)
import { handleBookingRequest, handleOptions }
from './Booking_Enquiry/files/booking-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ROUTE: SSR Rendering (/s/:slug)
    if (request.method === "GET" && path.startsWith("/s/")) {
      return await handleSSR(path, url, env, ctx);
    }

    // ROUTE: Booking API (v6.0 enhanced)
    if (path === "/api/booking") {
      if (request.method === "OPTIONS") {
        return handleOptions();
      }
      return await handleBookingRequest(request, env, ctx); // Pass ctx for waitUntil
    }

    // ROUTE: Admin Publish
    if (request.method === "POST" && path === "/api/admin/publish") {
      return await handleAdminPublish(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

// -----------------------------------------------------
//  SSR HANDLER
// -----------------------------------------------------
async function handleSSR(path, url, env, ctx) {
  try {
    const KV = env.RESORT_CONFIGS;

    const slug = path.split("/s/")[1]?.replace(/\/$/, "");
    if (!slug) return new Response("Missing slug", { status: 400 });

    // Fetch config from KV
    const cfgRaw = await KV.get(`config:${slug}`);
    if (!cfgRaw) {
      return new Response("<h1>Site not found</h1>", {
        status: 404,
        headers: { "content-type": "text/html" }
      });
    }

    const cfg = JSON.parse(cfgRaw);

    // Fetch template
    let template = await KV.get("template:default");
    if (!template) {
      template = `<html><body><pre>{{DATA_INJECTION}}</pre></body></html>`;
    }

    // Replace placeholders
    const title = cfg.name || "Webzyl Resort";
    const desc = cfg.tagline || "";
    const ogImage = cfg?.branding?.heroImage || "";
    const ogUrl = url.href;

    const injected = 
      `window.RESORT_DATA = ${JSON.stringify(cfg).replace(/<\/script>/g, "<\\/script>")};`;

    let html = template
      .replace(/{{TITLE}}/g, escape(title))
      .replace(/{{DESC}}/g, escape(desc))
      .replace(/{{OG_IMAGE}}/g, escape(ogImage))
      .replace(/{{OG_URL}}/g, escape(ogUrl))
      .replace(/{{DATA_INJECTION}}/g, injected);

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html;charset=utf-8" }
    });

  } catch (err) {
    return new Response("SSR Error: " + err, { status: 500 });
  }
}

// -----------------------------------------------------
//  ADMIN PUBLISH HANDLER
// -----------------------------------------------------
async function handleAdminPublish(request, env) {
  const KV = env.RESORT_CONFIGS;

  const token = request.headers.get("X-Publish-Token");
  if (!token || token !== env.PUBLISH_TOKEN) {
    return json({ success: false, error: "unauthorized" }, 403);
  }

  try {
    const body = await request.json();

    if (!body.slug || !body.config) {
      return json({ success: false, error: "missing_fields" }, 400);
    }

    // v6.0: Config now includes notifications and payment blocks
    // No changes needed here - just store as-is
    await KV.put(`config:${body.slug}`, JSON.stringify(body.config));

    return json({ success: true });

  } catch (err) {
    return json({ success: false, error: "publish_failed" }, 500);
  }
}

// -----------------------------------------------------
// HELPERS
// -----------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function escape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
