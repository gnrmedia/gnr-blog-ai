import { upsertDraftAsset } from "../../_lib/blog-handlers.js";

// BUILD FINGERPRINT — bump this per deploy
const BUILD_FINGERPRINT = "asset-upload@2026-02-09T19:00-AEST";

async function uploadToCloudflareImages({ env, bytes, contentType, fileName }) {
  const accountId = String(env.CF_IMAGES_ACCOUNT_ID || "").trim();
  if (!accountId) throw new Error("Missing CF_IMAGES_ACCOUNT_ID");

  const cfToken = env.CF_IMAGES_API_TOKEN;
  const token = (cfToken && typeof cfToken.get === "function") ? await cfToken.get() : cfToken;
  if (!token) throw new Error("Missing CF_IMAGES_API_TOKEN");

  const hash = String(env.CF_IMAGES_DELIVERY_HASH || "").trim();
  if (!hash) throw new Error("Missing CF_IMAGES_DELIVERY_HASH");

const form = new FormData();
form.append(
  "file",
  new Blob([bytes], { type: contentType || "application/octet-stream" }),
  String(fileName || "upload.png")
);

// 🔑 CRITICAL: make images public (no signed URLs)
form.append("requireSignedURLs", "false");


  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.success) {
    throw new Error("Cloudflare Images upload failed: " + res.status + " " + JSON.stringify(out).slice(0, 600));
  }

  const id = out?.result?.id;
  if (!id) throw new Error("Cloudflare Images: missing result.id");

  return `https://imagedelivery.net/${hash}/${id}/public`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Must be multipart/form-data
  const ct = String(request.headers.get("content-type") || "");
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    return new Response(JSON.stringify({ ok: false, error: "Expected multipart/form-data" }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const form = await request.formData();

  const draft_id = String(form.get("draft_id") || "").trim();
  const key = String(form.get("key") || "").trim();
  const file = form.get("file");

  if (!draft_id || !key) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id and key required" }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  if (!file || typeof file === "string") {
    return new Response(JSON.stringify({ ok: false, error: "file required" }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const contentType = String(file.type || "").trim();
  if (!/^image\//i.test(contentType)) {
    return new Response(JSON.stringify({ ok: false, error: "file must be image/*", received: { type: contentType } }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = String(file.name || `upload-${draft_id}.png`);

  try {
    // 1) Upload to Cloudflare Images
    const image_url = await uploadToCloudflareImages({ env, bytes, contentType, fileName });

    // 2) Persist only https URL via existing upsertDraftAsset
    const result = await upsertDraftAsset(context, draft_id, key, {
      image_url,
      provider: "admin_upload",
      asset_type: "image",
      prompt: "manual_upload",
      status: "ready",
    });

    // upsertDraftAsset returns a Response already
    if (result instanceof Response) {
      // enrich success payload when ok
      try {
        const text = await result.text();
        const obj = JSON.parse(text);
        return new Response(JSON.stringify({ ...obj, build: BUILD_FINGERPRINT, image_url }, null, 2), {
          status: result.status,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (_) {
        return result;
      }
    }

    return new Response(JSON.stringify({ ok: true, build: BUILD_FINGERPRINT, image_url, result }, null, 2), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: "asset upload failed",
      detail: String(e?.message || e),
      build: BUILD_FINGERPRINT,
    }, null, 2), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
