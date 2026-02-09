// Repo: gnr-blog-ai
// Path: functions/api/blog/_lib/publisher/platforms/ghl.js

export async function publishToGhl({ db, env, job }) {
  const target = await db.prepare(`
    SELECT config_json
    FROM publish_targets
    WHERE target_id = ?
    LIMIT 1
  `).bind(job.target_id).first();

  if (!target) throw new Error("publish_target_missing");

  const cfg = safeJson(target.config_json);
  const blog_id = String(cfg.blog_id || "").trim();
  if (!blog_id) throw new Error("ghl_blog_id_missing");

  const draft = await db.prepare(`
    SELECT draft_id, title, content_html
    FROM blog_drafts
    WHERE draft_id = ?
    LIMIT 1
  `).bind(job.draft_id).first();

  if (!draft) throw new Error("draft_missing");

  // ----------------------------
  // TODO: DevTools-captured POST
  // ----------------------------
  // IMPORTANT: We will NOT guess endpoints.
  // You will capture the real request in GHL using:
  //   F12 → Network → create a blog post in UI → copy as fetch
  //
  // Then we paste that exact endpoint + headers here.
  //
  // For now, we simulate a publish result:
  const external_id = `ghl_stub_${crypto.randomUUID()}`;
  const published_url = cfg.published_url_template
    ? String(cfg.published_url_template).replace("{id}", external_id)
    : null;

  // Idempotency + audit
  await db.prepare(`
    INSERT OR IGNORE INTO publish_ledger (
      ledger_id, draft_id, platform, target_id, external_id, published_url, created_at
    )
    VALUES (?, ?, 'ghl', ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    draft.draft_id,
    job.target_id,
    external_id,
    published_url
  ).run();
}

function safeJson(s) {
  try { return JSON.parse(String(s || "{}")); } catch (_) { return {}; }
}
