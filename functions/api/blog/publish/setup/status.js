// Repo: gnr-blog-ai
// Path: functions/api/blog/publish/setup/status.js
//
// PUBLIC: GET /api/blog/publish/setup/status?t=<token>
// Returns: token validity + onboarding state + publish readiness signal (no secrets)

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const t = String(url.searchParams.get("t") || "").trim();
  if (!t) return json({ ok: false, error: "token_required" }, 400);

  const pepper = String(env.REVIEW_TOKEN_PEPPER || "");
  const token_hash = await sha256Hex(`v1|publish_setup|${pepper}|${t}`);

  const db = env.GNR_MEDIA_BUSINESS_DB;

  const tok = await db.prepare(`
    SELECT location_id, draft_id, client_email, expires_at, used_at
      FROM blog_publish_setup_tokens
     WHERE token_hash = ?
     LIMIT 1
  `).bind(token_hash).first();

  if (!tok) return json({ ok: false, error: "invalid_token" }, 404);

  const expMs = Date.parse(String(tok.expires_at || ""));
  if (!expMs || expMs <= Date.now()) return json({ ok: false, error: "expired" }, 410);

  const location_id = String(tok.location_id || "").trim();
  const draft_id = String(tok.draft_id || "").trim();

  // Onboarding state (may not exist yet)
  const onboarding = await db.prepare(`
    SELECT mode, status, wp_base_url, updated_at, last_error
      FROM blog_publish_onboarding
     WHERE location_id = ?
     LIMIT 1
  `).bind(location_id).first();

  // Publish readiness signals (no secrets)
  const hasPublishTargets = await db.prepare(`
    SELECT 1
      FROM publish_targets
     WHERE location_id = ?
       AND (is_active = 1 OR is_active IS NULL)
     LIMIT 1
  `).bind(location_id).first();

  const hasPublisherTargets = await db.prepare(`
    SELECT 1
      FROM publisher_targets
     WHERE location_id = ?
       AND enabled = 1
     LIMIT 1
  `).bind(location_id).first();

  return json({
    ok: true,
    token: {
      draft_id,
      location_id,
      used: !!tok.used_at,
      expires_at: tok.expires_at,
    },
    onboarding: onboarding
      ? {
          mode: onboarding.mode || null,
          status: onboarding.status || null,
          wp_base_url: onboarding.wp_base_url || null,
          updated_at: onboarding.updated_at || null,
          last_error: onboarding.last_error || null,
        }
      : null,
    readiness: {
      has_publish_targets: !!hasPublishTargets,
      has_publisher_targets: !!hasPublisherTargets,
    },
  });
}
