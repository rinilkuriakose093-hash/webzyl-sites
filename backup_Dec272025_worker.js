/**
 * PHASE 5 — BOOKING INGESTION PIPELINE
 * Status: FROZEN
 * Last verified: 2025-12-23
 * Notes:
 * - End-to-end booking flow verified
 * - Worker → Apps Script → Google Sheets
 * - Do not modify unless fixing a production bug
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

    // ROUTE: Booking API
   // ROUTE: Booking API (Phase 4)
if (path === "/api/booking") {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }
  return await handleBookingRequest(request, env);
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
    const KV = env.RESORT_CONFIGS;   // <-- Correct way to access KV

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
//  BOOKING HANDLER
// -----------------------------------------------------
async function handleBooking(request, env, ctx) {
  const KV = env.RESORT_CONFIGS;

  try {
    const data = await request.json();

    if (!data.name || !data.phone || !data.slug) {
      return json({ success: false, error: "missing_fields" }, 400);
    }

    const sinkUrl = env.BOOKING_SINK_URL;

    if (sinkUrl) {
      const r = await fetch(sinkUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data)
      });

      const out = await r.json();
      return json(out, r.ok ? 200 : 500);
    }

    // fallback storage
    const key = `booking_tmp_${Date.now()}`;
    await KV.put(key, JSON.stringify(data), { expirationTtl: 86400 });

    return json({ success: true, mode: "local_kv" });

  } catch (err) {
    return json({ success: false, error: "invalid_json" }, 400);
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
