import { requireAdmin, backfillEditorialBrain } from "../../../../blog-handlers.js";

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method !== "POST") {
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

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const limit = parseInt(body.limit) || 10;

  const result = await backfillEditorialBrain(context, locationid, limit);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}