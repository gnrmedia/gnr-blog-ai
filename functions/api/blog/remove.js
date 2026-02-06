import { requireAdmin, jsonResponse, errorResponse } from "../../../blog-handlers.js";
import { withCors, handleOptions } from "../../../cors.js";

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return handleOptions(request);
  }

  // Admin auth
  const admin = requireAdmin({ request, env });
  if (admin instanceof Response) {
    return withCors(request, admin);
  }

  // Payload
  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      errorResponse(context, "Invalid JSON body", 400)
    );
  }

  const location_id = String(body.location_id || "").trim();
  if (!location_id) {
    return withCors(
      request,
      errorResponse(context, "location_id required", 400)
    );
  }

  // Disable blog program for location
  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    UPDATE blog_program_locations
       SET enabled = 0,
           notes = ?,
           removed_at = datetime('now')
     WHERE location_id = ?
  `).bind(
    body.notes || "disabled via Blog AI Admin list",
    location_id
  ).run();

  return withCors(
    request,
    jsonResponse(context, {
      ok: true,
      action: "removed",
      location_id,
    })
  );
}
