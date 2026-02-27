// Repo: gnr-blog-ai
// Path: functions/api/blog/publish/setup/submit.js
//
// PUBLIC: POST /api/blog/publish/setup/submit
// Body: { t, mode: "GNR_UPLOADS"|"CLIENT_UPLOADS", wp_base_url? }

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeBaseUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const url = new URL(s);
    url.hash = "";
    url.search = "";
    // strip trailing slash
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();
  const mode = String(body.mode || "").trim();

  if (!t) return json({ ok: false, error: "token_required" }, 400);
  if (!["GNR_UPLOADS", "CLIENT_UPLOADS"].includes(mode)) {
    return json({ ok: false, error: "invalid_mode" }, 400);
  }

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

  const exp = Date.parse(String(tok.expires_at || ""));
  if (!exp || exp <= Date.now()) return json({ ok: false, error: "expired" }, 410);
  if (tok.used_at) return json({ ok: false, error: "already_used" }, 409);

  const location_id = String(tok.location_id || "").trim();
  const draft_id = String(tok.draft_id || "").trim();

  if (mode === "GNR_UPLOADS") {
    const wp_base_url = normalizeBaseUrl(body.wp_base_url);
    if (!wp_base_url) return json({ ok: false, error: "wp_base_url_required" }, 400);

    await db.prepare(`
      INSERT INTO blog_publish_onboarding (location_id, mode, status, wp_base_url, updated_at)
      VALUES (?, 'GNR_UPLOADS', 'BASE_URL_SUBMITTED', ?, datetime('now'))
      ON CONFLICT(location_id) DO UPDATE SET
        mode = 'GNR_UPLOADS',
        status = 'BASE_URL_SUBMITTED',
        wp_base_url = excluded.wp_base_url,
        updated_at = datetime('now')
    `).bind(location_id, wp_base_url).run();

    // Mark token used
    await db.prepare(`
      UPDATE blog_publish_setup_tokens
         SET used_at = datetime('now')
       WHERE token_hash = ?
    `).bind(token_hash).run();

    // Create staff credential token
    const rawStaffToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const staff_hash = await sha256Hex(`v1|publish_cred|${pepper}|${rawStaffToken}`);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(`
      INSERT INTO blog_publish_credential_tokens (token_hash, location_id, wp_base_url, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(staff_hash, location_id, wp_base_url, expiresAt).run();

    // Notify staff (email + slack) using same assignee logic as accept.js
    // We keep this fail-open and local to this handler.
    try {
      const rs = await db.prepare(`
        SELECT DISTINCT user_email
          FROM agency_location_assignments
         WHERE location_id = ?
           AND source = 'ghl'
           AND user_email IS NOT NULL
           AND TRIM(user_email) <> ''
      `).bind(location_id).all();

      const emails = (rs?.results || [])
        .map((r) => String(r.user_email || "").trim().toLowerCase())
        .filter(Boolean);

      if (emails.length) {
        const biz = await db.prepare(`
          SELECT business_name_raw
            FROM businesses
           WHERE location_id = ?
           LIMIT 1
        `).bind(location_id).first();

        const businessName = String(biz?.business_name_raw || "a client").trim();

        const apiBase = "https://api.admin.gnrmedia.global";
        const credUrl = `${apiBase}/api/blog/publish/wordpress/credentials?t=${encodeURIComponent(rawStaffToken)}`;

        const html = `
          <div style="font-family:Arial,sans-serif;line-height:1.55">
            <h2>WordPress publishing setup required</h2>
            <p><b>Business:</b> ${businessName}<br/>
               <b>Location ID:</b> <span style="font-family:Consolas,monospace">${location_id}</span><br/>
               <b>Draft ID:</b> <span style="font-family:Consolas,monospace">${draft_id}</span>
            </p>

            <p><b>Client submitted base URL:</b><br/>
              <span style="font-family:Consolas,monospace">${wp_base_url}</span>
            </p>

            <p>
              Next step: confirm admin access for <b>admin@gnrmedia.global</b>, then save the WordPress Application Password:
            </p>

            <p>
              <a href="${credUrl}"
                 style="display:inline-block;background:#301b7f;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px">
                 Enter WordPress App Password
              </a>
            </p>
          </div>
        `;

        await sendSendgridEmail(env, {
          to: emails,
          subject: `WordPress setup required — ${businessName}`,
          html,
        });
      }
    } catch (_) {}

    return json({ ok: true, action: "base_url_saved" }, 200);
  }

  // CLIENT_UPLOADS
  await db.prepare(`
    INSERT INTO blog_publish_onboarding (location_id, mode, status, updated_at)
    VALUES (?, 'CLIENT_UPLOADS', 'CLIENT_SELF_UPLOAD', datetime('now'))
    ON CONFLICT(location_id) DO UPDATE SET
      mode = 'CLIENT_UPLOADS',
      status = 'CLIENT_SELF_UPLOAD',
      updated_at = datetime('now')
  `).bind(location_id).run();

  await db.prepare(`
    UPDATE blog_publish_setup_tokens
       SET used_at = datetime('now')
     WHERE token_hash = ?
  `).bind(token_hash).run();

  const instructions_html = `
    <div style="margin-top:10px">
      <h3>Manual upload instructions</h3>
      <ol>
        <li>Log in to your website admin.</li>
        <li>Create a new blog post.</li>
        <li>Copy/paste the approved article content from the “Published View” link in your email.</li>
        <li>Upload the Cover Image (600×400) if provided.</li>
        <li>Publish the post.</li>
      </ol>
      <p class="muted">If you get stuck, reply to the email and we’ll help.</p>
    </div>
  `;

  return json({ ok: true, action: "client_self_upload", instructions_html }, 200);
}


// Minimal SendGrid helper (kept local so this endpoint is self-contained)
async function envString(env, key) {
  const v = env?.[key];
  if (v && typeof v === "object" && typeof v.get === "function") {
    const s = await v.get();
    return String(s || "");
  }
  return String(v || "");
}

async function sendSendgridEmail(env, { to, subject, html }) {
  const apiKey = (await envString(env, "SENDGRID_API_KEY_GNRMEDIA")).trim();
  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY_GNRMEDIA");

  const fromEmail = String(env.SENDGRID_FROM_EMAIL || "").trim();
  const fromName = String(env.SENDGRID_FROM_NAME || "GNR Media").trim();
  if (!fromEmail) throw new Error("Missing SENDGRID_FROM_EMAIL");

  const payload = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: fromEmail, name: fromName },
    reply_to: { email: fromEmail },
    subject,
    content: [{ type: "text/html", value: html }],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`SendGrid failed: ${res.status} ${txt.slice(0, 600)}`);
  }
}
