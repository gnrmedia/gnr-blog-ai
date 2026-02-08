import { upsertDraftAsset } from "../../_lib/blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const draftid = String(body.draft_id || "").trim();
  const key = String(body.key || "").trim();
  const asset_data = (body && typeof body.asset_data === "object" && body.asset_data) ? body.asset_data : {};

  if (!draftid || !key) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id and key required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ✅ HARD VALIDATION so we never throw deep in blog-handlers
  const image_url = String(asset_data.image_url || "").trim();
  const isHttpUrl = /^https?:\/\//i.test(image_url);
  const isDataImage = /^data:image\//i.test(image_url);

  if (!image_url || (!isHttpUrl && !isDataImage)) {
    return new Response(JSON.stringify({
      ok: false,
      error: "asset_data.image_url required (https://... or data:image/*)",
      received: {
        has_asset_data: !!body.asset_data,
        asset_data_keys: Object.keys(asset_data || {}),
      }
    }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const result = await upsertDraftAsset(context, draftid, key, asset_data);
    if (result instanceof Response) return result;

    return new Response(JSON.stringify({ ok: true, result }, null, 2), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    // ✅ Never let Cloudflare generate text/html 500 pages
    return new Response(JSON.stringify({
      ok: false,
      error: "asset upsert failed",
      detail: String(err?.message || err),
    }, null, 2), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
