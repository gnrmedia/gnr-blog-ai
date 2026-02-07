// Repo: gnr-blog-ai
// Path: functions/api/blog/review/visuals/save.js

// PUBLIC: POST /api/blog/review/visuals/save
// Body: { t: "<token>", visual_key: "hero", image_url: "https://..." }

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();
  const visual_key = String(body.visual_key || "").trim().toLowerCase();
  const image_url = String(body.image_url || "").trim();

  if (!t) return json({ ok: false, error: "token (t) required" }, 400);
  if (!visual_key) return json({ ok: false, error: "visual_key required" }, 400);
  if (!image_url) return json({ ok: false, error: "image_url required" }, 400);

  // HERO ONLY (per your requirement)
  if (visual_key !== "hero") {
    return json({ ok: false, error: "Only 'hero' is supported right now", allowed: ["hero"] }, 400);
  }

  if (!/^https:\/\//i.test(image_url)) {
    return json({ ok: false, error: "image_url must be https://" }, 400);
  }

  const db = env.GNR_MEDIA_BUSINESS_DB;
  const hash = await tokenHash(t, env);

  const review = await db.prepare(`
    SELECT review_id, draft_id, status, expires_at
    FROM blog_draft_reviews
    WHERE token_hash = ?
    LIMIT 1
  `).bind(hash).first();

  if (!review) return json({ ok: false, error: "Invalid token" }, 404);

  if (isExpired(review.expires_at)) {
    try {
      await db.prepare(`
        UPDATE blog_draft_reviews
        SET status='EXPIRED', decided_at=datetime('now')
        WHERE review_id=?
      `).bind(review.review_id).run();
    } catch (_) {}
    return json({ ok: false, error: "Link expired" }, 410);
  }

  if (String(review.status || "").toUpperCase() !== "PENDING") {
    return json({ ok: false, error: "Review is not active", status: review.status }, 409);
  }

  // Upsert hero asset
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
    "client",
    "client_url_swap",
    image_url,
    "ready"
  ).run();

  return json({ ok: true, action: "visual_saved", draft_id: review.draft_id, visual_key, image_url }, 200);
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
Review Visuals Save js doc
