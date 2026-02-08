// blog-handlers.js — Phase 2: MVP Draft Lifecycle
// -----------------------------------------------------------
// Migrated from zlegacy-workers/blog-ai.worker.js
// Phase 1: requireAdmin, corsHeaders, jsonResponse, errorResponse
// Phase 2: listBusinesses, createDraftForLocation, getDraftById,
//          renderDraftHtml, generateAiForDraft + all helpers
// -----------------------------------------------------------

// ============================================================
// DRAFT STATUS CONSTANTS
// ============================================================
const DRAFT_STATUS = {
      DRAFTING: "drafting",
      AI_GENERATED: "ai_generated",
      AI_VISUALS_GENERATED: "ai_visuals_generated",
      REVIEW_LINK_ISSUED: "review_link_issued",
      APPROVED: "approved",
      PUBLISHED: "published",
      REJECTED: "rejected",
};

// ============================================================
// SMALL UTILITIES
// ============================================================
function safeJsonParse(s, fallback) {
      try { return JSON.parse(s); } catch (_) { return fallback; }
}

const nowIso = () => new Date().toISOString();

const toHex = (value) => {
      const bytes = new TextEncoder().encode(String(value ?? ""));
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const normaliseLocationId = (value) => {
      let s = String(value ?? "");
      try { s = s.normalize("NFKC"); } catch (_) {}
      s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, "");
      s = s.replace(/\s+/g, "");
      return s.trim();
};

const escapeHtml = (s) =>
      String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const extractFirstJsonObject = (txt) => {
      const raw = String(txt || "").trim();
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) {}
      const a = raw.indexOf("{");
      const b = raw.lastIndexOf("}");
      if (a >= 0 && b > a) {
              try { return JSON.parse(raw.slice(a, b + 1)); } catch (_) {}
      }
      return null;
};

// ============================================================
// CORS (admin UI calls blog-api cross-origin)
// ============================================================
const CORS_ALLOWED_ORIGINS = new Set([
      "https://admin.gnrmedia.global",
      "https://gnr-admin.pages.dev",
      "http://localhost:8788",
      "http://localhost:3000",
    ]);

export function corsHeaders(context) {
      const req = (context && context.request) ? context.request : context;
      if (!req || typeof req.headers?.get !== "function") return null;
      const origin = req.headers.get("Origin");
      if (!origin || !CORS_ALLOWED_ORIGINS.has(origin)) return null;
      const reqHeaders = req.headers.get("Access-Control-Request-Headers") || "content-type,authorization";
      const requestedMethod = (req.headers.get("Access-Control-Request-Method") || req.method || "").toUpperCase();
      const allowMethods = requestedMethod === "GET" ? "GET,OPTIONS" : "POST,OPTIONS";
      return {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              "Access-Control-Allow-Methods": allowMethods,
              "Access-Control-Allow-Headers": reqHeaders,
              "Access-Control-Max-Age": "86400",
              Vary: "Origin",
      };
}

// ============================================================
// JSON + ERROR Response helpers (with CORS)
// ============================================================
export function jsonResponse(context, obj, status = 200) {
      const cors = corsHeaders(context);
      return new Response(JSON.stringify(obj, null, 2), {
              status,
              headers: { "content-type": "application/json; charset=utf-8", ...(cors || {}) },
      });
}

export function errorResponse(context, error, status = 500, extra = {}) {
      return jsonResponse(context, { ok: false, error, ...extra }, status);
}

// ============================================================
// ADMIN AUTH (Cloudflare Access)
// ============================================================
function parseCsv(s) {
      return String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}
function getAccessEmail(req) {
      const h = req.headers.get("cf-access-authenticated-user-email") ||
                      req.headers.get("Cf-Access-Authenticated-User-Email") || "";
      return String(h || "").trim().toLowerCase();
}
function isAllowedAdmin(email, env) {
      if (!email) return false;
      const adminEmails = parseCsv(env.ADMIN_EMAILS);
      const adminDomains = parseCsv(env.ADMIN_DOMAINS);
      if (adminEmails.length && adminEmails.includes(email)) return true;
      if (adminDomains.length) {
              const at = email.lastIndexOf("@");
              const domain = at >= 0 ? email.slice(at + 1) : "";
              if (domain && adminDomains.includes(domain)) return true;
      }
      return false;
}

export function requireAdmin(context) {
  const { request, env } = context;
  console.log("AUTH_PROBE", {
    has_shared_header: request.headers.has("x-provision-shared-secret"),
    shared_len: String(request.headers.get("x-provision-shared-secret") || "").length,
    env_len: String(env.PROVISION_SHARED_SECRET || "").length,
  });
      
  // 1) Fallback: shared secret header (works even when API IS behind Access)
  const key = String(
    request.headers.get("x-provision-shared-secret") ||
    request.headers.get("X-Provision-Shared-Secret") ||
    ""
  ).trim();

  const expected = String(env.PROVISION_SHARED_SECRET || "").trim();
  if (!expected) {
    return jsonResponse(
      context,
      { error: "Server misconfigured", detail: "env.PROVISION_SHARED_SECRET is missing" },
      500
    );
  }

  if (key && key === expected) {
    return { email: "api-key", auth: "shared-secret" };
  }

  // 2) Preferred: Cloudflare Access identity header (works if API is behind Access)
  const email = getAccessEmail(request);
  if (email) {
    if (!isAllowedAdmin(email, env)) {
      return jsonResponse(context, { error: "Forbidden", email }, 403);
    }
    return { email, auth: "cf-access-header" };
  }

  return jsonResponse(
    context,
    {
      error: "Unauthorized",
      detail:
        "Missing admin identity (no Access email header and no valid x-provision-shared-secret).",
    },
    401
  );
}



// ============================================================
// HTML → TEXT (for fetched context)
// ============================================================
const htmlToText = (html) => {
      const s = String(html || "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
        .replace(/<\/(p|div|h1|h2|h3|li|br|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return s.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]+/g, " ").trim();
};

// ============================================================
// FETCH CONTEXT TEXT (URL → short text excerpt)
// ============================================================
const fetchContextText = async (url, { maxChars = 6000, timeoutMs = 8000 } = {}) => {
      const u = String(url || "").trim();
      if (!u || !/^https?:\/\//i.test(u)) return "";
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
              const res = await fetch(u, {
                        method: "GET",
                        redirect: "follow",
                        headers: {
                                    "User-Agent": "gnr-blog-ai/1.0 (+https://gnrmedia.global)",
                                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        },
                        signal: controller.signal,
              });
              const ct = String(res.headers.get("content-type") || "").toLowerCase();
              if (!res.ok) return "";
              if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";
              const raw = await res.text();
              const text = ct.includes("text/plain") ? raw.trim() : htmlToText(raw);
              return text.slice(0, maxChars);
      } catch { return ""; }
      finally { clearTimeout(t); }
};

// ============================================================
// MARKDOWN → HTML (snarkdown-style + sanitizer)
// ============================================================
function snarkdown(md) {
      md = String(md || "").replace(/\r\n?/g, "\n");
      md = md.replace(/```([\s\S]*?)```/g, (_, code) =>
              "\n<pre><code>" + escapeHtml(code.trim()) + "</code></pre>\n");
      md = md.replace(/`([^`]+)`/g, (_, code) => "<code>" + escapeHtml(code) + "</code>");
      md = md.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
      md = md.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
      md = md.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
      md = md.replace(/^### (.*)$/gm, "<h3>$1</h3>");
      md = md.replace(/^## (.*)$/gm, "<h2>$1</h2>");
      md = md.replace(/^# (.*)$/gm, "<h1>$1</h1>");
      md = md.replace(/^\s*---\s*$/gm, "<hr/>");
      md = md.replace(/^\s*>\s?(.*)$/gm, "<blockquote>$1</blockquote>");
      md = md.replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>");
      md = md.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      md = md.replace(/\*([^\*]+)\*/g, "<em>$1</em>");
      md = md.replace(/_([^_]+)_/g, "<em>$1</em>");
      md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
                          (_, text, url) => `<a href="${escapeHtml(url)}" rel="nofollow noopener" target="_blank">${text}</a>`);
      md = md.replace(/(^|\n)(?:\s*[-*+]\s.+(?:\n|$))+?/g, (m) => {
              const items = m.trim().split("\n")
                .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim()).filter(Boolean)
                .map((li) => "<li>" + li + "</li>").join("");
              return "\n<ul>" + items + "</ul>\n";
      });
      md = md.replace(/(^|\n)(?:\s*\d+\.\s.+(?:\n|$))+?/g, (m) => {
              const items = m.trim().split("\n")
                .map((line) => line.replace(/^\s*\d+\.\s+/, "").trim()).filter(Boolean)
                .map((li) => "<li>" + li + "</li>").join("");
              return "\n<ol>" + items + "</ol>\n";
      });
      const blocks = md.split(/\n{2,}/);
      md = blocks.map((b) => {
              const s = b.trim();
              if (!s) return "";
              if (/^<(h\d|ul|ol|li|blockquote|pre|hr)\b/i.test(s)) return s;
              const p = s.replace(/\n+/g, "<br/>");
              return `<p>${p}</p>`;
      }).filter(Boolean).join("\n");
      return md;
}

function sanitizeHtml(html) {
      let s = String(html || "");
      s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
      s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
      s = s.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
      s = s.replace(/href\s*=\s*("|\')\s*javascript:[\s\S]*?\1/gi, 'href="#"');
      const allowed = new Set([
              "p","br","h1","h2","h3","h4","h5","h6",
              "ul","ol","li","blockquote","hr",
              "strong","em","code","pre","a",
            ]);
      s = s.replace(/<\/?([a-z0-9]+)(\s[^>]*?)?>/gi, (m, tag) => {
              return allowed.has(String(tag || "").toLowerCase()) ? m : "";
      });
      return s;
}

const markdownToHtml = (md) => sanitizeHtml(snarkdown(String(md || "")));

// ============================================================
// VISUAL PLACEHOLDER HANDLING
// ============================================================
const VISUAL_TOKEN_PREFIX = "GNRVISUALTOKEN:";
const VISUAL_KINDS = ["hero"];

const kindToAssetKey = (kind) =>
      String(kind || "").trim().toLowerCase().replace(/-/g, "_");

const toSafeTokenKey = (k) =>
      String(k || "").trim().toLowerCase().replace(/_/g, "-");

const stripInternalTelemetryComments = (md) => {
      return String(md || "")
        .replace(/^\s*<!--\s*AI_GENERATED\s*-->\s*\n?/gmi, "")
        .replace(/^\s*<!--\s*generated_at:\s*.*?-->\s*\n?/gmi, "")
        .replace(/^\s*<!--\s*wow_standard:\s*.*?-->\s*\n?/gmi, "")
        .replace(/^\s*<!--\s*eio_fingerprint:\s*[\s\S]*?-->\s*\n?/gmi, "")
        .trim();
};

const visualCommentsToTokens = (md) => {
      let out = String(md || "");
      out = out.replace(/<!--\s*VISUAL\s*:\s*([a-zA-Z0-9_\-]+)\s*-->/gmi,
                            (_, key) => `\n${VISUAL_TOKEN_PREFIX}${toSafeTokenKey(key)}\n`);
      out = out.replace(/(?:^|\n)\s*_?GNRVISUAL_?:([a-zA-Z0-9_\-]+)\s*(?=\n|$)/gmi,
                            (_, key) => `\n${VISUAL_TOKEN_PREFIX}${toSafeTokenKey(key)}\n`);
      return out;
};

const replaceVisualTokensInHtml = (html, blockFn) => {
      let out = String(html || "");
      const aliasToCanonical = { hero: "hero" };
      const tokenPrefixes = [
              VISUAL_TOKEN_PREFIX, "_GNRVISUAL:", "__GNRVISUAL__:",
              "GNRVISUAL:", "_GNRVISUAL_:", "GNRVISUAL_:",
            ];
      const allKeys = Object.keys(aliasToCanonical);
      const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const rawKey of allKeys) {
              const canonical = aliasToCanonical[rawKey] || null;
              if (!canonical) continue;
              for (const pfx of tokenPrefixes) {
                        const token = pfx + rawKey;
                        const paraRe = new RegExp(
                                    `<p[^>]*>\\s*${escRe(token)}\\s*(?:<br\\s*\\/?>\\s*)*<\\/p>`, "gi");
                        out = out.replace(paraRe, blockFn(canonical));
                        const looseRe = new RegExp(escRe(token), "g");
                        out = out.replace(looseRe, blockFn(canonical));
              }
      }
      return out;
};

// ============================================================
// DRAFT ASSETS (D1)
// ============================================================
async function getDraftAssetsMap(env, draft_id) {
      try {
              const did = String(draft_id || "").trim();
              if (!did) return {};
              const rs = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT visual_key, image_url FROM blog_draft_assets
                          WHERE draft_id = ? AND image_url IS NOT NULL AND TRIM(image_url) <> ''
                              `).bind(did).all();
              const map = {};
              for (const r of (rs?.results || [])) {
                        const k = String(r.visual_key || "").trim().toLowerCase();
                        const u = String(r.image_url || "").trim();
                        if (k && u) map[k] = u;
              }
              return map;
      } catch (e) {
              console.log("DRAFT_ASSETS_READ_FAIL_OPEN", { draft_id, error: String(e?.message || e) });
              return {};
      }
}

