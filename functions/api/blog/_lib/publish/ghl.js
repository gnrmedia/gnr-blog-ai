// Repo: gnr-blog-ai
// Path: functions/api/blog/_lib/publish/ghl.js

export async function publishToGhl({ db, job }) {
  // Load target config
  const target = await db.prepare(`
    SELECT config_json
    FROM publish_targets
    WHERE target_id = ?
  `).bind(job.target_id).first();

  if (!target) throw new Error("Missing publish target");

  const config = JSON.parse(target.config_json || "{}");
  const { blog_id, author_id, category_id } = config;

  if (!blog_id) throw new Error("GHL blog_id missing");

  // Load draft content
  const draft = await db.prepare(`
    SELECT title, content_html
    FROM blog_drafts
    WHERE draft_id = ?
  `).bind(job.draft_id).first();

  if (!draft) throw new Error("Draft not found");

  // TODO: call GHL API here (intentionally stubbed)
  // const res = await fetch("https://services.leadconnectorhq.com/blogs/posts", ...)

  const external_id = "ghl_stub_post_id";
  const published_url = `https://app.gohighlevel.com/blog/${external_id}`;

  // Ledger write (idempotent)
  await db.prepare(`
    INSERT OR IGNORE INTO publish_ledger (
      ledger_id, draft_id, platform, target_id,
      external_id, published_url, created_at
    ) VALUES (?, ?, 'ghl', ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    job.draft_id,
    job.target_id,
    external_id,
    published_url
  ).run();

  await db.prepare(`
    UPDATE publish_jobs
    SET status='done', updated_at=datetime('now')
    WHERE job_id=?
  `).bind(job.job_id).run();
}
