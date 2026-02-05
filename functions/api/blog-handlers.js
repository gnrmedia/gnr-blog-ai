// blog-handlers.js — Phase 1: Security + Response plumbing
// -----------------------------------------------------------
// Migrated from zlegacy-workers/blog-ai.worker.js
// Phase 1 implements: requireAdmin, corsHeaders, jsonResponse,
// errorResponse. All other handlers remain TODO stubs.
// -----------------------------------------------------------

// ============================================================
// CORS (admin UI calls blog-api cross-origin)
// Allow ONLY your admin site, and allow credentials (Access cookies)
// ============================================================
const CORS_ALLOWED_ORIGINS = new Set([
    "https://admin.gnrmedia.global",
    "https://gnr-admin.pages.dev",
    "http://localhost:8788",
    "http://localhost:3000",
  ]);

/**
 * Build CORS response headers for a given request.
 * Returns a headers object if the Origin is allowed, or null if not.
 *
 * @param {Object} context - Pages Function context (must have context.request)
 *   OR a raw Request object (for convenience).
 * @returns {Object|null} CORS headers object or null
 */
export function corsHeaders(context) {
    const req = (context && context.request) ? context.request : context;
    if (!req || typeof req.headers?.get !== "function") return null;

  const origin = req.headers.get("Origin");
    if (!origin || !CORS_ALLOWED_ORIGINS.has(origin)) return null;

  const reqHeaders =
        req.headers.get("Access-Control-Request-Headers") ||
        "content-type,authorization";
    const requestedMethod = (
          req.headers.get("Access-Control-Request-Method") ||
          req.method ||
          ""
        ).toUpperCase();
    const allowMethods =
          requestedMethod === "GET" ? "GET,OPTIONS" : "POST,OPTIONS";

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
// JSON Response helper (with CORS)
// ============================================================

/**
 * Return a JSON Response with CORS headers + content-type.
 *
 * @param {Object} context - Pages Function context
 * @param {*} obj - JSON-serialisable payload
 * @param {number} status - HTTP status code (default 200)
 * @returns {Response}
 */
export function jsonResponse(context, obj, status = 200) {
    const cors = corsHeaders(context);
    return new Response(JSON.stringify(obj, null, 2), {
          status,
          headers: {
                  "content-type": "application/json; charset=utf-8",
                  ...(cors || {}),
          },
    });
}

/**
 * Convenience: return a JSON error Response.
 *
 * @param {Object} context - Pages Function context
 * @param {string} error - Short error message
 * @param {number} status - HTTP status code (default 500)
 * @param {Object} extra - Additional fields to include in body
 * @returns {Response}
 */
export function errorResponse(context, error, status = 500, extra = {}) {
    return jsonResponse(context, { ok: false, error, ...extra }, status);
}

// ============================================================
// ADMIN AUTH (Cloudflare Access)
// ============================================================
// ENV vars (set in Pages > Settings > Environment variables):
//   ADMIN_EMAILS  — comma-separated exact emails (optional)
//   ADMIN_DOMAINS — comma-separated domains e.g. gnrmedia.global (optional)
//
// Cloudflare Access injects identity headers when the request
// passes through. We trust Access to block unauthenticated
// requests and do an extra allowlist check here (defense-in-depth).
// ============================================================

function parseCsv(s) {
    return String(s || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
}

function getAccessEmail(req) {
    const h =
          req.headers.get("cf-access-authenticated-user-email") ||
          req.headers.get("Cf-Access-Authenticated-User-Email") ||
          "";
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

  // If neither ADMIN_EMAILS nor ADMIN_DOMAINS is set, default DENY.
  return false;
}

/**
 * Require admin authentication via Cloudflare Access.
 *
 * Returns { email } on success, or a Response (401/403) on failure.
 * Route files should do:
 *   const admin = requireAdmin(context);
 *   if (admin instanceof Response) return admin;
 *
 * @param {Object} context - Pages Function context ({ request, env })
 * @returns {{ email: string } | Response}
 */
export function requireAdmin(context) {
    const { request, env } = context;
    const email = getAccessEmail(request);

  if (!email) {
        return jsonResponse(
                context,
          {
                    error: "Unauthorized",
                    detail:
                                "Missing Cloudflare Access identity header. Ensure this route is protected by Cloudflare Access.",
          },
                401
              );
  }

  if (!isAllowedAdmin(email, env)) {
        return jsonResponse(context, { error: "Forbidden", email }, 403);
  }

  return { email };
}

// ============================================================
// Remaining handler stubs (Phase 2+)
// All TODO — implementations will be migrated incrementally
// from zlegacy-workers/blog-ai.worker.js
// ============================================================

// ---------- Core admin actions ----------
export async function runNowForLocation(_ctx, locationid) {
    // TODO: implement
}

// ---------- Draft spine ----------
export async function createDraftForLocation(_ctx, locationid) {
    // TODO: implement
}

export async function generateAiForDraft(_ctx, draftid, options = {}) {
    // TODO: implement
}

export async function listDraftsForLocation(ctx, locationid, limit = 20) {
    // TODO: implement
}

export async function getDraftById(_ctx, draftid) {
    // TODO: implement
}

export async function renderDraftHtml(_ctx, draftid) {
    // TODO: implement
}

// ---------- Draft asset management ----------
export async function upsertDraftAsset(_ctx, draftid, key, assetData) {
    // TODO: implement
}

// ---------- Review flow ----------
export async function createReviewLink(_ctx, draftid, clientemail = null) {
    // TODO: implement
}

export async function acceptReview(_ctx, token, follow = {}) {
    // TODO: implement
}

export async function saveReviewEdits(_ctx, token, content_markdown, follow = {}) {
    // TODO: implement
}

export async function submitReviewFinal(ctx, token, content_markdown) {
    // TODO: implement
}

export async function saveReviewSuggestions(_ctx, token, payload = {}) {
    // TODO: implement
}

export async function saveReviewVisualUrl(_ctx, token, visual_key, imageurl) {
    // TODO: implement
}

export async function getReviewDebug(ctx, token) {
    // TODO: implement
}

export async function getReviewVisualsDebug(ctx, token) {
    // TODO: implement
}

// ---------- Program management ----------
export async function addProgram(ctx, payload = {}) {
    // TODO: implement
}

export async function removeProgram(ctx, programid) {
    // TODO: implement
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

// ---------- Businesses ----------
export async function listBusinesses(ctx) {
    // TODO: implement
}

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