async function hasHeroAsset(env, draft_id) {
      try {
              const did = String(draft_id || "").trim();
              if (!did) return false;
              const row = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT image_url FROM blog_draft_assets
                          WHERE draft_id = ? AND lower(visual_key) = 'hero'
                                  AND image_url IS NOT NULL AND TRIM(image_url) <> ''
                                        LIMIT 1
                                            `).bind(did).first();
              return !!(row && String(row.image_url || "").trim());
      } catch (e) {
              console.log("HAS_HERO_ASSET_FAIL_OPEN", { draft_id, error: String(e?.message || e) });
              return false;
      }
}

async function upsertDraftAssetRow(env, { draft_id, visual_key, image_url, provider, asset_type, prompt, status }) {
      const did = String(draft_id || "").trim();
      const k = String(visual_key || "").trim().toLowerCase();
      const url = String(image_url || "").trim();
      if (!did) return { ok: false, error: "draft_id required" };
      if (!k || !VISUAL_KINDS.includes(k)) return { ok: false, error: "invalid visual_key", allowed: VISUAL_KINDS };
      if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) {
              return { ok: false, error: "image_url must be https:// or data:image/*" };
      }
      const asset_id = `${did}:${k}`;

      try {
        await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          INSERT INTO blog_draft_assets (
                asset_id, draft_id, visual_key, asset_type, provider, prompt, image_url, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                        ON CONFLICT(asset_id) DO UPDATE SET
                              visual_key = excluded.visual_key, asset_type = excluded.asset_type,
                                    provider = excluded.provider, prompt = excluded.prompt,
                                          image_url = excluded.image_url, status = excluded.status,
                                                updated_at = datetime('now')
        `).bind(
          asset_id, did, k,
          String(asset_type || "image"), String(provider || "admin"),
          String(prompt || "manual_upload"), url, String(status || "ready")
        ).run();
      } catch (e) {
        return { ok: false, error: "asset_upsert_db_failed", detail: String(e?.message || e) };
      }

      return { ok: true, asset_id };

}

// ============================================================
// AI TEXT GENERATION (Cloudflare AI + OpenAI fallback)
// ============================================================
const generateMarkdownWithAI = async ({ env, prompt, system }) => {
      if (env.AI) {
              const model = env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
              const res = await env.AI.run(model, {
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: prompt },
                                  ],
                        max_tokens: 1600,
              });
              const text = res?.response || res?.result || res?.output || (typeof res === "string" ? res : null);
              if (!text) throw new Error("Cloudflare AI returned no text.");
              return String(text).trim();
      }
      const k = env && env.OPENAI_API_KEY;
      const apiKey = (k && typeof k.get === "function") ? await k.get() : k;
      if (!apiKey) throw new Error("No AI provider configured. Bind env.AI or set OPENAI_API_KEY.");
      const model = env.OPENAI_MODEL || "gpt-4o-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                        model, temperature: 0.6,
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: prompt },
                                  ],
              }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
              const errMsg = data?.error?.message || r.statusText;
              throw new Error("OpenAI error: " + errMsg);
      }
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text) throw new Error("OpenAI returned no message content.");
      return String(text).trim();
};

// ============================================================
// AI IMAGE GENERATION + CLOUDFLARE IMAGES STORAGE
// ============================================================
async function openaiGenerateImageBase64({ env, prompt, size }) {
  const k = env && env.OPENAI_API_KEY;
  const apiKey = (k && typeof k.get === "function") ? await k.get() : k;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY (needed for raster visuals)");
  const model = env.OPENAI_IMAGE_MODEL || "dall-e-3";
  const isDalle = model.startsWith("dall-e");

  // Build request body per model
  const body = { model, prompt };
  if (isDalle) {
    // dall-e-2 / dall-e-3: needs response_format and n; size constraints differ
    body.response_format = "b64_json";
    body.n = 1;
    body.size = (model === "dall-e-3")
      ? (size === "1024x1024" || size === "1792x1024" || size === "1024x1792" ? size : "1792x1024")
      : (size === "256x256" || size === "512x512" || size === "1024x1024" ? size : "1024x1024");
  } else {
    // gpt-image-1: no n param, always returns b64_json, flexible sizes
    body.size = size || "1536x1024";
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error("OpenAI image error: " + (data?.error?.message || res.statusText));
  }
  const first = data?.data?.[0] || {};
  const b64 = first?.b64_json ? String(first.b64_json).trim() : null;
  const imageUrl = first?.url ? String(first.url).trim() : null;
  if (!b64 && !imageUrl) throw new Error("OpenAI image returned neither b64_json nor url");
  if (!b64) throw new Error("OpenAI image returned no b64_json");
  return { imageUrl, b64 };
}

async function cloudflareImagesUploadBase64({ env, b64, fileNameHint }) {
      const accountId = String(env.CF_IMAGES_ACCOUNT_ID || "").trim();
      if (!accountId) throw new Error("Missing CF_IMAGES_ACCOUNT_ID");
      const cfToken = env.CF_IMAGES_API_TOKEN;
      const token = (cfToken && typeof cfToken.get === "function") ? await cfToken.get() : cfToken;
      if (!token) throw new Error("Missing CF_IMAGES_API_TOKEN");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/png" }), String(fileNameHint || "visual.png"));
      const url = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/images/v1";
      const res = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token }, body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out?.success) {
              throw new Error("Cloudflare Images upload failed: " + res.status + " " + JSON.stringify(out).slice(0, 600));
      }
      const id = out?.result?.id;
      if (!id) throw new Error("Cloudflare Images: missing result.id");
      const hash = String(env.CF_IMAGES_DELIVERY_HASH || "").trim();
      if (!hash) throw new Error("Missing CF_IMAGES_DELIVERY_HASH");
      return "https://imagedelivery.net/" + hash + "/" + id + "/public";
}

async function generateAndStoreImage({ env, prompt, size, fileNameHint }) {
      const out = await openaiGenerateImageBase64({ env, prompt, size });
      const url = await cloudflareImagesUploadBase64({ env, b64: out.b64, fileNameHint });
      return { url, openai_url: out.imageUrl || null };
}

// ============================================================
// AI EVENT LOGGING (D1, fail-open)
// ============================================================
async function logAiEventFailOpen(env, { kind, model, draft_id, detail }) {
      try {
await env.GNR_MEDIA_BUSINESS_DB
  .prepare(
    "INSERT INTO ai_events (id, created_at, kind, model, draft_id, detail_json) " +
    "VALUES (?, datetime('now'), ?, ?, ?, ?)"
  )
  .bind(
    crypto.randomUUID(),
    String(kind || ""),
    String(model || ""),
    draft_id ? String(draft_id) : null,
    JSON.stringify(detail || {})
  )
  .run();

      } catch (e) {
              console.log("AI_EVENT_LOG_FAIL_OPEN", String(e?.message || e));
      }
}

// ============================================================
// SVG FALLBACK VISUALS (no-text abstract panels)
// ============================================================
const svgToDataUrl = (svg) => {
      const b64 = btoa(unescape(encodeURIComponent(String(svg || "").trim())));
      return "data:image/svg+xml;base64," + b64;
};

