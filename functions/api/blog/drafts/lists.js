import { requireAdmin, listDraftsForLocation } from "../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const locationid = url.searchParams.get("location_id") || "";
  const limit = parseInt(url.searchParams.get("limit")) || 20;

  if (!locationid) {
    return new Response(JSON.stringify({ ok: false, error: "location_id query param required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await listDraftsForLocation(context, locationid, limit);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, drafts: result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}