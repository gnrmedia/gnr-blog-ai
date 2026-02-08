// Repo: gnr-blog-ai
// File: functions/api/blog/auto/run-location.js
import { requireAdmin, runNowForLocation } from "../../blog-handlers.js";

// POST /api/blog/auto/run-location  { location_id: "..."}
export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const location_id = String(body.location_id || "").trim();
  if (!location_id) {
    return new Response(JSON.stringify({ ok: false, error: "location_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // This creates a draft + generates AI + persists visuals to D1 (hero saved in blog_draft_assets)
  const result = await runNowForLocation(context, location_id);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