function buildAbstractPanelSvg() {
      const gridLines = Array.from({ length: 18 }).map((_, i) =>
              '<line x1="' + (i * 100) + '" y1="0" x2="' + (i * 100) + '" y2="900" stroke="#fff"/>`).join("");
      const gridRows = Array.from({ length: 10 }).map((_, i) =>
              '<line x1="0" y1="' + (i * 100) + '" x2="1600" y2="' + (i * 100) + '" stroke="#fff"/>').join("");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
        <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#0b0f1a"/><stop offset="60%" stop-color="#111827"/><stop offset="100%" stop-color="#7c3aed"/>
                      </linearGradient>
                          <radialGradient id="r" cx="70%" cy="25%" r="70%">
                                <stop offset="0%" stop-color="#22c55e" stop-opacity="0.18"/><stop offset="55%" stop-color="#22c55e" stop-opacity="0"/>
                                    </radialGradient>
                                      </defs>
                                        <rect width="1600" height="900" fill="url(#g)"/><rect width="1600" height="900" fill="url(#r)"/>
                                          <g opacity="0.12">${gridLines}${gridRows}</g>
                                            <g opacity="0.9">
                                                <circle cx="1180" cy="260" r="190" fill="rgba(255,255,255,0.06)"/>
                                                    <circle cx="420" cy="650" r="260" fill="rgba(255,255,255,0.05)"/>
                                                        <rect x="140" y="150" width="1320" height="600" rx="36" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)"/>
                                                          </g>
                                                          </svg>`.trim();
}

// ============================================================
// AUTO-GENERATE VISUALS FOR DRAFT (hero image)
// ============================================================
async function autoGenerateVisualsForDraft(env, draft_id) {
      const did = String(draft_id || "").trim();
      if (!did) return { ok: false, error: "draft_id required" };
        // ✅ Idempotency: if hero already exists, do nothing (prevents extra image spend)
        const alreadyHasHero = await hasHeroAsset(env, did);
        if (alreadyHasHero) {
                  return { ok: true, draft_id: did, generated: [], skipped: ["hero_already_present"] };
        }
      const row = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          SELECT draft_id, title, content_markdown FROM blog_drafts WHERE draft_id = ? LIMIT 1
            `).bind(did).first();
      if (!row?.draft_id) return { ok: false, error: "draft_not_found" };
      const md0 = String(row.content_markdown || "");
      const h1Line = md0.split("\n").find((l) => /^#\s+/.test(l)) || "";
      const articleTitle = h1Line ? h1Line.replace(/^#\s+/, "").trim() : "";
      const title = String(articleTitle || row.title || "Growth Journal").trim();
      const h2 = md0.split("\n").filter((l) => /^##\s+/.test(l))
        .map((l) => l.replace(/^##\s+/, "").trim()).filter(Boolean);
      const subtitle = h2.slice(0, 3).join(" \u2022 ") || "Community-driven marketing foundations";
      try {
              const heroPrompt = [
                        "Create a premium, magazine-quality feature image for a marketing blog article.",
                        "Style: modern editorial, cinematic lighting, clean premium design, subtle abstract gradients.",
                        "Brand feel: dark premium base, confident, high-trust (GNR Media style).",
                        "ABSOLUTE RULE: no text, no letters, no numbers, no typography in the image.",
                        "No logos, no watermarks, no fake brand marks.",
                        "Composition: abstract + photoreal blend, with strong depth and a clear focal point.",
                        "Use subtle green accents and deep navy/charcoal tones.",
                        `Theme: ${title}`,
                        `Concept cues: ${subtitle}`,
                      ].join("\n");
              const gen = await generateAndStoreImage({ env, prompt: heroPrompt, size: "1536x1024", fileNameHint: "hero-" + did + ".png" });
              const heroImageUrl = gen?.url ? String(gen.url).trim() : "";
              await upsertDraftAssetRow(env, {
                        draft_id: did, visual_key: "hero",
                        image_url: heroImageUrl || svgToDataUrl(buildAbstractPanelSvg()),
                        provider: heroImageUrl ? "openai+cloudflare_images" : "system",
                        asset_type: heroImageUrl ? "image" : "svg",
                        prompt: heroPrompt, status: "ready",
              });
      } catch (e) {
              console.log("AUTO_VISUALS_HERO_FAIL_OPEN", { draft_id: did, error: String(e?.message || e) });
              await upsertDraftAssetRow(env, {
                        draft_id: did, visual_key: "hero",
                        image_url: svgToDataUrl(buildAbstractPanelSvg()),
                        provider: "system", asset_type: "svg",
                        prompt: "hero_fallback_svg_no_text", status: "ready",
              });
      }
      return { ok: true, draft_id: did, generated: ["hero"] };
}

// ============================================================
// EDITORIAL INTELLIGENCE PRE-WRITE (EIPW) — EIO SYSTEM
// ============================================================
const EIO_ENUMS = {
      authority_level: new Set(["intro", "intermediate", "expert"]),
      contrarian_degree: new Set(["low", "medium", "high"]),
      risk_profile: new Set(["conservative", "balanced", "bold"]),
      primary_angle: new Set(["visibility","trust","differentiation","consistency","speed","efficiency","authority","conversion"]),
      narrative_hook: new Set(["invisible business problem","attention tax","new gatekeepers","content compounding","trust signals","decision fatigue","consistency gap","credibility stack","proof problem","modern referral loop"]),
      framework_style: new Set(["4-step process","5-point checklist","do/don't","myth vs reality","short/medium/long term","decision tree","before/after"]),
      proof_type: new Set(["mini case vignette","directional chart","checklist audit","common mistakes teardown","roadmap","benchmark comparison"]),
      voice_micro_style: new Set(["calm strategist","friendly expert","clear teacher","practical operator","executive advisory"]),
      primary_intent: new Set(["authority","visibility","conversion","education"]),
};

const arrMin2 = (v) => Array.isArray(v) && v.length >= 2;

const getFallbackEIO = () => ({
      schema_version: "eio_v1",
      generated_at_utc: new Date().toISOString(),
      editorial_thesis: {
              core_insight: "Most businesses don't have a marketing problem \u2014 they have a clarity and consistency problem that prevents trust from compounding.",
              why_this_matters_now: "Attention is fragmented and buyers are sceptical. Consistent, coherent authority beats sporadic activity.",
              what_not_to_say: ["Generic advice that could apply to any business", "Guaranteed outcomes or exaggerated claims"],
      },
      reader_state: {
              starting_state: "Overwhelmed by tactics and inconsistent output",
              desired_end_state: "Clear on next steps and confident in a simple system",
              emotional_friction: ["Decision fatigue", "Fear of wasting time"],
      },
      narrative_positioning: { authority_level: "intermediate", contrarian_degree: "low", risk_profile: "conservative" },
      wow_execution_plan: {
              primary_angle: "trust", narrative_hook: "credibility stack",
              framework_style: "4-step process", proof_type: "common mistakes teardown",
              voice_micro_style: "calm strategist",
              reasoning: "Fail-open conservative defaults when business inputs are thin or uncertain.",
      },
      guardrails: {
              avoid_topics: ["Regulatory advice", "Industry-specific guarantees"],
              avoid_claims: ["Guaranteed rankings, revenue, leads, or growth", "Awards/certifications/years-in-business unless explicitly provided"],
              tone_constraints: ["Calm and authoritative", "No hype, no buzzwords"],
      },
      success_definition: {
              primary_intent: "authority", wow_score_target: 92,
              must_include: ["At least 3 amazement moments", "Directional proof only (no invented stats)"],
      },
});

const validateEIO = (obj) => {
      if (!obj || typeof obj !== "object") return "EIO is not an object";
      if (obj.schema_version !== "eio_v1") return "schema_version must be eio_v1";
      if (!obj.generated_at_utc) return "generated_at_utc missing";
      const et = obj.editorial_thesis, rs = obj.reader_state;
      const np = obj.narrative_positioning, wp = obj.wow_execution_plan;
      const gr = obj.guardrails, sd = obj.success_definition;
      if (!et?.core_insight || !et?.why_this_matters_now) return "editorial_thesis missing fields";
      if (!arrMin2(et?.what_not_to_say)) return "what_not_to_say must have >=2 items";
      if (!rs?.starting_state || !rs?.desired_end_state) return "reader_state missing fields";
      if (!arrMin2(rs?.emotional_friction)) return "emotional_friction must have >=2 items";
      if (!EIO_ENUMS.authority_level.has(np?.authority_level)) return "authority_level invalid";
      if (!EIO_ENUMS.contrarian_degree.has(np?.contrarian_degree)) return "contrarian_degree invalid";
      if (!EIO_ENUMS.risk_profile.has(np?.risk_profile)) return "risk_profile invalid";
      if (!EIO_ENUMS.primary_angle.has(wp?.primary_angle)) return "primary_angle invalid";
      if (!EIO_ENUMS.narrative_hook.has(wp?.narrative_hook)) return "narrative_hook invalid";
      if (!EIO_ENUMS.framework_style.has(wp?.framework_style)) return "framework_style invalid";
      if (!EIO_ENUMS.proof_type.has(wp?.proof_type)) return "proof_type invalid";
      if (!EIO_ENUMS.voice_micro_style.has(wp?.voice_micro_style)) return "voice_micro_style invalid";
      if (!wp?.reasoning) return "reasoning missing";
      if (!arrMin2(gr?.avoid_topics)) return "avoid_topics must have >=2 items";
      if (!arrMin2(gr?.avoid_claims)) return "avoid_claims must have >=2 items";
      if (!arrMin2(gr?.tone_constraints)) return "tone_constraints must have >=2 items";
      if (!EIO_ENUMS.primary_intent.has(sd?.primary_intent)) return "primary_intent invalid";
      if (typeof sd?.wow_score_target !== "number") return "wow_score_target must be number";
      if (!arrMin2(sd?.must_include)) return "must_include must have >=2 items";
      return null;
};

const runEditorialPrewrite = async ({ env, businessName, context_quality, context_quality_reason, urls, excerpts, priorDraftsContext, editorialBriefBlock, wowStandardMeta, wowStandardJson, override_prompt }) => {
      const fallback = getFallbackEIO();
      try {
              const system = [
                        "You are the Editorial Intelligence Pre-Write Engine (EIPW).",
                        "Return ONE valid JSON object only. No markdown. No commentary.",
                        "Be conservative: do not invent stats, awards, certifications, years, locations, or results.",
                        "Proof must be directional only (no fake stats).",
                        "All enum fields must use EXACT allowed values.",
                      ].join(" ");
              const prompt = [
                        "Build an Editorial Intelligence Object (EIO) JSON (schema_version='eio_v1') for the next article.", "",
                        "ALLOWED ENUMS:", JSON.stringify({
                                    narrative_positioning: { authority_level: [...EIO_ENUMS.authority_level], contrarian_degree: [...EIO_ENUMS.contrarian_degree], risk_profile: [...EIO_ENUMS.risk_profile] },
                                    wow_execution_plan: { primary_angle: [...EIO_ENUMS.primary_angle], narrative_hook: [...EIO_ENUMS.narrative_hook], framework_style: [...EIO_ENUMS.framework_style], proof_type: [...EIO_ENUMS.proof_type], voice_micro_style: [...EIO_ENUMS.voice_micro_style] },
                                    success_definition: { primary_intent: [...EIO_ENUMS.primary_intent] },
                        }, null, 2), "",
                        `Business name: ${String(businessName || "this business")}`,
                        `Context quality: ${String(context_quality || "low")}`,
                        context_quality_reason ? `Context quality reason: ${context_quality_reason}` : "", "",
                        "URLS:", JSON.stringify(urls || {}, null, 2), "",
                        "EXCERPTS:", JSON.stringify(excerpts || {}, null, 2), "",
                        priorDraftsContext || "", "", editorialBriefBlock || "", "",
                        wowStandardMeta ? `WOW Standard Meta: ${wowStandardMeta}` : "",
                        wowStandardJson ? "WOW Standard JSON:\n" + String(wowStandardJson).slice(0, 12000) : "", "",
                        override_prompt ? "OVERRIDE PROMPT:\n" + String(override_prompt).slice(0, 4000) : "", "",
                        "HARD RULES:", "- Output JSON only", "- schema_version must be exactly eio_v1",
                        "- what_not_to_say / avoid_topics / avoid_claims / tone_constraints / must_include must each have >=2 items",
                      ].filter(Boolean).join("\n");
              const txt = await generateMarkdownWithAI({ env, prompt, system });
              const obj = extractFirstJsonObject(txt);
              const err = validateEIO(obj);
              if (err) throw new Error(err);
              return obj;
      } catch (e) {
              console.log("EIPW_FAIL_OPEN", String(e?.message || e));
              return fallback;
      }
};

// ============================================================
// EDITORIAL DIVERSITY ENFORCEMENT
// ============================================================
async function enforceEditorialDiversity({ env, location_id, eio }) {
      try {
              const loc = String(location_id || "").trim();
              if (!loc || !eio) return eio;
              const rs = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT content_markdown FROM blog_drafts
                          WHERE location_id LIKE ? AND length(location_id) = ? AND lower(status) = 'approved'
                                ORDER BY datetime(approved_at) DESC, datetime(updated_at) DESC LIMIT 3
                                    `).bind(loc, loc.length).all();
              const rows = rs?.results || [];
              if (rows.length < 3) return eio;
              const parseFp = (md) => {
                        const m = String(md || "").match(/<!--\s*eio_fingerprint:\s*(\{[\s\S]*?\})\s*-->/);
                        if (!m) return null;
                        try { return JSON.parse(m[1]); } catch { return null; }
              };
              const fps = rows.map((r) => parseFp(r.content_markdown)).filter(Boolean);
              if (fps.length < 3) return eio;
              const triple = (fp) => [
                        String(fp.primary_angle || "").trim().toLowerCase(),
                        String(fp.narrative_hook || "").trim().toLowerCase(),
                        String(fp.framework_style || "").trim().toLowerCase(),
                      ].join("||");
              const uniq = new Set(fps.map(triple));
              if (uniq.size !== 1) return eio;
              const wp = eio.wow_execution_plan || {};
              const pickDifferent = (set, current) => {
                        for (const v of set) {
                                    if (String(v).trim() && String(v).trim() !== String(current).trim()) return v;
                        }
                        return current;
              };
              let changed = false;
              const nf = pickDifferent(EIO_ENUMS.framework_style, wp.framework_style);
              if (nf !== wp.framework_style) { wp.framework_style = nf; changed = true; }
              if (!changed) { const np = pickDifferent(EIO_ENUMS.proof_type, wp.proof_type); if (np !== wp.proof_type) { wp.proof_type = np; changed = true; } }
              if (!changed) { const nh = pickDifferent(EIO_ENUMS.narrative_hook, wp.narrative_hook); if (nh !== wp.narrative_hook) { wp.narrative_hook = nh; changed = true; } }
              if (changed) {
                        eio.wow_execution_plan = wp;
                        eio.wow_execution_plan.reasoning = String(eio.wow_execution_plan.reasoning || "") + " | diversity_enforced: saturated_last_3";
              }
              return eio;
      } catch (e) {
              console.log("DIVERSITY_ENFORCE_FAIL_OPEN", { error: String(e?.message || e) });
              return eio;
      }
}

// ============================================================
// PRIOR DRAFTS CONTEXT (anti-repetition)
// ============================================================
async function getPriorDraftsContext(env, location_id, exclude_draft_id, limit = 6) {
      try {
              const rows = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT draft_id, title, content_markdown, created_at FROM blog_drafts
                          WHERE location_id LIKE ? AND length(location_id) = ? AND draft_id != ?
                                ORDER BY datetime(created_at) DESC LIMIT ?
                                    `).bind(String(location_id || ""), String(location_id || "").length, String(exclude_draft_id || ""), Number(limit)).all();
              const list = (rows?.results || []).map((r) => {
                        const title = String(r.title || "").trim() || "(untitled)";
                        const md = String(r.content_markdown || "").trim();
                        const isPlaceholder = md.includes("This is a placeholder draft (no AI yet).") || md.length < 80;
                        const excerptRaw = md.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "")
                          .replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim();
                        const excerpt = excerptRaw.slice(0, 220);
                        if (!excerpt || isPlaceholder) return null;
                        return `- ${title}\n  Excerpt: ${excerpt}${excerptRaw.length > 220 ? "\u2026" : ""}`;
              }).filter(Boolean);
              if (!list.length) return "";
              return ["PRIOR DRAFTS (avoid repeating these topics/angles):", ...list, "",
                            "Instruction: Do NOT repeat the same topic/angle. Choose a fresh angle or a new subtopic."].join("\n");
      } catch { return ""; }
}

// ============================================================
// ============================================================
//   PHASE 2 — EXPORTED HANDLER IMPLEMENTATIONS
// ============================================================
// ============================================================

// ---------- Businesses ----------
export async function listBusinesses(ctx) {
      const { env, request } = ctx;
      const url = new URL(request.url);
      const includeInactive = (url.searchParams.get("include_inactive") || "") === "1";
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10), 1), 1000);
      const where = [];
      const binds = [];
      if (!includeInactive) where.push("b.is_active = 1");
      if (q) {
              where.push(`(lower(b.business_name_raw) LIKE ? OR lower(b.business_name_canon) LIKE ? OR lower(b.abn) LIKE ? OR lower(b.location_id) LIKE ?)`);
              const like = `%${q}%`;
              binds.push(like, like, like, like);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const sql = `
          SELECT b.location_id, b.business_name_raw, b.abn, b.master_contact_id,
                b.is_active, b.source, b.last_synced_from_ghl_at,
                      CASE WHEN p.enabled = 1 THEN 1 ELSE 0 END AS program_enabled,
                            COALESCE(p.run_mode, 'manual') AS program_run_mode,
                                  p.notes AS program_notes, p.added_at AS program_added_at
                                      FROM businesses b
                                          LEFT JOIN blog_program_locations p ON p.location_id = b.location_id
                                              ${whereSql}
                                                  ORDER BY program_enabled DESC, b.is_active DESC, b.updated_at DESC
                                                      LIMIT ${limit}
                                                        `;
      const res = await env.GNR_MEDIA_BUSINESS_DB.prepare(sql).bind(...binds).all();
      return jsonResponse(ctx, { ok: true, include_inactive: includeInactive, q: q || null, limit, rows: res.results || [] });
}

