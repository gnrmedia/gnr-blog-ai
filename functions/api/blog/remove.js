import { requireAdmin, jsonResponse, errorResponse } from "../../../blog-handlers.js";
import { withCors, handleOptions } from "../../../cors.js";

export async function onRequest(context) {
  const { request, env } = context;

  // 1) CORS preflight
  if (request.method === "OPTIONS") return handleOptions(request);

  // 2) Admin guard (IMPORTANT: requireAdmin returns Response on failure)
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) return withCors(request, admin);

  // 3) Only POST supported
  if (request.method !== "POST") {
    return withCors(
      request,
      errorResponse(context, "Method not allowed", 405, { allow: ["POST", "OPTIONS"] })
    );
  }

  // 4) Parse JSON body
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    return withCors(request, errorResponse(context, "Invalid JSON body", 400));
  }

  const location_id = String(body?.location_id || "").trim();
  const notes = String(body?.notes || "disabled via Blog AI Admin list").trim();

  if (!location_id) {
    return withCors(request, errorResponse(context, "location_id required", 400));
  }

  // 5) Persist disable state (keep history, don't delete)
  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    UPDATE blog_program_locations
       SET enabled = 0,
           notes = ?,
           removed_at = datetime('now')
     WHERE location_id = ?
  `).bind(notes, location_id).run();

  // 6) Always return CORS-wrapped success
  return withCors(
    request,
    jsonResponse(context, { ok: true, action: "removed", location_id })
  );
}

