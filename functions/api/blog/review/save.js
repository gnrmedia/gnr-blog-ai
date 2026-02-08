// Repo: gnr-blog-ai
// Path: functions/api/blog/review/save.js

// PUBLIC: POST /api/blog/review/save
// Body: { t: "<token>", content_markdown: "...", follow_emphasis?: "...", follow_avoid?: "..." }

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();
  const content_markdown = String(body.content_markdown || "").trim();
  const follow_emphasis = String(body.follow_emphasis || "").trim();
  const follow_avoid = String(body.follow_avoid || "").trim();

  if (!t) return json({ ok: false, error: "token (t) required" }, 400);
  if (!content_markdown) return json({ ok: false, error: "content_markdown required" }, 400);

  const db = env.GNR_MEDIA_BUSINESS_DB;
  const hash = await tokenHash(t, env);

const review = await db.prepare(`
  SELECT review_id, draft_id, location_id, status, expires_at
  FROM blog_draft_reviews
  WHERE token_hash = ?
  LIMIT 1
`).bind(hash).first();


  if (!review) return json({ ok: false, error: "Invalid token" }, 404);

  if (isExpired(review.expires_at)) {
    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='EXPIRED', decided_at=datetime('now')
      WHERE review_id=?
    `).bind(review.review_id).run();
    return json({ ok: false, error: "Link expired" }, 410);
  }

  // Allow saving while the review is still editable.
  // UI considers these editable: PENDING, ISSUED, AI_VISUALS_GENERATED
  const status = String(review.status || "").trim();
  const EDITABLE = new Set(["PENDING", "ISSUED", "AI_VISUALS_GENERATED"]);

  if (!EDITABLE.has(status)) {
    return json({ ok: false, error: "Already decided", status }, 409);
  }


  const finalMd = content_markdown.endsWith("\n") ? content_markdown : (content_markdown + "\n");

  await db.prepare(`
    UPDATE blog_draft_reviews
    SET
      client_content_markdown = ?,
      follow_emphasis = COALESCE(NULLIF(?, ''), follow_emphasis),
      follow_avoid = COALESCE(NULLIF(?, ''), follow_avoid),
      updated_at = datetime('now')
    WHERE review_id = ?
  `).bind(finalMd, follow_emphasis, follow_avoid, review.review_id).run();

  return json({ ok: true, action: "saved", review_id: review.review_id }, 200);
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