// ---------- Draft spine ----------
export async function createDraftForLocation(ctx, locationid) {
      const { env } = ctx;
      const inputNorm = normaliseLocationId(locationid);
      if (!inputNorm) {
              return errorResponse(ctx, "location_id required", 400, { debug: { raw: locationid, raw_hex: toHex(locationid) } });
      }
      const enabledRow = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          SELECT location_id, enabled FROM blog_program_locations
              WHERE enabled = 1 AND location_id LIKE ? AND length(location_id) = ? LIMIT 1
                `).bind(inputNorm, inputNorm.length).first();
      if (!enabledRow) {
              const sample = await env.GNR_MEDIA_BUSINESS_DB.prepare(
                        `SELECT location_id, enabled, hex(location_id) AS hexval FROM blog_program_locations ORDER BY added_at DESC LIMIT 10`
                      ).all();
              return errorResponse(ctx, "location_id not enabled for blog program", 400, {
                        debug: { input_norm: inputNorm, input_norm_hex: toHex(inputNorm), db_sample: sample.results || [] },
              });
      }
      const draft_id = crypto.randomUUID();
      const biz = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          SELECT business_name_raw FROM businesses WHERE location_id LIKE ? AND length(location_id) = ? LIMIT 1
            `).bind(inputNorm, inputNorm.length).first();
      const businessName = biz?.business_name_raw || inputNorm;
      const title = `Draft article for ${businessName}`;
      const content_md = `# ${title}\n\nThis is a placeholder draft (no AI yet).\n\nBusiness: ${businessName}\n`;
      await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          INSERT INTO blog_drafts (draft_id, location_id, status, title, content_markdown) VALUES (?, ?, ?, ?, ?)
            `).bind(draft_id, inputNorm, DRAFT_STATUS.DRAFTING, title, content_md).run();
      return jsonResponse(ctx, { ok: true, draft_id, location_id: inputNorm, status: "drafting" });
}

export async function getDraftById(ctx, draftid) {
      const { env } = ctx;
      const draft_id = String(draftid || "").trim();
      if (!draft_id) return errorResponse(ctx, "draft_id required", 400);
      const row = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          SELECT draft_id, location_id, status, title, content_markdown, content_html,
                context_quality, context_quality_reason, final_url,
                      created_at, updated_at, approved_at, approved_by_email, editorial_intelligence_json
                          FROM blog_drafts WHERE draft_id = ? LIMIT 1
                            `).bind(draft_id).first();
      if (!row) return errorResponse(ctx, "Draft not found", 404, { draft_id });
      return jsonResponse(ctx, { ok: true, draft: row });
}

