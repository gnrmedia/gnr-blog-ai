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

  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // Accept BOTH: legacy "suggestions" and canonical "client_topic_suggestions"
  const suggestionsProvided = has("suggestions") || has("client_topic_suggestions");
  const suggestionsRaw = suggestionsProvided
    ? String((has("suggestions") ? body.suggestions : body.client_topic_suggestions) ?? "").trim()
    : null;

  const followEmphasisProvided = has("follow_emphasis");
  const followAvoidProvided = has("follow_avoid");

  const follow_emphasis_raw = followEmphasisProvided ? String(body.follow_emphasis ?? "").trim() : null;
  const follow_avoid_raw = followAvoidProvided ? String(body.follow_avoid ?? "").trim() : null;


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

  // Contract:
  // - Omitted field => NO CHANGE
  // - Empty string  => EXPLICIT CLEAR (store NULL)
  // - Non-empty     => OVERWRITE
  const suggestionsDb = suggestionsProvided ? (suggestionsRaw === "" ? null : suggestionsRaw) : null;
  const followEmphasisDb = followEmphasisProvided ? (follow_emphasis_raw === "" ? null : follow_emphasis_raw) : null;
  const followAvoidDb = followAvoidProvided ? (follow_avoid_raw === "" ? null : follow_avoid_raw) : null;

  await db.prepare(`
    UPDATE blog_draft_reviews
    SET
      client_topic_suggestions = CASE WHEN ? = 0 THEN client_topic_suggestions ELSE ? END,
      follow_emphasis         = CASE WHEN ? = 0 THEN follow_emphasis         ELSE ? END,
      follow_avoid            = CASE WHEN ? = 0 THEN follow_avoid            ELSE ? END,
      updated_at = datetime('now')
    WHERE review_id = ?
  `).bind(
    suggestionsProvided ? 1 : 0, suggestionsDb,
    followEmphasisProvided ? 1 : 0, followEmphasisDb,
    followAvoidProvided ? 1 : 0, followAvoidDb,
    review.review_id
  ).run();


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
