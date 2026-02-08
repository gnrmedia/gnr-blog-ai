import { upsertDraftAsset } from "../../_lib/blog-handlers.js";
// BUILD FINGERPRINT (debug) — bump this string each deploy to prove which build is live.
const BUILD_FINGERPRINT = "asset-upsert@2026-02-08T20:55-AEST";

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
  const asset_data =
    body && typeof body.asset_data === "object" && body.asset_data
      ? body.asset_data
      : {};

  if (!draftid || !key) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id and key required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ✅ Validate required field early so we don't throw deeper
  const image_url = String(asset_data.image_url || "").trim();
  const isHttpUrl = /^https?:\/\//i.test(image_url);
  const isDataImage = /^data:image\//i.test(image_url);

  if (!image_url || (!isHttpUrl && !isDataImage)) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "asset_data.image_url required (https://... or data:image/*)",
          received: {
            has_asset_data: !!body.asset_data,
            asset_data_keys: Object.keys(asset_data || {}),
          },
        },
        null,
        2
      ),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  // ✅ Optional safety: avoid trying to store multi-megabyte data URLs in D1
  // (tune this number as you like)
  if (isDataImage && image_url.length > 250_000) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "data:image payload too large for safe storage. Use a public https:// URL instead.",
          received: { image_url_len: image_url.length },
        },
        null,
        2
      ),
      {
        status: 413,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  try {
    const result = await upsertDraftAsset(context, draftid, key, asset_data);
    if (result instanceof Response) return result;

return new Response(JSON.stringify({ ok: true, build: BUILD_FINGERPRINT, result }, null, 2), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});

  } catch (err) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "asset upsert failed",
          detail: String(err?.message || err),
          name: String(err?.name || ""),
          stack: String(err?.stack || ""),
          debug: {
            draft_id: draftid,
            key,
            image_url_len: image_url.length,
            is_data_image: isDataImage,
            is_http_url: isHttpUrl,
          },
        },
        null,
        2
      ),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }
}