export async function renderDraftHtml(ctx, draftid, token = "") {
      const { env } = ctx;
      const draft_id = String(draftid || "").trim();
      if (!draft_id) return errorResponse(ctx, "draft_id required", 400);
      const row = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          SELECT draft_id, title, location_id, content_markdown, updated_at
              FROM blog_drafts WHERE draft_id = ? LIMIT 1
                `).bind(draft_id).first();
      if (!row) return new Response("<h1>Draft not found</h1>", { status: 404, headers: { "content-type": "text/html" } });

   // OPTION B: if token (t=) is present and matches this draft, prefer client_content_markdown.
  let chosenMarkdown = String(row.content_markdown || "");

  const t = String(token || "").trim();
  if (t) {
    try {
      const { error, row: reviewRow } = await getReviewRowByToken(ctx, t);
      if (!error && reviewRow && String(reviewRow.draft_id || "").trim() === draft_id) {
        const clientMd = String(reviewRow.client_content_markdown || "");
        if (clientMd.trim()) chosenMarkdown = clientMd;
      }
    } catch (e) {
      console.log("RENDER_TOKEN_OVERRIDE_FAIL_OPEN", { draft_id, error: String(e?.message || e) });
    }
  }

  const md = visualCommentsToTokens(stripInternalTelemetryComments(chosenMarkdown));

      let bodyHtml = "";
      try { bodyHtml = markdownToHtml(md); } catch (e) {
              bodyHtml = `<pre style="white-space:pre-wrap;">${escapeHtml(md)}</pre>`;
      }

  const assets = await getDraftAssetsMap(env, draft_id);
      bodyHtml = replaceVisualTokensInHtml(bodyHtml, (kind) => {
              const url = String(assets?.[kindToAssetKey(kind)] || "").trim();
              if (url) {
                        const labelMap = { hero: "Hero image", "infographic-summary": "Infographic summary", "process-diagram": "Process diagram", "proof-chart": "Proof chart", "pull-quote-graphic": "Pull quote graphic", "cta-banner": "CTA banner" };
                        const label = labelMap[kind] || `Visual: ${kind}`;
                        return `<figure class="gnr-visual gnr-${kind}"><img class="gnr-img" src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" /></figure>`;
              }
              const block = (k, l) => `<section class="gnr-visual gnr-${k}"><div class="gnr-visual-inner"><div class="gnr-visual-label">${l}</div><div class="gnr-visual-note">This will be auto-generated (or uploaded) by the platform.</div></div></section>`;
              const map = { hero: block("hero", "Hero image"), "infographic-summary": block("infographic", "Infographic summary"), "process-diagram": block("diagram", "Process diagram"), "proof-chart": block("chart", "Proof chart"), "pull-quote-graphic": block("quote", "Pull quote graphic"), "cta-banner": block("cta", "CTA banner") };
              return map[kind] || block("visual", `Visual: ${kind}`);
      });

  const title = escapeHtml(String(row.title || "Draft article").trim());
      const full = `<!doctype html>
      <html><head>
      <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
      <title>${title}</title>
      <style>
      :root{--ink:#111;--muted:#666;--paper:#fff;--wash:#f6f6f6;--line:#e6e6e6;--radius:16px}
      body{margin:0;background:var(--wash);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.55}
      .gnr-wrap{max-width:880px;margin:0 auto;padding:32px 16px 60px}
      .gnr-article{background:var(--paper);border:1px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:0 18px 55px rgba(0,0,0,.08)}
      .gnr-head{padding:34px 34px 10px}.gnr-head h1{margin:0 0 10px;font-family:"Playfair Display",Georgia,serif;font-weight:700;letter-spacing:-0.02em;line-height:1.08;font-size:44px}
      .gnr-sub{color:var(--muted);font-size:15px;margin:0 0 18px}
      .gnr-body{padding:10px 34px 34px}.gnr-body h2{font-family:"Playfair Display",Georgia,serif;font-size:28px;letter-spacing:-0.01em;margin:28px 0 10px}
      .gnr-body h3{font-size:18px;margin:20px 0 8px}.gnr-body p{margin:10px 0;font-size:17px}
      .gnr-body blockquote{margin:18px 0;padding:14px 16px;border-left:4px solid #111;background:#fafafa;border-radius:12px;color:#222}
      .gnr-body ul{margin:12px 0 12px 20px}
      .gnr-visual{margin:22px 0;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(180deg,#fff,#fbfbfb);overflow:hidden}
      .gnr-img{width:100%;height:auto;display:block}
      .gnr-visual-inner{padding:18px 18px 16px}.gnr-visual-label{font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#111;margin-bottom:6px}
      .gnr-visual-note{font-size:14px;color:var(--muted)}.gnr-hero{min-height:260px}
      @media(max-width:720px){.gnr-head{padding:24px 18px 6px}.gnr-body{padding:8px 18px 22px}.gnr-head h1{font-size:34px}.gnr-body p{font-size:16px}.gnr-body h2{font-size:24px}}
      </style></head><body>
      <div class="gnr-wrap"><article class="gnr-article">
      <header class="gnr-head"><h1>${title}</h1><p class="gnr-sub">Generic Published View A</p></header>
      <div class="gnr-body">${bodyHtml}</div>
      </article></div></body></html>`;
      return new Response(full.trim(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- Generate AI Content ----------
export async function generateAiForDraft(ctx, draftid, options = {}) {
      const { env } = ctx;
      const draft_id = String(draftid || "").trim();
      const force = options.force === true || String(options.force || "").trim().toLowerCase() === "true" || String(options.force || "").trim() === "1";
      const override_prompt = String(options.override_prompt || "").trim() || null;
      if (!draft_id) return errorResponse(ctx, "draft_id required", 400);

  const draft = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      SELECT d.draft_id, d.location_id, d.status, d.title, d.content_markdown, d.content_html,
            EXISTS (SELECT 1 FROM blog_draft_reviews r WHERE r.draft_id = d.draft_id
                    AND r.client_content_markdown IS NOT NULL AND length(r.client_content_markdown) > 0
                          ) AS has_client_edits
                              FROM blog_drafts d WHERE d.draft_id = ? LIMIT 1
                                `).bind(draft_id).first();
      if (!draft) return errorResponse(ctx, "Draft not found", 404, { draft_id });

  if (draft.has_client_edits) {
          return errorResponse(ctx, "AI generation blocked: client has submitted final content for this draft.", 409, { draft_id: draft.draft_id });
  }

  const blockedStatuses = new Set([DRAFT_STATUS.REVIEW_LINK_ISSUED, DRAFT_STATUS.APPROVED, DRAFT_STATUS.REJECTED]);
      if (blockedStatuses.has(String(draft.status || ""))) {
              return errorResponse(ctx, "AI generation is blocked for drafts in review/approved/rejected states.", 409, { status: draft.status });
      }

  // Idempotency check
  if (!force && draft.content_markdown && String(draft.content_markdown).includes("<!-- AI_GENERATED -->")) {
          const heroExists = await hasHeroAsset(env, draft.draft_id);
          if (!heroExists) {
                    try { await autoGenerateVisualsForDraft(env, draft.draft_id); } catch (e) {
                                console.log("AUTO_VISUALS_FAIL_ON_ALREADY_GENERATED", { draft_id: draft.draft_id, error: String(e?.message || e) });
                    }
          }
          return jsonResponse(ctx, { ok: true, action: heroExists ? "already_generated" : "already_generated_hero_generated", draft_id: draft.draft_id, location_id: draft.location_id, status: draft.status, hero_exists: heroExists });
  }

  // Business context
  const biz = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      SELECT business_name_raw, marketing_passport_url, website_url, blog_url
          FROM businesses WHERE location_id LIKE ? AND length(location_id) = ? LIMIT 1
            `).bind(String(draft.location_id || ""), String(draft.location_id || "").length).first();
      const businessName = biz?.business_name_raw || "this business";

  // Latest client guidance
  let latestGuidance = null;
      try {
              latestGuidance = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT follow_emphasis, follow_avoid, client_topic_suggestions, decided_at
                          FROM blog_draft_reviews WHERE location_id LIKE ? AND length(location_id) = ? AND status = 'ACCEPTED'
                                ORDER BY datetime(decided_at) DESC LIMIT 1
                                    `).bind(String(draft.location_id || ""), String(draft.location_id || "").length).first();
      } catch { latestGuidance = null; }

  const guidanceBlock = (latestGuidance && (
          String(latestGuidance.follow_emphasis || "").trim() ||
          String(latestGuidance.follow_avoid || "").trim() ||
          String(latestGuidance.client_topic_suggestions || "").trim()
        )) ? [
          "CLIENT GUIDANCE (MOST RECENT \u2014 MUST APPLY):",
          latestGuidance.decided_at ? `Decided at: ${latestGuidance.decided_at}` : "",
          String(latestGuidance.follow_emphasis || "").trim() ? `Emphasise: ${String(latestGuidance.follow_emphasis).trim()}` : "",
          String(latestGuidance.follow_avoid || "").trim() ? `Avoid: ${String(latestGuidance.follow_avoid).trim()}` : "",
          String(latestGuidance.client_topic_suggestions || "").trim() ? `Future topics/direction: ${String(latestGuidance.client_topic_suggestions).trim()}` : "",
          "", "Hard rules:", "- Follow 'Avoid' strictly.", "- Use 'Emphasise' to shape tone/angle/examples.", "",
        ].filter(Boolean).join("\n") : "";

  // Context quality + fetched excerpts
  const mpUrl = String(biz?.marketing_passport_url || "").trim();
      const siteUrl = String(biz?.website_url || "").trim();
      const blogUrl = String(biz?.blog_url || "").trim();
      const mpText = mpUrl ? await fetchContextText(mpUrl, { maxChars: 7000 }) : "";
      const siteText = !mpText && siteUrl ? await fetchContextText(siteUrl, { maxChars: 7000 }) : "";
      const blogText = blogUrl ? await fetchContextText(blogUrl, { maxChars: 5000 }) : "";

  let context_quality = "low", context_quality_reason = "no_sources";
      const mpOk = !!(mpUrl && mpText && mpText.length >= 250);
      if (mpOk) { context_quality = "high"; context_quality_reason = "marketing_passport_ok"; }
      else if (mpUrl && !mpOk) {
              context_quality = (siteUrl || blogUrl || siteText || blogText) ? "medium" : "low";
              context_quality_reason = (siteUrl || blogUrl || siteText || blogText) ? "marketing_passport_unreadable" : "marketing_passport_unreadable_no_other_sources";
      } else if (siteUrl || blogUrl || siteText || blogText) {
              context_quality = "medium"; context_quality_reason = "marketing_passport_missing";
      }

  // Prior drafts + editorial intelligence
  const priorDraftsContext = await getPriorDraftsContext(env, draft.location_id, draft.draft_id, Number(env.PRIOR_DRAFTS_LIMIT || 6));

  let editorialState = null;
      try {
              editorialState = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT dominant_topics_json, overused_topics_json, missing_topics_json,
                            authority_score, content_entropy, tone_drift, last_recomputed_at
                                  FROM editorial_state WHERE location_id = ? LIMIT 1
                                      `).bind(String(draft.location_id || "").trim()).first();
      } catch { editorialState = null; }

  const dominantTopics = editorialState?.dominant_topics_json ? safeJsonParse(editorialState.dominant_topics_json, []) : [];
      const overusedTopics = editorialState?.overused_topics_json ? safeJsonParse(editorialState.overused_topics_json, []) : [];
      const missingTopics = editorialState?.missing_topics_json ? safeJsonParse(editorialState.missing_topics_json, []) : [];

  const editorialBriefBlock = (dominantTopics.length || overusedTopics.length || missingTopics.length) ? [
          "EDITORIAL INTELLIGENCE (PLATFORM MEMORY \u2014 MUST OBEY):",
          dominantTopics.length ? `Dominant topics (OK, but don't repeat): ${dominantTopics.join(", ")}` : "",
          overusedTopics.length ? `Overused topics (AVOID for this new article): ${overusedTopics.join(", ")}` : "",
          missingTopics.length ? `Missing topics (PREFER if relevant): ${missingTopics.join(", ")}` : "",
          "", "Hard rules:", "- Do NOT use any overused topics as H2 headings.",
          "- Do NOT reuse the same structure/angle as the last drafts.", "- If missing topics exist, choose 1\u20132 and build the article around them.", "",
        ].filter(Boolean).join("\n") : "";

  const contextBlock = [
          "BUSINESS CONTEXT (use this as the primary source of truth):",
          `Business name: ${businessName}`,
          mpUrl ? `Marketing Passport URL: ${mpUrl}` : "Marketing Passport URL: (not provided)",
          siteUrl ? `Website URL: ${siteUrl}` : "Website URL: (not provided)",
          blogUrl ? `Blog URL: ${blogUrl}` : "Blog URL: (not provided)", "",
          mpText ? `Marketing Passport excerpt:\n${mpText}` : "",
          siteText ? `Website excerpt:\n${siteText}` : "",
          blogText ? `Blog excerpt:\n${blogText}` : "",
          guidanceBlock || "", priorDraftsContext || "",
        ].filter(Boolean).join("\n\n");

  // WOW Standard
  const WOW_STANDARD_KEY = String(env.CONTENT_STANDARD_KEY || "GNR_WOW_ARTICLE_STANDARD").trim();
      let wowStandardRow = null;
      try {
              wowStandardRow = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                    SELECT standard_key, version, json_spec FROM content_standards
                          WHERE standard_key = ? AND status = 'active' LIMIT 1
                              `).bind(WOW_STANDARD_KEY).first();
      } catch { wowStandardRow = null; }
      const wowStandardMeta = wowStandardRow?.standard_key ? `${wowStandardRow.standard_key} v${wowStandardRow.version || ""}`.trim() : "";
      const wowStandardJson = wowStandardRow?.json_spec ? String(wowStandardRow.json_spec) : "";
      const wowBlock = wowStandardJson ? [
              "GNR WOW ARTICLE STANDARD (MUST FOLLOW EXACTLY):", wowStandardMeta ? `Standard: ${wowStandardMeta}` : "", wowStandardJson, "",
            ].filter(Boolean).join("\n") : "";

  // EIPW + diversity enforcement
  const eio = await runEditorialPrewrite({
          env, businessName, context_quality, context_quality_reason,
          urls: { marketing_passport_url: mpUrl || null, website_url: siteUrl || null, blog_url: blogUrl || null },
          excerpts: { marketing_passport_excerpt: mpText ? mpText.slice(0, 5000) : "", website_excerpt: siteText ? siteText.slice(0, 5000) : "", blog_excerpt: blogText ? blogText.slice(0, 3500) : "" },
          priorDraftsContext, editorialBriefBlock, wowStandardMeta, wowStandardJson, override_prompt,
  });
      const eioEnforced = await enforceEditorialDiversity({ env, location_id: draft.location_id, eio });
      const eioJson = JSON.stringify(eioEnforced || null);

  // EIO fingerprint
  const normFp = (v) => String(v || "").trim().toLowerCase();
      const wp = eioEnforced?.wow_execution_plan || {};
      const np = eioEnforced?.narrative_positioning || {};
      const sd = eioEnforced?.success_definition || {};
      const eioFingerprint = {
              schema_version: "eio_fingerprint_v1", generated_at_utc: nowIso(),
              primary_angle: normFp(wp.primary_angle), narrative_hook: normFp(wp.narrative_hook),
              framework_style: normFp(wp.framework_style), proof_type: normFp(wp.proof_type),
              voice_micro_style: normFp(wp.voice_micro_style), authority_level: normFp(np.authority_level),
              primary_intent: normFp(sd.primary_intent), wow_score_target: Number(sd.wow_score_target ?? 0) || 0,
      };
      const eioFingerprintJson = JSON.stringify(eioFingerprint);

  const eioBlock = [
          "EDITORIAL INTELLIGENCE PRE-WRITE (EIO \u2014 MUST OBEY):", JSON.stringify(eioEnforced, null, 2), "",
          "Hard rules:", "- The article MUST follow the EIO decisions.", "- The article MUST respect guardrails.", "",
        ].join("\n");

  const system = [
          "You are an expert marketing blog writer for GNR Media.",
          "Write in Australian English.", "Output MUST be Markdown only.",
          "No hype. Clear, helpful, practical.", "Avoid making legal/financial promises.",
          "Do not mention 'AI' or 'ChatGPT'.",
          "You MUST follow the GNR WOW ARTICLE STANDARD provided in the prompt.",
        ].join(" ");

  const draftTitleHint = String(draft?.title || "").trim() || `Marketing foundations for ${businessName}`;
      const defaultPrompt = `Create a premium, editorial-grade blog article for ${businessName}.

      ${contextBlock}

      ${editorialBriefBlock}

      ${eioBlock}

      ${wowBlock}

      Important:
      - Use the BUSINESS CONTEXT excerpts above to tailor the article to this business.
      - If the excerpts are thin, keep claims conservative.
      - Follow the GNR WOW ARTICLE STANDARD exactly.

      Non-negotiable output contract (Markdown only):
      1) Title (H1)
      2) Immediately under H1 include: <!-- VISUAL:hero -->
      3) Intro (2 short paragraphs, no heading)
      4) No TL;DR, no summary, no recap, no key takeaways (ban list).
      5) 4\u20136 sections with H2 headings
      6) At least 3 "Amazement Moments"
      7) One practical checklist
      8) 3\u20135 FAQ questions
      9) Short premium CTA at the end
      10) Keep it evergreen
      11) Length: ~900\u20131200 words
      12) Markdown only. No HTML. No code fences.

      Draft title hint: "${draftTitleHint}"`;

  const prompt = override_prompt || defaultPrompt;
      let md;
      try {
              md = await generateMarkdownWithAI({ env, prompt, system });
      } catch (e) {
              return errorResponse(ctx, "AI generation failed", 502, { detail: String(e?.message || e) });
      }

  const finalMd = `<!-- AI_GENERATED -->\n<!-- generated_at: ${nowIso()} -->\n`
        + (wowStandardMeta ? `<!-- wow_standard: ${wowStandardMeta} -->\n` : "")
        + `<!-- eio_fingerprint: ${eioFingerprintJson} -->\n\n` + md.trim() + "\n";
      const finalHtml = markdownToHtml(stripInternalTelemetryComments(finalMd));

  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_drafts SET content_markdown = ?, content_html = ?, status = ?,
            context_quality = ?, context_quality_reason = ?, editorial_intelligence_json = ?,
                  updated_at = datetime('now') WHERE draft_id = ?
                    `).bind(finalMd, finalHtml, DRAFT_STATUS.AI_VISUALS_GENERATED, context_quality, context_quality_reason, eioJson, draft.draft_id).run();

  // Persist fingerprint (fail-open)
  try {
          await env.GNR_MEDIA_BUSINESS_DB.prepare(`
                INSERT INTO editorial_fingerprints (draft_id, location_id, fingerprint_json, created_at)
                      VALUES (?, ?, ?, datetime('now'))
                            ON CONFLICT(draft_id) DO UPDATE SET fingerprint_json = excluded.fingerprint_json, location_id = excluded.location_id, created_at = datetime('now')
                                `).bind(String(draft.draft_id), String(draft.location_id), JSON.stringify(eioFingerprint)).run();
  } catch (e) {
          console.log("FINGERPRINT_PERSIST_FAIL_OPEN", { draft_id: draft.draft_id, error: String(e?.message || e) });
  }

  // Auto-generate visuals (fail-open)
  try { await autoGenerateVisualsForDraft(env, draft.draft_id); } catch (e) {
          console.log("AUTO_VISUALS_FAIL_SYNC", { draft_id: draft.draft_id, error: String(e?.message || e) });
  }

  return jsonResponse(ctx, { ok: true, action: "generated", draft_id: draft.draft_id, location_id: draft.location_id, status: DRAFT_STATUS.AI_VISUALS_GENERATED });
}

