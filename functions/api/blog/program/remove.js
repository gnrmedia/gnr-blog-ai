import { requireAdmin, jsonResponse, errorResponse } from "../../../blog-handlers.js";
import { withCors, handleOptions } from "../../../cors.js";

// OPTIONS preflight
export async function onRequestOptions(context) {
  return handleOptions(context.request);
}

// POST handler — THIS is what Pages routes
export async function onRequestPost(context) {
  const { request, env } = context;

  // Admin auth
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) {
    return withCors(request, admin);
  }

  // Parse JSON body
  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      errorResponse(context, "Invalid JSON body", 400)
    );
  }

  const location_id = String(body?.location_id || "").trim();
  const notes = String(body?.notes || "disabled via Blog AI Admin list").trim();

  if (!location_id) {
    return withCors(
      request,
      errorResponse(context, "location_id required", 400)
    );
  }

  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    UPDATE blog_program_locations
       SET enabled = 0,
           notes = ?,
           removed_at = datetime('now')
     WHERE location_id = ?
  `).bind(notes, location_id).run();

  return withCors(
    request,
    jsonResponse(context, {
      ok: true,
      action: "removed",
      location_id
    })
  );
}
