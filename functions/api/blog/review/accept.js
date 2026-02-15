// Repo: gnr-blog-ai
// Path: functions/api/blog/review/accept.js

// PUBLIC: POST /api/blog/review/accept
// Body: { t: "<token>", follow_emphasis?: "...", follow_avoid?: "..." }
import { enqueuePublishJobsForDraft, processQueuedPublishJobsForDraft } from "../_lib/publisher/index.js";

export async function onRequest(context) {
  const { request, env } = context;
  const waitUntil = (context && typeof context.waitUntil === "function")
    ? context.waitUntil.bind(context)
    : null;

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

  const review = await db.prepare(`
    SELECT review_id, draft_id, location_id, status, expires_at, client_email, client_content_markdown
    FROM blog_draft_reviews
    WHERE token_hash = ?
    LIMIT 1
  `).bind(hash).first();

  if (!review) return json({ ok: false, error: "Invalid token" }, 404);

  if (isExpired(review.expires_at)) {
    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='EXPIRED', decided_at=datetime('now'), updated_at=datetime('now')
      WHERE review_id=?
    `).bind(review.review_id).run();
    return json({ ok: false, error: "Link expired" }, 410);
  }

  const status = String(review.status || "").toUpperCase();
  const ACCEPTABLE = new Set(["PENDING", "ISSUED", "AI_VISUALS_GENERATED"]);
  if (!ACCEPTABLE.has(status)) {
    return json({ ok: false, error: "Already decided", status }, 409);
  }

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

  try {
    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='ACCEPTED', decided_at=datetime('now'), updated_at=datetime('now')
      WHERE review_id=?
    `).bind(review.review_id).run();

    await db.prepare(`
      UPDATE blog_draft_reviews
      SET status='SUPERSEDED', decided_at=datetime('now'), updated_at=datetime('now')
      WHERE draft_id = ?
        AND review_id <> ?
        AND status IN ('PENDING','ISSUED','AI_VISUALS_GENERATED')
    `).bind(review.draft_id, review.review_id).run();

    const savedMd = String(review.client_content_markdown || "").trim();
    if (savedMd) {
      const finalMd = savedMd.endsWith("\n") ? savedMd : (savedMd + "\n");
      const finalHtml = markdownToHtml(stripInternalTelemetryComments(finalMd));

      let canonicalTitle = null;
      try {
        const h1Line = finalMd.split("\n").find((l) => /^#\s+/.test(l)) || "";
        const h1 = h1Line ? h1Line.replace(/^#\s+/, "").trim() : "";
        if (h1) canonicalTitle = h1;
      } catch (_) {}

      await db.prepare(`
        UPDATE blog_drafts
        SET
          title = COALESCE(NULLIF(?, ''), title),
          content_markdown = ?,
          content_html = ?,
          updated_at = datetime('now')
        WHERE draft_id = ?
      `).bind(canonicalTitle, finalMd, finalHtml, review.draft_id).run();
    }

    await db.prepare(`
      UPDATE blog_drafts
      SET
        status='approved',
        approved_at=datetime('now'),
        approved_by_email=?,
        updated_at=datetime('now')
      WHERE draft_id=?
    `).bind(review.client_email || null, review.draft_id).run();
  } catch (e) {
    console.error("REVIEW_ACCEPT_FAILED", review.draft_id, String(e?.message || e));
    return json({ ok: false, error: "accept_failed", detail: String(e?.message || e) }, 200);
  }

  // Publish enqueue must happen (fast D1 insert). Processing must never block approval.
  try {
    // 1) Enqueue synchronously so publish_jobs exists immediately (proves the pipeline).
    try {
      console.log("ENQUEUE_START", review.draft_id);
      await enqueuePublishJobsForDraft({
        db,
        draft_id: review.draft_id,
        location_id: review.location_id,
      });
      console.log("ENQUEUE_DONE", review.draft_id);
    } catch (e) {
      console.error("PUBLISH_ENQUEUE_FAIL_OPEN", review.draft_id, String(e?.message || e));
    }

    // 2) Process in the background when possible.
    const processTask = (async () => {
      try {
        await processQueuedPublishJobsForDraft({
          db,
          env,
          draft_id: review.draft_id,
          location_id: review.location_id,
        });
      } catch (e) {
        console.error("PUBLISH_PROCESS_FAIL_OPEN", review.draft_id, String(e?.message || e));
      }
    })();

    if (waitUntil) {
      waitUntil(processTask);
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

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripInternalTelemetryComments(md) {
  const s = String(md || "");
  return s
    .replace(/^\s*<!--\s*AI_GENERATED\s*-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*generated_at:\s*.*?-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*wow_standard:\s*.*?-->\s*\n?/gmi, "")
    .replace(/^\s*<!--\s*eio_fingerprint:\s*[\s\S]*?-->\s*\n?/gmi, "")
    .trim();
}

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