// ============================================================
// Remaining handler stubs (Phase 3+)
// ============================================================

// ---------- Core admin actions ----------
export async function runNowForLocation(_ctx, locationid) {
      // TODO: implement
}

export async function listDraftsForLocation(ctx, locationid, limit = 20) {
  const { env } = ctx;

  const loc = normaliseLocationId(locationid);
  const lim = Math.min(Math.max(parseInt(String(limit || "20"), 10) || 20, 1), 200);

  if (!loc) return errorResponse(ctx, "location_id required", 400);

  // Draft history (latest first). Include status so UI can label rows.
  const rs = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    SELECT
      draft_id,
      location_id,
      status,
      title,
      created_at,
      updated_at,
      approved_at
    FROM blog_drafts
    WHERE location_id LIKE ? AND length(location_id) = ?
    AND deleted_at IS NULL
    ORDER BY
      datetime(approved_at) DESC,
      datetime(updated_at) DESC,
      datetime(created_at) DESC
    LIMIT ?
  `).bind(loc, loc.length, lim).all();

  return jsonResponse(ctx, { ok: true, location_id: loc, limit: lim, drafts: rs?.results || [] });
}


// ---------- Draft asset management ----------
export async function upsertDraftAsset(ctx, draftid, key, assetData) {
        const { env } = ctx;
      
        const draft_id = String(draftid || "").trim();
        if (!draft_id) return errorResponse(ctx, "draft_id required", 400);
      
        const rawKey = String(key || "").trim();
        if (!rawKey) return errorResponse(ctx, "key required", 400);
      
        // Accept "hero" or "infographic-summary" etc, normalize to D1 visual_key format
        const visual_key = kindToAssetKey(rawKey); // uses underscores, lowercase
      
        if (!VISUAL_KINDS.includes(visual_key)) {
                  return errorResponse(ctx, "invalid key", 400, {
                              allowed: VISUAL_KINDS,
                              received: rawKey,
                              normalized: visual_key,
                  });
        }
      
        const image_url = String(assetData?.image_url || assetData?.url || "").trim();
        if (!image_url) return errorResponse(ctx, "asset_data.image_url required", 400);
      
        // Validate draft exists
        const exists = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
            SELECT draft_id FROM blog_drafts WHERE draft_id = ? LIMIT 1
              `).bind(draft_id).first();
      
        if (!exists?.draft_id) return errorResponse(ctx, "Draft not found", 404, { draft_id });
      
        const provider = String(assetData?.provider || "admin").trim();
        const asset_type = String(assetData?.asset_type || "image").trim();
        const prompt = assetData?.prompt ? String(assetData.prompt).trim() : null;
        const status = String(assetData?.status || "ready").trim();
      
        const out = await upsertDraftAssetRow(env, {
                  draft_id,
                  visual_key,
                  image_url,
                  provider,
                  asset_type,
                  prompt,
                  status,
        });
      
        if (!out?.ok) {
          return errorResponse(ctx, out?.error || "upsert_failed", 400, { ...out });
        }
      
        return jsonResponse(ctx, { ok: true, ...out, draft_id, visual_key });
}

