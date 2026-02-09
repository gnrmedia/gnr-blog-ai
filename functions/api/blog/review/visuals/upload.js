// Repo: gnr-blog-ai
// Path: functions/api/blog/review/visuals/upload.js

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json({ ok: false, error: "multipart/form-data required" }, 400);
  }

  const form = await request.formData();
  const t = String(form.get("t") || "").trim();
  const visual_key = String(form.get("visual_key") || "").trim().toLowerCase();
  const file = form.get("file");

  if (!t) return json({ ok: false, error: "token (t) required" }, 400);

  // HERO ONLY (locked requirement)
  if (visual_key !== "hero") {
    return json({ ok: false, error: "Only hero supported", allowed: ["hero"] }, 400);
  }

  if (!file || !(file instanceof File)) {
    return json({ ok: false, error: "file required" }, 400);
  }

  // ---- validate review token + status gating ----
  const db = env.GNR_MEDIA_BUSINESS_DB;
  const hash = await tokenHash(t, env);

  const review = await db.prepare(`
    SELECT review_id, draft_id, status, expires_at
    FROM blog_draft_reviews
    WHERE token_hash = ?
    LIMIT 1
  `).bind(hash).first();

  if (!review) return json({ ok: false, error: "Invalid token" }, 404);
  if (isExpired(review.expires_at)) return json({ ok: false, error: "Link expired" }, 410);

  const st = String(review.status || "").trim().toUpperCase();
  const EDITABLE = new Set(["PENDING", "ISSUED", "AI_VISUALS_GENERATED"]);
  if (!EDITABLE.has(st)) {
    return json({ ok: false, error: "Review is not active", status: review.status }, 409);
  }

  // ---- required Cloudflare Images bindings ----
  const accountId = String(env.CF_IMAGES_ACCOUNT_ID || "").trim();
  const deliveryHash = String(env.CF_IMAGES_DELIVERY_HASH || "").trim();
  const token = String(env.CF_IMAGES_API_TOKEN || "").trim();

  if (!accountId) return json({ ok: false, error: "Missing CF_IMAGES_ACCOUNT_ID" }, 500);
  if (!deliveryHash) return json({ ok: false, error: "Missing CF_IMAGES_DELIVERY_HASH" }, 500);
  if (!token) return json({ ok: false, error: "Missing CF_IMAGES_API_TOKEN" }, 500);

  // ---- upload to Cloudflare Images (PUBLIC) ----
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploadForm = new FormData();

  uploadForm.append(
    "file",
    new Blob([bytes], { type: file.type || "application/octet-stream" }),
    file.name || "upload.png"
  );

  // CRITICAL: make image public (no signed URLs)
  uploadForm.append("requireSignedURLs", "false");

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: uploadForm,
    }
  );

  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.success || !out?.result?.id) {
    return json({ ok: false, error: "Cloudflare upload failed", detail: out }, 500);
  }

  const image_url = `https://imagedelivery.net/${deliveryHash}/${out.result.id}/public`;

  // ---- upsert draft asset row (blog_draft_assets) ----
  const asset_id = `${String(review.draft_id)}:${visual_key}`;

  await db.prepare(`
    INSERT INTO blog_draft_assets (
      asset_id, draft_id, visual_key, asset_type, provider, prompt, image_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(asset_id) DO UPDATE SET
      image_url = excluded.image_url,
      provider = excluded.provider,
      status = excluded.status,
      updated_at = datetime('now')
  `).bind(
    asset_id,
    String(review.draft_id),
    visual_key,
    "image",
    "client_upload",
    "client_file_upload",
    image_url,
    "ready"
  ).run();

  return json({ ok: true, action: "visual_uploaded", draft_id: review.draft_id, visual_key, image_url }, 200);
}

// ---------------- helpers ----------------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isExpired(expires_at) {
  const t = Date.parse(expires_at || "");
  return !t || t <= Date.now();
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(rawToken, env) {
  const pepper = String(env.REVIEW_TOKEN_PEPPER || "");
  return sha256Hex(`v1|${pepper}|${rawToken}`);
}
