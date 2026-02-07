// Repo: gnr-blog-ai
// Path: functions/api/blog/review/suggestions/save.js

// PUBLIC: POST /api/blog/review/suggestions/save
// Body: { t: "<token>", suggestions?: "...", follow_emphasis?: "...", follow_avoid?: "..." }

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();

  const suggestions = String(body.suggestions ?? "").trim();
  const follow_emphasis = String(body.follow_emphasis ?? "").trim();
  const follow_avoid = String(body.follow_avoid ?? "").trim();

  if (!t) return json({ ok: false, error: "token (t) required" }, 400);

  const db = env.GNR_MEDIA_BUSINESS_DB;
  const hash = await tokenHash(t, env);

  const review = await db.prepare(`
    SELECT review_id, location_id, status, expires_at
    FROM blog_draft_reviews
    WHERE token_hash = ?
    LIMIT 1
  `).bind(hash).first();

  if (!review) return json({ ok: false, error: "Invalid token" }, 404);

  if (isExpired(review.expires_at) || String(review.status || "").toUpperCase() === "EXPIRED") {
    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='EXPIRED', decided_at=datetime('now')
      WHERE review_id=?
    `).bind(review.review_id).run();
    return json({ ok: false, error: "Link expired" }, 410);
  }

  // Allow clearing: store NULL when empty string is sent
  const suggestionsDb = suggestions === "" ? null : suggestions;
  const followEmphasisDb = follow_emphasis === "" ? null : follow_emphasis;
  const followAvoidDb = follow_avoid === "" ? null : follow_avoid;

  await db.prepare(`
    UPDATE blog_draft_reviews
    SET
      client_topic_suggestions = ?,
      follow_emphasis = ?,
      follow_avoid = ?,
      updated_at = datetime('now')
    WHERE review_id = ?
  `).bind(suggestionsDb, followEmphasisDb, followAvoidDb, review.review_id).run();

  // Sticky guidance table (fail-open if missing)
  try {
    await db.prepare(`
      INSERT INTO blog_client_guidance
        (location_id, follow_emphasis, follow_avoid, topic_suggestions, updated_at, updated_by_review_id)
      VALUES
        (?,          ?,              ?,           ?,               datetime('now'), ?)
      ON CONFLICT(location_id) DO UPDATE SET
        follow_emphasis = excluded.follow_emphasis,
        follow_avoid = excluded.follow_avoid,
        topic_suggestions = excluded.topic_suggestions,
        updated_at = datetime('now'),
        updated_by_review_id = excluded.updated_by_review_id
    `).bind(
      String(review.location_id || "").trim(),
      followEmphasisDb,
      followAvoidDb,
      suggestionsDb,
      String(review.review_id || "")
    ).run();
  } catch (_) {}

  return json({ ok: true, action: "guidance_saved", review_id: review.review_id }, 200);
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
