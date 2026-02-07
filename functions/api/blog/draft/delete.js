import { requireAdmin, jsonResponse } from "../_lib/blog-handlers.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(context, { ok: false, error: "Invalid JSON body" }, 400);
  }

  const draft_id = String(body?.draft_id || "").trim();
  if (!draft_id) {
    return jsonResponse(context, { ok: false, error: "draft_id required" }, 400);
  }

  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    UPDATE blog_drafts
       SET deleted_at = datetime('now')
     WHERE draft_id = ?
  `).bind(draft_id).run();

  return jsonResponse(context, { ok: true, draft_id, action: "deleted" });
}
