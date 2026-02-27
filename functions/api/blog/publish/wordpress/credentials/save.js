// Repo: gnr-blog-ai
// Path: functions/api/blog/publish/wordpress/credentials/save.js
//
// ADMIN: POST /api/blog/publish/wordpress/credentials/save
// Body: { t, wp_app_password }

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

function base64UrlEncode(bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Uses same secret key pattern as token-id encryption
async function importAesKeyFromEnv(env) {
  const k = env.PUBLISHER_TOKEN_KEY;
  const raw = (k && typeof k.get === "function") ? await k.get() : k;
  const keyStr = String(raw || "").trim();
  if (!keyStr) throw new Error("missing_env_PUBLISHER_TOKEN_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyStr));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encryptSecret(env, plaintext) {
  const key = await importAesKeyFromEnv(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(String(plaintext || "").trim());
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);

  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return base64UrlEncode(out);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();
  const wp_app_password = String(body.wp_app_password || "").trim();

  if (!t) return json({ ok: false, error: "token_required" }, 400);
  if (!wp_app_password) return json({ ok: false, error: "wp_app_password_required" }, 400);

  const pepper = String(env.REVIEW_TOKEN_PEPPER || "");
  const token_hash = await sha256Hex(`v1|publish_cred|${pepper}|${t}`);

  const db = env.GNR_MEDIA_BUSINESS_DB;

  const tok = await db.prepare(`
    SELECT location_id, wp_base_url, expires_at, used_at
      FROM blog_publish_credential_tokens
     WHERE token_hash = ?
     LIMIT 1
  `).bind(token_hash).first();

  if (!tok) return json({ ok: false, error: "invalid_token" }, 404);

  const exp = Date.parse(String(tok.expires_at || ""));
  if (!exp || exp <= Date.now()) return json({ ok: false, error: "expired" }, 410);
  if (tok.used_at) return json({ ok: false, error: "already_used" }, 409);

  const location_id = String(tok.location_id || "").trim();
  const wp_base_url = String(tok.wp_base_url || "").trim();
  if (!location_id || !wp_base_url) return json({ ok: false, error: "token_missing_fields" }, 400);

  let wp_app_password_enc = "";
  try {
    wp_app_password_enc = await encryptSecret(env, wp_app_password);
  } catch (e) {
    return json({ ok: false, error: "encrypt_failed", detail: String(e?.message || e) }, 500);
  }

  // Upsert publisher_targets (schema: location_id PK)
  await db.prepare(`
    INSERT INTO publisher_targets (
      location_id, publisher_type, enabled,
      wp_base_url, wp_username, wp_app_password_enc,
      updated_at
    )
    VALUES (?, 'wordpress', 1, ?, 'admin@gnrmedia.global', ?, datetime('now'))
    ON CONFLICT(location_id) DO UPDATE SET
      publisher_type = 'wordpress',
      enabled = 1,
      wp_base_url = excluded.wp_base_url,
      wp_username = 'admin@gnrmedia.global',
      wp_app_password_enc = excluded.wp_app_password_enc,
      updated_at = datetime('now')
  `).bind(location_id, wp_base_url, wp_app_password_enc).run();

  // Ensure publish_targets has a wordpress target so publishing pipeline can pick it up
  const target_id = `${location_id}:wordpress`;

  const config_json = JSON.stringify({
    wp_base_url,
    wp_username: "admin@gnrmedia.global",
    // publishing defaults can evolve later
    wp_default_status: "publish"
  });

  await db.prepare(`
    INSERT INTO publish_targets (target_id, location_id, platform, config_json, is_active, created_at, updated_at)
    VALUES (?, ?, 'wordpress', ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(target_id) DO UPDATE SET
      platform = 'wordpress',
      config_json = excluded.config_json,
      is_active = 1,
      updated_at = datetime('now')
  `).bind(target_id, location_id, config_json).run();

  // Update onboarding state
  await db.prepare(`
    INSERT INTO blog_publish_onboarding (location_id, mode, status, wp_base_url, updated_at)
    VALUES (?, 'GNR_UPLOADS', 'CREDENTIALS_SAVED', ?, datetime('now'))
    ON CONFLICT(location_id) DO UPDATE SET
      mode = 'GNR_UPLOADS',
      status = 'CREDENTIALS_SAVED',
      wp_base_url = excluded.wp_base_url,
      updated_at = datetime('now')
  `).bind(location_id, wp_base_url).run();

  // Mark token used
  await db.prepare(`
    UPDATE blog_publish_credential_tokens
       SET used_at = datetime('now')
     WHERE token_hash = ?
  `).bind(token_hash).run();

  return json({ ok: true, action: "wordpress_ready", location_id }, 200);
}
