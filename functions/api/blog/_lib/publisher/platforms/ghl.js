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

 // ------------------------------------------------------------
// REAL GHL create-post call (captured via DevTools "Copy as fetch")
// Endpoint: POST https://services.leadconnectorhq.com/blogs/posts
// NOTE: This creates the post record (DRAFT) so it appears in GHL.
// Content HTML may require a follow-up request (we will wire next).
// ------------------------------------------------------------

const url = "https://services.leadconnectorhq.com/blogs/posts";

// IMPORTANT: do NOT hardcode the JWT from DevTools.
// Store an equivalent token in env (secret) and pass here.
// Choose ONE of these patterns depending on what you store:
//
// Pattern A: env.GHL_BLOG_TOKEN_ID is a token-id style JWT (recommended to match capture)
const tokenId = String(env.GHL_BLOG_TOKEN_ID || "").trim();

// Pattern B (fallback): if you instead store an API key, you must capture the correct auth header
// const tokenId = String(env.GHL_GNR_API_KEY || "").trim();

if (!tokenId) throw new Error("missing_env_GHL_BLOG_TOKEN_ID");

const payload = {
  status: "DRAFT",
  locationId: String(job.location_id || job.locationId || "").trim() || String(cfg.location_id || "").trim(),
  blogId: String(cfg.blog_id || cfg.blogId || "").trim(),
  title: String(draft.title || "").trim() || "New Blog Post",
  description: String(cfg.description || "Published via GNR Blog AI").trim(),
};

if (!payload.locationId) throw new Error("ghl_location_id_missing");
if (!payload.blogId) throw new Error("ghl_blog_id_missing");

const resp = await fetch(url, {
  method: "POST",
  headers: {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    channel: "APP",
    source: "WEB_USER",
    "token-id": tokenId,
    Version: "2021-07-28",
  },
  body: JSON.stringify(payload),
});


const text = await resp.text();
let data = null;
try { data = JSON.parse(text); } catch (_) {}

if (!resp.ok) {
  throw new Error(`ghl_create_post_failed_${resp.status}: ${String(text).slice(0, 300)}`);
}

// Try common id fields
const external_id =
  // Common top-level shapes
  (data && (data._id || data.id || data.postId || data.blogPostId))
    ? String(data._id || data.id || data.postId || data.blogPostId)
    : // Some responses wrap in "post"
    (data && data.post && (data.post._id || data.post.id))
      ? String(data.post._id || data.post.id)
      : // ✅ Your observed shape: { blogPost: { _id: ... } }
      (data && data.blogPost && (data.blogPost._id || data.blogPost.id))
        ? String(data.blogPost._id || data.blogPost.id)
        : null;

if (!external_id) {
  throw new Error(`ghl_create_post_no_id_shape: ${String(text).slice(0, 300)}`);
}


// ------------------------------------------------------------
// STEP B — UPDATE POST WITH FULL CONTENT (PUT)
// ------------------------------------------------------------

const html = String(draft.content_html || "").trim();
if (!html) throw new Error("ghl_update_aborted_empty_html");

const updateUrl = `https://services.leadconnectorhq.com/blogs/posts/${external_id}`;

const updateResp = await fetch(updateUrl, {
  method: "PUT",
  headers: {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    channel: "APP",
    source: "WEB_USER",
    "token-id": tokenId,
    Version: "2021-07-28",
  },
  body: JSON.stringify({
    categories: cfg.categories || [],
    tags: cfg.tags || [],
    archived: false,
    type: "manual",
    status: "PUBLISHED",
    locationId: payload.locationId,
    blogId: payload.blogId,
    title: payload.title,
    description: payload.description,
    urlSlug: cfg.urlSlug || "",
    author: cfg.author || null,
    canonicalLink: cfg.canonicalLink || null,
    publishedAt: new Date().toISOString(),
    scheduledAt: null,
    imageAltText: cfg.imageAltText || payload.title,
    imageUrl: cfg.imageUrl || null,

    // Populate editor + renderer
    content: html,
    rawHTML: html,
  }),
});

const updateText = await updateResp.text();
if (!updateResp.ok) {
  throw new Error(`ghl_update_failed_${updateResp.status}: ${updateText.slice(0, 300)}`);
}



// Best-effort published URL template (optional)
const published_url =
  cfg.published_url_template
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
