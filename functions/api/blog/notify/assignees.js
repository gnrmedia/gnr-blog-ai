// Repo: gnr-blog-ai
// Path: functions/api/blog/notify/assignees.js
//
// ADMIN: GET /api/blog/notify/assignees?location_id=<id>
// Returns staff recipients (from agency_location_assignments) who will be notified on client Accept.

import { requireAdmin, jsonResponse } from "../_lib/blog-handlers.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  // Admin auth
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const location_id = String(url.searchParams.get("location_id") || "").trim();
  if (!location_id) {
    return jsonResponse(context, { ok: false, error: "location_id required" }, 400);
  }

  try {
    const rs = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      SELECT DISTINCT user_email
        FROM agency_location_assignments
       WHERE location_id = ?
         AND source = 'ghl'
         AND user_email IS NOT NULL
         AND TRIM(user_email) <> ''
       ORDER BY lower(user_email) ASC
    `).bind(location_id).all();

    const emails = (rs?.results || [])
      .map((r) => String(r.user_email || "").trim().toLowerCase())
      .filter(Boolean);

    return jsonResponse(context, {
      ok: true,
      location_id,
      emails,
      count: emails.length,
    });
  } catch (e) {
    return jsonResponse(
      context,
      { ok: false, error: "assignees_lookup_failed", detail: String(e?.message || e) },
      500
    );
  }
}
