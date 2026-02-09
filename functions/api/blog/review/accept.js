// Repo: gnr-blog-ai
// Path: functions/api/blog/review/accept.js

// PUBLIC: POST /api/blog/review/accept
// Body: { t: "<token>", follow_emphasis?: "...", follow_avoid?: "..." }
import { enqueuePublishJobsForDraft, processQueuedPublishJobsForDraft } from "../_lib/publish/index.js";

export async function onRequest(context) {
  const { request, env, ctx } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const t = String(body.t || "").trim();
  const follow_emphasis = String(body.follow_emphasis || "").trim();
  const follow_avoid = String(body.follow_avoid || "").trim();

  if (!t) return json({ ok: false, error: "token (t) required" }, 400);

  const db = env.GNR_MEDIA_BUSINESS_DB;
  const hash = await tokenHash(t, env);

  // Find review
  const review = await db.prepare(`
    SELECT review_id, draft_id, location_id, status, expires_at, client_email, client_content_markdown
    FROM blog_draft_reviews
    WHERE token_hash = ?
    LIMIT 1
  `).bind(hash).first();

  if (!review) return json({ ok: false, error: "Invalid token" }, 404);

  if (isExpired(review.expires_at)) {
    // expire it
    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='EXPIRED', decided_at=datetime('now')
      WHERE review_id=?
    `).bind(review.review_id).run();
    return json({ ok: false, error: "Link expired" }, 410);
  }

  if (String(review.status || "") !== "PENDING") {
    return json({ ok: false, error: "Already decided", status: review.status }, 409);
  }

  // Persist follow-ups onto the review row (best-effort)
  try {
    if (follow_emphasis || follow_avoid) {
      await db.prepare(`
        UPDATE blog_draft_reviews
        SET
          follow_emphasis = COALESCE(NULLIF(?, ''), follow_emphasis),
          follow_avoid = COALESCE(NULLIF(?, ''), follow_avoid),
          updated_at = datetime('now')
        WHERE review_id = ?
      `).bind(follow_emphasis, follow_avoid, review.review_id).run();
    }
  } catch (_) {}

  // Mark this review accepted
  await db.prepare(`
    UPDATE blog_draft_reviews
    SET status='ACCEPTED', decided_at=datetime('now')
    WHERE review_id=?
  `).bind(review.review_id).run();

  // Close other pending review links for same draft (prevents zombies)
  await db.prepare(`
    UPDATE blog_draft_reviews
    SET status='SUPERSEDED', decided_at=datetime('now')
    WHERE draft_id = ?
      AND review_id <> ?
      AND status = 'PENDING'
  `).bind(review.draft_id, review.review_id).run();

  // If client saved edits, write them onto the draft before approving (minimal, safe)
  const savedMd = String(review.client_content_markdown || "").trim();
  if (savedMd) {
    const finalMd = savedMd.endsWith("\n") ? savedMd : (savedMd + "\n");
    const finalHtml = markdownToHtml(stripInternalTelemetryComments(finalMd));

    await db.prepare(`
      UPDATE blog_drafts
      SET
        content_markdown = ?,
        content_html = ?,
        updated_at = datetime('now')
      WHERE draft_id = ?
    `).bind(finalMd, finalHtml, review.draft_id).run();
  }

  // Approve draft
  await db.prepare(`
    UPDATE blog_drafts
    SET
      status='approved',
      approved_at=datetime('now'),
      approved_by_email=?
    WHERE draft_id=?
  `).bind(review.client_email || null, review.draft_id).run();

  // ------------------------------------------------------------
// Enqueue publish jobs (FAIL-OPEN, async)
// ------------------------------------------------------------
try {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil((async () => {
      await enqueuePublishJobsForDraft({
        db,
        draft_id: review.draft_id,
        location_id: review.location_id
      });

      // Best-effort immediate processing (fail-open)
      await processQueuedPublishJobsForDraft({
        db,
        draft_id: review.draft_id,
        location_id: review.location_id,
        limit: 10
      });
    })());
  }
} catch (_) {}


  // (Optional) background tasks later; safe no-op for now
  try {
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(Promise.resolve());
    }
  } catch (_) {}

  return json({ ok: true, action: "accepted", draft_id: review.draft_id }, 200);
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

// minimal markdown renderer for publish surface (safe subset)
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// remove internal telemetry comments
function stripInternalTelemetryComments(md) {
  const s = String(md || "");
  return s
    .replace(/^\s*<!--\s*AI_GENERATED\s*-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*generated_at:\s*.*?-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*wow_standard:\s*.*?-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*eio_fingerprint:\s*[\s\S]*?-->\s*\n?/gmi, "")
    .trim();
}

// very small markdown -> html (enough for review publish surface)
function markdownToHtml(md) {
  const txt = escapeHtml(String(md || ""));
  const lines = txt.split("\n");
  const out = [];
  for (const line of lines) {
    if (/^#\s+/.test(line)) out.push(`<h1>${line.replace(/^#\s+/, "")}</h1>`);
    else if (/^##\s+/.test(line)) out.push(`<h2>${line.replace(/^##\s+/, "")}</h2>`);
    else if (/^###\s+/.test(line)) out.push(`<h3>${line.replace(/^###\s+/, "")}</h3>`);
    else if (line.trim() === "") out.push("");
    else out.push(`<p>${line}</p>`);
  }
  return out.join("\n");
}
