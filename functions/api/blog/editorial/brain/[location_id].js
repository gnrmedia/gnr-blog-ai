import { requireAdmin, getEditorialBrain } from "../../../blog-handlers.js";

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  const locationid = String(params.location_id || "").trim();
  if (!locationid) {
    return new Response(JSON.stringify({ ok: false, error: "location_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit")) || 10;

  const result = await getEditorialBrain(context, locationid, limit);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, brain: result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}