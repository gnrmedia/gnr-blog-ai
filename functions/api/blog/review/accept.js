// Repo: gnr-blog-ai
// Path: functions/api/blog/review/accept.js

// PUBLIC: POST /api/blog/review/accept
// Body: { t: "<token>", follow_emphasis?: "...", follow_avoid?: "..." }
import { enqueuePublishJobsForDraft, processQueuedPublishJobsForDraft } from "../_lib/publisher/index.js";

export async function onRequest(context) {
  const { request, env } = context;
  const waitUntil =
    (context && typeof context.waitUntil === "function")
      ? context.waitUntil.bind(context)
      : (context?.ctx && typeof context.ctx.waitUntil === "function")
        ? context.ctx.waitUntil.bind(context.ctx)
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

    if (waitUntil) waitUntil(processTask);
    else console.warn("PUBLISH_NO_WAITUNTIL", review.draft_id);
  } catch (_) {}

  // ------------------------------------------------------------
  // TEAM NOTIFY (fail-open, async)
  // ------------------------------------------------------------
  try {
    const notifyTask = (async () => {
      try {
        // Pull assigned staff emails from D1
        const rs = await db.prepare(`
          SELECT DISTINCT user_email
            FROM agency_location_assignments
           WHERE location_id = ?
             AND source = 'ghl'
             AND user_email IS NOT NULL
             AND TRIM(user_email) <> ''
        `).bind(String(review.location_id || "").trim()).all();

        const emails = (rs?.results || [])
          .map((r) => String(r.user_email || "").trim().toLowerCase())
          .filter(Boolean);

        if (!emails.length) {
          console.log("TEAM_NOTIFY_SKIP_NO_ASSIGNEES", { location_id: review.location_id, draft_id: review.draft_id });
          return;
        }

        // Optional: get business name for subject
        const biz = await db.prepare(`
          SELECT business_name_raw
            FROM businesses
           WHERE location_id = ?
           LIMIT 1
        `).bind(String(review.location_id || "").trim()).first();

        const draftRow = await db.prepare(`
          SELECT title, content_markdown
            FROM blog_drafts
           WHERE draft_id = ?
           LIMIT 1
        `).bind(String(review.draft_id || "").trim()).first();

        const heroRow = await db.prepare(`
          SELECT image_url
            FROM blog_draft_assets
           WHERE draft_id = ?
             AND lower(visual_key) = 'hero'
           LIMIT 1
        `).bind(String(review.draft_id || "").trim()).first();

        const businessName = String(biz?.business_name_raw || "a client").trim();
        const draftTitle = String(draftRow?.title || "").trim();
        const heroUrl = String(heroRow?.image_url || "").trim() || null;

        const seoTitle = draftTitle || `Draft approved — ${businessName}`;

        // Build a clean 100–250 char description from markdown
        const seoDescription = buildSeoDescription(draftRow?.content_markdown || "", 250);

        let coverAttachment = null;

        try {
          if (heroUrl) {
            // Resize to 600x400 (cover) and attach as PNG
            const { b64, mime, filename } = await fetchResizedImageAsAttachment(heroUrl, {
              width: 600,
              height: 400,
              fit: "cover",
              format: "png",
              filename: "cover-600x400.png",
            });

            coverAttachment = {
              content: b64,
              type: mime,
              filename,
              disposition: "attachment",
            };
          }
        } catch (e) {
          console.log("COVER_IMAGE_ATTACH_FAIL_OPEN", {
            draft_id: review.draft_id,
            error: String(e?.message || e),
          });
        }

        // Canonical URLs (do NOT derive from request.origin for cross-host consistency)
        const apiBase = "https://api.admin.gnrmedia.global";
        const adminToolUrl = "https://admin.gnrmedia.global/admin/blog-ai.html";

        // Canonical published renderer (View A)
        const publishedViewUrl =
          `${apiBase}/api/blog/draft/render/${encodeURIComponent(String(review.draft_id || ""))}?view=generic`;

        const html = `
          <div style="font-family:Arial,sans-serif;line-height:1.55">
            <h2>✅ Client approved — ready for manual posting</h2>

            <p><b>Business:</b> ${escapeHtml(businessName)}<br/>
               <b>Location ID:</b> <span style="font-family:Consolas,monospace">${escapeHtml(String(review.location_id || ""))}</span><br/>
               <b>Draft ID:</b> <span style="font-family:Consolas,monospace">${escapeHtml(String(review.draft_id || ""))}</span><br/>
               <b>Status:</b> approved
            </p>

            <h3>SEO (use these in GHL “Edit Blog Post SEO”)</h3>
            <p>
              <b>Title:</b> ${escapeHtml(seoTitle)}<br/>
              <b>Post Description (100–250 chars):</b> ${escapeHtml(seoDescription)}
            </p>

            <h3>Cover Image (600×400)</h3>
            <p>
              ${coverAttachment
                ? "✅ Attached to this email as <b>cover-600x400.png</b> (upload it as the Cover Image in GHL)."
                : (heroUrl ? `⚠️ Could not attach resized cover image. Use the hero image URL manually:<br/><span style="font-family:Consolas,monospace">${escapeHtml(heroUrl)}</span>` : "⚠️ No hero image found for this draft (cover image required in GHL).")}
            </p>

            <h3>Links</h3>
            <ul>
              <li><b>Published View (copy from here):</b> <a href="${publishedViewUrl}">${publishedViewUrl}</a></li>
              <li><b>Blog AI Admin Tool:</b> <a href="${adminToolUrl}">${adminToolUrl}</a></li>
            </ul>

            <h3>Manual upload instructions (GHL)</h3>

            <ol>
              <li>Open the <b>Published View</b> link above.</li>
              <li>Copy the article content:
                <ul>
                  <li>If GHL editor accepts rich text: select the article content and copy/paste into the blog post body.</li>
                  <li>If you need HTML: use <b>View Page Source</b> and copy the relevant article/body HTML into GHL’s HTML mode (if available).</li>
                </ul>
              </li>
              <li>In GHL, open <b>Edit Blog Post SEO</b> and set:
                <ul>
                  <li><b>Title</b> = the Title above</li>
                  <li><b>Post Description</b> = the Description above</li>
                  <li><b>Cover Image</b> = upload the attached <b>cover-600x400.png</b></li>
                </ul>
              </li>
              <li>Publish the post.</li>
            </ol>

            <p style="margin-top:14px;color:#666">
              Note: We are starting with manual upload for safety. Direct publishing will be enabled once platform targets are fully validated.
            </p>
          </div>
        `;

        await sendSendgridEmail(env, {
          to: emails,
          subject: `✅ Draft approved — ${businessName}`,
          html,
          attachments: coverAttachment ? [coverAttachment] : [],
        });

        // Slack notify (fail-open)
        try {
          const slackText =
            `✅ Draft approved — ${businessName}\n` +
            `• location_id: ${review.location_id}\n` +
            `• draft_id: ${review.draft_id}\n` +
            `• Published view: ${publishedViewUrl}\n` +
            `• Admin tool: ${adminToolUrl}`;

          const blocks = [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*✅ Draft approved*\n*Business:* ${businessName}` }
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Location ID:*\n\`${String(review.location_id || "")}\`` },
                { type: "mrkdwn", text: `*Draft ID:*\n\`${String(review.draft_id || "")}\`` }
              ]
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Links*\n• <${publishedViewUrl}|Published View>\n• <${adminToolUrl}|Blog AI Admin>` }
            }
          ];

          await sendSlackWebhook(env, { text: slackText, blocks });

          console.log("SLACK_NOTIFY_SENT", {
            draft_id: review.draft_id,
            location_id: review.location_id
          });

        } catch (e) {
          console.log("SLACK_NOTIFY_FAIL_OPEN", {
            draft_id: review.draft_id,
            error: String(e?.message || e)
          });
        }

        console.log("TEAM_NOTIFY_SENT", { draft_id: review.draft_id, location_id: review.location_id, to_count: emails.length });
      } catch (e) {
        console.log("TEAM_NOTIFY_FAIL_OPEN", { draft_id: review.draft_id, error: String(e?.message || e) });
      }
    })();

    if (waitUntil) waitUntil(notifyTask);
    else notifyTask.catch(() => {});
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

async function envString(env, key) {
  const v = env?.[key];
  if (v && typeof v === "object" && typeof v.get === "function") {
    const s = await v.get();
    return String(s || "");
  }
  return String(v || "");
}

async function sendSendgridEmail(env, { to, subject, html, attachments = [] }) {
  const apiKey = (await envString(env, "SENDGRID_API_KEY_GNRMEDIA")).trim();
  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY_GNRMEDIA");

  const fromEmail = String(env.SENDGRID_FROM_EMAIL || "").trim(); // should be support@gnrmedia.global
  const fromName = String(env.SENDGRID_FROM_NAME || "GNR Media").trim();
  if (!fromEmail) throw new Error("Missing SENDGRID_FROM_EMAIL");

  const payload = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: fromEmail, name: fromName },
    reply_to: { email: fromEmail },
    subject,
    content: [{ type: "text/html", value: html }],
  };

  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments;
  }

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

function stripMdForSeo(md) {
  let s = String(md || "");

  // Remove internal comments and visual tokens
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/GNRVISUALTOKEN:[a-z0-9\-]+/gi, " ");
  s = s.replace(/_?GNRVISUAL_?:[a-z0-9_\-]+/gi, " ");

  // Remove markdown headings + formatting
  s = s.replace(/^\s*#{1,6}\s+/gm, "");
  s = s.replace(/[*_`>#]/g, " ");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function buildSeoDescription(md, maxLen = 250) {
  const cleaned = stripMdForSeo(md);
  if (!cleaned) return "";

  // Aim for 100–250 chars as per GHL guidance
  let out = cleaned.slice(0, maxLen).trim();

  // Avoid cutting mid-word if possible
  if (cleaned.length > maxLen) {
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace > 120) out = out.slice(0, lastSpace).trim();
    out = out.replace(/[,\s]+$/g, "") + "…";
  }

  // Enforce minimum-ish usefulness
  if (out.length < 80 && cleaned.length > out.length) {
    out = cleaned.slice(0, Math.min(200, cleaned.length)).trim();
  }

  return out;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Uses Cloudflare Image Resizing (via fetch cf options) to produce exact 600x400 cover image
async function fetchResizedImageAsAttachment(url, { width, height, fit = "cover", format = "png", filename }) {
  const src = String(url || "").trim();
  if (!src) throw new Error("Missing image url");

  const res = await fetch(src, {
    cf: {
      image: {
        width,
        height,
        fit,
        format,
      },
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Image fetch/resize failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const mime = res.headers.get("content-type") || (format === "png" ? "image/png" : "image/jpeg");
  const buf = await res.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);

  // Guardrail: if attachment too big (rare for 600x400), fail-open
  if (b64.length > 6_000_000) {
    throw new Error("Resized image too large to attach");
  }

  return {
    b64,
    mime,
    filename: filename || `cover-${width}x${height}.${format}`,
  };
}

async function sendSlackWebhook(env, { text, blocks }) {
  const webhookUrl = String(await envString(env, "SLACK_WEBHOOK_URL") || "").trim();
  if (!webhookUrl) throw new Error("Missing SLACK_WEBHOOK_URL");

  const payload = {};
  if (text) payload.text = String(text);
  if (blocks) payload.blocks = blocks;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${res.status} ${txt.slice(0, 600)}`);
  }
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