// ---------- Review flow ----------
export async function createReviewLink(ctx, draftid, clientemail = null) {
  const { env, request } = ctx;

  // Admin auth
  const admin = requireAdmin(ctx);
  if (admin instanceof Response) return admin;

  const draft_id = String(draftid || "").trim();
  if (!draft_id) return errorResponse(ctx, "draft_id required", 400);

  // Load draft (need location_id for review row)
  const draft = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    SELECT draft_id, location_id, status
      FROM blog_drafts
     WHERE draft_id = ?
     LIMIT 1
  `).bind(draft_id).first();

  if (!draft?.draft_id) return errorResponse(ctx, "Draft not found", 404, { draft_id });

  // Block if already approved/published (keeps lifecycle clean)
  // Return published_url so Admin UI can still open the canonical renderer.
  const st = String(draft.status || "").toLowerCase();
  if (st === "approved" || st === "published") {
    const apiOrigin = new URL(request.url).origin;
    const published_url =
      `${apiOrigin}/api/blog/draft/render/${encodeURIComponent(draft_id)}?view=generic`;

    return errorResponse(
      ctx,
      "Review link not allowed for approved/published drafts",
      409,
      { status: draft.status, action: "use_published_url", published_url }
    );
  }



  // Generate token (base64url-ish)
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");


  // SHA-256 hash token for storage
  const { primary: token_hash } = await tokenHashCompat(env, token);


  // TTL (hours)
  const ttlHours = Math.min(
    Math.max(parseInt(String(env.REVIEW_TOKEN_TTL_HOURS || "168"), 10) || 168, 1),
    24 * 30 // cap 30 days
  );

  // Persist review row (schema-tolerant to extra columns)
  const review_id = crypto.randomUUID();
  const email = clientemail ? String(clientemail).trim().toLowerCase() : null;

  // Status: ISSUED (matches your lifecycle semantics)
  const status = "ISSUED";

  // Write
  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    INSERT INTO blog_draft_reviews (
      review_id, draft_id, location_id, token_hash, expires_at, status, client_email, created_at
    ) VALUES (
      ?, ?, ?, ?, datetime('now', ?), ?, ?, datetime('now')
    )
  `).bind(
    review_id,
    draft_id,
    String(draft.location_id || ""),
    token_hash,
    `+${ttlHours} hours`,
    status,
    email
  ).run();

  // Build review URL
  // Prefer explicit override, otherwise use the calling Admin UI Origin
  const overrideBase = String(env.PUBLIC_REVIEW_BASE || "").trim();

  const originHeader = request.headers.get("Origin");
  const originBase =
    originHeader && CORS_ALLOWED_ORIGINS.has(originHeader)
      ? originHeader
      : null;

  const base = overrideBase || originBase || new URL(request.url).origin;

  const review_url = `${String(base).replace(/\/+$/g, "")}/review?t=${encodeURIComponent(token)}`;




  // Provide exact expiry (ISO) for UI display + keep hours for compatibility
  const expires_at = new Date(Date.now() + (ttlHours * 60 * 60 * 1000)).toISOString();

  return jsonResponse(ctx, {
    ok: true,
    review_id,
    draft_id,
    location_id: draft.location_id,
    review_url,
    expires_at,            // <-- NEW: ISO string
    expires_at_hours: ttlHours,
  });

}

// ------------------------------------------------------------
// REVIEW HELPERS
// ------------------------------------------------------------
async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s || "")));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function tokenHashCompat(env, token) {
  const t = String(token || "").trim();
  if (!t) return { primary: "", fallbacks: [] };

  // Legacy scheme (preferred if pepper exists)
  const pepper = String(env?.REVIEW_TOKEN_PEPPER || "").trim();
  if (pepper) {
    const v1 = await sha256Hex(`v1|${pepper}|${t}`);
    const plain = await sha256Hex(t);
    return { primary: v1, fallbacks: [plain] };
  }

  // No pepper: plain SHA256(token)
  const plain = await sha256Hex(t);
  return { primary: plain, fallbacks: [] };
}

async function getReviewRowByToken(ctx, token) {
  const { env } = ctx;
  const t = String(token || "").trim();
  if (!t) return { error: errorResponse(ctx, "token required", 400) };

  const { primary, fallbacks } = await tokenHashCompat(env, t);
  const hashes = [primary, ...(fallbacks || [])].filter(Boolean);

  if (!hashes.length) {
    return { error: errorResponse(ctx, "token required", 400) };
  }

  const row = await env.GNR_MEDIA_BUSINESS_DB.prepare(`


  SELECT *
    FROM blog_draft_reviews
   WHERE token_hash IN (${hashes.map(() => "?").join(",")})
   LIMIT 1
`).bind(...hashes).first();

const token_hash = primary; // canonical hash for downstream updates


  if (!row) return { error: errorResponse(ctx, "Review token not found", 404) };

  // Expiry check (fail closed)
  try {
    const raw = String(row.expires_at || "").trim();
    if (raw) {
      const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
      const exp = new Date(iso);
      if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
        return { error: errorResponse(ctx, "Review token expired", 410) };
      }
    }
  } catch (_) {}

  return { row, token_hash };
}

function normFollow(obj = {}) {
  const o = (obj && typeof obj === "object") ? obj : {};
  const pick = (v) => (v === undefined ? null : (v === null ? "" : String(v)));
  return {
    follow_emphasis: pick(o.follow_emphasis ?? o.emphasis),
    follow_avoid: pick(o.follow_avoid ?? o.avoid),
    client_topic_suggestions: pick(o.client_topic_suggestions ?? o.topic_suggestions ?? o.suggestions),
  };
}

// ------------------------------------------------------------
// REVIEW: Save edits (does NOT approve)
// ------------------------------------------------------------
export async function saveReviewEdits(ctx, token, content_markdown, follow = {}) {
  const { env } = ctx;

  const { error, row, token_hash } = await getReviewRowByToken(ctx, token);
  if (error) return error;

  const md = String(content_markdown || "");
  const f = normFollow(follow);

  // Schema-tolerant update (full fields if present; fallback to md only)
  try {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_draft_reviews
         SET client_content_markdown = ?,
             follow_emphasis = CASE WHEN ? IS NULL THEN follow_emphasis ELSE ? END,
             follow_avoid = CASE WHEN ? IS NULL THEN follow_avoid ELSE ? END,
             client_topic_suggestions = CASE WHEN ? IS NULL THEN client_topic_suggestions ELSE ? END,
             updated_at = datetime('now')
       WHERE token_hash = ?
    `).bind(
      md,
      f.follow_emphasis, f.follow_emphasis,
      f.follow_avoid, f.follow_avoid,
      f.client_topic_suggestions, f.client_topic_suggestions,
      token_hash
    ).run();
  } catch (e) {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_draft_reviews
         SET client_content_markdown = ?,
             updated_at = datetime('now')
       WHERE token_hash = ?
    `).bind(md, token_hash).run();
  }

  return jsonResponse(ctx, { ok: true, action: "saved", draft_id: row.draft_id });
}

