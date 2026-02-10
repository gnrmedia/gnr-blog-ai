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
  // -------------------------
// Canonical defaults mapping
// -------------------------
const authorId =
  (String(cfg.author || "").trim()) ||
  (String(cfg.default_author_id || "").trim()) ||
  null;

const categories =
  Array.isArray(cfg.categories) ? cfg.categories :
  (String(cfg.default_category_id || "").trim() ? [String(cfg.default_category_id).trim()] : []);

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
// Prefer per-target encrypted token stored in D1 (no redeploy rotation).
const tokenFromCfg = await decryptTokenIdFailOpen(env, cfg.token_id_enc);

// Fallback: global secret (legacy)
const tokenId = String(tokenFromCfg || env.GHL_BLOG_TOKEN_ID || "").trim();

if (!tokenId) throw new Error("missing_token_id");


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
  categories,
  tags: cfg.tags || [],
  archived: false,
  type: "manual",
  status: "PUBLISHED",
  locationId: payload.locationId,
  blogId: payload.blogId,
  title: payload.title,
  description: payload.description,
  urlSlug: cfg.urlSlug || "",
  author: authorId,
  canonicalLink: cfg.canonicalLink || null,
  publishedAt: new Date().toISOString(),
  scheduledAt: null,
  imageAltText: cfg.imageAltText || payload.title,
  imageUrl: cfg.imageUrl || null,

  // Populate editor + renderer
  rawHTML: html,
}),

  // 🔑 REQUIRED by GHL to persist rawHTML
  externalFonts: [],

  // Optional but harmless (UI sends them)
  readTimeInMinutes: 0,
  wordCount: html.split(/\s+/).length,
  isAutoSave: false,
})

const updateText = await updateResp.text();
if (!updateResp.ok) {
  throw new Error(`ghl_update_failed_${updateResp.status}: ${updateText.slice(0, 300)}`);
}

// Fail-closed: if GHL still returns empty rawHTML, treat as failure.
let updateJson = null;
try { updateJson = JSON.parse(updateText); } catch (_) {}

// Prefer response echo if present (some responses omit rawHTML even when persisted)
const echoedRaw =
  updateJson?.blogPost?.rawHTML ??
  updateJson?.blogPost?.rawHtml ??
  updateJson?.rawHTML ??
  updateJson?.rawHtml ??
  null;

if (echoedRaw && String(echoedRaw).trim()) {
  // Great — echoed back content, proceed.
} else {
  // Fallback: verify persisted content via GET
  const verifyResp = await fetch(updateUrl, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      channel: "APP",
      source: "WEB_USER",
      "token-id": tokenId,
      Version: "2021-07-28",
    },
  });

  const verifyText = await verifyResp.text();
  if (!verifyResp.ok) {
    throw new Error(`ghl_verify_failed_${verifyResp.status}: ${verifyText.slice(0, 220)}`);
  }

  let verifyJson = null;
  try { verifyJson = JSON.parse(verifyText); } catch (_) {}

  const persistedRaw =
    verifyJson?.blogPost?.rawHTML ??
    verifyJson?.blogPost?.rawHtml ??
    verifyJson?.rawHTML ??
    verifyJson?.rawHtml ??
    "";

  if (!String(persistedRaw).trim()) {
    throw new Error(`ghl_update_persisted_empty_rawHTML: sent_len=${html.length}`);
  }
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
function base64UrlEncode(bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecodeToBytes(b64url) {
  const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(b64url || "").length % 4) || 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importAesKeyFromEnv(env) {
  const k = env.PUBLISHER_TOKEN_KEY;
  const raw = (k && typeof k.get === "function") ? await k.get() : k;
  const keyStr = String(raw || "").trim();
  if (!keyStr) throw new Error("missing_env_PUBLISHER_TOKEN_KEY");

  // Key material: SHA-256 of string → 32 bytes for AES-GCM
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyStr));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function decryptTokenIdFailOpen(env, token_id_enc) {
  try {
    const enc = String(token_id_enc || "").trim();
    if (!enc) return null;

    const bytes = base64UrlDecodeToBytes(enc);
    if (bytes.length < 12 + 8) return null; // iv + minimal ciphertext

    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);

    const key = await importAesKeyFromEnv(env);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (_) {
    return null;
  }
}
