import { requireAdmin, upsertDraftAsset } from "../../../blog-handlers.js";

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

  const draftid = String(body.draft_id || "").trim();
  const key = String(body.key || "").trim();

  if (!draftid || !key) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id and key required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await upsertDraftAsset(context, draftid, key, body.asset_data || {});
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}