// ------------------------------------------------------------
// REVIEW: Save suggestions only (no content overwrite)
// ------------------------------------------------------------
export async function saveReviewSuggestions(ctx, token, payload = {}) {
  const { env } = ctx;

  const { error, row, token_hash } = await getReviewRowByToken(ctx, token);
  if (error) return error;

  const f = normFollow(payload);

  try {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_draft_reviews
         SET follow_emphasis = CASE WHEN ? IS NULL THEN follow_emphasis ELSE ? END,
             follow_avoid = CASE WHEN ? IS NULL THEN follow_avoid ELSE ? END,
             client_topic_suggestions = CASE WHEN ? IS NULL THEN client_topic_suggestions ELSE ? END,
             updated_at = datetime('now')
       WHERE token_hash = ?
    `).bind(
      f.follow_emphasis, f.follow_emphasis,
      f.follow_avoid, f.follow_avoid,
      f.client_topic_suggestions, f.client_topic_suggestions,
      token_hash
    ).run();
  } catch (e) {
    return errorResponse(ctx, "Suggestions save failed", 500, { detail: String(e?.message || e) });
  }

  return jsonResponse(ctx, { ok: true, action: "suggestions_saved", draft_id: row.draft_id });
}

// ------------------------------------------------------------
// REVIEW: Accept (approves + locks draft)
// - Writes client_content_markdown into blog_drafts (if present)
// - Sets blog_drafts.status=approved and approved_at
// ------------------------------------------------------------
export async function acceptReview(ctx, token, follow = {}) {
  const { env } = ctx;

  const { error, row, token_hash } = await getReviewRowByToken(ctx, token);
  if (error) return error;

  const draft_id = String(row.draft_id || "").trim();
  if (!draft_id) return errorResponse(ctx, "Review row missing draft_id", 500);

  const draft = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    SELECT draft_id, status, content_markdown
      FROM blog_drafts
     WHERE draft_id = ?
     LIMIT 1
  `).bind(draft_id).first();

  if (!draft?.draft_id) return errorResponse(ctx, "Draft not found", 404, { draft_id });

  const st = String(draft.status || "").toLowerCase();
  if (st === DRAFT_STATUS.APPROVED || st === DRAFT_STATUS.PUBLISHED) {
    return jsonResponse(ctx, { ok: true, action: "already_approved", draft_id });
  }

  const f = normFollow(follow);

  // Use client content if present; otherwise keep existing draft copy
  const md = String(row.client_content_markdown || "").trim()
    ? String(row.client_content_markdown)
    : String(draft.content_markdown || "");

  const html = markdownToHtml(stripInternalTelemetryComments(md));

  await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    UPDATE blog_drafts
       SET content_markdown = ?,
           content_html = ?,
           status = ?,
           approved_at = datetime('now'),
           updated_at = datetime('now')
     WHERE draft_id = ?
  `).bind(md, html, DRAFT_STATUS.APPROVED, draft_id).run();

  // Mark review accepted (schema tolerant)
  try {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_draft_reviews
         SET status = 'ACCEPTED',
             decided_at = datetime('now'),
             follow_emphasis = CASE WHEN ? IS NULL THEN follow_emphasis ELSE ? END,
             follow_avoid = CASE WHEN ? IS NULL THEN follow_avoid ELSE ? END,
             client_topic_suggestions = CASE WHEN ? IS NULL THEN client_topic_suggestions ELSE ? END,
             updated_at = datetime('now')
       WHERE token_hash = ?
    `).bind(
      f.follow_emphasis, f.follow_emphasis,
      f.follow_avoid, f.follow_avoid,
      f.client_topic_suggestions, f.client_topic_suggestions,
      token_hash
    ).run();
  } catch (e) {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_draft_reviews
         SET status = 'ACCEPTED',
             updated_at = datetime('now')
       WHERE token_hash = ?
    `).bind(token_hash).run();
  }

  return jsonResponse(ctx, { ok: true, action: "approved", draft_id });
}

// ------------------------------------------------------------
// REVIEW: Submit final (save + accept)
// ------------------------------------------------------------
export async function submitReviewFinal(ctx, token, content_markdown) {
  const saved = await saveReviewEdits(ctx, token, content_markdown, {});
  if (saved instanceof Response && !saved.ok) return saved;
  return acceptReview(ctx, token, {});
}

// ------------------------------------------------------------
// REVIEW: Save visual URL against the draft (token-protected)
// ------------------------------------------------------------
export async function saveReviewVisualUrl(ctx, token, visual_key, imageurl) {
  const { error, row } = await getReviewRowByToken(ctx, token);
  if (error) return error;

  const draft_id = String(row.draft_id || "").trim();
  if (!draft_id) return errorResponse(ctx, "Review row missing draft_id", 500);

  return upsertDraftAsset(ctx, draft_id, visual_key, {
    image_url: String(imageurl || "").trim(),
    provider: "review",
    asset_type: "image",
    status: "ready",
  });
}

// ------------------------------------------------------------
// REVIEW: Debug
// ------------------------------------------------------------
export async function getReviewDebug(ctx, token) {
  const { env } = ctx;

  const { error, row } = await getReviewRowByToken(ctx, token);
  if (error) return error;

const draft = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
  SELECT draft_id, location_id, status, title,
         content_markdown,
         approved_at, updated_at, created_at
    FROM blog_drafts
   WHERE draft_id = ?
   LIMIT 1
`).bind(String(row.draft_id || "")).first();


  // redact token_hash
  const safe = { ...row };
  delete safe.token_hash;

      const draft_markdown =
  String(row.client_content_markdown || "").trim()
    ? String(row.client_content_markdown)
    : String(draft?.content_markdown || "");

return jsonResponse(ctx, {
  ok: true,
  review: safe,
  draft: draft || null,
  draft_id: safe.draft_id || draft?.draft_id || null,
  status: draft?.status || safe.status || null,
  draft_markdown, // <-- NEW: token-authorized markdown for editor prefill
});


}

export async function getReviewVisualsDebug(ctx, token) {
  const { env } = ctx;

  const { error, row } = await getReviewRowByToken(ctx, token);
  if (error) return error;

  const draft_id = String(row.draft_id || "").trim();
  const rs = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    SELECT visual_key, image_url, provider, status, updated_at
      FROM blog_draft_assets
     WHERE draft_id = ?
     ORDER BY visual_key ASC
  `).bind(draft_id).all();

  return jsonResponse(ctx, { ok: true, draft_id, assets: rs?.results || [] });
}


// ---------- Program management ----------
export async function addProgram(ctx, payload = {}) {
  const { env, request } = ctx;

  // Admin auth (returns Response on failure)
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) return admin;

  // Parse JSON body
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errorResponse(ctx, "Invalid JSON body", 400);
  }

  const location_id = String(body?.location_id || "").trim();
  const run_mode = String(body?.run_mode || "manual").trim().toLowerCase();
  const notes = String(body?.notes || "enabled via Blog AI Admin list").trim();

  if (!location_id) return errorResponse(ctx, "location_id required", 400);
  if (!["manual", "auto"].includes(run_mode)) {
    return errorResponse(ctx, "run_mode must be 'manual' or 'auto'", 400);
  }

  // Schema-tolerant enablement:
  // Try INSERT including added_at (preferred), fall back if column doesn't exist.
  try {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      INSERT INTO blog_program_locations (
        location_id, enabled, run_mode, notes, added_at
      ) VALUES (?, 1, ?, ?, datetime('now'))
      ON CONFLICT(location_id) DO UPDATE SET
        enabled = 1,
        run_mode = excluded.run_mode,
        notes = excluded.notes
    `).bind(location_id, run_mode, notes).run();
  } catch (e) {
    const msg = String(e?.message || e);
    console.log("PROGRAM_ADD_UPSERT_FALLBACK", { location_id, error: msg });

    // Fallback: same upsert but without added_at (schema-safe)
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      INSERT INTO blog_program_locations (
        location_id, enabled, run_mode, notes
      ) VALUES (?, 1, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET
        enabled = 1,
        run_mode = excluded.run_mode,
        notes = excluded.notes
    `).bind(location_id, run_mode, notes).run();
  }

  return jsonResponse(ctx, { ok: true, action: "enabled", location_id, run_mode });
}


export async function removeProgram(ctx) {
  const { env, request } = ctx;

  // Admin auth (returns Response on failure)
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) return admin;

  // Parse JSON body
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return errorResponse(ctx, "Invalid JSON body", 400);
  }

  const location_id = String(body?.location_id || "").trim();
  const notes = String(body?.notes || "disabled via Blog AI Admin list").trim();

  if (!location_id) {
    return errorResponse(ctx, "location_id required", 400);
  }

  // Try with removed_at first; fall back if column doesn't exist.
  try {
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_program_locations
         SET enabled = 0,
             notes = ?,
             removed_at = datetime('now')
       WHERE location_id = ?
    `).bind(notes, location_id).run();
  } catch (e) {
    console.log("PROGRAM_REMOVE_UPDATE_FALLBACK", {
      location_id,
      error: String(e?.message || e),
    });

    // Fallback: schema-safe update (no removed_at)
    await env.GNR_MEDIA_BUSINESS_DB.prepare(`
      UPDATE blog_program_locations
         SET enabled = 0,
             notes = ?
       WHERE location_id = ?
    `).bind(notes, location_id).run();
  }

  return jsonResponse(ctx, { ok: true, action: "removed", location_id });
}

export async function setProgramMode(ctx, programid, mode) {
      // TODO: implement
}
export async function setProgramModeBulk(ctx, updates = {}) {
      // TODO: implement
}
export async function listPrograms(ctx) {
      // TODO: implement
}

// ---------- Businesses (remaining) ----------
export async function updateBusinessUrls(ctx, businessid, urls = {}) {
      // TODO: implement
}
export async function backfillBusinessWebsites(ctx, businessid) {
      // TODO: implement
}
export async function backfillBusinessWebsitesMaster(ctx, limit = 50) {
      // TODO: implement
}

// ---------- Editorial / auto cadence ----------
export async function runAutoCadence(_ctx, limit = 25) {
      // TODO: implement
}
export async function getEditorialBrain(ctx, locationid, limit = 10) {
      // TODO: implement
}
export async function backfillEditorialBrain(ctx, locationid, limit = 10) {
      // TODO: implement
}

// ---------- WOW ----------
export async function evaluateWow(ctx, draftid, minscore = 96) {
      // TODO: implement
}

// ---------- WordPress ----------
export async function wordpressConnect(_ctx, payload) {
      // TODO: implement
}
export async function wordpressTest(ctx, locationid) {
      // TODO: implement
}
